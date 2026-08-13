/**
 * 华溯之家订单同步单元测试（mock，不打真实外部接口）
 *
 * 覆盖：未支付跳过、幂等跳过、建单+收款、商品未映射/机构未映射失败
 *
 * 运行：
 *   pnpm --filter @hspsi/api test order-sync.unit.spec
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
  HUASU_HOME_AFTER_SALES_STATUS,
  HUASU_HOME_AFTER_SALES_TYPE,
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_ORDER_STATUS,
  HUASU_HOME_ORDER_SYNC_STATUS,
  HUASU_HOME_ORDER_TYPE,
} from '../huasu-home.constants';
import type { HuasuHomeOrder } from '../huasu-home.types';
import { HuasuHomeOrderSyncService } from './order-sync.service';

function baseOrder(overrides: Partial<HuasuHomeOrder> = {}): HuasuHomeOrder {
  return {
    id: 10001,
    order_sn: 'OR2608080100000444212',
    order_status: HUASU_HOME_ORDER_STATUS.PAID,
    actual_amount: 199,
    total_amount: 199,
    payment_method: 1,
    service_org_id: 88,
    user_id: 501,
    consignee: '测试用户',
    mobile: '13800000000',
    created_at: '2026-08-08T10:00:00+08:00',
    updated_at: '2026-08-08T10:00:00+08:00',
    address: ['广东省', '深圳市', '南山区', '科技园一路'],
    items: [
      {
        id: 1,
        product_id: 11,
        sku_id: 1101,
        package_id: 0,
        product_type: 2,
        quantity: 1,
        price: 199,
      },
    ],
    user: { id: 501, nickname: '华溯会员', mobile: '13800000000', gender: 1 },
    referrer: { nickname: '推荐人', mobile: '13900000000' },
    shipments: [],
    after_sales_type: 0,
    after_sales_status: 0,
    after_sales_amount: 0,
    after_sales: null,
    remark: '',
    ...overrides,
  };
}

function createService() {
  const mappingStore = new Map<string, any>();
  let mappingSeq = 1n;
  let soSeq = 9001n;
  let paySeq = 1n;
  let serviceSeq = 1n;

  const orderRow = {
    so_id: 9001n,
    org_id: 1n,
    warehouse_id: 21n,
    so_no: 'SO20260811000001',
    customer_id: 7001n,
    customer_name: '测试',
    customer_mobile: '13800000000',
    customer_address: '',
    sales_name: '',
    sales_mobile: '',
    delivery_status: 1,
    order_status: 1,
    service_status: 3,
    so_property_type: 1,
    shipper: '',
    fact_amount: 199,
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
      findFirstOrThrow: vi.fn().mockResolvedValue({
        customer_id: 7001n,
        name: '华溯会员',
        mobile: '13800000000',
      }),
      update: vi.fn(),
    },
    hspsi_goods_source_mapping: {
      findFirst: vi.fn().mockResolvedValue({
        goods_id: 101n,
        sku_id: 201n,
        mapping_status: 1,
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          goods_id: 101n,
          sku_id: 201n,
          mapping_status: 1,
        },
      ]),
    },
    hspsi_goods_info_sku: {
      findFirst: vi.fn().mockResolvedValue({
        sku_id: 201n,
        good_id: 101n,
        unit_type: 1,
        is_default: 1,
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
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { ...orderRow, so_id: soSeq++, ...data };
        return row;
      }),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn().mockImplementation(async ({ where }) => ({
        ...orderRow,
        so_id: where.so_id,
      })),
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
    },
    hspsi_sale_order_output: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        so_output_id: 8001n,
        ...data,
      })),
    },
    hspsi_sale_order_output_detail: { createMany: vi.fn(), findMany: vi.fn() },
    hspsi_sale_order_exit: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        so_exit_id: 5001n,
        ...data,
      })),
    },
    hspsi_sale_order_exit_detail: { createMany: vi.fn() },
    hspsi_goods_sku_conversion_rule: { findMany: vi.fn().mockResolvedValue([]) },
    hspsi_inventory_batch_total: { findMany: vi.fn().mockResolvedValue([]) },
  };

  const prisma = {
    hspsi_sys_data_source: {
      findFirst: vi.fn().mockResolvedValue({
        id: 9n,
        code: HUASU_HOME_DATA_SOURCE_CODE,
        status: 1,
      }),
    },
    hspsi_sale_order_source_mapping: {
      findFirst: vi.fn().mockImplementation(async ({ where }) => {
        if (where?.id) {
          return [...mappingStore.values()].find((item) => item.id === where.id) ?? null;
        }
        const key = `${where.source_order_type}:${where.source_order_id}`;
        return mappingStore.get(key) ?? null;
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
  };

  const huasuHome = {
    getOrderList: vi.fn(),
    getOrderInfo: vi.fn(),
  };
  const businessNumber = {
    generate: vi
      .fn()
      .mockResolvedValueOnce('SO20260811000001')
      .mockResolvedValueOnce('SRC20260811000001')
      .mockResolvedValueOnce('AS20260811000001')
      .mockResolvedValue('NO20260811000999'),
  };
  const posting = { post: vi.fn().mockResolvedValue(undefined) };

  const service = new HuasuHomeOrderSyncService(
    prisma as never,
    huasuHome as never,
    businessNumber as never,
    posting as never,
  );

  return { service, prisma, huasuHome, businessNumber, posting, tx, mappingStore };
}

describe('HuasuHomeOrderSyncService 单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未支付订单不同步建单（skipped）', async () => {
    const { service, huasuHome, prisma } = createService();
    huasuHome.getOrderList.mockResolvedValue({
      list: [baseOrder({ order_status: HUASU_HOME_ORDER_STATUS.PENDING_PAY })],
    });

    const stats = await service.syncOrders('1', { updated_at: '2026-01-01 00:00:00' });
    expect(stats.fetched).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.created).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('支付中订单不同步建单（skipped）', async () => {
    const { service, huasuHome } = createService();
    huasuHome.getOrderList.mockResolvedValue({
      list: [baseOrder({ order_status: HUASU_HOME_ORDER_STATUS.PAYING })],
    });

    const stats = await service.syncOrders('1', { updated_at: '2026-01-01 00:00:00' });
    expect(stats.skipped).toBe(1);
    expect(stats.created).toBe(0);
  });

  it('已支付订单可建销售单、映射、收款与状态事件', async () => {
    const ctx = createService();
    const order = baseOrder();
    ctx.huasuHome.getOrderInfo.mockResolvedValue(order);

    const stats = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(stats.fetched).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.created).toBe(1);
    expect(stats.payments).toBe(1);
    expect(stats.events).toBe(1);

    expect(ctx.tx.hspsi_sale_order.create).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_detail.createMany).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sales_order_payment.create).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_service.create).toHaveBeenCalled();

    const mapping = [...ctx.mappingStore.values()][0]!;
    expect(mapping.source_order_type).toBe(HUASU_HOME_ORDER_TYPE.SALE_ORDER);
    expect(mapping.source_order_id).toBe(String(order.id));
    expect(mapping.sync_status).toBe(HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS);
    expect(mapping.last_payload).toContain(order.order_sn);

    const createArg = ctx.tx.hspsi_sale_order.create.mock.calls[0]![0].data;
    expect(createArg.so_source).toBe(9n);
    expect(createArg.so_source_id).toBe(mapping.id);
    expect(createArg.business_source_type).toBe('');
    expect(createArg.business_source_id).toBe(0n);
    expect(createArg.customer_name).toBe('测试用户');
  });

  it('商品未映射时整单失败并写入失败痕迹', async () => {
    const ctx = createService();
    ctx.tx.hspsi_goods_source_mapping.findFirst.mockResolvedValue(null);
    ctx.huasuHome.getOrderInfo.mockResolvedValue(baseOrder());

    const stats = await ctx.service.syncOrderBySn('OR2608080100000444212', '1');
    expect(stats.failed).toBe(1);
    expect(stats.created).toBe(0);
    expect(stats.failures[0]!.reason).toMatch(/商品未映射/);
    expect(
      ctx.prisma.hspsi_sale_order_source_mapping.create.mock.calls.length +
        ctx.prisma.hspsi_sale_order_source_mapping.update.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it('成功同步后相同 updated_at/status 再次同步应跳过', async () => {
    const ctx = createService();
    const order = baseOrder();
    ctx.huasuHome.getOrderInfo.mockResolvedValue(order);

    const first = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(first.created).toBe(1);

    const mapping = [...ctx.mappingStore.values()][0];
    ctx.prisma.hspsi_sale_order_source_mapping.findFirst.mockResolvedValue({
      ...mapping,
      so_id: 9001n,
      sync_status: HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS,
      source_status: order.order_status,
      source_updated_at: new Date(order.updated_at),
    });

    const second = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(second.skipped).toBe(1);
    expect(second.created).toBe(0);
  });

  it('机构未映射时失败', async () => {
    const ctx = createService();
    ctx.tx.hspsi_sys_organization_mapping.findFirst.mockResolvedValue(null);
    ctx.huasuHome.getOrderInfo.mockResolvedValue(baseOrder());

    const stats = await ctx.service.syncOrderBySn(baseOrder().order_sn, '1');
    expect(stats.failed).toBe(1);
    expect(stats.failures[0]!.reason).toMatch(/机构未映射/);
  });

  it('退货退款：rights 为空时只记账不回库', async () => {
    const ctx = createService();
    const order = baseOrder({
      order_status: HUASU_HOME_ORDER_STATUS.AFTER_SALES_DONE,
      after_sales_type: HUASU_HOME_AFTER_SALES_TYPE.RETURN_REFUND,
      after_sales_status: HUASU_HOME_AFTER_SALES_STATUS.DONE,
      after_sales_amount: 50,
      after_sales: {
        id: 901,
        type: HUASU_HOME_AFTER_SALES_TYPE.RETURN_REFUND,
        status: 2,
        rights_deducted_records: [],
      },
      updated_at: '2026-08-08T12:00:00+08:00',
    });
    ctx.huasuHome.getOrderInfo.mockResolvedValue(order);

    const stats = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.payments).toBeGreaterThanOrEqual(2); // 收款 + 退款
    expect(stats.exits).toBe(0);
    expect(ctx.tx.hspsi_sale_order_exit.create).not.toHaveBeenCalled();
    // 出库可能过账；回库不应出现 sales_return
    expect(
      ctx.posting.post.mock.calls.some(
        (call: unknown[]) => (call[0] as { sourceType?: string }).sourceType === 'sales_return',
      ),
    ).toBe(false);
  });

  it('退货退款：按权益扣减合并回库并过账', async () => {
    const ctx = createService();
    const order = baseOrder({
      order_status: HUASU_HOME_ORDER_STATUS.AFTER_SALES_DONE,
      after_sales_type: HUASU_HOME_AFTER_SALES_TYPE.RETURN_REFUND,
      after_sales_status: HUASU_HOME_AFTER_SALES_STATUS.DONE,
      after_sales_amount: 50,
      after_sales: {
        id: 902,
        type: HUASU_HOME_AFTER_SALES_TYPE.RETURN_REFUND,
        status: 2,
        rights_deducted_records: [
          { product_id: 11, buy_number: 1, gift_number: 1 },
          { product_id: 11, buy_number: 2, gift_number: 0 },
        ],
      },
      updated_at: '2026-08-08T12:00:00+08:00',
    });
    ctx.huasuHome.getOrderInfo.mockResolvedValue(order);
    ctx.tx.hspsi_sale_order_output.findFirst.mockResolvedValue({ so_output_id: 8001n });

    const stats = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.exits).toBe(1);
    expect(ctx.tx.hspsi_sale_order_exit.create).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_exit_detail.createMany).toHaveBeenCalled();

    const detailArg = ctx.tx.hspsi_sale_order_exit_detail.createMany.mock.calls[0]![0].data;
    expect(detailArg).toHaveLength(1);
    expect(detailArg[0].goods_id).toBe(101n);
    expect(detailArg[0].sku_id).toBe(201n);
    expect(detailArg[0].exit_qty).toBe(4); // (1+1)+(2+0)

    const exitArg = ctx.tx.hspsi_sale_order_exit.create.mock.calls[0]![0].data;
    expect(exitArg.source_output_id).toBe(8001n);
    expect(exitArg.exit_qty).toBe(4);

    expect(ctx.posting.post).toHaveBeenCalled();
    const postArg = ctx.posting.post.mock.calls[0]![0];
    expect(postArg.direction).toBe(1);
    expect(postArg.lines).toEqual([
      expect.objectContaining({
        goodsId: 101n,
        skuId: 201n,
        quantity: '4',
      }),
    ]);
  });

  it('仅退款即使有权益扣减也不回库', async () => {
    const ctx = createService();
    const order = baseOrder({
      order_status: HUASU_HOME_ORDER_STATUS.AFTER_SALES_DONE,
      after_sales_type: HUASU_HOME_AFTER_SALES_TYPE.REFUND_ONLY,
      after_sales_status: HUASU_HOME_AFTER_SALES_STATUS.DONE,
      after_sales_amount: 30,
      after_sales: {
        id: 903,
        type: HUASU_HOME_AFTER_SALES_TYPE.REFUND_ONLY,
        status: 2,
        rights_deducted_records: [{ product_id: 11, buy_number: 1, gift_number: 0 }],
      },
      updated_at: '2026-08-08T12:00:00+08:00',
    });
    ctx.huasuHome.getOrderInfo.mockResolvedValue(order);

    const stats = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(stats.failed).toBe(0);
    expect(stats.exits).toBe(0);
    expect(ctx.tx.hspsi_sale_order_exit.create).not.toHaveBeenCalled();
  });
});
