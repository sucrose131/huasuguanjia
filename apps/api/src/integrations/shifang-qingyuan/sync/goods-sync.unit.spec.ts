/**
 * 十方清源商品同步单元测试（mock，不打真实外部接口）
 *
 * 覆盖：
 * - 普通商品(STANDARD)同步：SPU / SKU / mapping 落库
 * - 下架商品仍创建，mapping 保持 MAPPED，平台不下架
 * - 无 SKU 商品跳过
 * - gift_plan 对象格式 give_goods_num 写 conversion_rule（source_type=MAPPED）
 * - upgrade_bag 数组格式 give_goods_num 写 conversion_rule（source_type=MAPPED）
 * - 幂等：二次同步走 update 路径
 * - gift_plan 清空后停用旧 conversion_rule
 * - 源端不再返回的商品保留 mapping / 平台商品，仅告警
 * - 分页空页退出（避免 total 偏大死循环）
 * - 金额按元直落（不做 ÷100）
 *
 * 运行：
 *   pnpm --filter @hspsi/api test goods-sync.unit.spec
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
  SHIFANG_QINGYUAN_RULE_STATUS,
  SHIFANG_QINGYUAN_RULE_TYPE,
  SHIFANG_QINGYUAN_SOURCE_TYPE,
} from '../shifang-qingyuan.constants';
import type { ShifangQingyuanGoodsItem } from '../shifang-qingyuan.types';
import { asRecordArray, ShifangQingyuanGoodsSyncService } from './goods-sync.service';

/** 构造一个"自身出库"普通商品 */
function buildStandardGoods(overrides: Partial<ShifangQingyuanGoodsItem> = {}): ShifangQingyuanGoodsItem {
  return {
    goods: {
      id: 1,
      mall_id: 1,
      mch_id: 0,
      goods_name: '尝鲜装',
      subtitle: '1瓶',
      price: 686,
      original_price: 0,
      cost_price: 0,
      unit: '瓶',
      cover_pic: 'https://example.com/1.jpg',
      bannar_pic: [],
      video_url: '',
      video_cover_pic: '',
      is_on_sale: 1,
      is_attr: 0,
      attr_groups: '',
      attr_groups_format: '',
      status: 1,
      stock: 99840,
      stock_warning: 1000,
      is_show_stock: 1,
      is_show_sales: 1,
      virtual_sales: 0,
      sales_num: 164,
      buy_num_limit: -1,
      freight_type: 1,
      freight_rules_type: 1,
      freight_id: 2,
      shipping_fee: 0,
      free_shipping_num: 6,
      free_shipping_money: 0,
      goods_type: 1,
      detail: '',
      is_area_limit: 0,
      area_limit: [],
      services: '',
      labels: '',
      goods_source: '',
      check_status: 0,
      check_remark: '',
      sort: 1,
      created_at: 1765508237,
      updated_at: 1784116682,
      is_show: 1,
      comment_score: 0.07,
      goods_no: '',
      is_pay_limit: 1,
      pay_limit: {},
      can_feedback: 1,
      goods_subtype: 0,
      is_virtual_feedback: 0,
      freight_compute_mode: 0,
    },
    goods_cate: [{ id: 1, mall_id: 1, mch_id: 0, parent_id: 0, name: '优选专区', pic: '', big_pic: '', advert_pic: '', advert_url: '', advert_open_type: '', advert_params: null, is_show: 1, status: 1, sort: 0, level: 1, text_color: '', created_at: 0, updated_at: 0 }],
    qimall_goods_attr: [
      {
        id: 1,
        goods_id: 1,
        name: '',
        sign_id: '',
        stock: 99840,
        price: 686,
        original_price: 0,
        cost_price: 0,
        goods_no: '',
        weight: 120,
        pic_url: 'https://example.com/1.jpg',
        status: 1,
        version: 0,
        sort: 1,
        created_at: 0,
        updated_at: 0,
        is_show: 1,
        is_show_code: 0,
        spec_no: '',
      },
    ],
    cloud_stock_gift_plan: [],
    cloud_stock_upgrade_bag: [],
    ...overrides,
  };
}

