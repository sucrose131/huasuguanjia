/**
 * 十方清源订单同步单元测试（mock，不打真实 DB/API）
 *
 * 覆盖：
 * - 未支付跳过
 * - 已支付建单+收款（机构 mall_id 映射；商品映射无 source_type）
 * - 商品未映射失败
 * - 机构未映射失败
 * - 已发货出库 + conversion_rule 扩量
 * - order_type=1 云库存纯入库不写出库/回库
 * - 无 conversion_rule 时按下单 SKU 出库
 * - 仅退款成功（so_pay_type=2，无 exit）
 * - 退货退款成功生成 exit
 * - 按 order_no 单笔同步
 * - 二次同步幂等（跳过无变更）
 * - 缺失客户用收货人补建（levels=[]）
 * - 已存在客户只更新地址，不覆盖姓名/levels
 *
 * 运行：
 *   pnpm --filter @hspsi/api test order-sync.unit.spec
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shifang-qingyuan.constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shifang-qingyuan.constants')>();
  return {
    ...actual,
    SHIFANG_QINGYUAN_GOODS_CATEGORY_ID: 10n,
  };
});

import {
  SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
  SHIFANG_QINGYUAN_MAPPING_STATUS,
  SHIFANG_QINGYUAN_ORDER_STATUS,
  SHIFANG_QINGYUAN_ORDER_SYNC_STATUS,
  SHIFANG_QINGYUAN_ORDER_TYPE,
  SHIFANG_QINGYUAN_PAY_STATUS,
  SHIFANG_QINGYUAN_REFUND_TYPE,
  SHIFANG_QINGYUAN_RULE_STATUS,
  SHIFANG_QINGYUAN_RULE_TYPE,
  SHIFANG_QINGYUAN_STOCK_FLOW,
} from '../shifang-qingyuan.constants';
import type {
  ShifangQingyuanOrderDetail,
  ShifangQingyuanOrderDetailData,
  ShifangQingyuanOrderExpress,
  ShifangQingyuanOrderRefund,
} from '../shifang-qingyuan.types';
import { ShifangQingyuanOrderSyncService } from './order-sync.service';

const SOURCE_ID = 5n;
const ORG_ID = 10n;
const WAREHOUSE_ID = 20n;
const GOODS_ID = 101n;
const SKU_ID = 201n;
const TARGET_GOODS_ID = 102n;
const TARGET_SKU_ID = 202n;

function buildDetail(
  overrides: {
    order?: Partial<ShifangQingyuanOrderDetailData['order']>;
    order_type?: number;
    details?: Partial<ShifangQingyuanOrderDetail>[];
    express?: ShifangQingyuanOrderExpress[];
    refunds?: ShifangQingyuanOrderRefund[];
  } = {},
): ShifangQingyuanOrderDetailData {
  const order = {
    id: 10001,
    mall_id: 88,
    mch_id: 0,
    store_id: 0,
    user_id: 501,
    order_no: 'SFQY202608120001',
    out_trade_no: '',
    mobile: '13800000000',
    province: 0,
    city: 0,
    area: 0,
    town: 0,
    community: 0,
    address: '科技园一路',
    region_name: '广东省深圳市南山区',
    zip: '',
    receiver_name: '测试用户',
    remark: '',
    seller_remark: '',
    shipping_type: 1,
    shipping_money: 0,
    reduce_shipping_money: 0,
    refund_money: 0,
    pay_money: 199,
    goods_price: 199,
    original_goods_price: 199,
    ip: '',
    coupon_id: 0,
    coupon_money: 0,
    score: 0,
    score_money: 0,
    order_status: SHIFANG_QINGYUAN_ORDER_STATUS.PENDING_SHIP,
    pay_status: SHIFANG_QINGYUAN_PAY_STATUS.PAID,
    shipping_status: 0,
    review_status: 0,
    is_feedback: 0,
    payment_type: 1,
    marketing_id: 0,
    marketing_type: '',
    invoice_id: 0,
    status: 1,
    is_comment: 0,
    is_recycle: 0,
    is_virtual: 0,
    is_new_user: 0,
    pay_time: 1723449600,
    shipping_time: 0,
    sign_time: 0,
    consign_time: 0,
    finish_time: 0,
    close_time: 0,
    extra_info: '',
    order_source: '',
    created_at: 1723449600,
    updated_at: 1723449600,
    is_bill: 0,
    bill_time: 0,
    clerk_code: '',
    is_print: 0,
    goods_subtype: 0,
    ...overrides.order,
  };

  const details: ShifangQingyuanOrderDetail[] = (
    overrides.details ?? [
      { id: 1, goods_id: 11, goods_attr_id: 1101, num: 1, price: 199, goods_price: 199 },
    ]
  ).map((d, i) => ({
    id: d.id ?? i + 1,
    mall_id: 88,
    order_id: order.id,
    user_id: order.user_id,
    mch_id: 0,
    store_id: 0,
    goods_id: d.goods_id ?? 11,
    goods_name: '测试商品',
    goods_attr_id: d.goods_attr_id ?? 1101,
    goods_attr_name: '',
    sign_id: '',
    attr_groups_format: '',
    price: d.price ?? 199,
    cost_price: 0,
    num: d.num ?? 1,
    adjust_money: 0,
    goods_price: d.goods_price ?? 199,
    original_goods_price: d.goods_price ?? 199,
    pic_url: '',
    marketing_id: 0,
    marketing_type: '',
    order_type: 0,
    give_score: 0,
    order_status: order.order_status,
    shipping_status: 0,
    is_feedback: 0,
    remark: '',
    is_evaluate: 0,
    refund_balance_money: 0,
    is_virtual: 0,
    status: 1,
    extra_info: '',
    created_at: order.created_at,
    updated_at: order.updated_at,
    order_source: '',
    shipped_num: 0,
    unit: '瓶',
    goods_subtype: 0,
  }));

  return {
    order,
    order_type: overrides.order_type,
    details,
    express: overrides.express ?? [],
    refunds: overrides.refunds ?? [],
  };
}

function buildRefund(
  overrides: Partial<ShifangQingyuanOrderRefund> = {},
): ShifangQingyuanOrderRefund {
  return {
    id: 901,
    mall_id: 88,
    mch_id: 0,
    store_id: 0,
    user_id: 501,
    order_id: 10001,
    order_detail_id: 1,
    order_no: 'SFQY202608120001',
    type: SHIFANG_QINGYUAN_REFUND_TYPE.REFUND_ONLY,
    reason: '不想要了',
    remark: '',
    refuse_remark: '',
    express: '',
    express_no: '',
    saler_express: '',
    customer_name: '',
    saler_express_no: '',
    is_refund: 1,
    refund_at: 1723536000,
    refund_price: 50,
    reality_refund_price: 50,
    express_at: 0,
    saler_express_at: 0,
    step_status: 0,
    refund_status: 2,
    status: 1,
    created_at: 1723536000,
    updated_at: 1723536000,
    goods_type: 1,
    refund_remark: '',
    old_reality_refund_price: 0,
    num: 1,
    order_source: '',
    is_auto_refund: 0,
    ...overrides,
  };
}

function createContext() {
  const mappingStore = new Map<string, any>();
  let mappingSeq = 1n;
  let soSeq = 9001n;
  let paySeq = 1n;
  let serviceSeq = 1n;
  let bizNo = 0;

  const orderRow = {
    so_id: 9001n,
    org_id: ORG_ID,
    warehouse_id: WAREHOUSE_ID,
    so_no: 'SO20260812000001',
    customer_id: 7001n,
    customer_name: '测试用户',
    customer_mobile: '13800000000',
    customer_address: '',
    sales_name: '',
    sales_mobile: '',
    delivery_status: 1,
    order_status: 1,
    service_status: 3,
    shipper: '',
  };

  const tx = {
    hspsi_sys_organization_mapping: {
      findFirst: vi.fn().mockResolvedValue({ org_id: ORG_ID }),
    },
    hspsi_goods_info_category: {
      findFirst: vi.fn().mockResolvedValue({ goods_catg_id: 10n, warehouse_type: 1 }),
    },
    hspsi_basic_warehouse: {
      findFirst: vi.fn().mockResolvedValue({ warehouse_id: WAREHOUSE_ID, org_id: ORG_ID }),
    },
    hspsi_basic_customer: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        customer_id: 7001n,
        ...data,
      })),
      findFirstOrThrow: vi.fn().mockResolvedValue({
        customer_id: 7001n,
        name: '测试用户',
        mobile: '13800000000',
      }),
      update: vi.fn(),
    },
    hspsi_goods_source_mapping: {
      findFirst: vi.fn().mockResolvedValue({
        goods_id: GOODS_ID,
        sku_id: SKU_ID,
        mapping_status: SHIFANG_QINGYUAN_MAPPING_STATUS.MAPPED,
      }),
    },
    hspsi_goods_info_sku: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.sku_id === TARGET_SKU_ID) {
          return { sku_id: TARGET_SKU_ID, good_id: TARGET_GOODS_ID, unit_type: 1 };
        }
        return { sku_id: SKU_ID, good_id: GOODS_ID, unit_type: 1 };
      }),
    },
    hspsi_goods_info: {
      findFirst: vi.fn().mockResolvedValue({ goods_id: GOODS_ID, goods_type: 1 }),
    },
    hspsi_goods_sku_conversion_rule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    hspsi_sale_order_source_mapping: {
      findFirstOrThrow: vi.fn().mockImplementation(async ({ where }: any) => {
        const row = [...mappingStore.values()].find((item) => item.id === where.id);
        if (!row) throw new Error('mapping missing');
        return row;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = { id: mappingSeq++, so_id: 0n, ...data };
        mappingStore.set(`${data.source_order_type}:${data.source_order_id}`, row);
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = [...mappingStore.values()].find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    hspsi_sale_order: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = { ...orderRow, so_id: soSeq++, ...data };
        return row;
      }),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn().mockImplementation(async ({ where }: any) => ({
        ...orderRow,
        so_id: where.so_id,
      })),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => ({
        ...orderRow,
        so_id: where.so_id,
      })),
    },
    hspsi_sale_order_detail: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    hspsi_sales_order_payment: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        pay_id: paySeq++,
        ...data,
      })),
    },
    hspsi_sale_order_service: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        service_id: serviceSeq++,
        ...data,
      })),
    },
    hspsi_sale_order_service_detail: {
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn(),
    },
    hspsi_sale_order_output: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        so_output_id: 8001n,
        ...data,
      })),
    },
    hspsi_sale_order_output_detail: { createMany: vi.fn(), findMany: vi.fn() },
    hspsi_sale_order_exit: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        so_exit_id: 5001n,
        ...data,
      })),
    },
    hspsi_sale_order_exit_detail: { createMany: vi.fn() },
  };

  const prisma = {
    hspsi_sys_data_source: {
      findFirst: vi.fn().mockResolvedValue({
        id: SOURCE_ID,
        code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
        status: 1,
      }),
      findUnique: vi.fn().mockResolvedValue({
        id: SOURCE_ID,
        code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
        status: 1,
      }),
      create: vi.fn(),
    },
    hspsi_sale_order_source_mapping: {
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        if (where?.id) {
          return [...mappingStore.values()].find((item) => item.id === where.id) ?? null;
        }
        if (where?.source_order_id) {
          const key = `${where.source_order_type}:${where.source_order_id}`;
          return mappingStore.get(key) ?? null;
        }
        return null;
      }),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = { id: mappingSeq++, so_id: 0n, ...data };
        mappingStore.set(`${data.source_order_type}:${data.source_order_id}`, row);
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = [...mappingStore.values()].find((item) => item.id === where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      }),
      aggregate: vi.fn().mockResolvedValue({ _max: { source_updated_at: null } }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    hspsi_sale_order_service: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    hspsi_sale_order_service_detail: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };

  const shifangQingyuan = {
    getOrderList: vi.fn(),
    getOrderDetail: vi.fn(),
  };
  const businessNumber = {
    generate: vi.fn().mockImplementation(async () => `NO${String(++bizNo).padStart(4, '0')}`),
  };
  const externalPosting = { post: vi.fn().mockResolvedValue(undefined) };

  const service = new ShifangQingyuanOrderSyncService(
    prisma as never,
    shifangQingyuan as never,
    businessNumber as never,
    externalPosting as never,
  );

  return {
    service,
    prisma,
    shifangQingyuan,
    businessNumber,
    externalPosting,
    tx,
    mappingStore,
  };
}

function mockListSnapshot(
  ctx: ReturnType<typeof createContext>,
  snapshot: ShifangQingyuanOrderDetailData,
) {
  ctx.shifangQingyuan.getOrderList.mockResolvedValue({
    list: [snapshot],
    pagination: { total: 1, page: 1, page_size: 100 },
  });
}

describe('ShifangQingyuanOrderSyncService 单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未支付跳过：pay_status=0 → skipped=1，不建销售单', async () => {
    const ctx = createContext();
    const snapshot = buildDetail({
      order: { pay_status: SHIFANG_QINGYUAN_PAY_STATUS.UNPAID, order_status: 0 },
    });
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', {
      start_time: '2026-01-01 00:00:00',
      pay_status: SHIFANG_QINGYUAN_PAY_STATUS.UNPAID,
    });

    expect(stats.fetched).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.created).toBe(0);
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order.create).not.toHaveBeenCalled();
  });

  it('已支付建单+收款：org 经 mall_id 映射；商品映射不含 source_type', async () => {
    const ctx = createContext();
    const snapshot = buildDetail({
      order: {
        pay_status: SHIFANG_QINGYUAN_PAY_STATUS.PAID,
        order_status: SHIFANG_QINGYUAN_ORDER_STATUS.PENDING_SHIP,
        mall_id: 88,
      },
    });
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.fetched).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.created).toBe(1);
    expect(stats.payments).toBe(1);
    expect(stats.events).toBe(0);
    expect(ctx.tx.hspsi_sale_order_service.create).not.toHaveBeenCalled();

    expect(ctx.tx.hspsi_sys_organization_mapping.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source_id: SOURCE_ID,
          source_object_id: '88',
        }),
      }),
    );

    const goodsWhere = ctx.tx.hspsi_goods_source_mapping.findFirst.mock.calls[0]![0].where;
    expect(goodsWhere).not.toHaveProperty('source_type');
    expect(goodsWhere.source_goods_id).toBe('11');
    expect(goodsWhere.source_sku_id).toBe('1101');

    expect(ctx.tx.hspsi_sale_order.create).toHaveBeenCalled();
    const soCreate = ctx.tx.hspsi_sale_order.create.mock.calls[0]![0].data;
    expect(Number(soCreate.fact_amount)).toBe(199);
    expect(Number(soCreate.so_amount)).toBe(199);
    expect(ctx.tx.hspsi_sale_order_detail.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            sale_price: expect.anything(),
            sale_amount: expect.anything(),
          }),
        ]),
      }),
    );
    const line = ctx.tx.hspsi_sale_order_detail.createMany.mock.calls[0]![0].data[0];
    expect(Number(line.sale_price)).toBe(199);
    expect(Number(line.sale_amount)).toBe(199);

    expect(ctx.tx.hspsi_sales_order_payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          so_pay_type: 1,
          org_id: ORG_ID,
          fact_pay_amount: expect.anything(),
        }),
      }),
    );
    const pay = ctx.tx.hspsi_sales_order_payment.create.mock.calls[0]![0].data;
    expect(Number(pay.fact_pay_amount)).toBe(199);
    expect(pay.pay_date).toEqual(new Date(1723449600 * 1000));
    expect(pay.created_at).toEqual(new Date(1723449600 * 1000));
    expect(pay.updated_at).not.toEqual(new Date(1723449600 * 1000));
    expect(pay.updated_at).toBeInstanceOf(Date);

    const mapping = [...ctx.mappingStore.values()][0];
    expect(mapping.source_order_type).toBe(SHIFANG_QINGYUAN_ORDER_TYPE.SALE_ORDER);
    expect(mapping.sync_status).toBe(SHIFANG_QINGYUAN_ORDER_SYNC_STATUS.SUCCESS);
    expect(mapping.so_id).toBeGreaterThan(0n);
  });

  it('商品未映射失败：failed=1，failures 含原因', async () => {
    const ctx = createContext();
    ctx.tx.hspsi_goods_source_mapping.findFirst.mockResolvedValue(null);
    const snapshot = buildDetail();
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed).toBe(1);
    expect(stats.created).toBe(0);
    expect(stats.failures[0]!.reason).toMatch(/商品未映射/);
    expect(
      ctx.prisma.hspsi_sale_order_source_mapping.create.mock.calls.length +
        ctx.prisma.hspsi_sale_order_source_mapping.update.mock.calls.length,
    ).toBeGreaterThan(0);
  });

  it('已发货出库：express + conversion_rule 扩量', async () => {
    const ctx = createContext();
    ctx.tx.hspsi_goods_sku_conversion_rule.findMany.mockResolvedValue([
      {
        source_goods_id: GOODS_ID,
        source_sku_id: SKU_ID,
        target_goods_id: TARGET_GOODS_ID,
        target_sku_id: TARGET_SKU_ID,
        quantity_ratio: 3,
        rule_type: SHIFANG_QINGYUAN_RULE_TYPE.REPLACE,
        status: SHIFANG_QINGYUAN_RULE_STATUS.ENABLED,
      },
    ]);

    const snapshot = buildDetail({
      order: {
        order_status: SHIFANG_QINGYUAN_ORDER_STATUS.SHIPPED,
        shipping_status: 1,
        consign_time: 1723536000,
      },
      details: [{ id: 1, goods_id: 11, goods_attr_id: 1101, num: 2, price: 99.5, goods_price: 199 }],
      express: [
        {
          id: 7001,
          order_id: 10001,
          cs_order_id: 0,
          shipping_type: 1,
          express_id: 1,
          express_name: '顺丰',
          express_no: 'SF123456',
          customer_name: '',
          buyer_id: 0,
          buyer_name: '',
          operator_id: 0,
          operator_username: '',
          memo: '',
          status: 1,
          created_at: 1723536000,
          updated_at: 1723536000,
          source_table: '',
          source_table_id: 0,
          edit_num: 0,
        },
      ],
    });
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.created).toBe(1);
    expect(stats.outputs).toBeGreaterThanOrEqual(1);
    expect(ctx.tx.hspsi_sale_order_output.create).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_output_detail.createMany).toHaveBeenCalled();

    const detailArg = ctx.tx.hspsi_sale_order_output_detail.createMany.mock.calls[0]![0].data;
    expect(detailArg).toHaveLength(1);
    expect(detailArg[0].goods_id).toBe(TARGET_GOODS_ID);
    expect(detailArg[0].sku_id).toBe(TARGET_SKU_ID);
    expect(detailArg[0].output_qty).toBe(6); // 2 * ratio 3

    expect(ctx.externalPosting.post).toHaveBeenCalled();
  });

  it('order_type=1 云库存纯入库：建单收款，不出库不扣库，发货态保持待发货', async () => {
    const ctx = createContext();
    const snapshot = buildDetail({
      order_type: SHIFANG_QINGYUAN_STOCK_FLOW.CLOUD_IN,
      order: {
        order_status: SHIFANG_QINGYUAN_ORDER_STATUS.COMPLETED,
        shipping_status: 1,
      },
    });
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.created).toBe(1);
    expect(stats.payments).toBe(1);
    expect(stats.outputs).toBe(0);
    expect(ctx.tx.hspsi_sale_order_output.create).not.toHaveBeenCalled();
    expect(ctx.externalPosting.post).not.toHaveBeenCalled();

    const soCreate = ctx.tx.hspsi_sale_order.create.mock.calls[0]![0].data;
    expect(soCreate.so_type).toBe(4);
    expect(soCreate.delivery_status).toBe(1);
    expect(soCreate.order_status).toBe(2);
    expect(soCreate.delivery_date).toBeNull();
  });

  it('order_type=1 退货退款：只记账不回库', async () => {
    const ctx = createContext();
    const snapshot = buildDetail({
      order_type: SHIFANG_QINGYUAN_STOCK_FLOW.CLOUD_IN,
      order: {
        order_status: SHIFANG_QINGYUAN_ORDER_STATUS.COMPLETED,
        is_feedback: 2,
      },
      refunds: [
        buildRefund({
          type: SHIFANG_QINGYUAN_REFUND_TYPE.RETURN_REFUND,
          is_refund: 1,
          num: 1,
          order_detail_id: 1,
        }),
      ],
    });
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.outputs).toBe(0);
    expect(stats.exits).toBe(0);
    expect(stats.payments).toBeGreaterThanOrEqual(2);
    expect(ctx.tx.hspsi_sale_order_exit.create).not.toHaveBeenCalled();
    expect(ctx.externalPosting.post).not.toHaveBeenCalled();
  });

  it('仅退款成功：type=1 is_refund=1 → 退款收款计入 payments，无 exit', async () => {
    const ctx = createContext();
    const snapshot = buildDetail({
      order: {
        order_status: SHIFANG_QINGYUAN_ORDER_STATUS.PENDING_SHIP,
        is_feedback: 2,
      },
      refunds: [buildRefund({ type: SHIFANG_QINGYUAN_REFUND_TYPE.REFUND_ONLY, is_refund: 1 })],
    });
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.payments).toBeGreaterThanOrEqual(2); // 收款 + 退款
    expect(stats.exits).toBe(0);
    expect(ctx.tx.hspsi_sale_order_exit.create).not.toHaveBeenCalled();

    const payCreates = ctx.tx.hspsi_sales_order_payment.create.mock.calls.map(
      (c: any[]) => c[0].data.so_pay_type,
    );
    expect(payCreates).toContain(1);
    expect(payCreates).toContain(2);

    const refundPay = ctx.tx.hspsi_sales_order_payment.create.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.so_pay_type === 2);
    expect(refundPay.pay_date).toEqual(new Date(1723536000 * 1000));
    expect(refundPay.created_at).toEqual(new Date(1723536000 * 1000));
    expect(refundPay.updated_at).not.toEqual(new Date(1723536000 * 1000));

    const afterSale = ctx.tx.hspsi_sale_order_service.create.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.event_type === 4);
    expect(afterSale).toBeTruthy();
    expect(afterSale.goods_id).toBe(Number(GOODS_ID));
    expect(afterSale.sku_id).toBe(Number(SKU_ID));
    expect(afterSale.event_date).toEqual(new Date(1723536000 * 1000));
    expect(afterSale.created_at).toEqual(new Date(1723536000 * 1000));
    expect(afterSale.updated_at).not.toEqual(new Date(1723536000 * 1000));
    expect(ctx.tx.hspsi_sale_order_service_detail.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          goods_id: GOODS_ID,
          sku_id: SKU_ID,
          service_qty: 1,
          batch_no: '',
          source_output_id: 0n,
        }),
      ],
    });
  });

  it('机构未映射：mall_id 无 organization_mapping → failed', async () => {
    const ctx = createContext();
    ctx.tx.hspsi_sys_organization_mapping.findFirst.mockResolvedValue(null);
    mockListSnapshot(ctx, buildDetail());

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed).toBe(1);
    expect(stats.failures[0]!.reason).toMatch(/机构未映射|mall_id/);
    expect(ctx.tx.hspsi_sale_order.create).not.toHaveBeenCalled();
  });

  it('无 conversion_rule：按下单 SKU 原样出库', async () => {
    const ctx = createContext();
    ctx.tx.hspsi_goods_sku_conversion_rule.findMany.mockResolvedValue([]);
    const snapshot = buildDetail({
      order: {
        order_status: SHIFANG_QINGYUAN_ORDER_STATUS.SHIPPED,
        shipping_status: 1,
      },
      details: [{ id: 1, goods_id: 11, goods_attr_id: 1101, num: 2, price: 99.5, goods_price: 199 }],
      express: [
        {
          id: 7002,
          order_id: 10001,
          cs_order_id: 0,
          shipping_type: 1,
          express_id: 1,
          express_name: '中通',
          express_no: 'ZT999',
          customer_name: '',
          buyer_id: 0,
          buyer_name: '',
          operator_id: 0,
          operator_username: '',
          memo: '',
          status: 1,
          created_at: 1723536000,
          updated_at: 1723536000,
          source_table: '',
          source_table_id: 0,
          edit_num: 0,
        },
      ],
    });
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });
    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.outputs).toBeGreaterThanOrEqual(1);

    const detailArg = ctx.tx.hspsi_sale_order_output_detail.createMany.mock.calls[0]![0].data;
    expect(detailArg[0].goods_id).toBe(GOODS_ID);
    expect(detailArg[0].sku_id).toBe(SKU_ID);
    expect(detailArg[0].output_qty).toBe(2);
  });

  it('退货退款成功：type=2 → 生成 exit 并过账', async () => {
    const ctx = createContext();
    const snapshot = buildDetail({
      order: {
        order_status: SHIFANG_QINGYUAN_ORDER_STATUS.SHIPPED,
        shipping_status: 1,
        is_feedback: 2,
      },
      express: [
        {
          id: 7003,
          order_id: 10001,
          cs_order_id: 0,
          shipping_type: 1,
          express_id: 1,
          express_name: '顺丰',
          express_no: 'SF888',
          customer_name: '',
          buyer_id: 0,
          buyer_name: '',
          operator_id: 0,
          operator_username: '',
          memo: '',
          status: 1,
          created_at: 1723536000,
          updated_at: 1723536000,
          source_table: '',
          source_table_id: 0,
          edit_num: 0,
        },
      ],
      refunds: [
        buildRefund({
          type: SHIFANG_QINGYUAN_REFUND_TYPE.RETURN_REFUND,
          is_refund: 1,
          num: 1,
          order_detail_id: 1,
        }),
      ],
    });
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.exits).toBeGreaterThanOrEqual(1);
    expect(ctx.tx.hspsi_sale_order_exit.create).toHaveBeenCalled();
    expect(ctx.externalPosting.post.mock.calls.length).toBeGreaterThanOrEqual(2); // 出库 + 回库
  });

  it('按 order_no 单笔同步：syncOrderByNo', async () => {
    const ctx = createContext();
    const snapshot = buildDetail();
    ctx.shifangQingyuan.getOrderList.mockResolvedValue({
      list: [snapshot],
      pagination: { total: 1, page: 1, page_size: 1 },
    });

    const stats = await ctx.service.syncOrderByNo('SFQY202608120001', '1');

    expect(ctx.shifangQingyuan.getOrderList).toHaveBeenCalledWith(
      expect.objectContaining({ order_no: 'SFQY202608120001' }),
    );
    expect(ctx.shifangQingyuan.getOrderDetail).not.toHaveBeenCalled();
    expect(stats.created).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it('二次同步幂等：source_updated_at 与 status 未变则 skipped', async () => {
    const ctx = createContext();
    const snapshot = buildDetail();
    mockListSnapshot(ctx, snapshot);

    const first = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });
    expect(first.created).toBe(1);

    // 第二次：mapping 已 SUCCESS 且水位一致 → applyOrder 内跳过（读 prisma 侧 mapping）
    const mapping = [...ctx.mappingStore.values()][0]!;
    const watermark = new Date(snapshot.order.updated_at * 1000);
    ctx.prisma.hspsi_sale_order_source_mapping.findFirst.mockResolvedValue({
      ...mapping,
      sync_status: SHIFANG_QINGYUAN_ORDER_SYNC_STATUS.SUCCESS,
      so_id: mapping.so_id > 0n ? mapping.so_id : 9001n,
      source_status: snapshot.order.order_status,
      source_updated_at: watermark,
    });

    const createCallsBefore = ctx.tx.hspsi_sale_order.create.mock.calls.length;
    const second = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(second.skipped).toBe(1);
    expect(second.created).toBe(0);
    expect(ctx.tx.hspsi_sale_order.create.mock.calls.length).toBe(createCallsBefore);
  });

  it('缺失客户用收货人补建，levels 为空数组', async () => {
    const ctx = createContext();
    const snapshot = buildDetail({
      order: {
        pay_status: SHIFANG_QINGYUAN_PAY_STATUS.PAID,
        order_status: SHIFANG_QINGYUAN_ORDER_STATUS.PENDING_SHIP,
        receiver_name: '收货人甲',
      },
    });
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });
    expect(stats.failed).toBe(0);
    expect(ctx.tx.hspsi_basic_customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '收货人甲',
          mobile: '13800000000',
          related_customer_id: 501n,
          levels: [],
          address: '广东省深圳市南山区科技园一路',
        }),
      }),
    );
  });

  it('已存在客户只更新地址，不覆盖姓名/levels', async () => {
    const ctx = createContext();
    ctx.tx.hspsi_basic_customer.findFirst.mockResolvedValue({
      customer_id: 7001n,
      name: '同步昵称',
      mobile: '13700000000',
      levels: ['经销商'],
    });
    const snapshot = buildDetail({
      order: {
        pay_status: SHIFANG_QINGYUAN_PAY_STATUS.PAID,
        order_status: SHIFANG_QINGYUAN_ORDER_STATUS.PENDING_SHIP,
        receiver_name: '收货人乙',
        mobile: '13600000000',
      },
    });
    mockListSnapshot(ctx, snapshot);

    const stats = await ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });
    expect(stats.failed).toBe(0);
    expect(ctx.tx.hspsi_basic_customer.create).not.toHaveBeenCalled();
    expect(ctx.tx.hspsi_basic_customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customer_id: 7001n },
        data: expect.objectContaining({
          address: '广东省深圳市南山区科技园一路',
        }),
      }),
    );
    const updateData = ctx.tx.hspsi_basic_customer.update.mock.calls[0]![0].data;
    expect(updateData).not.toHaveProperty('name');
    expect(updateData).not.toHaveProperty('mobile');
    expect(updateData).not.toHaveProperty('levels');
    expect(updateData).not.toHaveProperty('status');
  });

  it('同步进行中再次触发应拒绝', async () => {
    const ctx = createContext();
    let release!: (value: { list: unknown[] }) => void;
    ctx.shifangQingyuan.getOrderList.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const first = ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' });
    await vi.waitFor(() => expect(ctx.shifangQingyuan.getOrderList).toHaveBeenCalled());
    await expect(ctx.service.syncOrders('1', { start_time: '2026-01-01 00:00:00' })).rejects.toThrow(
      /仍在进行/,
    );
    release({ list: [] });
    await first;
  });
});
