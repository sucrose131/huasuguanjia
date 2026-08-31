import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export type CreateTodoInput = {
  /** 接收人（hspsi_sys_user.id） */
  userId: number;
  /** 单据所属组织 id */
  organizationId: number;
  /** 待办标题，通常为单据编号 */
  title: string;
  /** 待办提示文案 */
  content: string;
  /** 业务类型：按业务表名去 hspsi_ 前缀，如 purchase_order / draw_approve */
  businessType: string;
  /** 业务单据 id（对应业务表主键） */
  businessId: number;
  /** 操作人（登录用户 id 字符串） */
  actorUserId: string;
};

/**
 * 系统待办写入服务。
 *
 * hspsi_sys_todo 的读取方为工作台「待办事项」（dashboard/todos 按 user_id + status=0 过滤）。
 * 本服务提供幂等写入：同一 (business_type, business_id, user_id, status=0) 未完成记录已存在时不重复写。
 * 支持传入事务客户端以保持与业务操作的原子性（默认使用全局 PrismaService）。
 */
@Injectable()
export class TodoService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(
    input: CreateTodoInput,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ created: boolean }> {
    if (!input.userId || input.userId <= 0) return { created: false };
    const existing = await db.hspsi_sys_todo.findFirst({
      where: {
        business_type: input.businessType,
        business_id: input.businessId,
        user_id: input.userId,
        status: 0,
        deleted_at: null,
      },
      select: { id: true },
    });
    if (existing) return { created: false };
    await db.hspsi_sys_todo.create({
      data: {
        organization_id: input.organizationId || 0,
        user_id: input.userId,
        title: input.title,
        content: input.content,
        source_type: input.businessType,
        source_id: input.businessId,
        business_type: input.businessType,
        business_id: input.businessId,
        status: 0,
        created_by: Number(input.actorUserId) || 0,
        updated_by: Number(input.actorUserId) || 0,
      },
    });
    return { created: true };
  }

  /**
   * 按业务单据批量关闭未完成待办（status=0 → 1 + completed_time）。
   * 用于审批类待办：单据审批通过/驳回后，把写给所有审批人的待办一次清掉。
   * 返回关闭条数。
   */
  async completeByBusiness(
    businessType: string,
    businessId: number,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const result = await db.hspsi_sys_todo.updateMany({
      where: { business_type: businessType, business_id: businessId, status: 0, deleted_at: null },
      data: { status: 1, completed_time: new Date() },
    });
    return result.count;
  }

  /**
   * 按「权限码 + 组织授权」解析待办接收人（配置化，不写死角色）。
   *
   * 权限码对应 hspsi_sys_menu.code（如 purchase:applications:generate-order）；
   * 返回该组织下、拥有该菜单权限（或 admin 角色）的用户 id 列表。
   * 与领用审批人判定（requisitions:applications:approve）同一范式，仅参数化权限码。
   * 无匹配配置时返回空数组，调用方按“无人接收”处理即可。
   */
  async resolveRecipients(
    permissionCode: string,
    orgId: number,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number[]> {
    if (!permissionCode || !orgId) return [];
    const authorized = await db.hspsi_sys_user_authorized_org.findMany({
      where: { org_id: orgId },
      select: { user_id: true },
    });
    const candidateIds = [...new Set(authorized.map((item) => Number(item.user_id)))];
    if (!candidateIds.length) return [];
    const userRoles = await db.hspsi_sys_user_role.findMany({
      where: { user_id: { in: candidateIds } },
    });
    const roleIds = [...new Set(userRoles.map((item) => Number(item.role_id)))];
    const roles = roleIds.length
      ? await db.hspsi_sys_role.findMany({
          where: { id: { in: roleIds.map((id) => BigInt(id)) }, status: 1, deleted_at: null },
          select: { id: true, code: true },
        })
      : [];
    const adminRoleIds = new Set(
      roles.filter((role) => role.code === 'admin').map((role) => Number(role.id)),
    );
    const roleMenus = roleIds.length
      ? await db.hspsi_sys_role_menu.findMany({
          where: { role_id: { in: roleIds.map((id) => BigInt(id)) } },
        })
      : [];
    const menuIds = [...new Set(roleMenus.map((item) => Number(item.menu_id)))];
    const menus = menuIds.length
      ? await db.hspsi_sys_menu.findMany({
          where: { id: { in: menuIds }, deleted_at: null, status: 1 },
          select: { id: true, code: true },
        })
      : [];
    const targetMenuIds = new Set(
      menus.filter((menu) => menu.code === permissionCode).map((menu) => menu.id),
    );
    const approvedRoleIds = new Set<number>();
    adminRoleIds.forEach((id) => approvedRoleIds.add(id));
    roleMenus.forEach((item) => {
      if (targetMenuIds.has(Number(item.menu_id))) approvedRoleIds.add(Number(item.role_id));
    });
    const userIds = new Set<number>();
    userRoles.forEach((item) => {
      if (approvedRoleIds.has(Number(item.role_id))) userIds.add(Number(item.user_id));
    });
    return [...userIds];
  }
}