/** 构造带 gift_plan 的商品（对象格式 give_goods_num） */
function buildGiftPlanGoods(overrides: Partial<ShifangQingyuanGoodsItem> = {}): ShifangQingyuanGoodsItem {
  const goods = buildStandardGoods({
    goods: { ...buildStandardGoods().goods, id: 10, goods_name: '赠品A', price: 9900, sort: 10 },
  });
  return {
    ...goods,
    goods: { ...goods.goods, id: 20, goods_name: '礼品装（含赠品）', price: 29800 },
    qimall_goods_attr: [
      {
        id: 20,
        goods_id: 20,
        name: '标准',
        sign_id: '',
        stock: 1000,
        price: 29800,
        original_price: 0,
        cost_price: 0,
        goods_no: '',
        weight: 0,
        pic_url: '',
        status: 1,
        version: 0,
        sort: 1,
        created_at: 0,
        updated_at: 0,
        is_show: 1,
        is_show_code: 0,
        spec_no: '',
      },
    ],
    cloud_stock_gift_plan: [
      {
        id: 1,
        mall_id: 1,
        goods_id: [20],
        // 对象格式：{商品id: 数量}
        give_goods_num: { '1': 3, '10': 5 } as Record<string, number>,
        give_goods_id: '[1,10]',
        gift_condition_level: '',
        gift_condition_self_level: '',
        is_gift_goods_quantity: 0,
        status: 1,
        created_at: 0,
        updated_at: 0,
      },
    ],
    cloud_stock_upgrade_bag: [],
    ...overrides,
  };
}

/** 构造带 upgrade_bag 的商品（数组格式 give_goods_num） */
function buildUpgradeBagGoods(): ShifangQingyuanGoodsItem {
  return {
    ...buildStandardGoods(),
    goods: { ...buildStandardGoods().goods, id: 30, goods_name: '升级礼包2瓶', price: 119800, goods_type: 2, sort: 30 },
    qimall_goods_attr: [
      {
        id: 30,
        goods_id: 30,
        name: '',
        sign_id: '',
        stock: 99859,
        price: 119800,
        original_price: 0,
        cost_price: 0,
        goods_no: '',
        weight: 0,
        pic_url: '',
        status: 1,
        version: 0,
        sort: 2,
        created_at: 0,
        updated_at: 0,
        is_show: 1,
        is_show_code: 0,
        spec_no: '',
      },
    ],
    cloud_stock_gift_plan: [],
    cloud_stock_upgrade_bag: [
      {
        id: 3,
        mall_id: 1,
        name: '2瓶升级礼包',
        level: 1,
        goods_id: [30],
        // 数组格式：[{goods_id, num}]
        give_goods_num: [{ goods_id: 1, num: 2 }],
        give_goods_id: [1],
        is_enable: 1,
        status: 1,
        created_at: 0,
        updated_at: 0,
        level_reward: [],
        is_percent: 0,
      },
    ],
  };
}

type GoodsRow = {
  goods_id: bigint;
  goods_name: string;
  sale_price: { toNumber(): number };
  status?: number;
  deleted_at?: Date | null;
};
type SkuRow = { sku_id: bigint; sale_price: { toNumber(): number }; pcs_qty: number };
type MappingRow = {
  id: bigint;
  source_id: bigint;
  source_type: string;
  source_goods_id: string;
  source_sku_id: string;
  goods_id: bigint;
  sku_id: bigint;
  mapping_status: number;
  deleted_at?: Date;
};
type RuleRow = {
  id: bigint;
  source_goods_id: bigint;
  source_sku_id: bigint;
  target_goods_id: bigint;
  target_sku_id: bigint;
  quantity_ratio: number;
  rule_type: number;
  status: number;
  deleted_at?: Date;
};

