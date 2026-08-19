import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LAST_MESSAGE_MAX, SCHEDULED_TASK_CODE } from './scheduled-task.constants';
import {
  errorMessage,
  isBusyError,
  ScheduledTaskBusyError,
  ScheduledTaskHandlers,
  truncateMessage,
} from './scheduled-task.handlers';

describe('ScheduledTaskHandlers', () => {
  const huasuUsers = { syncUsers: vi.fn() };
  const huasuProducts = { syncProducts: vi.fn() };
  const huasuOrders = { syncOrders: vi.fn() };
  const huasuConference = { syncConferenceOrders: vi.fn() };
  const huasuInstallment = { syncInstallmentOrders: vi.fn() };
  const shifangUsers = { syncUsers: vi.fn() };
  const shifangGoods = { syncGoods: vi.fn() };
  const shifangOrders = { syncOrders: vi.fn() };
  const oaOrg = { syncAll: vi.fn() };
  let handlers: ScheduledTaskHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new ScheduledTaskHandlers(
      huasuUsers as never,
      huasuProducts as never,
      huasuOrders as never,
      huasuConference as never,
      huasuInstallment as never,
      shifangUsers as never,
      shifangGoods as never,
      shifangOrders as never,
      oaOrg as never,
    );
  });

  it('路由用户同步', async () => {
    huasuUsers.syncUsers.mockResolvedValue({ fetched: 1, created: 2, updated: 3, failed: 0 });
    await expect(handlers.execute(SCHEDULED_TASK_CODE.HUASU_USERS)).resolves.toContain('拉取1');
  });

  it('路由商品同步', async () => {
    huasuProducts.syncProducts.mockResolvedValue({
      products: { created: 1, updated: 2 },
      packages: { created: 0, updated: 1 },
      mappings: { upserted: 3 },
    });
    await expect(handlers.execute(SCHEDULED_TASK_CODE.HUASU_PRODUCTS)).resolves.toContain('单品1/2');
  });

  it('路由订单同步', async () => {
    huasuOrders.syncOrders.mockResolvedValue({ fetched: 1, created: 1, updated: 0 });
    huasuConference.syncConferenceOrders.mockResolvedValue({ fetched: 2, created: 0, updated: 2 });
    huasuInstallment.syncInstallmentOrders.mockResolvedValue({ fetched: 3, created: 1, updated: 1 });
    await expect(handlers.execute(SCHEDULED_TASK_CODE.HUASU_ORDERS)).resolves.toContain('销售1/1/0');
  });

  it('路由十方清源用户同步', async () => {
    shifangUsers.syncUsers.mockResolvedValue({ fetched: 4, created: 1, updated: 2, failed: 1 });
    await expect(handlers.execute(SCHEDULED_TASK_CODE.SHIFANG_USERS)).resolves.toContain('拉取4');
  });

  it('路由十方清源商品同步', async () => {
    shifangGoods.syncGoods.mockResolvedValue({
      goods: { created: 2, updated: 3, mappingOnly: 1, skipped: 0 },
      skus: { created: 4, updated: 5 },
      mappings: { upserted: 6, disabled: 0 },
      conversionRules: { upserted: 2 },
      warnings: [],
    });
    await expect(handlers.execute(SCHEDULED_TASK_CODE.SHIFANG_GOODS)).resolves.toContain('商品2/3');
  });

  it('路由十方清源订单同步', async () => {
    shifangOrders.syncOrders.mockResolvedValue({
      fetched: 8,
      created: 3,
      updated: 4,
      skipped: 1,
      failed: 0,
      payments: 7,
      outputs: 2,
      exits: 1,
      events: 3,
      warnings: [],
      failures: [],
    });
    await expect(handlers.execute(SCHEDULED_TASK_CODE.SHIFANG_ORDERS)).resolves.toContain('拉取8');
  });

  it('路由 OA 组织同步', async () => {
    oaOrg.syncAll.mockResolvedValue('组织3 职位2 人员10');
    await expect(handlers.execute(SCHEDULED_TASK_CODE.OA_ORG)).resolves.toBe('组织3 职位2 人员10');
  });

  it('未知类型抛错', async () => {
    await expect(handlers.execute('unknown:job')).rejects.toThrow(/未注册的任务类型/);
  });

  it('用户同步忙碌转换为 ScheduledTaskBusyError', async () => {
    huasuUsers.syncUsers.mockResolvedValue(null);
    await expect(handlers.execute(SCHEDULED_TASK_CODE.HUASU_USERS)).rejects.toBeInstanceOf(
      ScheduledTaskBusyError,
    );
  });

  it('商品同步忙碌文案转换为 ScheduledTaskBusyError', async () => {
    huasuProducts.syncProducts.mockRejectedValue(new BadRequestException('华溯商品同步仍在进行，请稍后再试'));
    await expect(handlers.execute(SCHEDULED_TASK_CODE.HUASU_PRODUCTS)).rejects.toBeInstanceOf(
      ScheduledTaskBusyError,
    );
  });

  it('十方清源用户同步忙碌转换为 ScheduledTaskBusyError', async () => {
    shifangUsers.syncUsers.mockResolvedValue(null);
    await expect(handlers.execute(SCHEDULED_TASK_CODE.SHIFANG_USERS)).rejects.toBeInstanceOf(
      ScheduledTaskBusyError,
    );
  });

  it('十方清源商品同步忙碌文案转换为 ScheduledTaskBusyError', async () => {
    shifangGoods.syncGoods.mockRejectedValue(
      new BadRequestException('十方清源商品同步仍在进行，请稍后再试'),
    );
    await expect(handlers.execute(SCHEDULED_TASK_CODE.SHIFANG_GOODS)).rejects.toBeInstanceOf(
      ScheduledTaskBusyError,
    );
  });
});

describe('truncateMessage / isBusyError / errorMessage', () => {
  it('恰好等于上限不截断', () => {
    const text = 'a'.repeat(LAST_MESSAGE_MAX);
    expect(truncateMessage(text)).toBe(text);
  });

  it('超出上限截断并加省略号', () => {
    const text = 'a'.repeat(LAST_MESSAGE_MAX + 1);
    const result = truncateMessage(text);
    expect(result.length).toBe(LAST_MESSAGE_MAX);
    expect(result.endsWith('…')).toBe(true);
  });

  it('识别含仍在进行的 BadRequestException', () => {
    expect(isBusyError(new BadRequestException('同步仍在进行'))).toBe(true);
    expect(isBusyError(new BadRequestException('参数错误'))).toBe(false);
    expect(isBusyError(new ScheduledTaskBusyError())).toBe(true);
    expect(isBusyError(new Error('仍在进行'))).toBe(false);
  });

  it('非 Error 转为字符串', () => {
    expect(errorMessage('超时')).toBe('超时');
    expect(errorMessage({ foo: 1 })).toBe('[object Object]');
  });
});
