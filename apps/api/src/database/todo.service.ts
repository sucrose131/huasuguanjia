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
}