function createContext() {
  const goodsStore: GoodsRow[] = [];
  const skuStore: SkuRow[] = [];
  const mappingStore: MappingRow[] = [];
  const ruleStore: RuleRow[] = [];

  let goodsSeq = 1001n;
  let skuSeq = 2001n;
  let mappingSeq = 3001n;
  let ruleSeq = 4001n;

  const tx = {
    hspsi_basic_unit: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { id: 1, name: '瓶' },
          { id: 2, name: '盒' },
        ]),
    },
    hspsi_goods_info: {
      findUnique: vi.fn().mockImplementation(({ where }: any) =>
        goodsStore.find((row) => row.goods_id === where.goods_id) ?? null,
      ),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const row: GoodsRow = { goods_id: goodsSeq++, ...data };
        goodsStore.push(row);
        return row;
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const row = goodsStore.find((r) => r.goods_id === where.goods_id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        let count = 0;
        const idIn: bigint[] | undefined = where.goods_id?.in;
        for (const row of goodsStore) {
          if (idIn && !idIn.includes(row.goods_id)) continue;
          if (where.deleted_at === null && row.deleted_at) continue;
          if (where.status?.not != null && row.status === where.status.not) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      }),
    },
    hspsi_goods_info_sku: {
      create: vi.fn().mockImplementation(({ data }: any) => {
        const row: SkuRow = { sku_id: skuSeq++, ...data };
        skuStore.push(row);
        return row;
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const row = skuStore.find((r) => r.sku_id === where.sku_id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    hspsi_goods_source_mapping: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return (
          mappingStore.find(
            (row) =>
              row.source_id === where.source_id &&
              row.source_goods_id === where.source_goods_id &&
              row.source_sku_id === (where.source_sku_id ?? row.source_sku_id) &&
              (where.source_type ? row.source_type === where.source_type : true) &&
              (where.deleted_at === null ? !row.deleted_at : true) &&
              (where.goods_id?.gt != null ? row.goods_id > where.goods_id.gt : true),
          ) ?? null
        );
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        return mappingStore.filter((row) => {
          if (where.source_id != null && row.source_id !== where.source_id) return false;
          if (where.deleted_at === null && row.deleted_at) return false;
          if (
            where.mapping_status?.not != null &&
            row.mapping_status === where.mapping_status.not
          ) {
            return false;
          }
          if (where.source_goods_id != null && row.source_goods_id !== where.source_goods_id) {
            return false;
          }
          return true;
        });
      }),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const row: MappingRow = { id: mappingSeq++, ...data };
        mappingStore.push(row);
        return row;
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const row = mappingStore.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        let count = 0;
        const idIn: bigint[] | undefined = where.id?.in;
        for (const row of mappingStore) {
          if (idIn) {
            if (!idIn.includes(row.id)) continue;
          } else {
            if (row.source_id !== where.source_id) continue;
            if (
              where.source_goods_id != null &&
              row.source_goods_id !== where.source_goods_id
            ) {
              continue;
            }
            if (
              where.source_sku_id != null &&
              row.source_sku_id !== where.source_sku_id
            ) {
              continue;
            }
            if (where.deleted_at === null && row.deleted_at) continue;
            if (
              where.mapping_status?.not != null &&
              row.mapping_status === where.mapping_status.not
            ) {
              continue;
            }
          }
          Object.assign(row, data);
          count++;
        }
        return { count };
      }),
    },
    hspsi_goods_sku_conversion_rule: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return (
          ruleStore.find(
            (row) =>
              row.source_goods_id === where.source_goods_id &&
              row.source_sku_id === where.source_sku_id &&
              row.target_goods_id === where.target_goods_id &&
              row.target_sku_id === where.target_sku_id,
          ) ?? null
        );
      }),
      findMany: vi.fn().mockImplementation(({ where }: any) =>
        ruleStore.filter((row) => {
          if (where.source_goods_id?.in) {
            if (!where.source_goods_id.in.includes(row.source_goods_id)) return false;
          } else if (where.source_goods_id != null) {
            if (row.source_goods_id !== where.source_goods_id) return false;
          }
          if (where.source_sku_id != null && row.source_sku_id !== where.source_sku_id) {
            return false;
          }
          if (where.rule_type?.in != null) {
            if (!where.rule_type.in.includes(row.rule_type)) return false;
          } else if (where.rule_type != null && row.rule_type !== where.rule_type) {
            return false;
          }
          if (where.deleted_at === null && row.deleted_at) return false;
          if (where.status != null && row.status !== where.status) return false;
          return true;
        }),
      ),
      create: vi.fn().mockImplementation(({ data }: any) => {
        const row: RuleRow = { id: ruleSeq++, ...data };
        ruleStore.push(row);
        return row;
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        const row = ruleStore.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }: any) => {
        let count = 0;
        for (const row of ruleStore) {
          if (where.id?.in?.includes(row.id)) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
      }),
    },
  };

  const prisma = {
    hspsi_sys_data_source: {
      findUnique: vi.fn().mockResolvedValue({
        id: 5n,
        code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
        status: 1,
      }),
      create: vi.fn().mockImplementation(({ data }: any) => ({ id: 5n, ...data })),
    },
    hspsi_basic_unit: {
      findMany: vi.fn().mockResolvedValue([
        { id: 1, name: '瓶' },
        { id: 2, name: '盒' },
      ]),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };

  const shifangQingyuan = {
    getGoodsList: vi.fn(),
  };

  const service = new ShifangQingyuanGoodsSyncService(prisma as never, shifangQingyuan as never);

  return { service, prisma, shifangQingyuan, tx, goodsStore, skuStore, mappingStore, ruleStore };
}

