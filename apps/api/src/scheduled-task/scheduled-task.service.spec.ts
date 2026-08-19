import { BadRequestException, ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledTaskService } from './scheduled-task.service';

describe('ScheduledTaskService', () => {
  const prisma = {
    hspsi_sys_scheduled_task: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  let service: ScheduledTaskService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ScheduledTaskService(prisma as never);
  });

  it('类型列表标记已被占用的编码', async () => {
    prisma.hspsi_sys_scheduled_task.findMany.mockResolvedValue([{ task_code: 'huasu-home:users' }]);
    const types = await service.types();
    expect(types.find((item) => item.code === 'huasu-home:users')?.occupied).toBe(true);
    expect(types.find((item) => item.code === 'huasu-home:products')?.occupied).toBe(false);
    expect(types.find((item) => item.code === 'shifang-qingyuan:users')?.occupied).toBe(false);
    expect(types.find((item) => item.code === 'shifang-qingyuan:goods')?.name).toBe('十方清源商品同步');
  });

  it('拒绝未注册类型', async () => {
    await expect(service.create({ taskCode: 'unknown:job', taskName: 'x' }, '1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('拒绝重复类型', async () => {
    prisma.hspsi_sys_scheduled_task.findFirst.mockResolvedValue({ id: 1n, task_code: 'huasu-home:users' });
    await expect(
      service.create({ taskCode: 'huasu-home:users', taskName: '用户同步', cronExpr: '0 1 * * *' }, '1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('拒绝非法 Cron', async () => {
    prisma.hspsi_sys_scheduled_task.findFirst.mockResolvedValue(null);
    await expect(
      service.create(
        { taskCode: 'huasu-home:users', taskName: '用户同步', cronExpr: '0 1 * * * *' },
        '1',
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('5 段') });
  });

  it('新增合法任务', async () => {
    prisma.hspsi_sys_scheduled_task.findFirst.mockResolvedValue(null);
    prisma.hspsi_sys_scheduled_task.create.mockResolvedValue({
      id: 8n,
      task_code: 'huasu-home:users',
      task_name: '用户同步',
      cron_expr: '0 2 * * *',
      status: 0,
      last_run_at: null,
      last_status: null,
      last_message: '',
      remark: '',
      created_by: 1n,
      updated_by: 1n,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const created = await service.create(
      { taskCode: 'huasu-home:users', taskName: '用户同步', cronExpr: '0 2 * * *', status: 0 },
      '1',
    );
    expect(created.taskCode).toBe('huasu-home:users');
    expect(created.cronExpr).toBe('0 2 * * *');
    expect(created.status).toBe(0);
  });

  it('编辑时不允许改任务类型', async () => {
    prisma.hspsi_sys_scheduled_task.findFirst.mockResolvedValue({
      id: 8n,
      task_code: 'huasu-home:users',
      task_name: '用户同步',
      cron_expr: '0 1 * * *',
      status: 0,
      last_run_at: null,
      last_status: null,
      last_message: '',
      remark: '',
      created_by: 1n,
      updated_by: 1n,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await expect(
      service.update('8', { taskCode: 'huasu-home:products', taskName: '用户同步', cronExpr: '0 1 * * *' }, '1'),
    ).rejects.toMatchObject({ message: expect.stringContaining('不可修改') });
  });

  it('预览下次执行为上海墙钟而不是 UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T16:00:00.000Z'));
    try {
      expect(service.previewCron('0 1 * * *').nextRunAt).toBe('2026-08-14 01:00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('非法 userId 返回 400 而不是 500', async () => {
    prisma.hspsi_sys_scheduled_task.findFirst.mockResolvedValue(null);
    await expect(
      service.create({ taskCode: 'huasu-home:users', taskName: '用户同步', cronExpr: '0 1 * * *' }, 'abc'),
    ).rejects.toMatchObject({ message: '用户身份无效' });
  });

  it('软删除写入 deleted_at', async () => {
    prisma.hspsi_sys_scheduled_task.findFirst.mockResolvedValue({
      id: 8n,
      task_code: 'huasu-home:users',
      task_name: '用户同步',
      cron_expr: '0 1 * * *',
      status: 0,
      last_run_at: null,
      last_status: null,
      last_message: '',
      remark: '',
      created_by: 1n,
      updated_by: 1n,
      created_at: new Date(),
      updated_at: new Date(),
    });
    prisma.hspsi_sys_scheduled_task.update.mockResolvedValue({});
    await service.remove('8', '1');
    expect(prisma.hspsi_sys_scheduled_task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 8n },
        data: expect.objectContaining({ deleted_at: expect.any(Date) }),
      }),
    );
  });
});
