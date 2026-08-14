import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCHEDULED_TASK_LAST_STATUS,
  SCHEDULED_TASK_PUBLIC_MESSAGE,
  SCHEDULED_TASK_RUNTIME,
} from './scheduled-task.constants';
import { ScheduledTaskBusyError } from './scheduled-task.handlers';
import { ScheduledTaskRunner } from './scheduled-task.runner';

describe('ScheduledTaskRunner', () => {
  const tasks = {
    requireTask: vi.fn(),
    parseUserId: vi.fn(),
    markRunStart: vi.fn(),
    markRunResult: vi.fn(),
  };
  const handlers = {
    execute: vi.fn(),
  };
  let runner: ScheduledTaskRunner;
  const originalTimeout = SCHEDULED_TASK_RUNTIME.timeoutMs;
  const originalRetries = [...SCHEDULED_TASK_RUNTIME.retryDelaysMs];

  beforeEach(() => {
    vi.clearAllMocks();
    SCHEDULED_TASK_RUNTIME.timeoutMs = originalTimeout;
    SCHEDULED_TASK_RUNTIME.retryDelaysMs = [...originalRetries];
    runner = new ScheduledTaskRunner(tasks as never, handlers as never);
    tasks.requireTask.mockResolvedValue({ id: 1n, task_code: 'huasu-home:users' });
    tasks.parseUserId.mockReturnValue(1n);
    tasks.markRunStart.mockResolvedValue(99n);
    tasks.markRunResult.mockResolvedValue(99n);
  });

  afterEach(() => {
    runner.onModuleDestroy();
    SCHEDULED_TASK_RUNTIME.timeoutMs = originalTimeout;
    SCHEDULED_TASK_RUNTIME.retryDelaysMs = [...originalRetries];
  });

  it('成功执行回写成功状态', async () => {
    handlers.execute.mockResolvedValue('拉取1');
    await runner.execute(1n, 'huasu-home:users');
    expect(tasks.markRunStart).toHaveBeenCalledWith(1n, expect.any(Object));
    expect(tasks.markRunResult).toHaveBeenCalledWith(
      1n,
      SCHEDULED_TASK_LAST_STATUS.SUCCESS,
      '拉取1',
      99n,
      undefined,
    );
  });

  it('重入时跳过', async () => {
    handlers.execute.mockImplementation(async () => {
      await runner.execute(1n, 'huasu-home:users');
      return 'ok';
    });
    await runner.execute(1n, 'huasu-home:users');
    expect(tasks.markRunResult).toHaveBeenCalledWith(
      1n,
      SCHEDULED_TASK_LAST_STATUS.SKIPPED,
      SCHEDULED_TASK_PUBLIC_MESSAGE.SKIPPED,
      undefined,
      expect.any(Object),
    );
  });

  it('处理器忙碌记为跳过', async () => {
    handlers.execute.mockRejectedValue(new ScheduledTaskBusyError());
    await runner.execute(1n, 'huasu-home:users');
    expect(tasks.markRunResult).toHaveBeenCalledWith(
      1n,
      SCHEDULED_TASK_LAST_STATUS.SKIPPED,
      SCHEDULED_TASK_PUBLIC_MESSAGE.SKIPPED,
      99n,
      undefined,
    );
  });

  it('失败时任务列表脱敏，执行历史写入原始错误', async () => {
    SCHEDULED_TASK_RUNTIME.retryDelaysMs = [];
    handlers.execute.mockRejectedValue(new Error('mysql://root:secret@127.0.0.1/hspsi'));
    await runner.execute(1n, 'huasu-home:users');
    expect(tasks.markRunResult).toHaveBeenCalledWith(
      1n,
      SCHEDULED_TASK_LAST_STATUS.FAILED,
      SCHEDULED_TASK_PUBLIC_MESSAGE.FAILED,
      99n,
      expect.objectContaining({ runMessage: 'mysql://root:secret@127.0.0.1/hspsi' }),
    );
  });

  it('写入开始时间失败时不抛出，回写脱敏失败状态', async () => {
    SCHEDULED_TASK_RUNTIME.retryDelaysMs = [];
    tasks.markRunStart.mockRejectedValue(new Error('连接池耗尽'));
    await expect(runner.execute(1n, 'huasu-home:users')).resolves.toBeUndefined();
    expect(handlers.execute).not.toHaveBeenCalled();
    expect(tasks.markRunResult).toHaveBeenCalledWith(
      1n,
      SCHEDULED_TASK_LAST_STATUS.FAILED,
      SCHEDULED_TASK_PUBLIC_MESSAGE.FAILED,
      undefined,
      expect.objectContaining({ runMessage: '连接池耗尽' }),
    );
  });

  it('超过超时时间后标记失败并释放 running', async () => {
    SCHEDULED_TASK_RUNTIME.timeoutMs = 20;
    SCHEDULED_TASK_RUNTIME.retryDelaysMs = [];
    handlers.execute.mockImplementation(() => new Promise(() => {}));
    await runner.execute(1n, 'huasu-home:users');
    expect(tasks.markRunResult).toHaveBeenCalledWith(
      1n,
      SCHEDULED_TASK_LAST_STATUS.FAILED,
      SCHEDULED_TASK_PUBLIC_MESSAGE.TIMEOUT,
      99n,
      expect.objectContaining({ runMessage: '任务执行超时' }),
    );
    expect(runner.isRunning('huasu-home:users')).toBe(false);
  });

  it('失败后按间隔自动重试', async () => {
    SCHEDULED_TASK_RUNTIME.retryDelaysMs = [20];
    handlers.execute.mockRejectedValue(new Error('网络抖动'));
    await runner.execute(1n, 'huasu-home:users');
    expect(tasks.markRunResult).toHaveBeenCalledWith(
      1n,
      SCHEDULED_TASK_LAST_STATUS.FAILED,
      SCHEDULED_TASK_PUBLIC_MESSAGE.RETRY,
      99n,
      expect.objectContaining({ runMessage: '网络抖动' }),
    );
    await vi.waitFor(() => {
      expect(handlers.execute).toHaveBeenCalledTimes(2);
    });
  });

  it('手动执行返回 runId', async () => {
    handlers.execute.mockResolvedValue('ok');
    const result = await runner.start('1', '8');
    expect(result.runId).toBe('99');
    expect(result.started).toBe(true);
    await vi.waitFor(() => {
      expect(handlers.execute).toHaveBeenCalled();
    });
  });

  it('enqueue 对不同任务串行执行', async () => {
    const order: string[] = [];
    handlers.execute.mockImplementation(async (code: string) => {
      order.push(`start:${code}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`end:${code}`);
      return 'ok';
    });
    runner.enqueue(1n, 'huasu-home:users');
    runner.enqueue(2n, 'huasu-home:products');
    await vi.waitFor(() => {
      expect(order).toEqual([
        'start:huasu-home:users',
        'end:huasu-home:users',
        'start:huasu-home:products',
        'end:huasu-home:products',
      ]);
    });
    expect(handlers.execute).toHaveBeenCalledTimes(2);
  });

  it('同一 task_code 已在队列或执行中则不再入队', async () => {
    handlers.execute.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return 'ok';
    });
    runner.enqueue(1n, 'huasu-home:users');
    runner.enqueue(1n, 'huasu-home:users');
    await vi.waitFor(() => {
      expect(handlers.execute).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(tasks.markRunResult).toHaveBeenCalledWith(
        1n,
        SCHEDULED_TASK_LAST_STATUS.SUCCESS,
        'ok',
        99n,
        undefined,
      );
    });
  });
});
