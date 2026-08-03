import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthRequest } from './auth.types';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (!required.length) return true;
    const permissions = context.switchToHttp().getRequest<AuthRequest>().user?.permissions ?? [];
    if (
      permissions.includes('*') ||
      required.some((permission) => permissions.includes(permission))
    )
      return true;
    throw new ForbiddenException('当前账号没有执行该操作的权限');
  }
}
