import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  AMOUNT_OWNER_FIELDS,
  GLOBAL_AMOUNT_FIELDS,
} from './amount-field-registry';

export type AmountAccessLevel = 'none' | 'view' | 'edit';
/** 金额数据范围：own=仅自己经办单据，all=权限内全部单据 */
export type AmountScope = 'own' | 'all';

export interface AmountAccessState {
  level: AmountAccessLevel;
  canViewAmount: boolean;
  canEditAmount: boolean;
  amountScope: AmountScope;
}

const NONE: AmountAccessState = {
  level: 'none',
  canViewAmount: false,
  canEditAmount: false,
  amountScope: 'own',
};

const scopeFromDb = (value: number | null | undefined): AmountScope =>
  Number(value) === 2 ? 'all' : 'own';

export { scopeFromDb as amountScopeFromDb };

@Injectable()
export class AmountAccessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  fromFlags(
    canViewAmount: number | boolean,
    canEditAmount: number | boolean,
    amountScope: AmountScope = 'own',
  ): AmountAccessState {
    const canEdit = Boolean(canEditAmount);
    const canView = canEdit || Boolean(canViewAmount);
    return {
      level: canEdit ? 'edit' : canView ? 'view' : 'none',
      canViewAmount: canView,
      canEditAmount: canEdit,
      amountScope,
    };
  }

  async forUser(userId: string): Promise<AmountAccessState> {
    const id = BigInt(userId);
    const [user, access] = await Promise.all([
      this.prisma.hspsi_sys_user.findFirst({
        where: { id, status: 1, deleted_at: null },
        select: { id: true },
      }),
      this.prisma.hspsi_sys_user_amount_access.findUnique({ where: { user_id: id } }),
    ]);
    if (!user || !access) return { ...NONE };
    return this.fromFlags(
      access.can_view_amount,
      access.can_edit_amount,
      scopeFromDb(access.amount_scope),
    );
  }

  async assertCanEdit(userId: string) {
    const access = await this.forUser(userId);
    if (!access.canEditAmount)
      throw new ForbiddenException('当前账号不在金额编辑白名单中');
    return access;
  }

  /**
   * 记录级编辑断言：能力校验（必须可编辑）之上，叠加金额数据范围。
   * amount_scope=own 时只允许编辑自己经办（created_by=当前用户）的单据金额；
   * amount_scope=all 时只要具备编辑能力即可。
   */
  async assertCanEditRecord(
    userId: string,
    ownerId: string | number | bigint | null | undefined,
  ) {
    const access = await this.forUser(userId);
    if (!access.canEditAmount)
      throw new ForbiddenException('当前账号不在金额编辑白名单中');
    if (access.amountScope === 'own' && String(ownerId ?? '') !== String(userId))
      throw new ForbiddenException('当前账号只能编辑自己经办单据的金额');
    return access;
  }

  async saveForUser(
    targetUserId: string,
    body: Record<string, unknown>,
    operatorUserId: string,
  ) {
    const targetId = BigInt(targetUserId);
    const operatorId = BigInt(operatorUserId);
    const target = await this.prisma.hspsi_sys_user.findFirst({
      where: { id: targetId, deleted_at: null },
      select: { id: true, username: true, nickname: true, status: true },
    });
    if (!target) throw new NotFoundException('用户不存在');

    const level = String(body.level ?? '') as AmountAccessLevel;
    if (!['none', 'view', 'edit'].includes(level))
      throw new BadRequestException('金额权限等级无效');
    const rawScope = String(body.amountScope ?? 'own') as AmountScope;
    if (!['own', 'all'].includes(rawScope))
      throw new BadRequestException('金额数据范围无效');
    const amountScope: AmountScope = rawScope;
    const grantReason = String(body.grantReason ?? '').trim();
    if (!grantReason || grantReason.length > 255)
      throw new BadRequestException('授权原因长度应为1至255个字符');
    if (level !== 'none' && target.status !== 1)
      throw new BadRequestException('停用账号不能加入金额白名单');

    const old = await this.prisma.hspsi_sys_user_amount_access.findUnique({
      where: { user_id: targetId },
    });
    const oldState = old
      ? this.fromFlags(old.can_view_amount, old.can_edit_amount, scopeFromDb(old.amount_scope))
      : { ...NONE };
    const nextState =
      level === 'edit'
        ? this.fromFlags(1, 1, amountScope)
        : level === 'view'
          ? this.fromFlags(1, 0, amountScope)
          : { ...NONE };
    const scopeDbValue = amountScope === 'all' ? 2 : 1;

    await this.prisma.$transaction(async (tx) => {
      if (level === 'none') {
        await tx.hspsi_sys_user_amount_access.deleteMany({ where: { user_id: targetId } });
      } else {
        await tx.hspsi_sys_user_amount_access.upsert({
          where: { user_id: targetId },
          create: {
            user_id: targetId,
            can_view_amount: nextState.canViewAmount ? 1 : 0,
            can_edit_amount: nextState.canEditAmount ? 1 : 0,
            amount_scope: scopeDbValue,
            grant_reason: grantReason,
            created_by: operatorId,
            updated_by: operatorId,
          },
          update: {
            can_view_amount: nextState.canViewAmount ? 1 : 0,
            can_edit_amount: nextState.canEditAmount ? 1 : 0,
            amount_scope: scopeDbValue,
            grant_reason: grantReason,
            updated_by: operatorId,
            updated_at: new Date(),
          },
        });
      }
      await tx.hspsi_sys_oper_log.create({
        data: {
          method: 'PUT',
          router: `/system/users/${targetUserId}/amount-access`,
          url: `/system/users/${targetUserId}/amount-access`,
          service_name: 'amount-access',
          request_data: JSON.stringify({
            targetUserId,
            targetUsername: target.username,
            oldLevel: oldState.level,
            oldScope: oldState.amountScope,
            newLevel: nextState.level,
            newScope: nextState.amountScope,
            grantReason,
          }),
          response_code: '200',
          response_data: JSON.stringify({
            amountAccess: nextState.level,
            amountScope: nextState.amountScope,
          }),
          created_by: Number(operatorId),
          updated_by: Number(operatorId),
        },
      });
    });

    return {
      id: targetUserId,
      amountAccess: nextState.level,
      amountScope: nextState.amountScope,
      message: level === 'none' ? '金额权限已取消' : '金额权限已保存',
    };
  }

  maskFields<T>(value: T, fieldNames: ReadonlySet<string>): T {
    const visit = (current: unknown): unknown => {
      if (Array.isArray(current)) return current.map(visit);
      if (!current || typeof current !== 'object') return current;
      if (Object.getPrototypeOf(current) !== Object.prototype) return current;
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>).map(([key, item]) => [
          key,
          fieldNames.has(key) ? null : visit(item),
        ]),
      );
    };
    return visit(value) as T;
  }

  /**
   * 按记录归属脱敏（amount_scope=own）：
   * - 命中 AMOUNT_OWNER_FIELDS 的对象按 created_by 与当前用户比对，重新决定本节点归属；
   * - 子节点（明细行等）通常无归属字段，继承父级判定；
   * - 无归属字段可判定的节点默认拒绝（金额置空），例如跨单据聚合结果。
   */
  maskAmountsByOwner<T>(value: T, userId: string): T {
    const current = String(userId);
    const visit = (node: unknown, inherited: 'own' | 'other' | 'unknown'): unknown => {
      if (Array.isArray(node)) return node.map((item) => visit(item, inherited));
      if (!node || typeof node !== 'object') return node;
      if (Object.getPrototypeOf(node) !== Object.prototype) return node;
      const source = node as Record<string, unknown>;
      let state = inherited;
      for (const key of Object.keys(source)) {
        if (AMOUNT_OWNER_FIELDS.has(key)) {
          state = String(source[key] ?? '') === current ? 'own' : 'other';
          break;
        }
      }
      const masked: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(source)) {
        if (state !== 'own' && GLOBAL_AMOUNT_FIELDS.has(key)) masked[key] = null;
        else masked[key] = visit(item, state);
      }
      return masked;
    };
    return visit(value, 'unknown') as T;
  }
}
