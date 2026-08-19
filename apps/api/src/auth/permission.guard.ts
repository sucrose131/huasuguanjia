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
import { inferRequestPermissions } from './request-permission';

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
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const permissions = request.user?.permissions ?? [];
    if (permissions.includes('*')) return true;
    const granular = inferRequestPermissions(request);
    if (granular.length && granular.every((permission) => permissions.includes(permission)))
      return true;
    // 选项/辅助接口（无法映射到具体页面）使用显式装饰器权限，通常为模块目录 code（如 sales）。
    // 拥有该模块下任一页面/操作权限（sales:orders 等）即视为具备访问下拉选项的能力，
    // 避免新角色只分配了页面权限却没有目录 code 时，列表能打开但 options 报 403。
    if (
      !granular.length &&
      required.some(
        (permission) =>
          permissions.includes(permission) ||
          permissions.some((item) => item.startsWith(`${permission}:`)),
      )
    )
      return true;
    throw new ForbiddenException('当前账号没有执行该操作的权限');
  }
}
