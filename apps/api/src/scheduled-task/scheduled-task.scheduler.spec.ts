import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledTaskScheduler } from './scheduled-task.scheduler';

describe('ScheduledTaskScheduler', () => {
  const tasks = {
    listEnabled: vi.fn(),
  };
  const runner = {
    enqueue: vi.fn(),
    execute: vi.fn(),
  };
  let scheduler: ScheduledTaskScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduler = new ScheduledTaskScheduler(tasks as never, runner as never);
  });

  it('listEnabled 失败时不记下分钟，下次可重试', async () => {
    tasks.listEnabled.mockRejectedValue(new Error('数据库超时'));
    await scheduler.tick();
    await scheduler.tick();
    expect(tasks.listEnabled).toHaveBeenCalledTimes(2);
    expect(runner.enqueue).not.toHaveBeenCalled();
  });

  it('成功扫描后同一分钟不再读取数据库', async () => {
    tasks.listEnabled.mockResolvedValue([]);
    await scheduler.tick();
    await scheduler.tick();
    expect(tasks.listEnabled).toHaveBeenCalledTimes(1);
  });

  it('命中 Cron 的任务入队而非并行 execute', async () => {
    tasks.listEnabled.mockResolvedValue([
      { id: 1n, task_code: 'huasu-home:users', cron_expr: '* * * * *' },
      { id: 2n, task_code: 'huasu-home:products', cron_expr: '* * * * *' },
    ]);
    await scheduler.tick();
    expect(runner.enqueue).toHaveBeenCalledTimes(2);
    expect(runner.enqueue).toHaveBeenCalledWith(1n, 'huasu-home:users');
    expect(runner.enqueue).toHaveBeenCalledWith(2n, 'huasu-home:products');
    expect(runner.execute).not.toHaveBeenCalled();
  });
});
