import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { assertCronExpr, formatShanghaiDateTime, nextRunAt } from './cron.util';
import {
  DEFAULT_CRON_EXPR,
  SCHEDULED_TASK_LAST_STATUS,
  SCHEDULED_TASK_STATUS,
  SCHEDULED_TASK_TRIGGER,
  SCHEDULED_TASK_TYPES,
  type ScheduledTaskCode,
} from './scheduled-task.constants';

type Body = Record<string, unknown>;

type RunMeta = {
  triggerType?: number;
  triggeredBy?: bigint;
  runId?: bigint;
  /** 执行历史入库文案；不传则与 last_message 相同 */
  runMessage?: string;
};

@Injectable()
export class ScheduledTaskService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  types() {
    return this.occupiedCodes().then((occupied) =>
      SCHEDULED_TASK_TYPES.map((item) => ({
        code: item.code,
        name: item.name,
        occupied: occupied.has(item.code),
      })),
    );
  }

  previewCron(cronExpr: unknown) {
    const expr = this.cron(cronExpr);
    const next = nextRunAt(expr);
    return { cronExpr: expr, nextRunAt: formatShanghaiDateTime(next) };
  }

  async list() {
    const rows = await this.prisma.hspsi_sys_scheduled_task.findMany({
      where: { deleted_at: null },
      orderBy: { id: 'asc' },
    });
    const typeName = new Map<string, string>(
      SCHEDULED_TASK_TYPES.map((item) => [item.code, item.name]),
    );
    return rows.map((row) => this.present(row, typeName.get(row.task_code) ?? row.task_code));
  }

  async create(body: Body, userId: string) {
    const taskCode = this.taskCode(body.taskCode);
    const type = SCHEDULED_TASK_TYPES.find((item) => item.code === taskCode);
    if (!type) throw new BadRequestException('未注册的任务类型');
    const existing = await this.prisma.hspsi_sys_scheduled_task.findFirst({
      where: { task_code: taskCode, deleted_at: null },
    });
    if (existing) throw new ConflictException('该任务类型已存在，请先删除或直接编辑');
    const taskName = this.text(body.taskName ?? type.name, '任务名称', 1, 100);
    const cronExpr = this.cron(body.cronExpr ?? DEFAULT_CRON_EXPR);
    const status = this.status(body.status ?? SCHEDULED_TASK_STATUS.DISABLED);
    const remark = this.text(body.remark ?? '', '备注', 0, 255);
    const operator = this.parseUserId(userId);
    const created = await this.prisma.hspsi_sys_scheduled_task.create({
      data: {
        task_code: taskCode,
        task_name: taskName,
        cron_expr: cronExpr,
        status,
        remark,
        created_by: operator,
        updated_by: operator,
      },
    });
    return this.present(created, type.name);
  }

  async update(id: string, body: Body, userId: string) {
    const current = await this.requireTask(id);
    if (body.taskCode !== undefined && String(body.taskCode) !== current.task_code) {
      throw new BadRequestException('任务类型创建后不可修改');
    }
    const type = SCHEDULED_TASK_TYPES.find((item) => item.code === current.task_code);
    const taskName = this.text(body.taskName ?? current.task_name, '任务名称', 1, 100);
    const cronExpr = this.cron(body.cronExpr ?? current.cron_expr);
    const status = this.status(body.status ?? current.status);
    const remark = this.text(body.remark ?? current.remark, '备注', 0, 255);
    const updated = await this.prisma.hspsi_sys_scheduled_task.update({
      where: { id: current.id },
      data: {
        task_name: taskName,
        cron_expr: cronExpr,
        status,
        remark,
        updated_by: this.parseUserId(userId),
        updated_at: new Date(),
      },
    });
    return this.present(updated, type?.name ?? current.task_code);
  }

  async remove(id: string, userId: string) {
    const current = await this.requireTask(id);
    await this.prisma.hspsi_sys_scheduled_task.update({
      where: { id: current.id },
      data: {
        deleted_at: new Date(),
        updated_by: this.parseUserId(userId),
        updated_at: new Date(),
      },
    });
    return { id: String(current.id), deleted: true };
  }

  async requireTask(id: string) {
    const numeric = Number(id);
    if (!Number.isInteger(numeric) || numeric <= 0) throw new BadRequestException('任务ID格式不正确');
    const row = await this.prisma.hspsi_sys_scheduled_task.findFirst({
      where: { id: BigInt(numeric), deleted_at: null },
    });
    if (!row) throw new NotFoundException('任务不存在或已删除');
    return row;
  }

  async listEnabled() {
    return this.prisma.hspsi_sys_scheduled_task.findMany({
      where: { deleted_at: null, status: SCHEDULED_TASK_STATUS.ENABLED },
      orderBy: { id: 'asc' },
    });
  }

  async listRuns(taskId: string) {
    const task = await this.requireTask(taskId);
    const rows = await this.prisma.hspsi_sys_scheduled_task_run.findMany({
      where: { task_id: task.id },
      orderBy: { id: 'desc' },
      take: 50,
    });
    return rows.map((row) => this.presentRun(row));
  }

  async getRun(taskId: string, runId: string) {
    const task = await this.requireTask(taskId);
    const numeric = Number(runId);
    if (!Number.isInteger(numeric) || numeric <= 0) throw new BadRequestException('执行记录ID格式不正确');
    const row = await this.prisma.hspsi_sys_scheduled_task_run.findFirst({
      where: { id: BigInt(numeric), task_id: task.id },
    });
    if (!row) throw new NotFoundException('执行记录不存在');
    return this.presentRun(row);
  }

  parseUserId(userId: string): bigint {
    if (!/^\d+$/.test(userId || '')) {
      throw new BadRequestException('用户身份无效');
    }
    return BigInt(userId);
  }

  async markRunStart(id: bigint, meta: RunMeta = {}) {
    const now = new Date();
    await this.prisma.hspsi_sys_scheduled_task.update({
      where: { id },
      data: {
        last_run_at: now,
        last_status: SCHEDULED_TASK_LAST_STATUS.RUNNING,
        last_message: '',
        updated_at: now,
      },
    });
    if (meta.runId) {
      await this.prisma.hspsi_sys_scheduled_task_run.update({
        where: { id: meta.runId },
        data: { started_at: now, status: SCHEDULED_TASK_LAST_STATUS.RUNNING },
      });
      return meta.runId;
    }
    const created = await this.prisma.hspsi_sys_scheduled_task_run.create({
      data: {
        task_id: id,
        started_at: now,
        status: SCHEDULED_TASK_LAST_STATUS.RUNNING,
        message: '',
        trigger_type: meta.triggerType ?? SCHEDULED_TASK_TRIGGER.CRON,
        triggered_by: meta.triggeredBy ?? 0n,
      },
    });
    return created.id;
  }

  async markRunResult(id: bigint, lastStatus: number, lastMessage: string, runId?: bigint, meta: RunMeta = {}) {
    const info = meta ?? {};
    const runMessage = info.runMessage ?? lastMessage;
    const now = new Date();
    await this.prisma.hspsi_sys_scheduled_task.update({
      where: { id },
      data: {
        last_status: lastStatus,
        last_message: lastMessage,
        updated_at: now,
      },
    });
    if (runId) {
      const current = await this.prisma.hspsi_sys_scheduled_task_run.findUnique({ where: { id: runId } });
      const startedAt = current?.started_at ?? now;
      await this.prisma.hspsi_sys_scheduled_task_run.update({
        where: { id: runId },
        data: {
          finished_at: now,
          duration_ms: Math.max(0, now.getTime() - startedAt.getTime()),
          status: lastStatus,
          message: runMessage,
        },
      });
      return runId;
    }
    const created = await this.prisma.hspsi_sys_scheduled_task_run.create({
      data: {
        task_id: id,
        started_at: now,
        finished_at: now,
        duration_ms: 0,
        status: lastStatus,
        message: runMessage,
        trigger_type: info.triggerType ?? SCHEDULED_TASK_TRIGGER.CRON,
        triggered_by: info.triggeredBy ?? 0n,
      },
    });
    return created.id;
  }

  private async occupiedCodes() {
    const rows = await this.prisma.hspsi_sys_scheduled_task.findMany({
      where: { deleted_at: null },
      select: { task_code: true },
    });
    return new Set(rows.map((row) => row.task_code));
  }

  private present(
    row: {
      id: bigint;
      task_code: string;
      task_name: string;
      cron_expr: string;
      status: number;
      last_run_at: Date | null;
      last_status: number | null;
      last_message: string;
      remark: string;
      created_by: bigint;
      updated_by: bigint;
      created_at: Date | null;
      updated_at: Date | null;
    },
    typeName: string,
  ) {
    const enabled = row.status === SCHEDULED_TASK_STATUS.ENABLED;
    return {
      id: String(row.id),
      taskCode: row.task_code,
      taskTypeName: typeName,
      taskName: row.task_name,
      cronExpr: row.cron_expr,
      status: row.status,
      statusName: enabled ? '启用' : '停用',
      nextRunAt: enabled ? formatShanghaiDateTime(nextRunAt(row.cron_expr)) : null,
      lastRunAt: formatShanghaiDateTime(row.last_run_at),
      lastStatus: row.last_status,
      lastStatusName: lastStatusName(row.last_status),
      lastMessage: row.last_message || '',
      remark: row.remark || '',
      createdBy: String(row.created_by),
      updatedBy: String(row.updated_by),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private presentRun(row: {
    id: bigint;
    task_id: bigint;
    started_at: Date;
    finished_at: Date | null;
    duration_ms: number | null;
    status: number;
    message: string;
    trigger_type: number;
    triggered_by: bigint;
  }) {
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      startedAt: formatShanghaiDateTime(row.started_at),
      finishedAt: formatShanghaiDateTime(row.finished_at),
      durationMs: row.duration_ms,
      status: row.status,
      statusName: lastStatusName(row.status),
      message: row.message || '',
      triggerType: row.trigger_type,
      triggerTypeName: row.trigger_type === SCHEDULED_TASK_TRIGGER.MANUAL ? '手动' : '定时',
      triggeredBy: String(row.triggered_by),
    };
  }

  private taskCode(value: unknown): ScheduledTaskCode {
    const code = String(value ?? '').trim();
    if (!SCHEDULED_TASK_TYPES.some((item) => item.code === code)) {
      throw new BadRequestException('未注册的任务类型');
    }
    return code as ScheduledTaskCode;
  }

  private cron(value: unknown) {
    try {
      return assertCronExpr(String(value ?? ''));
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Cron 表达式无效');
    }
  }

  private status(value: unknown) {
    const result = Number(value);
    if (result !== SCHEDULED_TASK_STATUS.DISABLED && result !== SCHEDULED_TASK_STATUS.ENABLED) {
      throw new BadRequestException('启用状态无效');
    }
    return result;
  }

  private text(value: unknown, field: string, minimum: number, maximum: number) {
    const result = String(value ?? '').trim();
    if (result.length < minimum || result.length > maximum) {
      throw new BadRequestException(`${field}长度应为${minimum}至${maximum}个字符`);
    }
    return result;
  }
}

function lastStatusName(value: number | null) {
  if (value === SCHEDULED_TASK_LAST_STATUS.SUCCESS) return '成功';
  if (value === SCHEDULED_TASK_LAST_STATUS.FAILED) return '失败';
  if (value === SCHEDULED_TASK_LAST_STATUS.SKIPPED) return '跳过';
  if (value === SCHEDULED_TASK_LAST_STATUS.RUNNING) return '运行中';
  return '—';
}
