/**
 * 华溯之家会议门票订单同步单元测试（mock，不打真实外部接口）
 *
 * 覆盖：未支付跳过、购买不出库、核销且发放才出库、退款不回库、
 * 首次同步核销+退款只记账、已出库再退款失败、失败水位不被成功单越过、
 * 套餐未映射挂起、水位按类型隔离、地址留空
 *
 * 运行：
 *   pnpm --filter @hspsi/api test conference-order-sync.unit.spec
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../huasu-home.constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../huasu-home.constants')>();
  return {
    ...actual,
    HUASU_HOME_GOODS_CATEGORY_ID: 10n,
  };
});

import {
  HUASU_HOME_CONFERENCE_ORDER_STATUS,
  HUASU_HOME_CONFERENCE_REFUND_STATUS,
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_ORDER_SYNC_STATUS,
  HUASU_HOME_ORDER_TYPE,
} from '../huasu-home.constants';
import type { HuasuHomeConferenceOrder } from '../huasu-home.types';
import { HuasuHomeConferenceOrderSyncService } from './conference-order-sync.service';

function baseOrder(
  overrides: Partial<HuasuHomeConferenceOrder> = {},
): HuasuHomeConferenceOrder {
  return {
    id: 34,
    order_sn: 'CT2607240100000134767',
    order_status: HUASU_HOME_CONFERENCE_ORDER_STATUS.PAID,
    actual_amount: 598,
    total_amount: 598,
    payment_method: 1,
    price: 598,
    product_package_id: 14,
    quantity: 1,
    pay_time: '2026-07-24 14:21:13',
    rights_granted: 0,
    verify_status: 0,
    verify_time: '',
    refund: null,
    remark: '',
    created_at: '2026-07-24 14:21:13',
    updated_at: '2026-07-24 14:21:13',
    user_id: 16890,
    conference: {
      id: 3,
      name: '健康中国健康论坛佛山站',
      address: '佛山市禅城区祖庙街道市东下路69号',
    },
    package_items: [
      {
        product_id: 1,
        name: '三养',
        number: 3,
        gift_number: 0,
      },
      {
        product_id: 2,
        name: '生物共振舱',
        number: 2,
        gift_number: 0,
      },
    ],
    user: {
      id: 16890,
      nickname: '徐贵艳',
      mobile: '18922946273',
      gender: 1,
      birth: '1977-03-28',
      status: 1,
      remark: '',
      organization_id: 6,
      is_centenarian: 0,
      is_provincial_partner: 0,
      level: { id: 2, level: 1, name: '全家福会员' },
      level_id: 2,
    },
    ...overrides,
  };
}

function createService() {
  const mappingStore = new Map<string, any>();
  let mappingSeq = 1n;
  let soSeq = 9001n;
  let paySeq = 1n;
  let serviceSeq = 1n;
  let confirmedOutputs = 0;
  const saleOrders = new Map<string, any>();

  const orderRow = {
    so_id: 9001n,
    org_id: 1n,
    warehouse_id: 21n,
    so_no: 'SO20260813000001',
    customer_id: 7001n,
    customer_name: '徐贵艳',
    customer_mobile: '18922946273',
    customer_address: '',
    sales_name: '',
    sales_mobile: '',
    delivery_status: 1,
    order_status: 1,
    service_status: 3,
    so_property_type: 1,
    shipper: '',
    fact_amount: 598,
  };

  const tx = {
    hspsi_sys_organization_mapping: {
      findFirst: vi.fn().mockResolvedValue({ org_id: 1n }),
    },
    hspsi_goods_info_category: {
      findFirst: vi.fn().mockResolvedValue({ goods_catg_id: 10n, warehouse_type: 1 }),
    },
    hspsi_basic_warehouse: {
      findFirst: vi.fn().mockResolvedValue({ warehouse_id: 21n, org_id: 1n }),
    },
    hspsi_basic_customer: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        customer_id: 7001n,
        ...data,
      })),
      update: vi.fn(),
      findFirstOrThrow: vi.fn().mockResolvedValue({
        customer_id: 7001n,
        name: '徐贵艳',
        mobile: '18922946273',
      }),
    },
    hspsi_goods_source_mapping: {
      findFirst: vi.fn().mockResolvedValue({
        goods_id: 101n,
        sku_id: 201n,
        mapping_status: 1,
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          goods_id: 301n,
          sku_id: 401n,
          mapping_status: 1,
        },
      ]),
    },
    hspsi_goods_info_sku: {
      findFirst: vi.fn().mockImplementation(async ({ where }) => {
        if (where?.sku_id === 201n) {
          return { sku_id: 201n, good_id: 101n, unit_type: 1, is_default: 1 };
        }
        return { sku_id: 401n, good_id: 301n, unit_type: 1, is_default: 1 };
      }),
    },
    hspsi_goods_info: {
      findFirst: vi.fn().mockResolvedValue({ goods_id: 101n, goods_type: 1 }),
    },
    hspsi_sale_order_source_mapping: {
      findFirstOrThrow: vi.fn().mockImplementation(async ({ where }) => {
        const row = [...mappingStore.values()].find((item) => item.id === where.id);
        if (!row) throw new Error('mapping missing');
        return row;
      }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { id: mappingSeq++, so_id: 0n, ...data };
        mappingStore.set(`${data.source_order_type}:${data.source_order_id}`, row);
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }) => {
        const row = [...mappingStore.values()].find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    hspsi_sale_order: {
      findFirst: vi.fn().mockImplementation(async ({ where }) => {
        if (where?.so_id != null) {
          return saleOrders.get(String(where.so_id)) ?? null;
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { ...orderRow, so_id: soSeq++, ...data };
        saleOrders.set(String(row.so_id), row);
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }) => {
        const row = saleOrders.get(String(where.so_id)) ?? { ...orderRow, so_id: where.so_id };
        Object.assign(row, data);
        saleOrders.set(String(where.so_id), row);
        return row;
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(async ({ where }) => {
        return saleOrders.get(String(where.so_id)) ?? { ...orderRow, so_id: where.so_id };
      }),
    },
    hspsi_sale_order_detail: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    hspsi_sales_order_payment: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        pay_id: paySeq++,
        ...data,
      })),
    },
    hspsi_sale_order_service: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        service_id: serviceSeq++,
        ...data,
      })),
      update: vi.fn(),
    },
    hspsi_sale_order_output: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockImplementation(async () => confirmedOutputs),
      create: vi.fn().mockImplementation(async ({ data }) => {
        confirmedOutputs += 1;
        return {
          so_output_id: 8001n,
          ...data,
        };
      }),
    },
    hspsi_sale_order_output_detail: { createMany: vi.fn(), findMany: vi.fn() },
    hspsi_sale_order_exit: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    hspsi_sale_order_exit_detail: { createMany: vi.fn() },
    hspsi_goods_sku_conversion_rule: { findMany: vi.fn().mockResolvedValue([]) },
  };

  const prisma = {
    hspsi_sys_data_source: {
      findUnique: vi.fn().mockResolvedValue({
        id: 9n,
        code: HUASU_HOME_DATA_SOURCE_CODE,
        status: 1,
        deleted_at: null,
      }),
    },
    hspsi_sale_order_source_mapping: {
      findFirst: vi.fn().mockImplementation(async ({ where, orderBy }) => {
        if (where?.id) {
          return [...mappingStore.values()].find((item) => item.id === where.id) ?? null;
        }
        if (where?.source_order_id) {
          const key = `${where.source_order_type}:${where.source_order_id}`;
          return mappingStore.get(key) ?? null;
        }
        const rows = [...mappingStore.values()].filter((row) => {
          if (where?.source_order_type && row.source_order_type !== where.source_order_type) {
            return false;
          }
          if (where?.sync_status != null && row.sync_status !== where.sync_status) return false;
          if (where?.source_updated_at?.not === null && !row.source_updated_at) return false;
          return true;
        });
        const dir = orderBy?.source_updated_at === 'asc' ? 1 : -1;
        rows.sort(
          (a, b) =>
            dir * ((a.source_updated_at?.getTime() ?? 0) - (b.source_updated_at?.getTime() ?? 0)),
        );
        return rows[0] ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { id: mappingSeq++, so_id: 0n, ...data };
        mappingStore.set(`${data.source_order_type}:${data.source_order_id}`, row);
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }) => {
        const row = [...mappingStore.values()].find((item) => item.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    hspsi_sale_order_service: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };

  const huasuHome = {
    getConferenceOrderList: vi.fn(),
  };
  const businessNumber = {
    generate: vi.fn().mockResolvedValue('NO20260813000999'),
  };
  const posting = { post: vi.fn().mockResolvedValue(undefined) };

  const service = new HuasuHomeConferenceOrderSyncService(
    prisma as never,
    huasuHome as never,
    businessNumber as never,
    posting as never,
  );

  return { service, prisma, huasuHome, businessNumber, posting, tx, mappingStore };
}

describe('HuasuHomeConferenceOrderSyncService 单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('待付款门票不同步建单', async () => {
    const { service, huasuHome, prisma } = createService();
    huasuHome.getConferenceOrderList.mockResolvedValue({
      list: [baseOrder({ order_status: HUASU_HOME_CONFERENCE_ORDER_STATUS.PENDING_PAY })],
    });

    const stats = await service.syncConferenceOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.fetched).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.created).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(huasuHome.getConferenceOrderList).toHaveBeenCalledWith({
      page: 1,
      page_size: 200,
      updated_at: '2026-01-01 00:00:00',
    });
  });

  it('已付款未核销：建销售单+收款，不出库，地址留空', async () => {
    const ctx = createService();
    ctx.huasuHome.getConferenceOrderList.mockResolvedValue({
      list: [baseOrder()],
      total: 1,
    });

    const stats = await ctx.service.syncConferenceOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(0);
    expect(stats.created).toBe(1);
    expect(stats.payments).toBe(1);
    expect(stats.outputs).toBe(0);
    expect(stats.events).toBe(0);
    expect(ctx.tx.hspsi_sale_order_output.create).not.toHaveBeenCalled();
    expect(ctx.posting.post).not.toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_service.create).not.toHaveBeenCalled();

    const createArg = ctx.tx.hspsi_sale_order.create.mock.calls[0][0].data;
    expect(createArg.customer_address).toBe('');
    expect(createArg.customer_name).toBe('徐贵艳');
    expect(createArg.sales_name).toBe('');
    expect(createArg.customer_address).not.toContain('佛山');

    const mapping = [...ctx.mappingStore.values()][0];
    expect(mapping.source_order_type).toBe(HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET);
    expect(mapping.sync_status).toBe(HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS);

    expect(ctx.tx.hspsi_basic_customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          address: '',
          related_customer_id: 16890n,
        }),
      }),
    );
  });

  it('仅核销未发放权益时不出库', async () => {
    const ctx = createService();
    ctx.huasuHome.getConferenceOrderList.mockResolvedValue({
      list: [baseOrder({ verify_status: 1, rights_granted: 0 })],
      total: 1,
    });

    const stats = await ctx.service.syncConferenceOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(0);
    expect(stats.outputs).toBe(0);
    expect(ctx.tx.hspsi_sale_order_output.create).not.toHaveBeenCalled();
  });

  it('核销且权益发放后出库扣库', async () => {
    const ctx = createService();
    ctx.huasuHome.getConferenceOrderList.mockResolvedValue({
      list: [
        baseOrder({
          verify_status: 1,
          rights_granted: 1,
          verify_time: '2026-07-25 10:00:00',
        }),
      ],
      total: 1,
    });

    const stats = await ctx.service.syncConferenceOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(0);
    expect(stats.outputs).toBe(1);
    expect(ctx.tx.hspsi_sale_order_output.create).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_output_detail.createMany).toHaveBeenCalled();
    expect(ctx.posting.post).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_exit.create).not.toHaveBeenCalled();

    const outputRemark = ctx.tx.hspsi_sale_order_output.create.mock.calls[0][0].data.remark;
    expect(outputRemark).toContain('CONFERENCE_TICKET');
  });

  it('未核销退款：只记账不回库', async () => {
    const ctx = createService();
    ctx.huasuHome.getConferenceOrderList.mockResolvedValue({
      list: [
        baseOrder({
          order_status: HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUNDED,
          refund: {
            id: 88,
            refund_amount: 598,
            refund_status: HUASU_HOME_CONFERENCE_REFUND_STATUS.DONE,
            reason: '未核销退款',
          },
        }),
      ],
      total: 1,
    });

    const stats = await ctx.service.syncConferenceOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(0);
    expect(stats.outputs).toBe(0);
    expect(stats.exits).toBe(0);
    expect(ctx.tx.hspsi_sale_order_exit.create).not.toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_service.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: 4,
        event_status: 2,
        goods_id: 101,
        sku_id: 201,
      }),
    });

    const refundPay = ctx.tx.hspsi_sales_order_payment.create.mock.calls.find(
      (call: Array<{ data: { so_pay_type: number } }>) => call[0].data.so_pay_type === 2,
    );
    expect(refundPay).toBeTruthy();
  });

  it('已出库后再退款则整单失败，不冲库存', async () => {
    const ctx = createService();
    const shipped = baseOrder({
      verify_status: 1,
      rights_granted: 1,
      verify_time: '2026-07-25 10:00:00',
      updated_at: '2026-07-25 10:00:00',
    });
    ctx.huasuHome.getConferenceOrderList.mockResolvedValueOnce({
      list: [shipped],
      total: 1,
    });
    await ctx.service.syncConferenceOrders('1', { updated_at: '2026-01-01 00:00:00' });
    expect(ctx.tx.hspsi_sale_order_output.create).toHaveBeenCalled();

    ctx.huasuHome.getConferenceOrderList.mockResolvedValueOnce({
      list: [
        baseOrder({
          verify_status: 1,
          rights_granted: 1,
          order_status: HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUNDED,
          updated_at: '2026-07-26 10:00:00',
          refund: {
            id: 99,
            refund_amount: 598,
            refund_status: HUASU_HOME_CONFERENCE_REFUND_STATUS.DONE,
          },
        }),
      ],
      total: 1,
    });
    const stats = await ctx.service.syncConferenceOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(1);
    expect(stats.failures[0]?.reason).toContain('已核销发货后出现退款');
    expect(ctx.tx.hspsi_sale_order_exit.create).not.toHaveBeenCalled();
  });

  it('套餐未映射则挂起失败', async () => {
    const ctx = createService();
    ctx.tx.hspsi_goods_source_mapping.findFirst.mockResolvedValue(null);
    ctx.huasuHome.getConferenceOrderList.mockResolvedValue({
      list: [baseOrder()],
      total: 1,
    });

    const stats = await ctx.service.syncConferenceOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(1);
    expect(stats.failures[0]?.reason).toContain('商品未映射');
    expect(ctx.tx.hspsi_sale_order.create).not.toHaveBeenCalled();
  });

  it('增量水位只取 CONFERENCE_TICKET，不与普通订单混用', async () => {
    const ctx = createService();
    ctx.huasuHome.getConferenceOrderList.mockResolvedValue({ list: [] });

    await ctx.service.syncConferenceOrders('1');

    expect(ctx.prisma.hspsi_sale_order_source_mapping.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source_order_type: HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET,
        }),
      }),
    );
    expect(ctx.huasuHome.getConferenceOrderList).toHaveBeenCalledWith({
      page: 1,
      page_size: 200,
      updated_at: '1970-01-01 00:00:00',
    });
  });

  it('机构取 user.organization_id', async () => {
    const ctx = createService();
    ctx.huasuHome.getConferenceOrderList.mockResolvedValue({
      list: [baseOrder()],
      total: 1,
    });

    await ctx.service.syncConferenceOrders('1', { updated_at: '2026-01-01 00:00:00' });
    expect(ctx.tx.hspsi_sys_organization_mapping.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source_object_id: '6',
        }),
      }),
    );
  });

  it('首次同步同时核销+退款：不出库，只记收款和退款', async () => {
    const ctx = createService();
    ctx.huasuHome.getConferenceOrderList.mockResolvedValue({
      list: [
        baseOrder({
          verify_status: 1,
          rights_granted: 1,
          order_status: HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUNDED,
          refund: {
            id: 77,
            refund_amount: 598,
            refund_status: HUASU_HOME_CONFERENCE_REFUND_STATUS.DONE,
          },
        }),
      ],
      total: 1,
    });

    const stats = await ctx.service.syncConferenceOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(0);
    expect(stats.outputs).toBe(0);
    expect(ctx.tx.hspsi_sale_order_output.create).not.toHaveBeenCalled();
    expect(ctx.posting.post).not.toHaveBeenCalled();

    const refundPay = ctx.tx.hspsi_sales_order_payment.create.mock.calls.find(
      (call: Array<{ data: { so_pay_type: number } }>) => call[0].data.so_pay_type === 2,
    );
    expect(refundPay).toBeTruthy();
    expect(ctx.tx.hspsi_sale_order.create.mock.calls[0][0].data.delivery_status).toBe(1);
  });

  it('存在失败映射时增量水位取失败单最早 source_updated_at', async () => {
    const ctx = createService();
    ctx.mappingStore.set(`${HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET}:1`, {
      id: 1n,
      source_order_type: HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET,
      source_order_id: '1',
      sync_status: HUASU_HOME_ORDER_SYNC_STATUS.FAILED,
      source_updated_at: new Date(2026, 6, 24, 10, 0, 0),
    });
    ctx.mappingStore.set(`${HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET}:2`, {
      id: 2n,
      source_order_type: HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET,
      source_order_id: '2',
      sync_status: HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS,
      source_updated_at: new Date(2026, 6, 25, 12, 0, 0),
    });
    ctx.huasuHome.getConferenceOrderList.mockResolvedValue({ list: [] });

    await ctx.service.syncConferenceOrders('1');
    expect(ctx.huasuHome.getConferenceOrderList).toHaveBeenCalledWith({
      page: 1,
      page_size: 200,
      updated_at: '2026-07-24 10:00:00',
    });
  });
});