describe('ShifangQingyuanGoodsSyncService 单元测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('普通商品同步：创建 SPU + SKU + STANDARD mapping，金额按元直落正确', async () => {
    const ctx = createContext();
    const item = buildStandardGoods();
    ctx.shifangQingyuan.getGoodsList
      .mockResolvedValueOnce({
        list: [item],
        pagination: { total: 1, page: 1, page_size: 100 },
      });

    const stats = await ctx.service.syncGoods('0');

    expect(stats.goods.created).toBe(1);
    expect(stats.skus.created).toBe(1);
    expect(stats.mappings.upserted).toBe(1); // 仅 SKU 级映射

    // SPU
    const goods = ctx.goodsStore[0]!;
    expect(goods.goods_name).toBe('尝鲜装');
    expect(goods.sale_price.toNumber()).toBeCloseTo(686, 2); // 接口已是元
    expect(goods.spec_models).toBe('默认规格');

    // SKU
    const sku = ctx.skuStore[0]!;
    expect(sku.sale_price.toNumber()).toBeCloseTo(686, 2);
    expect(sku.pcs_qty).toBe(1); // 库存不同步
    expect(sku.spec_models).toBe('默认规格');

    // Mapping：source_type=STANDARD
    const mapping = ctx.mappingStore[0]!;
    expect(mapping.source_type).toBe(SHIFANG_QINGYUAN_SOURCE_TYPE.STANDARD);
    expect(mapping.source_goods_id).toBe('1');
    expect(mapping.mapping_status).toBe(SHIFANG_QINGYUAN_MAPPING_STATUS.MAPPED);
  });

  it('下架商品：仍创建 SPU+SKU+mapping，保留平台商品与可用映射', async () => {
    const ctx = createContext();
    const offlineItem = buildStandardGoods({
      goods: { ...buildStandardGoods().goods, is_on_sale: 0, status: 1 },
    });
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [offlineItem],
      pagination: { total: 1, page: 1, page_size: 100 },
    });

    const stats = await ctx.service.syncGoods('0');

    // 下架商品也创建了商品/SKU（历史订单找得到）
    expect(stats.goods.created).toBe(1);
    expect(stats.goods.mappingOnly).toBe(1); // 标记为 mappingOnly
    expect(stats.skus.created).toBe(1);
    expect(ctx.goodsStore.length).toBe(1);
    expect(ctx.skuStore.length).toBe(1);

    // 源端下架不落平台下架，mapping 保持可用
    expect(ctx.goodsStore[0]!.status).toBe(1);
    for (const m of ctx.mappingStore) {
      expect(m.mapping_status).toBe(SHIFANG_QINGYUAN_MAPPING_STATUS.MAPPED);
    }
    expect(ctx.mappingStore.length).toBe(1); // 仅 SKU 级
  });

  it('无 SKU 的商品跳过', async () => {
    const ctx = createContext();
    const noSkuItem = buildStandardGoods({ qimall_goods_attr: [] });
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [noSkuItem],
      pagination: { total: 1, page: 1, page_size: 100 },
    });

    const stats = await ctx.service.syncGoods('0');
    expect(stats.goods.skipped).toBe(1);
    expect(stats.warnings.some((w) => w.includes('无 SKU'))).toBe(true);
  });

  it('规格名为空白时写入默认规格，有名称时保留原名', async () => {
    const ctx = createContext();
    const blankName = buildStandardGoods({
      goods: { ...buildStandardGoods().goods, id: 101, goods_name: '空白规格商品' },
      qimall_goods_attr: [
        {
          ...buildStandardGoods().qimall_goods_attr[0]!,
          id: 101,
          goods_id: 101,
          name: '   ',
        },
      ],
    });
    const named = buildStandardGoods({
      goods: { ...buildStandardGoods().goods, id: 102, goods_name: '有规格商品' },
      qimall_goods_attr: [
        {
          ...buildStandardGoods().qimall_goods_attr[0]!,
          id: 102,
          goods_id: 102,
          name: '500ml',
        },
      ],
    });
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [blankName, named],
      pagination: { total: 2, page: 1, page_size: 100 },
    });

    await ctx.service.syncGoods('0');

    const blankSku = ctx.skuStore.find((row) => row.spec_models === '默认规格');
    const namedSku = ctx.skuStore.find((row) => row.spec_models === '500ml');
    const blankGoods = ctx.goodsStore.find((row) => row.goods_name === '空白规格商品');
    const namedGoods = ctx.goodsStore.find((row) => row.goods_name === '有规格商品');
    expect(blankSku).toBeTruthy();
    expect(namedSku).toBeTruthy();
    expect(blankGoods?.spec_models).toBe('默认规格');
    expect(namedGoods?.spec_models).toBe('500ml');
  });

  it('gift_plan 对象格式 give_goods_num：source_type=MAPPED，写多条 conversion_rule', async () => {
    const ctx = createContext();
    const standard = buildStandardGoods(); // goods.id=1
    const giftTarget = buildStandardGoods({
      goods: { ...buildStandardGoods().goods, id: 10, goods_name: '赠品A', price: 9900, sort: 10 },
      qimall_goods_attr: [
        {
          ...buildStandardGoods().qimall_goods_attr[0]!,
          id: 10,
          goods_id: 10,
          price: 9900,
        },
      ],
    });
    const withGift = buildGiftPlanGoods(); // goods.id=20，gift_plan 赠 goods=1×3, goods=10×5
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [standard, giftTarget, withGift],
      pagination: { total: 3, page: 1, page_size: 100 },
    });

    const stats = await ctx.service.syncGoods('0');

    // 3 个商品 + 3 个 SKU
    expect(stats.goods.created).toBe(3);
    expect(stats.skus.created).toBe(3);

    // 找礼品装 mapping
    const giftMapping = ctx.mappingStore.find((m) => m.source_goods_id === '20')!;
    expect(giftMapping.source_type).toBe(SHIFANG_QINGYUAN_SOURCE_TYPE.MAPPED);

    // 找 2 条 conversion_rule（赠送 goods=1×3, goods=10×5）→ 多目标用 COMBO_SPLIT
    expect(stats.conversionRules.upserted).toBe(2);
    const ratios = ctx.ruleStore.map((r) => r.quantity_ratio).sort();
    expect(ratios).toEqual([3, 5]);
    expect(
      ctx.ruleStore.every((r) => r.rule_type === SHIFANG_QINGYUAN_RULE_TYPE.COMBO_SPLIT),
    ).toBe(true);
    expect(ctx.ruleStore.every((r) => r.status === SHIFANG_QINGYUAN_RULE_STATUS.ENABLED)).toBe(true);
  });

  it('upgrade_bag 数组格式 give_goods_num：source_type=MAPPED，写 conversion_rule', async () => {
    const ctx = createContext();
    const standard = buildStandardGoods(); // goods.id=1，被赠 2 件
    const withBag = buildUpgradeBagGoods(); // goods.id=30，升级礼包
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [standard, withBag],
      pagination: { total: 2, page: 1, page_size: 100 },
    });

    const stats = await ctx.service.syncGoods('0');

    // 升级礼包 mapping
    const bagMapping = ctx.mappingStore.find((m) => m.source_goods_id === '30')!;
    expect(bagMapping.source_type).toBe(SHIFANG_QINGYUAN_SOURCE_TYPE.MAPPED);

    // 1 条转换规则，赠 goods=1×2 → 单目标用 REPLACE
    expect(stats.conversionRules.upserted).toBe(1);
    const rule = ctx.ruleStore[0]!;
    expect(rule.quantity_ratio).toBe(2);
    expect(rule.rule_type).toBe(SHIFANG_QINGYUAN_RULE_TYPE.REPLACE);
    expect(rule.source_goods_id).toBe(bagMapping.goods_id);
  });

  it('幂等：二次同步不创建新记录', async () => {
    const ctx = createContext();
    const item = buildStandardGoods();
    ctx.shifangQingyuan.getGoodsList.mockResolvedValue({
      list: [item],
      pagination: { total: 1, page: 1, page_size: 100 },
    });

    const first = await ctx.service.syncGoods('0');
    const second = await ctx.service.syncGoods('0');

    expect(second.goods.created).toBe(0);
    expect(second.skus.created).toBe(0);
    expect(second.goods.updated).toBe(1);
    expect(ctx.goodsStore.length).toBe(1);
    expect(ctx.skuStore.length).toBe(1);
    expect(ctx.mappingStore.length).toBe(1); // 仅 SKU 级
    expect(first.mappings.upserted).toBe(1);
    expect(second.mappings.upserted).toBe(1);
  });

  it('下架的已存在 mapping 商品：仍保持 MAPPED，平台不下架', async () => {
    const ctx = createContext();
    // 第一次：上架
    const item = buildStandardGoods();
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [item],
      pagination: { total: 1, page: 1, page_size: 100 },
    });
    await ctx.service.syncGoods('0');
    for (const m of ctx.mappingStore) {
      expect(m.mapping_status).toBe(SHIFANG_QINGYUAN_MAPPING_STATUS.MAPPED);
    }

    // 第二次：下架
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [buildStandardGoods({ goods: { ...item.goods, is_on_sale: 0 } })],
      pagination: { total: 1, page: 1, page_size: 100 },
    });
    const stats = await ctx.service.syncGoods('0');

    expect(stats.goods.mappingOnly).toBe(1);
    expect(ctx.goodsStore[0]!.status).toBe(1);
    for (const m of ctx.mappingStore) {
      expect(m.mapping_status).toBe(SHIFANG_QINGYUAN_MAPPING_STATUS.MAPPED);
    }
    expect(ctx.mappingStore.length).toBe(1); // 仅 SKU 级
  });

  it('单位字符串匹配：unit="瓶" → hspsi_basic_unit.id=1', async () => {
    const ctx = createContext();
    const item = buildStandardGoods();
    ctx.shifangQingyuan.getGoodsList.mockResolvedValue({
      list: [item],
      pagination: { total: 1, page: 1, page_size: 100 },
    });

    await ctx.service.syncGoods('0');

    // goods.unit_type
    expect(ctx.goodsStore[0]!).toHaveProperty('unit_type', 1);
    // SKU unit_type 继承商品
    expect(ctx.skuStore[0]!).toHaveProperty('unit_type', 1);
  });

  it('gift_plan 清空后：停用全部旧 conversion_rule，source_type 回 STANDARD', async () => {
    const ctx = createContext();
    const standard = buildStandardGoods();
    const giftTarget = buildStandardGoods({
      goods: { ...buildStandardGoods().goods, id: 10, goods_name: '赠品A', price: 9900, sort: 10 },
      qimall_goods_attr: [
        {
          ...buildStandardGoods().qimall_goods_attr[0]!,
          id: 10,
          goods_id: 10,
          price: 9900,
        },
      ],
    });
    const withGift = buildGiftPlanGoods();
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [standard, giftTarget, withGift],
      pagination: { total: 3, page: 1, page_size: 100 },
    });
    await ctx.service.syncGoods('0');
    expect(ctx.ruleStore.length).toBe(2);
    expect(ctx.ruleStore.every((r) => r.status === SHIFANG_QINGYUAN_RULE_STATUS.ENABLED)).toBe(
      true,
    );

    // 第二次：gift_plan 清空
    const cleared = buildGiftPlanGoods({
      cloud_stock_gift_plan: [],
    });
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [standard, giftTarget, cleared],
      pagination: { total: 3, page: 1, page_size: 100 },
    });
    await ctx.service.syncGoods('0');

    expect(ctx.ruleStore.every((r) => r.status === SHIFANG_QINGYUAN_RULE_STATUS.DISABLED)).toBe(
      true,
    );
    expect(ctx.ruleStore.every((r) => r.deleted_at != null)).toBe(true);
    const giftMapping = ctx.mappingStore.find((m) => m.source_goods_id === '20')!;
    expect(giftMapping.source_type).toBe(SHIFANG_QINGYUAN_SOURCE_TYPE.STANDARD);
  });

  it('源端不再返回的商品：保留 mapping、平台商品与转换规则，仅告警', async () => {
    const ctx = createContext();
    const standard = buildStandardGoods();
    const withBag = buildUpgradeBagGoods();
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [standard, withBag],
      pagination: { total: 2, page: 1, page_size: 100 },
    });
    await ctx.service.syncGoods('0');

    const bagMapping = ctx.mappingStore.find((m) => m.source_goods_id === '30')!;
    expect(bagMapping.mapping_status).toBe(SHIFANG_QINGYUAN_MAPPING_STATUS.MAPPED);
    expect(ctx.ruleStore.length).toBe(1);
    expect(ctx.ruleStore[0]!.status).toBe(SHIFANG_QINGYUAN_RULE_STATUS.ENABLED);

    // 第二次：源端只返回 standard，upgrade_bag 商品消失
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [standard],
      pagination: { total: 1, page: 1, page_size: 100 },
    });
    const stats = await ctx.service.syncGoods('0');

    expect(stats.mappings.disabled).toBe(0);
    for (const m of ctx.mappingStore.filter((row) => row.source_goods_id === '30')) {
      expect(m.mapping_status).toBe(SHIFANG_QINGYUAN_MAPPING_STATUS.MAPPED);
    }
    const bagGoods = ctx.goodsStore.find((g) => g.goods_id === bagMapping.goods_id)!;
    expect(bagGoods.status).toBe(1);
    expect(ctx.ruleStore[0]!.status).toBe(SHIFANG_QINGYUAN_RULE_STATUS.ENABLED);
    expect(ctx.ruleStore[0]!.deleted_at).toBeFalsy();
    expect(stats.warnings.some((w) => w.includes('已保留平台商品与 mapping'))).toBe(true);
  });

  it('分页：本页为空时退出，不因 total 偏大死循环', async () => {
    const ctx = createContext();
    const pageItems = Array.from({ length: 100 }, (_, i) => {
      const id = i + 1;
      return buildStandardGoods({
        goods: {
          ...buildStandardGoods().goods,
          id,
          goods_name: `商品${id}`,
          sort: id,
        },
        qimall_goods_attr: [
          {
            ...buildStandardGoods().qimall_goods_attr[0]!,
            id,
            goods_id: id,
          },
        ],
      });
    });

    ctx.shifangQingyuan.getGoodsList
      .mockResolvedValueOnce({
        list: pageItems,
        pagination: { total: 500, page: 1, page_size: 100 },
      })
      .mockResolvedValueOnce({
        list: [],
        pagination: { total: 500, page: 2, page_size: 100 },
      });

    const stats = await ctx.service.syncGoods('0');

    expect(ctx.shifangQingyuan.getGoodsList).toHaveBeenCalledTimes(2);
    expect(stats.goods.created).toBe(100);
  });

  it('同步进行中再次触发应拒绝', async () => {
    const ctx = createContext();
    let release!: (value: { list: unknown[]; pagination: { total: number; page: number; page_size: number } }) => void;
    ctx.shifangQingyuan.getGoodsList.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const first = ctx.service.syncGoods('0');
    await vi.waitFor(() => expect(ctx.shifangQingyuan.getGoodsList).toHaveBeenCalled());
    await expect(ctx.service.syncGoods('0')).rejects.toThrow(/仍在进行/);
    release({ list: [], pagination: { total: 0, page: 1, page_size: 100 } });
    await first;
  });

  it('upgrade_bag 为空对象 {} 时按无方案处理，不抛错', async () => {
    const ctx = createContext();
    const item = buildStandardGoods({
      cloud_stock_upgrade_bag: {} as never,
      cloud_stock_gift_plan: {} as never,
    });
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [item],
      pagination: { total: 1, page: 1, page_size: 100 },
    });

    const stats = await ctx.service.syncGoods('0');
    expect(stats.goods.created).toBe(1);
    const mapping = ctx.mappingStore.find((row) => row.source_goods_id === '1')!;
    expect(mapping.source_type).toBe(SHIFANG_QINGYUAN_SOURCE_TYPE.STANDARD);
    expect(stats.conversionRules.upserted).toBe(0);
  });

  it('upgrade_bag 为单条对象时仍按启用方案写入 conversion_rule', async () => {
    const ctx = createContext();
    const standard = buildStandardGoods();
    const withBag = buildUpgradeBagGoods();
    const [bag] = withBag.cloud_stock_upgrade_bag;
    const item = { ...withBag, cloud_stock_upgrade_bag: bag as never };
    ctx.shifangQingyuan.getGoodsList.mockResolvedValueOnce({
      list: [standard, item],
      pagination: { total: 2, page: 1, page_size: 100 },
    });

    const stats = await ctx.service.syncGoods('0');
    const bagMapping = ctx.mappingStore.find((row) => row.source_goods_id === '30')!;
    expect(bagMapping.source_type).toBe(SHIFANG_QINGYUAN_SOURCE_TYPE.MAPPED);
    expect(stats.conversionRules.upserted).toBe(1);
  });
});

describe('asRecordArray', () => {
  it('空对象视为空数组', () => {
    expect(asRecordArray({})).toEqual([]);
  });

  it('数字键对象展开为数组', () => {
    expect(asRecordArray({ '0': { id: 1 }, '1': { id: 2 } })).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('单条记录对象包成数组', () => {
    expect(asRecordArray({ id: 3, name: '礼包', goods_id: [1] })).toEqual([
      { id: 3, name: '礼包', goods_id: [1] },
    ]);
  });
});
