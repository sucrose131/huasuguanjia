import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  retryPublicMessage,
  SCHEDULED_TASK_LAST_STATUS,
  SCHEDULED_TASK_PUBLIC_MESSAGE,
  SCHEDULED_TASK_RUNTIME,
  SCHEDULED_TASK_TRIGGER,
} from './scheduled-task.constants';
import {
  errorMessage,
  ScheduledTaskBusyError,
  ScheduledTaskHandlers,
  truncateMessage,
} from './scheduled-task.handlers';
import { ScheduledTaskService } from './scheduled-task.service';

export class ScheduledTaskTimeoutError extends Error {
  constructor() {
    super('任务执行超时');
    this.name = 'ScheduledTaskTimeoutError';
  }
}

type QueuedJob = {
  id: bigint;
  taskCode: string;
  triggerType: number;
  triggeredBy: bigint;
  runId?: bigint;
  attempt: number;
};

@Injectable()
export class ScheduledTaskRunner implements OnModuleDestroy {
  private static readonly logger = new Logger(ScheduledTaskRunner.name);
  private readonly running = new Set<string>();
  private readonly queue: QueuedJob[] = [];
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private drainPromise: Promise<void> | null = null;

  constructor(
    @Inject(ScheduledTaskService) private readonly tasks: ScheduledTaskService,
    @Inject(ScheduledTaskHandlers) private readonly handlers: ScheduledTaskHandlers,
  ) {}

  onModuleDestroy() {
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
  }

  isRunning(taskCode: string) {
    return this.running.has(taskCode);
  }

  async start(id: string, userId: string) {
    const task = await this.tasks.requireTask(id);
    const triggeredBy = this.tasks.parseUserId(userId);
    this.cancelRetry(task.task_code);
    if (this.hasJob(task.task_code)) {
      const runId = await this.safeMarkResult(
        task.id,
        SCHEDULED_TASK_LAST_STATUS.SKIPPED,
        SCHEDULED_TASK_PUBLIC_MESSAGE.SKIPPED,
        undefined,
        { triggerType: SCHEDULED_TASK_TRIGGER.MANUAL, triggeredBy },
      );
      return {
        started: false,
        skipped: true,
        runId: runId ? String(runId) : null,
        message: SCHEDULED_TASK_PUBLIC_MESSAGE.SKIPPED,
      };
    }
    const waiting = this.queue.length > 0 || this.running.size > 0;
    const runId = await this.tasks.markRunStart(task.id, {
      triggerType: SCHEDULED_TASK_TRIGGER.MANUAL,
      triggeredBy,
    });
    this.enqueue(task.id, task.task_code, {
      triggerType: SCHEDULED_TASK_TRIGGER.MANUAL,
      triggeredBy,
      runId,
      attempt: 0,
    });
    return {
      started: true,
      skipped: false,
      runId: String(runId),
      message: waiting ? '已加入执行队列，将在当前任务结束后执行' : '已开始执行',
    };
  }

  /** 入队后由进程内单通道串行执行，避免多类同步同时打满 Prisma 连接池。 */
  enqueue(
    id: bigint,
    taskCode: string,
    options: {
      triggerType?: number;
      triggeredBy?: bigint;
      runId?: bigint;
      attempt?: number;
    } = {},
  ) {
    if (this.hasJob(taskCode)) return;
    this.queue.push({
      id,
      taskCode,
      triggerType: options.triggerType ?? SCHEDULED_TASK_TRIGGER.CRON,
      triggeredBy: options.triggeredBy ?? 0n,
      runId: options.runId,
      attempt: options.attempt ?? 0,
    });
    void this.ensureDrain().catch((error) => {
      ScheduledTaskRunner.logger.error('任务队列排空失败', error as Error);
    });
  }

