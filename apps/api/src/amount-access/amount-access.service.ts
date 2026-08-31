import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export type AmountAccessLevel = 'none' | 'view' | 'edit';

export interface AmountAccessState {
  level: AmountAccessLevel;
  canViewAmount: boolean;
  canEditAmount: boolean;
}

const NONE: AmountAccessState = {
  level: 'none',
  canViewAmount: false,
  canEditAmount: false,
};

@Injectable()
export class AmountAccessService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  fromFlags(canViewAmount: number | boolean, canEditAmount: number | boolean): AmountAccessState {
    const canEdit = Boolean(canEditAmount);
    const canView = canEdit || Boolean(canViewAmount);
    return {
      level: canEdit ? 'edit' : canView ? 'view' : 'none',
      canViewAmount: canView,
      canEditAmount: canEdit,
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
    return this.fromFlags(access.can_view_amount, access.can_edit_amount);
  }

  async assertCanEdit(userId: string) {
    const access = await this.forUser(userId);
    if (!access.canEditAmount)
      throw new ForbiddenException('当前账号不在金额编辑白名单中');
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
    const grantReason = String(body.grantReason ?? '').trim();
    if (!grantReason || grantReason.length > 255)
      throw new BadRequestException('授权原因长度应为1至255个字符');
    if (level !== 'none' && target.status !== 1)
      throw new BadRequestException('停用账号不能加入金额白名单');

    const old = await this.prisma.hspsi_sys_user_amount_access.findUnique({
      where: { user_id: targetId },
    });
    const oldState = old
      ? this.fromFlags(old.can_view_amount, old.can_edit_amount)
      : { ...NONE };
    const nextState =
      level === 'edit'
        ? this.fromFlags(1, 1)
        : level === 'view'
          ? this.fromFlags(1, 0)
          : { ...NONE };

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
            grant_reason: grantReason,
            created_by: operatorId,
            updated_by: operatorId,
          },
          update: {
            can_view_amount: nextState.canViewAmount ? 1 : 0,
            can_edit_amount: nextState.canEditAmount ? 1 : 0,
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
            newLevel: nextState.level,
            grantReason,
          }),
          response_code: '200',
          response_data: JSON.stringify({ amountAccess: nextState.level }),
          created_by: Number(operatorId),
          updated_by: Number(operatorId),
        },
      });
    });

    return {
      id: targetUserId,
      amountAccess: nextState.level,
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
}
