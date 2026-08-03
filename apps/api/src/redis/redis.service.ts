import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  constructor(@Inject(ConfigService) config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }
  async ensureConnected() {
    if (this.client.status === 'wait') await this.client.connect();
  }
  async onModuleDestroy() {
    if (this.client.status !== 'end') await this.client.quit();
  }
}
