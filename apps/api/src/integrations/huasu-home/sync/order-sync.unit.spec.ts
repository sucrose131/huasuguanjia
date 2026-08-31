/**
 * 华溯之家订单同步单元测试（mock，不打真实外部接口）
 *
 * 覆盖：未支付跳过、幂等跳过、建单+收款、客户全量创建/更新（含 levels）、商品未映射/机构未映射失败
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
    user: {
      id: 501,
      nickname: '华溯会员',
      mobile: '13800000000',
      gender: 1,
      birth: '1990-01-02',
      status: 1,
      remark: '会员备注',
      is_centenarian: 1,
      centenarian_type: 1,
      is_provincial_partner: 1,
      level: { id: 99, level: 1, name: '全家福会员' },
      level_id: 99,
    },
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
      update: vi.fn(),
      findFirstOrThrow: vi.fn().mockResolvedValue({
        customer_id: 7001n,
        name: '华溯会员',
        mobile: '13800000000',
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
      update: vi.fn(),
    },
    hspsi_sale_order_service_detail: {
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn(),
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
      findMany: vi.fn().mockResolvedValue([]),
    },
    hspsi_sale_order_service_detail: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
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
    expect(huasuHome.getOrderList).toHaveBeenCalledWith({
      page: 1,
      page_size: 200,
      updated_at: '2026-01-01 00:00:00',
    });
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

  it('普通订单存在且非空 order_installment_no 时应跳过，避免与分期重复', async () => {
    const { service, huasuHome, prisma } = createService();
    huasuHome.getOrderList.mockResolvedValue({
      list: [baseOrder({ order_installment_no: 'OI2607300100000730294' })],
    });

    const stats = await service.syncOrders('1', { updated_at: '2026-01-01 00:00:00' });
    expect(stats.skipped).toBe(1);
    expect(stats.created).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('普通订单未返回 order_installment_no 字段时应按普通单处理', async () => {
    const ctx = createService();
    const order = baseOrder();
    expect(Object.prototype.hasOwnProperty.call(order, 'order_installment_no')).toBe(false);
    ctx.huasuHome.getOrderInfo.mockResolvedValue(order);

    const stats = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(stats.created).toBe(1);
    expect(stats.skipped).toBe(0);
  });

  it('普通订单 order_installment_no 为空串或 null 时仍按普通单处理', async () => {
    const ctx = createService();
    ctx.huasuHome.getOrderInfo.mockResolvedValue(baseOrder({ order_installment_no: '' }));
    const empty = await ctx.service.syncOrderBySn('OR-empty', '1');
    expect(empty.created).toBe(1);

    const ctx2 = createService();
    ctx2.huasuHome.getOrderInfo.mockResolvedValue(
      baseOrder({ order_installment_no: null as unknown as string }),
    );
    const nulled = await ctx2.service.syncOrderBySn('OR-null', '1');
    expect(nulled.created).toBe(1);
  });

  it('已支付订单可建销售单、映射与收款，不写售后记录', async () => {
    const ctx = createService();
    const order = baseOrder();
    ctx.huasuHome.getOrderInfo.mockResolvedValue(order);

    const stats = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(stats.fetched).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.created).toBe(1);
    expect(stats.payments).toBe(1);
    expect(stats.events).toBe(0);

    expect(ctx.tx.hspsi_sale_order.create).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_detail.createMany).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sales_order_payment.create).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_service.create).not.toHaveBeenCalled();

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
    expect(ctx.posting.post).not.toHaveBeenCalled();

    expect(ctx.tx.hspsi_basic_customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '华溯会员',
          mobile: '13800000000',
          gender: 1,
          referrer_name: '推荐人',
          referrer_mobile: '13900000000',
          related_customer_id: 501n,
          status: 1,
          remark: '会员备注',
          levels: ['全家福会员', '省级合伙人', '百岁加会员-主卡'],
        }),
      }),
    );
  });

  it('已发货出库过账键使用本平台出库单 ID，不使用外部订单 ID 或 ALL', async () => {
    const ctx = createService();
    const order = baseOrder({
      id: 107,
      order_status: HUASU_HOME_ORDER_STATUS.SHIPPED,
      shipments: [],
    });
    ctx.huasuHome.getOrderInfo.mockResolvedValue(order);

    const stats = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.outputs).toBe(1);
    expect(ctx.posting.post).toHaveBeenCalled();

    const outputRemark = ctx.tx.hspsi_sale_order_output.create.mock.calls[0]![0].data.remark;
    expect(outputRemark).toContain('ALL');

    const postArg = ctx.posting.post.mock.calls[0]![0];
    expect(postArg.sourceId).toBe(8001n);
    expect(postArg.idempotencyKey).toBe('huasu-home-output:8001:v1');
    expect(postArg.idempotencyKey).not.toContain('107');
    expect(postArg.idempotencyKey).not.toContain('ALL');
  });

  it('已存在客户时全量更新（含 levels）', async () => {
    const ctx = createService();
    ctx.tx.hspsi_basic_customer.findFirst.mockResolvedValue({
      customer_id: 7001n,
      name: '旧名',
      mobile: '13700000000',
    });
    const order = baseOrder({
      user: {
        id: 501,
        nickname: '新昵称',
        mobile: '13600000000',
        gender: 2,
        birth: '1991-03-04',
        status: 1,
        remark: '新备注',
        is_centenarian: 0,
        centenarian_type: 0,
        is_provincial_partner: 0,
        level: { level: 2, name: '事业合伙人' },
      },
      referrer: { nickname: '新推荐人', mobile: '13500000000' },
    });
    ctx.huasuHome.getOrderInfo.mockResolvedValue(order);

    const stats = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(stats.failed).toBe(0);
    expect(ctx.tx.hspsi_basic_customer.create).not.toHaveBeenCalled();
    expect(ctx.tx.hspsi_basic_customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customer_id: 7001n },
        data: expect.objectContaining({
          name: '新昵称',
          mobile: '13600000000',
          gender: 2,
          referrer_name: '新推荐人',
          referrer_mobile: '13500000000',
          remark: '新备注',
          levels: ['事业合伙人'],
        }),
      }),
    );
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

  it('已有售后事件 goods_id 为 0 时补写商品规格且不新建事件', async () => {
    const ctx = createService();
    const order = baseOrder({
      order_status: HUASU_HOME_ORDER_STATUS.AFTER_SALES_DONE,
      after_sales_type: HUASU_HOME_AFTER_SALES_TYPE.RETURN_REFUND,
      after_sales_status: HUASU_HOME_AFTER_SALES_STATUS.DONE,
      after_sales_amount: 50,
      after_sales: {
        id: 904,
        type: HUASU_HOME_AFTER_SALES_TYPE.RETURN_REFUND,
        status: 2,
        rights_deducted_records: [],
      },
      updated_at: '2026-08-08T12:00:00+08:00',
    });
    ctx.huasuHome.getOrderInfo.mockResolvedValue(order);
    ctx.tx.hspsi_sale_order_service.findFirst.mockResolvedValue({
      service_id: 77n,
      goods_id: 0,
    });

    const stats = await ctx.service.syncOrderBySn(order.order_sn, '1');
    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(ctx.tx.hspsi_sale_order_service.create).not.toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_service.update).toHaveBeenCalledWith({
      where: { service_id: 77n },
      data: expect.objectContaining({
        goods_id: 101,
        sku_id: 201,
      }),
    });
    expect(ctx.tx.hspsi_sale_order_service_detail.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          goods_id: 101n,
          sku_id: 201n,
          service_qty: 1,
        }),
      ],
    });
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
    expect(ctx.tx.hspsi_sale_order_service.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        goods_id: 101,
        sku_id: 201,
        event_status: 2,
      }),
    });
    expect(ctx.tx.hspsi_sale_order_service_detail.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          goods_id: 101n,
          sku_id: 201n,
          service_qty: 4,
          batch_no: '',
        }),
      ],
    });
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
    expect(ctx.tx.hspsi_sale_order_service_detail.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          goods_id: 101n,
          sku_id: 201n,
          service_qty: 1,
        }),
      ],
    });
  });

  it('分页拉列表：按返回 total 翻页', async () => {
    const { service, huasuHome } = createService();
    huasuHome.getOrderList.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 1) {
        return {
          list: [
            baseOrder({ id: 1, order_sn: 'OR-1', order_status: HUASU_HOME_ORDER_STATUS.PENDING_PAY }),
            baseOrder({ id: 2, order_sn: 'OR-2', order_status: HUASU_HOME_ORDER_STATUS.PAYING }),
          ],
          page: 1,
          page_size: 2,
          total: 3,
        };
      }
      if (page === 2) {
        return {
          list: [
            baseOrder({ id: 3, order_sn: 'OR-3', order_status: HUASU_HOME_ORDER_STATUS.PENDING_PAY }),
          ],
          page: 2,
          page_size: 2,
          total: 3,
        };
      }
      throw new Error(`unexpected page ${page}`);
    });

    const stats = await service.syncOrders('1', {
      updated_at: '2026-01-01 00:00:00',
      page_size: 2,
    });

    expect(stats.fetched).toBe(3);
    expect(stats.skipped).toBe(3);
    expect(huasuHome.getOrderList).toHaveBeenCalledTimes(2);
    expect(huasuHome.getOrderList).toHaveBeenNthCalledWith(1, {
      page: 1,
      page_size: 2,
      updated_at: '2026-01-01 00:00:00',
    });
    expect(huasuHome.getOrderList).toHaveBeenNthCalledWith(2, {
      page: 2,
      page_size: 2,
      updated_at: '2026-01-01 00:00:00',
    });
  });

  it('本页已覆盖 total 时不再请求下一页', async () => {
    const { service, huasuHome } = createService();
    huasuHome.getOrderList.mockResolvedValue({
      list: [
        baseOrder({ id: 1, order_sn: 'OR-1', order_status: HUASU_HOME_ORDER_STATUS.PENDING_PAY }),
        baseOrder({ id: 2, order_sn: 'OR-2', order_status: HUASU_HOME_ORDER_STATUS.PENDING_PAY }),
      ],
      page: 1,
      page_size: 2,
      total: 2,
    });

    const stats = await service.syncOrders('1', {
      updated_at: '2026-01-01 00:00:00',
      page_size: 2,
    });

    expect(stats.fetched).toBe(2);
    expect(huasuHome.getOrderList).toHaveBeenCalledTimes(1);
  });

  it('total 偏大但下一页为空时停止，避免死循环', async () => {
    const { service, huasuHome } = createService();
    huasuHome.getOrderList.mockImplementation(async ({ page }: { page: number }) => {
      if (page === 1) {
        return {
          list: [
            baseOrder({ id: 1, order_sn: 'OR-1', order_status: HUASU_HOME_ORDER_STATUS.PENDING_PAY }),
          ],
          page: 1,
          page_size: 1,
          total: 500,
        };
      }
      return { list: [], page, page_size: 1, total: 500 };
    });

    const stats = await service.syncOrders('1', {
      updated_at: '2026-01-01 00:00:00',
      page_size: 1,
    });

    expect(stats.fetched).toBe(1);
    expect(huasuHome.getOrderList).toHaveBeenCalledTimes(2);
  });

  it('空列表只请求第一页', async () => {
    const { service, huasuHome } = createService();
    huasuHome.getOrderList.mockResolvedValue({ list: [] });

    const stats = await service.syncOrders('1', { updated_at: '2026-01-01 00:00:00' });
    expect(stats.fetched).toBe(0);
    expect(huasuHome.getOrderList).toHaveBeenCalledTimes(1);
    expect(huasuHome.getOrderList).toHaveBeenCalledWith({
      page: 1,
      page_size: 200,
      updated_at: '2026-01-01 00:00:00',
    });
  });

  it('page_size 超过上限时按 1000 截断', async () => {
    const { service, huasuHome } = createService();
    huasuHome.getOrderList.mockResolvedValue({ list: [] });

    await service.syncOrders('1', { updated_at: '2026-01-01 00:00:00', page_size: 5000 });
    expect(huasuHome.getOrderList).toHaveBeenCalledWith({
      page: 1,
      page_size: 1000,
      updated_at: '2026-01-01 00:00:00',
    });
  });

  it('同步进行中再次触发应拒绝', async () => {
    const { service, huasuHome } = createService();
    let release!: (value: { list: HuasuHomeOrder[] }) => void;
    huasuHome.getOrderList.mockImplementation(
      () =>
        new Promise<{ list: HuasuHomeOrder[] }>((resolve) => {
          release = resolve;
        }),
    );

    const first = service.syncOrders('1', { updated_at: '2026-01-01 00:00:00' });
    await vi.waitFor(() => expect(huasuHome.getOrderList).toHaveBeenCalled());
    await expect(service.syncOrders('1', { updated_at: '2026-01-01 00:00:00' })).rejects.toThrow(
      /仍在进行/,
    );
    release({ list: [] });
    await first;
  });
});
