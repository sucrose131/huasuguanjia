import { Controller, Get, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}
  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    await this.redis.ensureConnected();
    const redis = await this.redis.client.ping();
    return { status: 'up', mysql: 'up', redis: redis === 'PONG' ? 'up' : 'down' };
  }
}
