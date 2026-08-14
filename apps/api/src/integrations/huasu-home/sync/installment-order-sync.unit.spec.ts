/**
 * 华溯之家分期订单同步单元测试（mock，不打真实外部接口）
 *
 * 覆盖：待审核/驳回跳过、按期收款出库、同一销售单多期追加、售后按 product_id+number 回库不退款、
 * 未出库售后不加库存、未付金额不记优惠、缺少 unpaid_amount 不视为已付、失败水位、
 * 单品未映射挂起、水位按类型隔离
 *
 * 运行：
 *   pnpm --filter @hspsi/api test installment-order-sync.unit.spec
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
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_INSTALLMENT_STATUS,
  HUASU_HOME_ORDER_SYNC_STATUS,
  HUASU_HOME_ORDER_TYPE,
} from '../huasu-home.constants';
import type { HuasuHomeInstallmentOrder } from '../huasu-home.types';
import { HuasuHomeInstallmentOrderSyncService } from './installment-order-sync.service';

function paidPeriod(overrides: Record<string, unknown> = {}) {
  return {
    id: 45,
    installment_no: 'OI2607300100000730294',
    no: 'OIP2607300100000176913',
    period: 1,
    amount: 15000,
    paid_amount: 15000,
    unpaid_amount: 0,
    offline_paid_time: '2026-07-09 00:00:00',
    remark: '',
    rights_issue: {
      id: 45,
      installment_no: 'OI2607300100000730294',
      installment_period_no: 'OIP2607300100000176913',
      package_id: 8,
      product_id: 1,
      number: 10,
      created_at: '2026-07-30 15:20:31',
      updated_at: '2026-07-30 15:20:31',
    },
    created_at: '2026-07-30 15:20:31',
    updated_at: '2026-07-30 15:20:31',
    ...overrides,
  };
}

function baseOrder(
  overrides: Partial<HuasuHomeInstallmentOrder> = {},
): HuasuHomeInstallmentOrder {
  return {
    id: 23,
    no: 'OI2607300100000730294',
    order_sn: '',
    status: HUASU_HOME_INSTALLMENT_STATUS.IN_PROGRESS,
    amount: 30000,
    package_amount: 30000,
    paid_amount: 15000,
    unpaid_amount: 15000,
    paid_period: 1,
    package_id: 8,
    organization_id: 3,
    remark: '分期备注',
    created_at: '2026-07-30 15:18:09',
    updated_at: '2026-07-30 15:20:37',
    user_id: 988,
    aftersale: null,
    products: [
      {
        id: 35,
        installment_no: 'OI2607300100000730294',
        package_id: 8,
        product_id: 1,
        number: 20,
        gift_number: 20,
        original_price: 0,
      },
    ],
    periods: [paidPeriod()],
    user: {
      id: 988,
      nickname: '徐俊杰',
      mobile: '13922449153',
      gender: 1,
      birth: '',
      status: 1,
      remark: '',
      organization_id: 3,
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
  const payments = new Map<string, any>();
  const outputs = new Map<string, any>();
  const exits = new Map<string, any>();

  const orderRow = {
    so_id: 9001n,
    org_id: 1n,
    warehouse_id: 21n,
    so_no: 'SO20260813000001',
    customer_id: 7001n,
    customer_name: '徐俊杰',
    customer_mobile: '13922449153',
    customer_address: '',
    sales_name: '',
    sales_mobile: '',
    delivery_status: 1,
    order_status: 1,
    service_status: 3,
    so_property_type: 1,
    shipper: '',
    fact_amount: 15000,
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
        name: '徐俊杰',
        mobile: '13922449153',
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
      findFirst: vi.fn().mockResolvedValue({
        sku_id: 401n,
        good_id: 301n,
        unit_type: 1,
        is_default: 1,
      }),
    },
    hspsi_goods_info: {
      findFirst: vi.fn().mockResolvedValue({ goods_id: 301n, goods_type: 1 }),
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
      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        return payments.get(where.request_key) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { pay_id: paySeq++, ...data };
        payments.set(data.request_key, row);
        return row;
      }),
    },
    hspsi_sale_order_service: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        service_id: serviceSeq++,
        ...data,
      })),
    },
    hspsi_sale_order_output: {
      findFirst: vi.fn().mockImplementation(async ({ where }) => {
        if (where?.remark) return outputs.get(where.remark) ?? null;
        if (where?.so_id != null && confirmedOutputs > 0) {
          return { so_output_id: 8001n };
        }
        return null;
      }),
      count: vi.fn().mockImplementation(async () => confirmedOutputs),
      create: vi.fn().mockImplementation(async ({ data }) => {
        confirmedOutputs += 1;
        const row = {
          so_output_id: 8000n + BigInt(confirmedOutputs),
          ...data,
        };
        if (data.remark) outputs.set(data.remark, row);
        return row;
      }),
    },
    hspsi_sale_order_output_detail: { createMany: vi.fn(), findMany: vi.fn() },
    hspsi_sale_order_exit: {
      findFirst: vi.fn().mockImplementation(async ({ where }) => {
        return exits.get(where.remark) ?? null;
      }),
      create: vi.fn().mockImplementation(async ({ data }) => {
        const row = { so_exit_id: 5001n, ...data };
        exits.set(data.remark, row);
        return row;
      }),
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
  };

  const huasuHome = {
    getInstallmentOrderList: vi.fn(),
  };
  const businessNumber = {
    generate: vi.fn().mockResolvedValue('NO20260813000999'),
  };
  const posting = { post: vi.fn().mockResolvedValue(undefined) };

  const service = new HuasuHomeInstallmentOrderSyncService(
    prisma as never,
    huasuHome as never,
    businessNumber as never,
    posting as never,
  );

  return { service, prisma, huasuHome, businessNumber, posting, tx, mappingStore, saleOrders };
}

describe('HuasuHomeInstallmentOrderSyncService 单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('待审核分期不同步建单', async () => {
    const { service, huasuHome, prisma } = createService();
    huasuHome.getInstallmentOrderList.mockResolvedValue({
      list: [baseOrder({ status: HUASU_HOME_INSTALLMENT_STATUS.PENDING_AUDIT })],
    });

    const stats = await service.syncInstallmentOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.fetched).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.created).toBe(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('审核驳回分期不同步建单', async () => {
    const { service, huasuHome } = createService();
    huasuHome.getInstallmentOrderList.mockResolvedValue({
      list: [baseOrder({ status: HUASU_HOME_INSTALLMENT_STATUS.AUDIT_REJECTED })],
    });

    const stats = await service.syncInstallmentOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.skipped).toBe(1);
    expect(stats.created).toBe(0);
  });

  it('进行中但无已付期次时跳过', async () => {
    const { service, huasuHome, prisma } = createService();
    huasuHome.getInstallmentOrderList.mockResolvedValue({
      list: [
        baseOrder({
          paid_amount: 0,
          unpaid_amount: 30000,
          paid_period: 0,
          periods: [
            paidPeriod({
              paid_amount: 0,
              unpaid_amount: 15000,
              rights_issue: null,
            }),
          ],
        }),
      ],
    });

    const stats = await service.syncInstallmentOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.skipped).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('进行中已付一期：建一张销售单+该期收款+按 rights_issue 出库', async () => {
    const ctx = createService();
    ctx.huasuHome.getInstallmentOrderList.mockResolvedValue({
      list: [baseOrder()],
      total: 1,
    });

    const stats = await ctx.service.syncInstallmentOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(0);
    expect(stats.created).toBe(1);
    expect(stats.payments).toBe(1);
    expect(stats.outputs).toBe(1);
    expect(stats.exits).toBe(0);

    const createArg = ctx.tx.hspsi_sale_order.create.mock.calls[0][0].data;
    expect(createArg.customer_address).toBe('');
    expect(createArg.so_no).toBeTruthy();
    expect(Number(createArg.fact_amount)).toBe(15000);
    expect(Number(createArg.so_amount)).toBe(30000);
    expect(Number(createArg.priceoff_amount)).toBe(0);

    const mapping = [...ctx.mappingStore.values()][0];
    expect(mapping.source_order_type).toBe(HUASU_HOME_ORDER_TYPE.INSTALLMENT);
    expect(mapping.source_order_no).toBe('OI2607300100000730294');
    expect(mapping.sync_status).toBe(HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS);

    const payKey = ctx.tx.hspsi_sales_order_payment.create.mock.calls[0][0].data.request_key;
    expect(payKey).toContain('INSTALLMENT');
    expect(payKey).toContain('OIP2607300100000176913');

    const shipKey = ctx.tx.hspsi_sale_order_output.create.mock.calls[0][0].data.remark;
    expect(shipKey).toContain('OIP2607300100000176913');
    expect(ctx.posting.post).toHaveBeenCalled();
  });

  it('同一销售单第二期只追加收款和出库，不新建 so_no', async () => {
    const ctx = createService();
    ctx.huasuHome.getInstallmentOrderList.mockResolvedValueOnce({
      list: [baseOrder()],
      total: 1,
    });
    await ctx.service.syncInstallmentOrders('1', { updated_at: '2026-01-01 00:00:00' });
    const firstSoNo = ctx.tx.hspsi_sale_order.create.mock.calls[0][0].data.so_no;
    expect(ctx.tx.hspsi_sale_order.create).toHaveBeenCalledTimes(1);

    const secondPeriod = paidPeriod({
      id: 46,
      no: 'OIP2607300100000176914',
      period: 2,
      rights_issue: {
        id: 46,
        product_id: 1,
        number: 10,
        created_at: '2026-08-01 10:00:00',
      },
    });
    ctx.huasuHome.getInstallmentOrderList.mockResolvedValueOnce({
      list: [
        baseOrder({
          paid_amount: 30000,
          unpaid_amount: 0,
          paid_period: 2,
          status: HUASU_HOME_INSTALLMENT_STATUS.COMPLETED,
          updated_at: '2026-08-01 10:00:00',
          periods: [paidPeriod(), secondPeriod],
        }),
      ],
      total: 1,
    });

    const stats = await ctx.service.syncInstallmentOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(0);
    expect(stats.created).toBe(0);
    expect(stats.updated).toBe(1);
    expect(stats.payments).toBe(1);
    expect(stats.outputs).toBe(1);
    expect(ctx.tx.hspsi_sale_order.create).toHaveBeenCalledTimes(1);
    expect(ctx.tx.hspsi_sales_order_payment.create).toHaveBeenCalledTimes(2);
    expect(ctx.tx.hspsi_sale_order_output.create).toHaveBeenCalledTimes(2);

    const secondPayKey = ctx.tx.hspsi_sales_order_payment.create.mock.calls[1][0].data.request_key;
    expect(secondPayKey).toContain('OIP2607300100000176914');
    expect(firstSoNo).toBe('NO20260813000999');
  });

  it('售后按 product_id+number 回库，不写退款', async () => {
    const ctx = createService();
    ctx.huasuHome.getInstallmentOrderList.mockResolvedValue({
      list: [
        baseOrder({
          status: HUASU_HOME_INSTALLMENT_STATUS.AFTER_SALES,
          aftersale: {
            id: 2,
            installment_no: 'OI2607300100000730294',
            package_id: 8,
            product_id: 1,
            number: 5,
            remark: '分期售后',
            created_at: '2026-08-02 10:00:00',
            updated_at: '2026-08-02 10:00:00',
          },
        }),
      ],
      total: 1,
    });

    const stats = await ctx.service.syncInstallmentOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(0);
    expect(stats.exits).toBe(1);
    expect(ctx.tx.hspsi_sale_order_exit.create).toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_exit_detail.createMany).toHaveBeenCalled();

    const refundPay = ctx.tx.hspsi_sales_order_payment.create.mock.calls.find(
      (call: Array<{ data: { so_pay_type: number } }>) => call[0].data.so_pay_type === 2,
    );
    expect(refundPay).toBeFalsy();

    const exitRemark = ctx.tx.hspsi_sale_order_exit.create.mock.calls[0][0].data.remark;
    expect(exitRemark).toContain('INSTALLMENT');
    expect(exitRemark).toContain('-2');
  });

  it('单品未映射则挂起失败', async () => {
    const ctx = createService();
    ctx.tx.hspsi_goods_source_mapping.findMany.mockResolvedValue([]);
    ctx.huasuHome.getInstallmentOrderList.mockResolvedValue({
      list: [baseOrder()],
      total: 1,
    });

    const stats = await ctx.service.syncInstallmentOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(1);
    expect(stats.failures[0]?.reason).toContain('单品未映射');
    expect(ctx.tx.hspsi_sale_order.create).not.toHaveBeenCalled();
  });

  it('增量水位只取 INSTALLMENT，不与普通订单混用', async () => {
    const ctx = createService();
    ctx.huasuHome.getInstallmentOrderList.mockResolvedValue({ list: [] });

    await ctx.service.syncInstallmentOrders('1');

    expect(ctx.prisma.hspsi_sale_order_source_mapping.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source_order_type: HUASU_HOME_ORDER_TYPE.INSTALLMENT,
        }),
      }),
    );
    expect(ctx.huasuHome.getInstallmentOrderList).toHaveBeenCalledWith({
      page: 1,
      page_size: 200,
      updated_at: '1970-01-01 00:00:00',
    });
  });

  it('机构优先取订单 organization_id', async () => {
    const ctx = createService();
    ctx.huasuHome.getInstallmentOrderList.mockResolvedValue({
      list: [baseOrder()],
      total: 1,
    });

    await ctx.service.syncInstallmentOrders('1', { updated_at: '2026-01-01 00:00:00' });
    expect(ctx.tx.hspsi_sys_organization_mapping.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source_object_id: '3',
        }),
      }),
    );
  });

  it('缺少 unpaid_amount 且 paid_amount=0 的期次不视为已付', async () => {
    const { service, huasuHome, prisma } = createService();
    huasuHome.getInstallmentOrderList.mockResolvedValue({
      list: [
        baseOrder({
          paid_amount: 0,
          unpaid_amount: 30000,
          paid_period: 0,
          periods: [
            paidPeriod({
              paid_amount: 0,
              unpaid_amount: undefined,
              rights_issue: null,
            }),
          ],
        }),
      ],
    });

    const stats = await service.syncInstallmentOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.skipped).toBe(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('售后但从未出库时只记事件，不回库加库存', async () => {
    const ctx = createService();
    ctx.huasuHome.getInstallmentOrderList.mockResolvedValue({
      list: [
        baseOrder({
          status: HUASU_HOME_INSTALLMENT_STATUS.AFTER_SALES,
          periods: [paidPeriod({ rights_issue: null })],
          aftersale: {
            id: 2,
            installment_no: 'OI2607300100000730294',
            package_id: 8,
            product_id: 1,
            number: 5,
            remark: '分期售后',
            created_at: '2026-08-02 10:00:00',
            updated_at: '2026-08-02 10:00:00',
          },
        }),
      ],
      total: 1,
    });

    const stats = await ctx.service.syncInstallmentOrders('1', {
      updated_at: '2026-01-01 00:00:00',
    });
    expect(stats.failed).toBe(0);
    expect(stats.outputs).toBe(0);
    expect(stats.exits).toBe(0);
    expect(ctx.tx.hspsi_sale_order_exit.create).not.toHaveBeenCalled();
    expect(ctx.posting.post).not.toHaveBeenCalled();
  });

  it('存在失败映射时增量水位取失败单最早 source_updated_at', async () => {
    const ctx = createService();
    ctx.mappingStore.set(`${HUASU_HOME_ORDER_TYPE.INSTALLMENT}:1`, {
      id: 1n,
      source_order_type: HUASU_HOME_ORDER_TYPE.INSTALLMENT,
      source_order_id: '1',
      sync_status: HUASU_HOME_ORDER_SYNC_STATUS.FAILED,
      source_updated_at: new Date(2026, 6, 24, 10, 0, 0),
    });
    ctx.mappingStore.set(`${HUASU_HOME_ORDER_TYPE.INSTALLMENT}:2`, {
      id: 2n,
      source_order_type: HUASU_HOME_ORDER_TYPE.INSTALLMENT,
      source_order_id: '2',
      sync_status: HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS,
      source_updated_at: new Date(2026, 6, 25, 12, 0, 0),
    });
    ctx.huasuHome.getInstallmentOrderList.mockResolvedValue({ list: [] });

    await ctx.service.syncInstallmentOrders('1');
    expect(ctx.huasuHome.getInstallmentOrderList).toHaveBeenCalledWith({
      page: 1,
      page_size: 200,
      updated_at: '2026-07-24 10:00:00',
    });
  });
});
