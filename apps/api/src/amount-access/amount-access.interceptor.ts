import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth/auth.types';
import { GLOBAL_AMOUNT_FIELDS } from './amount-field-registry';
import { AmountAccessService } from './amount-access.service';
import {
  AMOUNT_ALL_SCOPE_ONLY_KEY,
  AMOUNT_SCOPE_EXEMPT_KEY,
  REQUIRE_AMOUNT_EDIT_KEY,
} from './amount-access.decorator';

type AuthenticatedRequest = {
  user?: AuthUser;
};

@Injectable()
export class AmountAccessInterceptor implements NestInterceptor {
  constructor(
    @Inject(AmountAccessService) private readonly amountAccess: AmountAccessService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    if (!userId) return next.handle();

    const access = await this.amountAccess.forUser(userId);
    const requiresEdit = this.reflector.getAllAndOverride<boolean>(REQUIRE_AMOUNT_EDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiresEdit)
      await this.amountAccess.assertCanEdit(userId);

    const scopeExempt = Boolean(
      this.reflector.getAllAndOverride<boolean>(AMOUNT_SCOPE_EXEMPT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]),
    );
    const allScopeOnly = Boolean(
      this.reflector.getAllAndOverride<boolean>(AMOUNT_ALL_SCOPE_ONLY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]),
    );
    // 能力级：无查看权 → 金额字段全部置空（含 none，也含仅编辑语义之外的任何无查看状态）。
    if (!access.canViewAmount) {
      return next.handle().pipe(
        map((value) => this.amountAccess.maskFields(value, GLOBAL_AMOUNT_FIELDS)),
      );
    }
    // 库存成本快照（盘点单明细/盘点衍生的报亏、报盈成本价）：金额不随 created_by 归属放行，
    // 仅"权限内全部"可见；own 范围一律置空，防止通过单据详情反推库存价值。
    if (allScopeOnly && access.amountScope !== 'all') {
      return next.handle().pipe(
        map((value) => this.amountAccess.maskFields(value, GLOBAL_AMOUNT_FIELDS)),
      );
    }
    // 范围级：仅自己经办 → 按记录归属脱敏；主数据（无经办归属）端点豁免。
    if (access.amountScope === 'own' && !scopeExempt) {
      return next.handle().pipe(
        map((value) => this.amountAccess.maskAmountsByOwner(value, userId)),
      );
    }
    return next.handle();
  }
}
