import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import {
  BUSINESS_NUMBER_DAILY_LIMIT,
  BUSINESS_NUMBER_TIME_ZONE,
  BusinessPrefix,
} from './business-number.constants';

const INCREMENT_SCRIPT = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then
  redis.call('EXPIREAT', KEYS[1], ARGV[1])
end
return value
`;

@Injectable()
export class BusinessNumberService {
  private readonly environment: string;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    const nodeEnvironment = String(config.get('NODE_ENV') ?? 'development')
      .trim()
      .toLowerCase();
    this.environment = nodeEnvironment === 'production' ? 'production' : nodeEnvironment;
  }

  async generate(prefix: BusinessPrefix): Promise<string> {
    if (!/^[A-Z]{1,6}$/.test(prefix)) throw new Error('业务单号前缀无效');
    const { date, expiresAt } = this.shanghaiBusinessDay(new Date());
    const key = `hspsi:${this.environment}:business-no:${date}`;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.redis.ensureConnected();
        const raw = await this.redis.client.eval(INCREMENT_SCRIPT, 1, key, String(expiresAt));
        const sequence = Number(raw);
        if (!Number.isSafeInteger(sequence) || sequence <= 0)
          throw new Error('Redis 返回了无效的业务单号序列');
        if (sequence > BUSINESS_NUMBER_DAILY_LIMIT)
          throw new ServiceUnavailableException('当日业务单号数量已超过 999999 条');
        return `${prefix}${date}${String(sequence).padStart(6, '0')}`;
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        lastError = error;
        if (attempt < 3) await this.delay(attempt * 25);
      }
    }

    throw new ServiceUnavailableException(
      '业务单号服务暂不可用，请稍后重试',
      lastError instanceof Error ? { cause: lastError } : undefined,
    );
  }

  private shanghaiBusinessDay(now: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_NUMBER_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? '';
    const year = Number(part('year'));
    const month = Number(part('month'));
    const day = Number(part('day'));
    const date = `${part('year')}${part('month')}${part('day')}`;
    // 上海全年固定 UTC+8；保留到对应业务日期结束后的第二天零点。
    const expiresAt = Math.floor((Date.UTC(year, month - 1, day + 2) - 8 * 3600_000) / 1000);
    return { date, expiresAt };
  }

  private delay(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}
