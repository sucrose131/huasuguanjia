/**
 * 十方清源用户同步单元测试（mock，不打真实外部接口）
 *
 * 运行：
 *   pnpm --filter @hspsi/api test shifang-qingyuan/sync/user-sync.unit.spec
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShifangQingyuanUserItem } from '../shifang-qingyuan.types';
import { ShifangQingyuanUserSyncService } from './user-sync.service';

function baseItem(overrides: Partial<ShifangQingyuanUserItem> = {}): ShifangQingyuanUserItem {
  return {
    user: {
      id: 173032,
      mall_id: 1,
      username: '张三',
      mobile: '13800138000',
      nickname: '张三的昵称',
      birthday: '1990-01-02',
      parent_id: 100,
      parent_mobile: '13900139000',
      parent_username: '李四',
      parent_nickname: '李四的昵称',
      status: 1,
      level: 1,
      level_name: '经销商',
      ...overrides.user,
    },
    user_level: {
      id: 1,
      mall_id: 1,
      level: 1,
      name: '经销商',
      status: 1,
      ...overrides.user_level,
    },
    cloud_stock_agent: {
      id: 50,
      mall_id: 1,
      user_id: 173032,
      level: 1,
      level_name: '城市合伙人',
      status: 1,
      ...overrides.cloud_stock_agent,
    },
  };
}

describe('ShifangQingyuanUserSyncService', () => {
  const prisma = {
    hspsi_sys_data_source: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    hspsi_sys_organization_mapping: {
      findMany: vi.fn(),
    },
    hspsi_basic_customer: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  const shifangQingyuan = {
    getUserList: vi.fn(),
  };

  let service: ShifangQingyuanUserSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ShifangQingyuanUserSyncService(prisma as any, shifangQingyuan as any);
    prisma.hspsi_sys_data_source.findUnique.mockResolvedValue({
      id: 5n,
      code: 'shifang_qingyuan',
      status: 1,
      deleted_at: null,
    });
    prisma.hspsi_sys_organization_mapping.findMany.mockResolvedValue([
      { source_object_id: '1', org_id: 88n },
    ]);
  });

  describe('buildLevels', () => {
    it('TC-LEVEL-01 会员等级与云库存等级去重写入', () => {
      expect(service.buildLevels(baseItem())).toEqual(['经销商', '城市合伙人']);
    });

    it('TC-LEVEL-02 两名称相同时只写一条', () => {
      expect(
        service.buildLevels(
          baseItem({
            cloud_stock_agent: {
              id: 50,
              mall_id: 1,
              user_id: 173032,
              level_name: '经销商',
            },
          }),
        ),
      ).toEqual(['经销商']);
    });

    it('TC-LEVEL-03 普通会员无代理写入普通会员', () => {
      expect(
        service.buildLevels({
          user: { id: 1, mall_id: 1, level: 0, level_name: '普通会员' },
          user_level: null,
          cloud_stock_agent: null,
        }),
      ).toEqual(['普通会员']);
    });

    it('TC-LEVEL-04 无等级名称存空数组', () => {
      expect(
        service.buildLevels({
          user: { id: 1, mall_id: 1 },
          user_level: null,
          cloud_stock_agent: null,
        }),
      ).toEqual([]);
    });
  });

  describe('syncUsers', () => {
    it('TC-SYNC-01 不存在则创建，首轮不传 start_time', async () => {
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [baseItem()],
        pagination: { total: 1, page: 1, page_size: 100 },
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      const stats = await service.syncUsers({ pageSize: 100 });
      expect(stats).toMatchObject({
        fetched: 1,
        created: 1,
        updated: 0,
        failed: 0,
        startTime: '',
      });
      expect(shifangQingyuan.getUserList).toHaveBeenCalledWith({
        page: 1,
        limit: 100,
      });
      expect(prisma.hspsi_basic_customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source_type: 5,
            related_customer_id: 173032n,
            name: '张三的昵称',
            mobile: '13800138000',
            referrer_name: '李四的昵称',
            referrer_mobile: '13900139000',
            levels: ['经销商', '城市合伙人'],
            address: '',
            gender: 0,
          }),
        }),
      );
      const createData = prisma.hspsi_basic_customer.create.mock.calls[0][0].data;
      expect(createData).not.toHaveProperty('address', undefined);
    });

    it('TC-SYNC-02 已存在则更新身份，不改 address', async () => {
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [baseItem()],
        pagination: { total: 1, page: 1, page_size: 100 },
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue({ customer_id: 55n });
      prisma.hspsi_basic_customer.update.mockResolvedValue({ customer_id: 55n });

      const stats = await service.syncUsers({ pageSize: 100 });
      expect(stats).toMatchObject({ fetched: 1, created: 0, updated: 1, failed: 0 });
      expect(prisma.hspsi_basic_customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customer_id: 55n },
          data: expect.objectContaining({
            name: '张三的昵称',
            levels: ['经销商', '城市合伙人'],
          }),
        }),
      );
      const updateData = prisma.hspsi_basic_customer.update.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty('address');
      expect(updateData).not.toHaveProperty('gender');
    });

    it('TC-SYNC-03 机构未映射单条失败', async () => {
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [
          baseItem(),
          baseItem({
            user: {
              id: 173033,
              mall_id: 9,
              nickname: '未映射',
            },
            cloud_stock_agent: null,
          }),
        ],
        pagination: { total: 2, page: 1, page_size: 100 },
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      const stats = await service.syncUsers({ pageSize: 100 });
      expect(stats).toMatchObject({ fetched: 2, created: 1, failed: 1 });
      expect(prisma.hspsi_basic_customer.create).toHaveBeenCalledTimes(1);
    });

    it('TC-SYNC-04 mall_id 为 0 单条失败', async () => {
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [baseItem({ user: { id: 1, mall_id: 0 } })],
        pagination: { total: 1, page: 1, page_size: 100 },
      });

      const stats = await service.syncUsers({ pageSize: 100 });
      expect(stats).toMatchObject({ fetched: 1, failed: 1, created: 0 });
      expect(prisma.hspsi_basic_customer.create).not.toHaveBeenCalled();
    });

    it('TC-SYNC-05 进程内重入时跳过', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      shifangQingyuan.getUserList.mockImplementation(async () => {
        await gate;
        return { list: [baseItem()], pagination: { total: 1, page: 1, page_size: 100 } };
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      const first = service.syncUsers({ pageSize: 100 });
      await Promise.resolve();
      const second = await service.syncUsers({ pageSize: 100 });
      expect(second).toBeNull();
      release();
      const firstStats = await first;
      expect(firstStats).toMatchObject({ fetched: 1, created: 1 });
    });

    it('TC-SYNC-06 第二轮按上一轮开始时间减重叠窗口传 start_time', async () => {
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [baseItem()],
        pagination: { total: 1, page: 1, page_size: 100 },
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      await service.syncUsers({ pageSize: 100 });
      shifangQingyuan.getUserList.mockClear();
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [],
        pagination: { total: 0, page: 1, page_size: 100 },
      });

      const stats = await service.syncUsers({ pageSize: 100 });
      expect(stats?.startTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(shifangQingyuan.getUserList).toHaveBeenCalledWith({
        page: 1,
        limit: 100,
        start_time: stats?.startTime,
      });
    });

    it('TC-SYNC-07 可覆盖 startTime，full 时不传 start_time', async () => {
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [baseItem()],
        pagination: { total: 1, page: 1, page_size: 100 },
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      const incremental = await service.syncUsers({
        pageSize: 100,
        startTime: '2026-08-13 10:00:00',
      });
      expect(incremental).toMatchObject({ startTime: '2026-08-13 10:00:00' });
      expect(shifangQingyuan.getUserList).toHaveBeenCalledWith({
        page: 1,
        limit: 100,
        start_time: '2026-08-13 10:00:00',
      });

      shifangQingyuan.getUserList.mockClear();
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [],
        pagination: { total: 0, page: 1, page_size: 100 },
      });
      const full = await service.syncUsers({ pageSize: 100, full: true });
      expect(full).toMatchObject({ startTime: '' });
      expect(shifangQingyuan.getUserList).toHaveBeenCalledWith({
        page: 1,
        limit: 100,
      });
    });

    it('TC-SYNC-08 禁用用户 status=0 写入平台停用 2', async () => {
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [baseItem({ user: { id: 173032, mall_id: 1, status: 0 } })],
        pagination: { total: 1, page: 1, page_size: 100 },
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      await service.syncUsers({ pageSize: 100 });
      expect(prisma.hspsi_basic_customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 2 }),
        }),
      );
    });

    it('TC-SYNC-09 本轮有失败时不前进水位，下一轮仍全量', async () => {
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [
          baseItem({
            user: {
              id: 173033,
              mall_id: 9,
              nickname: '未映射',
            },
            cloud_stock_agent: null,
          }),
        ],
        pagination: { total: 1, page: 1, page_size: 100 },
      });

      const first = await service.syncUsers({ pageSize: 100 });
      expect(first).toMatchObject({ fetched: 1, failed: 1, startTime: '' });

      shifangQingyuan.getUserList.mockClear();
      shifangQingyuan.getUserList.mockResolvedValue({
        list: [],
        pagination: { total: 0, page: 1, page_size: 100 },
      });
      const second = await service.syncUsers({ pageSize: 100 });
      expect(second?.startTime).toBe('');
      expect(shifangQingyuan.getUserList).toHaveBeenCalledWith({
        page: 1,
        limit: 100,
      });
    });
  });
});
