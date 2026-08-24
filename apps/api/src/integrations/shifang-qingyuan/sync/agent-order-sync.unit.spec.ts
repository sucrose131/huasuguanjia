/**
 * 十方清源自提订单同步单元测试（mock，不打真实 DB/API）
 *
 * 覆盖：
 * - 未支付运费跳过
 * - 待发货建单，金额/单价为 0，不写收款
 * - 商品映射 source_type=STANDARD + source_goods_id，取第一条
 * - 商品未映射 / 机构未映射失败
 * - 已发货、已完成出库；不出转换规则
 * - 取消且未出库：关单不回库
 * - 已出库后取消：按出库单回库，过账键 sfqy-exit:{so_output_id}:v1
 * - 客户取 list.user，地址取 list.address
 *
 * 运行：
 *   pnpm --filter @hspsi/api test agent-order-sync.unit.spec
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
  SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS,
  SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
  SHIFANG_QINGYUAN_ORDER_SYNC_STATUS,
  SHIFANG_QINGYUAN_ORDER_TYPE,
  SHIFANG_QINGYUAN_SOURCE_TYPE,
} from '../shifang-qingyuan.constants';
import type { ShifangQingyuanAgentOrderListItem } from '../shifang-qingyuan.types';
import { ShifangQingyuanAgentOrderSyncService } from './agent-order-sync.service';

const SOURCE_ID = 5n;
const ORG_ID = 10n;
const WAREHOUSE_ID = 20n;
const GOODS_ID = 101n;
const SKU_ID = 201n;

function buildSnapshot(
  overrides: Partial<ShifangQingyuanAgentOrderListItem> = {},
): ShifangQingyuanAgentOrderListItem {
  return {
    id: 17,
    order_no: 'CSP20260109101204835092',
    order_type: 1,
    order_type_text: '云仓自提',
    send_status: SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.PENDING_SHIP,
    send_status_text: '待发货',
    user: {
      id: 171973,
      mall_id: 88,
      username: '18665546822',
      mobile: '18665546822',
      nickname: '小明',
    },
    details: [
      {
        id: 17,
        user_id: 171973,
        mall_id: 88,
        goods_id: 1,
        order_id: 17,
        num: 24,
        status: 1,
      },
    ],
    num: 0,
    name: '李四',
    mobile: '189****9911',
    address: '广东省广州市天河区',
    express_code: '',
    express_name: '',
    express_no: '',
    refunds: [],
    created_at: 1767924724,
    created_at_text: '2026-01-09 10:12:04',
    ...overrides,
  };
}

function createContext() {
  const mappingStore = new Map<string, any>();
  let mappingSeq = 1n;
  let soSeq = 9001n;
  let bizNo = 0;
  const createdOutput = { so_output_id: 8001n, so_id: 9001n, comfirm_status: 1 };

  const orderRow = {
    so_id: 9001n,
    org_id: ORG_ID,
    warehouse_id: WAREHOUSE_ID,
    so_no: 'SO20260824000001',
    customer_id: 7001n,
    customer_name: '小明',
    customer_mobile: '18665546822',
    customer_address: '广东省广州市天河区',
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
        name: '小明',
        mobile: '18665546822',
      }),
      update: vi.fn(),
    },
    hspsi_goods_source_mapping: {
      findFirst: vi.fn().mockResolvedValue({
        goods_id: GOODS_ID,
        sku_id: SKU_ID,
      }),
    },
    hspsi_goods_info_sku: {
      findFirst: vi.fn().mockResolvedValue({ sku_id: SKU_ID, good_id: GOODS_ID, unit_type: 1 }),
    },
    hspsi_goods_info: {
      findFirst: vi.fn().mockResolvedValue({ goods_id: GOODS_ID, goods_type: 1 }),
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
        return { ...orderRow, so_id: soSeq++, ...data };
      }),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn().mockImplementation(async ({ where }: any) => ({
        ...orderRow,
        so_id: where.so_id,
      })),
    },
    hspsi_sale_order_detail: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    hspsi_sales_order_payment: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    hspsi_sale_order_service: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    hspsi_sale_order_output: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        ...createdOutput,
        ...data,
      })),
    },
    hspsi_sale_order_output_detail: {
      createMany: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
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
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const shifangQingyuan = {
    getAgentOrderList: vi.fn(),
  };
  const businessNumber = {
    generate: vi.fn().mockImplementation(async () => `NO${String(++bizNo).padStart(4, '0')}`),
  };
  const externalPosting = { post: vi.fn().mockResolvedValue(undefined) };

  const service = new ShifangQingyuanAgentOrderSyncService(
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
    createdOutput,
  };
}

function mockList(
  ctx: ReturnType<typeof createContext>,
  snapshot: ShifangQingyuanAgentOrderListItem,
) {
  ctx.shifangQingyuan.getAgentOrderList.mockResolvedValue({
    list: [snapshot],
    pagination: { total: 1, page: 1, page_size: 100 },
  });
}

describe('ShifangQingyuanAgentOrderSyncService 单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('未支付运费跳过：send_status=3 → skipped，不建单', async () => {
    const ctx = createContext();
    mockList(
      ctx,
      buildSnapshot({ send_status: SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.UNPAID_FREIGHT }),
    );

    const stats = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.fetched).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order.create).not.toHaveBeenCalled();
  });

  it('待发货建单：金额为 0、不写收款、客户取 user、地址取 list.address', async () => {
    const ctx = createContext();
    mockList(ctx, buildSnapshot());

    const stats = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.created).toBe(1);
    expect(stats.outputs).toBe(0);
    expect(ctx.tx.hspsi_sales_order_payment.create).not.toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_output.create).not.toHaveBeenCalled();

    const soCreate = ctx.tx.hspsi_sale_order.create.mock.calls[0]![0].data;
    expect(Number(soCreate.so_amount)).toBe(0);
    expect(Number(soCreate.fact_amount)).toBe(0);
    expect(soCreate.customer_name).toBe('小明');
    expect(soCreate.customer_mobile).toBe('18665546822');
    expect(soCreate.customer_address).toBe('广东省广州市天河区');
    expect(soCreate.so_type).toBe(1);
    expect(soCreate.delivery_status).toBe(1);

    const line = ctx.tx.hspsi_sale_order_detail.createMany.mock.calls[0]![0].data[0];
    expect(Number(line.sale_price)).toBe(0);
    expect(line.sale_qty).toBe(24);

    expect(ctx.tx.hspsi_basic_customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: '小明',
          mobile: '18665546822',
          related_customer_id: 171973n,
          address: '广东省广州市天河区',
          levels: [],
        }),
      }),
    );

    const mapping = [...ctx.mappingStore.values()][0];
    expect(mapping.source_order_type).toBe(SHIFANG_QINGYUAN_ORDER_TYPE.CLOUD_STOCK_AGENT_ORDER);
    expect(mapping.sync_status).toBe(SHIFANG_QINGYUAN_ORDER_SYNC_STATUS.SUCCESS);
  });

  it('商品映射只查 STANDARD + source_goods_id，不查规格 ID', async () => {
    const ctx = createContext();
    mockList(ctx, buildSnapshot());

    await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });

    const goodsWhere = ctx.tx.hspsi_goods_source_mapping.findFirst.mock.calls[0]![0];
    expect(goodsWhere.where).toEqual(
      expect.objectContaining({
        source_id: SOURCE_ID,
        source_type: SHIFANG_QINGYUAN_SOURCE_TYPE.STANDARD,
        source_goods_id: '1',
      }),
    );
    expect(goodsWhere.where).not.toHaveProperty('source_sku_id');
    expect(goodsWhere.orderBy).toEqual({ id: 'asc' });
  });

  it('商品未映射失败', async () => {
    const ctx = createContext();
    ctx.tx.hspsi_goods_source_mapping.findFirst.mockResolvedValue(null);
    mockList(ctx, buildSnapshot());

    const stats = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed).toBe(1);
    expect(stats.failures[0]!.reason).toMatch(/商品未映射/);
  });

  it('机构未映射失败', async () => {
    const ctx = createContext();
    ctx.tx.hspsi_sys_organization_mapping.findFirst.mockResolvedValue(null);
    mockList(ctx, buildSnapshot());

    const stats = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed).toBe(1);
    expect(stats.failures[0]!.reason).toMatch(/机构未映射/);
  });

  it('已发货：按 details.num 出库，过账键绑出库单 ID', async () => {
    const ctx = createContext();
    mockList(
      ctx,
      buildSnapshot({
        send_status: SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.SHIPPED,
        express_no: 'SF123',
      }),
    );

    const stats = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.outputs).toBe(1);
    expect(ctx.tx.hspsi_sales_order_payment.create).not.toHaveBeenCalled();

    const detailArg = ctx.tx.hspsi_sale_order_output_detail.createMany.mock.calls[0]![0].data;
    expect(detailArg[0].goods_id).toBe(GOODS_ID);
    expect(detailArg[0].sku_id).toBe(SKU_ID);
    expect(detailArg[0].output_qty).toBe(24);

    expect(ctx.externalPosting.post.mock.calls[0]![0].idempotencyKey).toBe(
      'shifang-qingyuan-output:8001:v1',
    );
    const soCreate = ctx.tx.hspsi_sale_order.create.mock.calls[0]![0].data;
    expect(soCreate.shipper).toBe('SF123');
    expect(soCreate.delivery_status).toBe(3);
  });

  it('已完成视为已发货并出库', async () => {
    const ctx = createContext();
    mockList(
      ctx,
      buildSnapshot({ send_status: SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.COMPLETED }),
    );

    const stats = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.outputs).toBe(1);
    const soCreate = ctx.tx.hspsi_sale_order.create.mock.calls[0]![0].data;
    expect(soCreate.order_status).toBe(2);
    expect(soCreate.delivery_status).toBe(3);
  });

  it('取消且未出库：关单不回库', async () => {
    const ctx = createContext();
    mockList(
      ctx,
      buildSnapshot({ send_status: SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.CANCELLED }),
    );

    const stats = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
    expect(stats.created).toBe(1);
    expect(stats.outputs).toBe(0);
    expect(stats.exits).toBe(0);
    expect(ctx.tx.hspsi_sale_order_exit.create).not.toHaveBeenCalled();
    const soCreate = ctx.tx.hspsi_sale_order.create.mock.calls[0]![0].data;
    expect(soCreate.order_status).toBe(3);
  });

  it('已出库后取消：按出库单回库，过账键 sfqy-exit:{so_output_id}:v1', async () => {
    const ctx = createContext();
    mockList(
      ctx,
      buildSnapshot({ send_status: SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.SHIPPED }),
    );

    const first = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });
    expect(first.outputs).toBe(1);

    ctx.tx.hspsi_sale_order_output.findFirst.mockResolvedValue(ctx.createdOutput);
    ctx.tx.hspsi_sale_order_output.count.mockResolvedValue(1);
    ctx.tx.hspsi_sale_order_output_detail.findMany.mockResolvedValue([
      {
        goods_id: GOODS_ID,
        sku_id: SKU_ID,
        unit_type: 1,
        output_qty: 24,
        batch_no: '',
      },
    ]);
    ctx.tx.hspsi_sale_order.findFirst.mockResolvedValue({
      so_id: 9001n,
      delivery_status: 3,
      order_status: 1,
      service_status: 3,
    });

    mockList(
      ctx,
      buildSnapshot({ send_status: SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.CANCELLED }),
    );
    const second = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });

    expect(second.failed, JSON.stringify(second.failures)).toBe(0);
    expect(second.exits).toBe(1);
    expect(ctx.tx.hspsi_sale_order_exit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_output_id: 8001n,
          remark: 'sfqy-exit:8001:v1',
        }),
      }),
    );
    const exitPost = ctx.externalPosting.post.mock.calls.find(
      (call: any[]) => call[0].idempotencyKey === 'sfqy-exit:8001:v1',
    );
    expect(exitPost).toBeTruthy();
    expect(exitPost![0].direction).toBe(1);
    expect(ctx.tx.hspsi_sales_order_payment.create).not.toHaveBeenCalled();
    expect(ctx.tx.hspsi_sale_order_service.create).not.toHaveBeenCalled();
  });

  it('已存在客户只更新地址，不覆盖姓名', async () => {
    const ctx = createContext();
    ctx.tx.hspsi_basic_customer.findFirst.mockResolvedValue({
      customer_id: 7001n,
      name: '同步昵称',
      mobile: '13700000000',
      levels: ['经销商'],
    });
    mockList(ctx, buildSnapshot());

    const stats = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });
    expect(stats.failed).toBe(0);
    expect(ctx.tx.hspsi_basic_customer.create).not.toHaveBeenCalled();
    const updateData = ctx.tx.hspsi_basic_customer.update.mock.calls[0]![0].data;
    expect(updateData.address).toBe('广东省广州市天河区');
    expect(updateData).not.toHaveProperty('name');
    expect(updateData).not.toHaveProperty('mobile');
    expect(updateData).not.toHaveProperty('levels');
  });

  it('二次同步同状态幂等跳过', async () => {
    const ctx = createContext();
    mockList(ctx, buildSnapshot());
    const first = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });
    expect(first.created).toBe(1);

    const mapping = [...ctx.mappingStore.values()][0]!;
    ctx.prisma.hspsi_sale_order_source_mapping.findFirst.mockResolvedValue({
      ...mapping,
      sync_status: SHIFANG_QINGYUAN_ORDER_SYNC_STATUS.SUCCESS,
      so_id: mapping.so_id > 0n ? mapping.so_id : 9001n,
      source_status: SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.PENDING_SHIP,
    });

    const createCallsBefore = ctx.tx.hspsi_sale_order.create.mock.calls.length;
    const second = await ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });
    expect(second.skipped).toBe(1);
    expect(ctx.tx.hspsi_sale_order.create.mock.calls.length).toBe(createCallsBefore);
  });

  it('同步进行中再次触发应拒绝', async () => {
    const ctx = createContext();
    let release!: (value: { list: unknown[] }) => void;
    ctx.shifangQingyuan.getAgentOrderList.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const first = ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' });
    await vi.waitFor(() => expect(ctx.shifangQingyuan.getAgentOrderList).toHaveBeenCalled());
    await expect(
      ctx.service.syncAgentOrders('1', { start_time: '2026-01-01 00:00:00' }),
    ).rejects.toThrow(/仍在进行/);
    release({ list: [] });
    await first;
  });
});
