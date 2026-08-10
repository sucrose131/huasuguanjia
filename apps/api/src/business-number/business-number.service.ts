import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  BUSINESS_PREFIX,
  BUSINESS_NUMBER_DAILY_LIMIT,
  BUSINESS_NUMBER_TIME_ZONE,
  BusinessPrefix,
  PURCHASE_BUSINESS_NUMBER_DAILY_LIMIT,
  PURCHASE_BUSINESS_PREFIXES,
} from './business-number.constants';

const INCREMENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('SET', KEYS[1], ARGV[2])
end
local value = redis.call('INCR', KEYS[1])
if value == tonumber(ARGV[2]) + 1 then
  redis.call('EXPIREAT', KEYS[1], ARGV[1])
end
return value
`;

@Injectable()
export class BusinessNumberService {
  private readonly environment: string;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
    const isPurchaseNumber = PURCHASE_BUSINESS_PREFIXES.has(prefix);
    const key = isPurchaseNumber
      ? `hspsi:${this.environment}:business-no:${prefix}:${date}`
      : `hspsi:${this.environment}:business-no:${date}`;
    const dailyLimit = isPurchaseNumber
      ? PURCHASE_BUSINESS_NUMBER_DAILY_LIMIT
      : BUSINESS_NUMBER_DAILY_LIMIT;
    const sequenceWidth = isPurchaseNumber ? 4 : 6;
    const initialSequence = isPurchaseNumber
      ? await this.existingPurchaseSequence(prefix, date)
      : 0;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.redis.ensureConnected();
        const raw = await this.redis.client.eval(
          INCREMENT_SCRIPT,
          1,
          key,
          String(expiresAt),
          String(initialSequence),
        );
        const sequence = Number(raw);
        if (!Number.isSafeInteger(sequence) || sequence <= 0)
          throw new Error('Redis 返回了无效的业务单号序列');
        if (sequence > dailyLimit)
          throw new ServiceUnavailableException(
            `当日${isPurchaseNumber ? '该采购类型' : '业务'}单号数量已超过 ${dailyLimit} 条`,
          );
        return `${prefix}${date}${String(sequence).padStart(sequenceWidth, '0')}`;
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

  private async existingPurchaseSequence(prefix: BusinessPrefix, date: string) {
    const startsWith = `${prefix}${date}`;
    let currentNumber = '';
    switch (prefix) {
      case BUSINESS_PREFIX.PURCHASE_APPLICATION:
        currentNumber =
          (
            await this.prisma.hspsi_purchase_approve.findFirst({
              where: { pur_no: { startsWith } },
              orderBy: { pur_no: 'desc' },
              select: { pur_no: true },
            })
          )?.pur_no ?? '';
        break;
      case BUSINESS_PREFIX.PURCHASE_ORDER:
        currentNumber =
          (
            await this.prisma.hspsi_purchase_order.findFirst({
              where: { po_no: { startsWith } },
              orderBy: { po_no: 'desc' },
              select: { po_no: true },
            })
          )?.po_no ?? '';
        break;
      case BUSINESS_PREFIX.PURCHASE_RECEIPT:
        currentNumber =
          (
            await this.prisma.hspsi_purchase_order_input.findFirst({
              where: { po_input_no: { startsWith } },
              orderBy: { po_input_no: 'desc' },
              select: { po_input_no: true },
            })
          )?.po_input_no ?? '';
        break;
      case BUSINESS_PREFIX.PURCHASE_RETURN:
        currentNumber =
          (
            await this.prisma.hspsi_purchase_order_input_exit.findFirst({
              where: { po_exit_no: { startsWith } },
              orderBy: { po_exit_no: 'desc' },
              select: { po_exit_no: true },
            })
          )?.po_exit_no ?? '';
        break;
      case BUSINESS_PREFIX.PURCHASE_PAYMENT:
        currentNumber =
          (
            await this.prisma.hspsi_purchase_order_payment.findFirst({
              where: { pay_no: { startsWith } },
              orderBy: { pay_no: 'desc' },
              select: { pay_no: true },
            })
          )?.pay_no ?? '';
        break;
      case BUSINESS_PREFIX.PURCHASE_REFUND:
        currentNumber =
          (
            await this.prisma.hspsi_purchase_refund.findFirst({
              where: { refund_no: { startsWith } },
              orderBy: { refund_no: 'desc' },
              select: { refund_no: true },
            })
          )?.refund_no ?? '';
        break;
      case BUSINESS_PREFIX.PURCHASE_REFUND_FLOW:
        currentNumber =
          (
            await this.prisma.hspsi_purchase_refund_flow.findFirst({
              where: { flow_no: { startsWith } },
              orderBy: { flow_no: 'desc' },
              select: { flow_no: true },
            })
          )?.flow_no ?? '';
        break;
      default:
        return 0;
    }
    const sequence = Number(currentNumber.slice(-4));
    return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 0;
  }

  private delay(milliseconds: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}
