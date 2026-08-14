/**
 * 华溯之家用户同步单元测试（mock，不打真实外部接口）
 *
 * 运行：
 *   pnpm --filter @hspsi/api test user-sync.unit.spec
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HuasuHomeUser } from '../huasu-home.types';
import { HuasuHomeUserSyncService } from './user-sync.service';

function baseUser(overrides: Partial<HuasuHomeUser> = {}): HuasuHomeUser {
  return {
    id: 1001,
    nickname: '测试会员',
    mobile: '13800000001',
    gender: 1,
    birth: '1990-01-02',
    organization_id: 5,
    is_centenarian: 1,
    centenarian_type: 1,
    is_provincial_partner: 1,
    level: { id: 99, level: 1, name: '全家福会员' },
    level_id: 99,
    referrer: { nickname: '推荐人', mobile: '13900000000' },
    status: 1,
    remark: '备注',
    ...overrides,
  };
}

describe('HuasuHomeUserSyncService', () => {
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
      aggregate: vi.fn(),
    },
  };
  const huasuHome = {
    getUserList: vi.fn(),
  };

  let service: HuasuHomeUserSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HuasuHomeUserSyncService(prisma as any, huasuHome as any);
    prisma.hspsi_sys_data_source.findUnique.mockResolvedValue({
      id: 7n,
      code: 'huashu_home',
      status: 1,
      deleted_at: null,
    });
    prisma.hspsi_sys_organization_mapping.findMany.mockResolvedValue([
      { source_object_id: '5', org_id: 88n },
    ]);
    prisma.hspsi_basic_customer.aggregate.mockResolvedValue({
      _max: { related_customer_id: null },
    });
  });

  describe('buildLevels', () => {
    it('TC-LEVEL-01 三类身份写入标签数组', () => {
      expect(service.buildLevels(baseUser())).toEqual([
        '全家福会员',
        '省级合伙人',
        '百岁加会员-主卡',
      ]);
    });

    it('TC-LEVEL-03 无身份存空数组', () => {
      expect(
        service.buildLevels(
          baseUser({
            is_centenarian: 0,
            is_provincial_partner: 0,
            level: null,
          }),
        ),
      ).toEqual([]);
    });
  });

  describe('syncUsers', () => {
    it('TC-SYNC-01 不存在则创建', async () => {
      huasuHome.getUserList.mockResolvedValue({
        list: [baseUser()],
        page: 1,
        page_size: 200,
        total: 1,
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      const stats = await service.syncUsers({ pageSize: 200 });
      expect(stats).toMatchObject({
        fetched: 1,
        created: 1,
        updated: 0,
        failed: 0,
        afterUserId: 0,
        lastUserId: 1001,
      });
      expect(huasuHome.getUserList).toHaveBeenCalledWith({
        page: 1,
        page_size: 200,
        id: 0,
      });
      expect(prisma.hspsi_basic_customer.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source_type: 7,
            related_customer_id: 1001n,
            levels: ['全家福会员', '省级合伙人', '百岁加会员-主卡'],
          }),
        }),
      );
    });

    it('TC-SYNC-02 已存在则更新', async () => {
      huasuHome.getUserList.mockResolvedValue({
        list: [baseUser({ is_centenarian: 0, centenarian_type: 0 })],
        page: 1,
        page_size: 200,
        total: 1,
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue({ customer_id: 55n });
      prisma.hspsi_basic_customer.update.mockResolvedValue({ customer_id: 55n });

      const stats = await service.syncUsers({ pageSize: 200 });
      expect(stats).toMatchObject({ fetched: 1, created: 0, updated: 1, failed: 0 });
      expect(prisma.hspsi_basic_customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customer_id: 55n },
          data: expect.objectContaining({
            levels: ['全家福会员', '省级合伙人'],
          }),
        }),
      );
    });

    it('TC-SYNC-03 机构未映射单条失败', async () => {
      huasuHome.getUserList.mockResolvedValue({
        list: [
          baseUser({ id: 1001, organization_id: 5 }),
          baseUser({ id: 1002, organization_id: 9 }),
        ],
        page: 1,
        page_size: 200,
        total: 2,
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      const stats = await service.syncUsers({ pageSize: 200 });
      expect(stats).toMatchObject({ fetched: 2, created: 1, failed: 1 });
      expect(prisma.hspsi_basic_customer.create).toHaveBeenCalledTimes(1);
    });

    it('TC-SYNC-04 organization_id 为 0 单条失败', async () => {
      huasuHome.getUserList.mockResolvedValue({
        list: [baseUser({ organization_id: 0 })],
        page: 1,
        page_size: 200,
        total: 1,
      });

      const stats = await service.syncUsers({ pageSize: 200 });
      expect(stats).toMatchObject({ fetched: 1, failed: 1, created: 0 });
      expect(prisma.hspsi_basic_customer.create).not.toHaveBeenCalled();
    });

    it('TC-SYNC-05 进程内重入时跳过', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      huasuHome.getUserList.mockImplementation(async () => {
        await gate;
        return { list: [baseUser()], page: 1, page_size: 200, total: 1 };
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      const first = service.syncUsers({ pageSize: 200 });
      await Promise.resolve();
      const second = await service.syncUsers({ pageSize: 200 });
      expect(second).toBeNull();
      release();
      const firstStats = await first;
      expect(firstStats).toMatchObject({ fetched: 1, created: 1 });
    });

    it('TC-SYNC-06 默认水位取库中 max(related_customer_id)', async () => {
      prisma.hspsi_basic_customer.aggregate.mockResolvedValue({
        _max: { related_customer_id: 500n },
      });
      huasuHome.getUserList.mockResolvedValue({
        list: [baseUser({ id: 501 })],
        page: 1,
        page_size: 200,
        total: 1,
      });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      const stats = await service.syncUsers({ pageSize: 200 });
      expect(huasuHome.getUserList).toHaveBeenCalledWith({
        page: 1,
        page_size: 200,
        id: 500,
      });
      expect(stats).toMatchObject({
        afterUserId: 500,
        lastUserId: 501,
        created: 1,
      });
    });

    it('TC-SYNC-07 可覆盖 afterUserId，并按页推进水位', async () => {
      huasuHome.getUserList
        .mockResolvedValueOnce({
          list: [baseUser({ id: 101 }), baseUser({ id: 102 })],
          page: 1,
          page_size: 2,
          total: 3,
        })
        .mockResolvedValueOnce({
          list: [baseUser({ id: 103 })],
          page: 1,
          page_size: 2,
          total: 3,
        });
      prisma.hspsi_basic_customer.findFirst.mockResolvedValue(null);
      prisma.hspsi_basic_customer.create.mockResolvedValue({ customer_id: 1n });

      const stats = await service.syncUsers({ pageSize: 2, afterUserId: 100 });
      expect(huasuHome.getUserList).toHaveBeenNthCalledWith(1, {
        page: 1,
        page_size: 2,
        id: 100,
      });
      expect(huasuHome.getUserList).toHaveBeenNthCalledWith(2, {
        page: 1,
        page_size: 2,
        id: 102,
      });
      expect(stats).toMatchObject({
        afterUserId: 100,
        lastUserId: 103,
        fetched: 3,
        created: 3,
      });
    });
  });
});
