import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { AuthRequest, AuthUser } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('请先登录');
    try {
      const payload = await this.jwt.verifyAsync<AuthUser & { sid: string }>(token);
      await this.redis.ensureConnected();
      if (!(await this.redis.client.exists(`session:${payload.sid}`))) throw new Error('expired');
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }
  }
}