  async execute(
    id: bigint,
    taskCode: string,
    options: {
      triggerType?: number;
      triggeredBy?: bigint;
      runId?: bigint;
      attempt?: number;
    } = {},
  ) {
    const triggerType = options.triggerType ?? SCHEDULED_TASK_TRIGGER.CRON;
    const triggeredBy = options.triggeredBy ?? 0n;
    const attempt = options.attempt ?? 0;
    if (this.running.has(taskCode)) {
      await this.safeMarkResult(
        id,
        SCHEDULED_TASK_LAST_STATUS.SKIPPED,
        SCHEDULED_TASK_PUBLIC_MESSAGE.SKIPPED,
        options.runId,
        { triggerType, triggeredBy },
      );
      return;
    }
    this.running.add(taskCode);
    let runId = options.runId;
    try {
      try {
        runId = await this.tasks.markRunStart(id, { triggerType, triggeredBy, runId });
      } catch (error) {
        ScheduledTaskRunner.logger.error(`任务 ${taskCode} 无法写入开始时间：${errorMessage(error)}`);
        await this.safeMarkResult(
          id,
          SCHEDULED_TASK_LAST_STATUS.FAILED,
          SCHEDULED_TASK_PUBLIC_MESSAGE.FAILED,
          runId,
          { triggerType, triggeredBy, runMessage: truncateMessage(errorMessage(error)) },
        );
        this.scheduleRetry(id, taskCode, attempt, triggerType, triggeredBy);
        return;
      }
      const work = this.handlers.execute(taskCode);
      this.inflight.set(taskCode, work);
      void work
        .finally(() => {
          if (this.inflight.get(taskCode) === work) this.inflight.delete(taskCode);
        })
        .catch(() => undefined);
      try {
        const message = await withTimeout(work, SCHEDULED_TASK_RUNTIME.timeoutMs);
        await this.safeMarkResult(
          id,
          SCHEDULED_TASK_LAST_STATUS.SUCCESS,
          truncateMessage(message || '执行完成'),
          runId,
        );
      } catch (error) {
        if (error instanceof ScheduledTaskBusyError) {
          await this.safeMarkResult(
            id,
            SCHEDULED_TASK_LAST_STATUS.SKIPPED,
            SCHEDULED_TASK_PUBLIC_MESSAGE.SKIPPED,
            runId,
          );
          return;
        }
        ScheduledTaskRunner.logger.error(`任务 ${taskCode} 执行失败：${errorMessage(error)}`);
        if (error instanceof ScheduledTaskTimeoutError) {
          await this.safeMarkResult(
            id,
            SCHEDULED_TASK_LAST_STATUS.FAILED,
            SCHEDULED_TASK_PUBLIC_MESSAGE.TIMEOUT,
            runId,
            { runMessage: truncateMessage(errorMessage(error)) },
          );
          void work
            .then(async (message) => {
              ScheduledTaskRunner.logger.warn(`任务 ${taskCode} 超时后仍执行完成`);
              this.cancelRetry(taskCode);
              await this.safeMarkResult(
                id,
                SCHEDULED_TASK_LAST_STATUS.SUCCESS,
                truncateMessage(message || '执行完成'),
                runId,
              );
            })
            .catch((lateError) => {
              ScheduledTaskRunner.logger.error(
                `任务 ${taskCode} 超时后底层仍失败：${errorMessage(lateError)}`,
              );
              void this.safeMarkResult(
                id,
                SCHEDULED_TASK_LAST_STATUS.FAILED,
                SCHEDULED_TASK_PUBLIC_MESSAGE.TIMEOUT,
                runId,
                { runMessage: truncateMessage(errorMessage(lateError)) },
              );
            });
          return;
        }
        const delayMs = SCHEDULED_TASK_RUNTIME.retryDelaysMs[attempt];
        const publicMessage =
          delayMs === undefined
            ? SCHEDULED_TASK_PUBLIC_MESSAGE.FAILED
            : retryPublicMessage(delayMs);
        await this.safeMarkResult(id, SCHEDULED_TASK_LAST_STATUS.FAILED, publicMessage, runId, {
          runMessage: truncateMessage(errorMessage(error)),
        });
        this.scheduleRetry(id, taskCode, attempt, triggerType, triggeredBy);
      }
    } finally {
      this.running.delete(taskCode);
    }
  }

  private hasJob(taskCode: string) {
    return (
      this.running.has(taskCode) ||
      this.queue.some((job) => job.taskCode === taskCode) ||
      this.inflight.has(taskCode) ||
      this.retryTimers.has(taskCode)
    );
  }

  private scheduleRetry(
    id: bigint,
    taskCode: string,
    attempt: number,
    triggerType: number,
    triggeredBy: bigint,
  ) {
    const delayMs = SCHEDULED_TASK_RUNTIME.retryDelaysMs[attempt];
    if (delayMs === undefined) return;
    this.cancelRetry(taskCode);
    const timer = setTimeout(() => {
      this.retryTimers.delete(taskCode);
      const pending = this.inflight.get(taskCode);
      const enqueueNext = () =>
        this.enqueue(id, taskCode, {
          triggerType,
          triggeredBy,
          attempt: attempt + 1,
        });
      if (pending) {
        void pending.finally(enqueueNext);
        return;
      }
      enqueueNext();
    }, delayMs);
    this.retryTimers.set(taskCode, timer);
  }

  private cancelRetry(taskCode: string) {
    const timer = this.retryTimers.get(taskCode);
    if (!timer) return;
    clearTimeout(timer);
    this.retryTimers.delete(taskCode);
  }

  private ensureDrain(): Promise<void> {
    if (!this.drainPromise) {
      this.drainPromise = this.processQueue();
    }
    return this.drainPromise;
  }

  private async processQueue() {
    try {
      while (this.queue.length) {
        const job = this.queue.shift()!;
        try {
          await this.execute(job.id, job.taskCode, job);
        } catch (error) {
          ScheduledTaskRunner.logger.error(`任务 ${job.taskCode} 未捕获异常`, error as Error);
        }
      }
    } finally {
      this.drainPromise = null;
      if (this.queue.length) {
        void this.ensureDrain().catch((error) => {
          ScheduledTaskRunner.logger.error('任务队列排空失败', error as Error);
        });
      }
    }
  }

  private async safeMarkResult(
    id: bigint,
    lastStatus: number,
    lastMessage: string,
    runId?: bigint,
    meta?: { triggerType?: number; triggeredBy?: bigint; runMessage?: string },
  ) {
    try {
      return await this.tasks.markRunResult(id, lastStatus, lastMessage, runId, meta);
    } catch (error) {
      ScheduledTaskRunner.logger.error(`任务结果回写失败 id=${id.toString()}`, error as Error);
      return runId;
    }
  }
}

export async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ScheduledTaskTimeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}