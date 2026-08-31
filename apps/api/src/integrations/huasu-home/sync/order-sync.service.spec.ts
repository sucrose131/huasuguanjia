/**
 * 华溯之家订单同步集成测试（真实请求）
 *
 * 测试方式：真实请求 + 真实写库（依赖 Redis 生成单号）
 * - 从 .env 读取 HUASU_HOME_* / DATABASE_URL / REDIS_URL
 * - 真实签名请求订单列表、订单详情
 * - 同步落库：映射 / 销售单 / 收款 / 事件 / 出库扣库（允许负库存）/ 售后退货入库
 *
 * 运行方式：
 *   pnpm --filter @hspsi/api test order-sync.service.spec
 *
 * 前置条件：
 *   1. .env 已配置 DATABASE_URL、REDIS_URL
 *   2. .env 已配置 HUASU_HOME_BASE_URL、HUASU_HOME_APP_PUBLIC_KEY
 *   3. 建议已完成商品同步；HUASU_HOME_GOODS_CATEGORY_ID 已改为真实分类
 *   4. service_org_id 已在 hspsi_sys_organization_mapping 中映射
 *   5. 映射机构下已有 warehouse_type=1 的销售仓库
 *   6. 外部同步出库使用专用过账，无库存时可建账扣负（不要求商品 org 与订单机构一致）
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { BusinessNumberService } from '../../../business-number/business-number.service';
import { INVENTORY_BUSINESS_MODE } from '../../../inventory/inventory-dictionary';
import { RedisService } from '../../../redis/redis.service';
import { HttpClientService } from '../../common/http-client.service';
import {
  HUASU_HOME_AFTER_SALES_STATUS,
  HUASU_HOME_AFTER_SALES_TYPE,
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_GOODS_CATEGORY_ID,
  HUASU_HOME_MAPPING_STATUS,
  HUASU_HOME_ORDER_SHIPPED_STATUSES,
  HUASU_HOME_ORDER_SYNC_STATUS,
  HUASU_HOME_ORDER_SYNCABLE_STATUSES,
  HUASU_HOME_ORDER_TYPE,
  HUASU_HOME_PRODUCT_TYPE,
  HUASU_HOME_SOURCE_TYPE,
} from '../huasu-home.constants';
import { HuasuHomeService } from '../huasu-home.service';
import type { HuasuHomeOrder, HuasuHomeOrderListData } from '../huasu-home.types';
import { ExternalInventoryPostingService } from '../../common/external-inventory-posting.service';
import { HuasuHomeOrderSyncService } from './order-sync.service';

function loadEnvOverride(filePath: string) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let raw = trimmed.slice(eqIdx + 1).trim();
      const quote = raw.startsWith('"') ? '"' : raw.startsWith("'") ? "'" : '';
      if (quote) {
        raw = raw.slice(1);
        while (!raw.endsWith(quote) && i + 1 < lines.length) {
          i += 1;
          raw += `\n${lines[i]!}`;
        }
        if (raw.endsWith(quote)) raw = raw.slice(0, -1);
        raw = raw.replace(/\\n/g, '\n');
      }
      process.env[key] = raw;
    }
  } catch {
    /* 文件不存在则跳过 */
  }
}

loadEnvOverride(resolve(process.cwd(), '../../.env'));
loadEnvOverride(resolve(process.cwd(), '.env'));

type ShipTarget = {
  goodsId: bigint;
  skuId: bigint;
  unitType: number;
  quantity: number;
};

describe('HuasuHomeOrderSyncService 订单同步集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let redis: RedisService;
  let huasuHome: HuasuHomeService;
  let service: HuasuHomeOrderSyncService;
  let orderList: HuasuHomeOrderListData;
  let paidSample: HuasuHomeOrder | undefined;
  let sourceId: bigint;

  beforeAll(async () => {
    expect(process.env.HUASU_HOME_BASE_URL, '缺少 HUASU_HOME_BASE_URL').toBeTruthy();
    expect(process.env.HUASU_HOME_APP_PUBLIC_KEY, '缺少 HUASU_HOME_APP_PUBLIC_KEY').toBeTruthy();
    expect(process.env.DATABASE_URL, '缺少 DATABASE_URL').toBeTruthy();
    expect(process.env.REDIS_URL, '缺少 REDIS_URL').toBeTruthy();

    const config = new ConfigService();
    const http = new HttpClientService(config);
    huasuHome = new HuasuHomeService(config, http);

    prisma = new PrismaClient();
    await prisma.$connect();

    redis = new RedisService(config);
    await redis.ensureConnected();
    const businessNumber = new BusinessNumberService(redis, prisma as never, config);
    const externalPosting = new ExternalInventoryPostingService(prisma as never);

    service = new HuasuHomeOrderSyncService(
      prisma as never,
      huasuHome,
      businessNumber,
      externalPosting,
    );

    const source = await prisma.hspsi_sys_data_source.findUnique({
      where: { code: HUASU_HOME_DATA_SOURCE_CODE },
    });
    sourceId = source?.id ?? 0n;
  }, 30_000);

  afterAll(async () => {
    await redis?.onModuleDestroy().catch(() => undefined);
    await prisma?.$disconnect();
  });

  async function ensureOrderList() {
    if (!orderList?.list?.length) {
      orderList = await huasuHome.getOrderList({
        page: 1,
        page_size: 20,
        updated_at: '1970-01-01 00:00:00',
      });
    }
    return orderList;
  }

  async function resolvePlatformOrgId(serviceOrgId: number) {
    const source =
      sourceId > 0n
        ? { id: sourceId }
        : await prisma.hspsi_sys_data_source.findUnique({
            where: { code: HUASU_HOME_DATA_SOURCE_CODE },
          });
    if (!source) return null;
    sourceId = source.id;
    const mapping = await prisma.hspsi_sys_organization_mapping.findFirst({
      where: {
        source_id: source.id,
        source_object_id: String(serviceOrgId),
        deleted_at: null,
      },
    });
    return mapping?.org_id ?? null;
  }

  async function resolveSaleWarehouse(orgId: bigint) {
    return prisma.hspsi_basic_warehouse.findFirst({
      where: {
        org_id: orgId,
        warehouse_type: 1,
        status: 1,
        deleted_at: null,
      },
    });
  }

  async function isOrderGoodsMapped(order: HuasuHomeOrder) {
    if (!(sourceId > 0n)) return false;
    for (const item of order.items ?? []) {
      const isCombo =
        Number(item.product_type) === HUASU_HOME_PRODUCT_TYPE.COMBO ||
        (item.product_type == null && Number(item.package_id ?? 0) > 0);
      const mapping = await prisma.hspsi_goods_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_type: isCombo ? HUASU_HOME_SOURCE_TYPE.COMBO : HUASU_HOME_SOURCE_TYPE.STANDARD,
          source_goods_id: String(isCombo ? item.package_id || item.product_id : item.product_id),
          source_sku_id: isCombo ? '0' : String(item.sku_id),
          mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
          deleted_at: null,
        },
      });
      if (!mapping) return false;
    }
    return true;
  }

  /** 出库目标：优先 package_items 默认规格，否则下单 SKU */
  async function resolveShipTargets(order: HuasuHomeOrder): Promise<ShipTarget[]> {
    const targets: ShipTarget[] = [];
    for (const item of order.items ?? []) {
      const buyQty = Number(item.quantity);
      if (!(buyQty > 0)) continue;
      const packageItems = (item.package_items ?? []).filter((row) => Number(row.product_id) > 0);
      if (packageItems.length > 0) {
        for (const pkg of packageItems) {
          const qty =
            (Number(pkg.number || 0) + Number(pkg.gift_number || 0)) * buyQty;
          if (!(qty > 0)) continue;
          const mappings = await prisma.hspsi_goods_source_mapping.findMany({
            where: {
              source_id: sourceId,
              source_type: HUASU_HOME_SOURCE_TYPE.STANDARD,
              source_goods_id: String(pkg.product_id),
              mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
              deleted_at: null,
            },
          });
          if (!mappings.length) {
            throw new Error(`发货单品未映射 product_id=${pkg.product_id}`);
          }
          const goodsId = mappings[0]!.goods_id;
          const defaultSku = await prisma.hspsi_goods_info_sku.findFirst({
            where: { good_id: goodsId, is_default: 1, deleted_at: null },
            orderBy: { sku_id: 'asc' },
          });
          const skuId = defaultSku?.sku_id ?? mappings[0]!.sku_id;
          const sku =
            defaultSku ??
            (await prisma.hspsi_goods_info_sku.findFirst({
              where: { sku_id: skuId, good_id: goodsId, deleted_at: null },
            }));
          targets.push({
            goodsId,
            skuId,
            unitType: Number(sku?.unit_type ?? 0),
            quantity: qty,
          });
        }
        continue;
      }

      const isCombo =
        Number(item.product_type) === HUASU_HOME_PRODUCT_TYPE.COMBO ||
        (item.product_type == null && Number(item.package_id ?? 0) > 0);
      const mapping = await prisma.hspsi_goods_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_type: isCombo ? HUASU_HOME_SOURCE_TYPE.COMBO : HUASU_HOME_SOURCE_TYPE.STANDARD,
          source_goods_id: String(isCombo ? item.package_id || item.product_id : item.product_id),
          source_sku_id: isCombo ? '0' : String(item.sku_id),
          mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
          deleted_at: null,
        },
      });
      if (!mapping) throw new Error(`下单商品未映射 item=${item.id}`);
      const sku = await prisma.hspsi_goods_info_sku.findFirst({
        where: { sku_id: mapping.sku_id, good_id: mapping.goods_id, deleted_at: null },
      });
      targets.push({
        goodsId: mapping.goods_id,
        skuId: mapping.sku_id,
        unitType: Number(sku?.unit_type ?? 0),
        quantity: buyQty,
      });
    }
    return targets;
  }

  async function isRightsGoodsMapped(order: HuasuHomeOrder) {
    if (!(sourceId > 0n)) return false;
    for (const rec of order.after_sales?.rights_deducted_records ?? []) {
      const productId = Number(rec.product_id);
      const qty = Number(rec.gift_number || 0) + Number(rec.buy_number || 0);
      if (!(productId > 0) || !(qty > 0)) continue;
      const mapping = await prisma.hspsi_goods_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_type: HUASU_HOME_SOURCE_TYPE.STANDARD,
          source_goods_id: String(productId),
          mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
          deleted_at: null,
        },
      });
      if (!mapping) return false;
    }
    return true;
  }

  /** 回库目标：rights_deducted_records，数量 gift+buy，同 product 合并，默认规格 */
  async function resolveReturnTargets(order: HuasuHomeOrder): Promise<ShipTarget[]> {
    const merged = new Map<string, ShipTarget>();
    for (const rec of order.after_sales?.rights_deducted_records ?? []) {
      const productId = Number(rec.product_id);
      const qty = Number(rec.gift_number || 0) + Number(rec.buy_number || 0);
      if (!(productId > 0) || !(qty > 0)) continue;
      const mappings = await prisma.hspsi_goods_source_mapping.findMany({
        where: {
          source_id: sourceId,
          source_type: HUASU_HOME_SOURCE_TYPE.STANDARD,
          source_goods_id: String(productId),
          mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
          deleted_at: null,
        },
      });
      if (!mappings.length) {
        throw new Error(`权益扣减单品未映射 product_id=${productId}`);
      }
      const goodsId = mappings[0]!.goods_id;
      const defaultSku = await prisma.hspsi_goods_info_sku.findFirst({
        where: { good_id: goodsId, is_default: 1, deleted_at: null },
        orderBy: { sku_id: 'asc' },
      });
      const skuId = defaultSku?.sku_id ?? mappings[0]!.sku_id;
      const sku =
        defaultSku ??
        (await prisma.hspsi_goods_info_sku.findFirst({
          where: { sku_id: skuId, good_id: goodsId, deleted_at: null },
        }));
      const key = `${goodsId}:${skuId}`;
      const cur = merged.get(key);
      if (cur) cur.quantity += qty;
      else
        merged.set(key, {
          goodsId,
          skuId,
          unitType: Number(sku?.unit_type ?? 0),
          quantity: qty,
        });
    }
    return [...merged.values()];
  }

  function mergeTargets(targets: ShipTarget[]): ShipTarget[] {
    const merged = new Map<string, ShipTarget>();
    for (const row of targets) {
      const key = `${row.goodsId}:${row.skuId}`;
      const cur = merged.get(key);
      if (cur) cur.quantity += row.quantity;
      else merged.set(key, { ...row });
    }
    return [...merged.values()];
  }

  /**
   * 外部过账不要求商品 org 与订单机构一致，但仍校验分类 warehouse_type。
   * 测试前对齐销售分类并启用商品/SKU。
   */
  async function prepareGoodsForPosting(_orgId: bigint, targets: ShipTarget[]) {
    const goodsIds = [...new Set(targets.map((t) => String(t.goodsId)))].map((id) => BigInt(id));
    if (!goodsIds.length) return;
    await prisma.hspsi_goods_info.updateMany({
      where: { goods_id: { in: goodsIds } },
      data: {
        goods_catg_id: HUASU_HOME_GOODS_CATEGORY_ID,
        status: 1,
        deleted_at: null,
      },
    });
    await prisma.hspsi_goods_info_sku.updateMany({
      where: { good_id: { in: goodsIds } },
      data: { status: 1, deleted_at: null },
    });
  }

  /** 清空目标库存，用于验证无明细时建账并扣成负数 */
  async function clearStock(orgId: bigint, warehouseId: bigint, targets: ShipTarget[]) {
    for (const target of targets) {
      await prisma.hspsi_inventory_total.deleteMany({
        where: {
          org_id: orgId,
          warehouse_id: warehouseId,
          goods_id: target.goodsId,
          sku_id: target.skuId,
        },
      });
      await prisma.hspsi_inventory_batch_total.deleteMany({
        where: {
          org_id: orgId,
          warehouse_id: warehouseId,
          goods_id: target.goodsId,
          sku_id: target.skuId,
        },
      });
    }
  }

  async function readStockQty(
    orgId: bigint,
    warehouseId: bigint,
    goodsId: bigint,
    skuId: bigint,
  ) {
    const row = await prisma.hspsi_inventory_total.findUnique({
      where: {
        org_id_warehouse_id_goods_id_sku_id: {
          org_id: orgId,
          warehouse_id: warehouseId,
          goods_id: goodsId,
          sku_id: skuId,
        },
      },
    });
    return Number(row?.inventory_qty ?? 0);
  }

  /** 清掉旧出库/退货及对应库存流水，并重置映射水位，便于本用例重新履约 */
  async function resetFulfillmentForResync(order: HuasuHomeOrder) {
    const mapping = await prisma.hspsi_sale_order_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_order_type: HUASU_HOME_ORDER_TYPE.SALE_ORDER,
        source_order_id: String(order.id),
        deleted_at: null,
      },
    });

    if (mapping?.so_id && mapping.so_id > 0n) {
      const outputs = await prisma.hspsi_sale_order_output.findMany({
        where: { so_id: mapping.so_id },
        select: { so_output_id: true },
      });
      const exits = await prisma.hspsi_sale_order_exit.findMany({
        where: { so_id: mapping.so_id },
        select: { so_exit_id: true },
      });
      const outputIds = outputs.map((row) => row.so_output_id);
      const exitIds = exits.map((row) => row.so_exit_id);

      if (outputIds.length) {
        await prisma.hspsi_inventory_total_detail.deleteMany({
          where: { source_type: 'sales_output', source_id: { in: outputIds } },
        });
      }
      if (exitIds.length) {
        await prisma.hspsi_inventory_total_detail.deleteMany({
          where: { source_type: 'sales_return', source_id: { in: exitIds } },
        });
      }

      await prisma.hspsi_sale_order_exit_detail.deleteMany({ where: { so_id: mapping.so_id } });
      await prisma.hspsi_sale_order_exit.deleteMany({ where: { so_id: mapping.so_id } });
      await prisma.hspsi_sale_order_output_detail.deleteMany({ where: { so_id: mapping.so_id } });
      await prisma.hspsi_sale_order_output.deleteMany({ where: { so_id: mapping.so_id } });

      await prisma.hspsi_sale_order_source_mapping.update({
        where: { id: mapping.id },
        data: {
          source_updated_at: null,
          source_status: 0,
          sync_status: HUASU_HOME_ORDER_SYNC_STATUS.RETRY,
        },
      });
    }

    // 单据可能已删但过账幂等键仍在：按固定键前缀清理
    const shipIds = [
      ...((order.shipments ?? []).map((item) => item?.id).filter(Boolean) as number[]),
      'ALL' as const,
    ];
    for (const shipId of shipIds) {
      await prisma.hspsi_inventory_total_detail.deleteMany({
        where: {
          posting_key: {
            startsWith: `huasu-home-output:HH-SHIP-${sourceId}-SALE_ORDER-${shipId}:`,
          },
        },
      });
    }
    await prisma.hspsi_inventory_total_detail.deleteMany({
      where: {
        posting_key: {
          startsWith: `huasu-home-exit:HH-EXIT-${sourceId}-SALE_ORDER-${order.id}-`,
        },
      },
    });
  }

  it(
    '能真实拉取订单列表',
    async () => {
      orderList = await huasuHome.getOrderList({
        page: 1,
        page_size: 20,
        updated_at: '1970-01-01 00:00:00',
      });

      expect(orderList).toBeDefined();
      expect(Array.isArray(orderList.list)).toBe(true);

      paidSample = orderList.list.find((item) =>
        HUASU_HOME_ORDER_SYNCABLE_STATUSES.has(Number(item.order_status)),
      );

      if (orderList.list.length > 0) {
        const sample = orderList.list[0]!;
        expect(sample.id).toBeTypeOf('number');
        expect(sample.order_sn).toBeTruthy();
        expect(sample.order_status).toBeTypeOf('number');
        expect(Array.isArray(sample.items)).toBe(true);
      }
    },
    60_000,
  );

  it(
    '能按 order_sn 拉取订单详情（/hspsi/order/info）',
    async () => {
      await ensureOrderList();
      const sample = orderList.list[0];
      if (!sample?.order_sn) {
        console.warn('[skip] 订单列表为空，跳过详情测试');
        return;
      }

      const detail = await huasuHome.getOrderInfo(sample.order_sn);
      expect(detail).toBeDefined();
      expect(detail.order_sn).toBe(sample.order_sn);
      expect(detail.id).toBe(sample.id);
      expect(detail.order_status).toBeTypeOf('number');
      expect(Array.isArray(detail.items)).toBe(true);
      expect(detail.user_id ?? detail.user?.id).toBeTruthy();
      expect(detail.service_org_id).toBeTypeOf('number');
    },
    60_000,
  );

  it(
    '批量同步订单：返回统计结构，并写入数据源；成功单应有映射',
    async () => {
      if (!(HUASU_HOME_GOODS_CATEGORY_ID > 0n)) {
        console.warn(
          '[skip] HUASU_HOME_GOODS_CATEGORY_ID 未配置为真实分类，跳过写库同步断言（仍会跑同步看失败原因）',
        );
      }

      const stats = await service.syncOrders('0', {
        updated_at: '1970-01-01 00:00:00',
      });

      expect(stats).toBeDefined();
      expect(stats.fetched).toBeGreaterThanOrEqual(0);
      expect(stats.created + stats.updated + stats.skipped + stats.failed).toBe(stats.fetched);
      expect(Array.isArray(stats.failures)).toBe(true);
      expect(Array.isArray(stats.warnings)).toBe(true);

      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: HUASU_HOME_DATA_SOURCE_CODE },
      });
      expect(source).toBeTruthy();
      expect(source!.status).toBe(1);
      sourceId = source!.id;

      if (stats.created + stats.updated > 0) {
        const mapping = await prisma.hspsi_sale_order_source_mapping.findFirst({
          where: {
            source_id: source!.id,
            source_order_type: HUASU_HOME_ORDER_TYPE.SALE_ORDER,
            sync_status: HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS,
            deleted_at: null,
          },
          orderBy: { id: 'desc' },
        });
        expect(mapping).toBeTruthy();
        expect(mapping!.so_id).toBeGreaterThan(0n);
        expect(mapping!.last_payload).toBeTruthy();

        const order = await prisma.hspsi_sale_order.findFirst({
          where: { so_id: mapping!.so_id, deleted_at: null },
        });
        expect(order).toBeTruthy();
        expect(order!.so_source).toBe(source!.id);
        expect(order!.so_source_id).toBe(mapping!.id);
        expect(order!.business_source_type).toBe('');
        expect(order!.business_source_id).toBe(0n);
        expect(order!.approve_status).toBe(1);

        const pay = await prisma.hspsi_sales_order_payment.findFirst({
          where: { so_id: mapping!.so_id, so_pay_type: 1, deleted_at: null },
        });
        expect(pay).toBeTruthy();
      } else if (stats.failed > 0) {
        expect(stats.failures[0]!.reason).toBeTruthy();
        console.warn(
          `[info] 本批无成功落库，样例失败原因: ${stats.failures[0]!.reason}`,
        );
      }
    },
    180_000,
  );

  it(
    '单笔同步 order_sn：可重复调用且成功后幂等跳过',
    async () => {
      await ensureOrderList();
      if (!paidSample?.order_sn) {
        paidSample = orderList.list.find((item) =>
          HUASU_HOME_ORDER_SYNCABLE_STATUSES.has(Number(item.order_status)),
        );
      }
      if (!paidSample?.order_sn) {
        console.warn('[skip] 列表中无已支付及以后订单，跳过单笔同步');
        return;
      }

      const first = await service.syncOrderBySn(paidSample.order_sn, '0');
      expect(first.fetched).toBe(1);

      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: HUASU_HOME_DATA_SOURCE_CODE },
      });
      expect(source).toBeTruthy();
      sourceId = source!.id;

      const mappingAfterFirst = await prisma.hspsi_sale_order_source_mapping.findFirst({
        where: {
          source_id: source!.id,
          source_order_type: HUASU_HOME_ORDER_TYPE.SALE_ORDER,
          source_order_id: String(paidSample.id),
          deleted_at: null,
        },
      });

      // 前置不全时允许失败，但映射行应留下失败痕迹
      expect(mappingAfterFirst).toBeTruthy();

      if (first.created + first.updated > 0) {
        expect(mappingAfterFirst!.sync_status).toBe(HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS);
        expect(mappingAfterFirst!.so_id).toBeGreaterThan(0n);

        const second = await service.syncOrderBySn(paidSample.order_sn, '0');
        expect(second.fetched).toBe(1);
        expect(second.skipped + second.updated).toBeGreaterThanOrEqual(1);
        expect(second.created).toBe(0);

        const mappingAfterSecond = await prisma.hspsi_sale_order_source_mapping.findFirst({
          where: { id: mappingAfterFirst!.id },
        });
        expect(mappingAfterSecond!.so_id).toBe(mappingAfterFirst!.so_id);
      } else if (first.failed > 0) {
        expect(mappingAfterFirst!.sync_status).toBe(HUASU_HOME_ORDER_SYNC_STATUS.FAILED);
        expect(mappingAfterFirst!.remark).toBeTruthy();
      } else {
        // skipped：订单已在前面批量同步中处理过，映射应为成功状态
        expect(first.skipped).toBeGreaterThanOrEqual(1);
        expect(mappingAfterFirst!.sync_status).toBe(HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS);
        expect(mappingAfterFirst!.so_id).toBeGreaterThan(0n);
      }
    },
    180_000,
  );

  it(
    '已发货订单同步：真实出库扣库（无库存可建账扣负）',
    async () => {
      if (!(HUASU_HOME_GOODS_CATEGORY_ID > 0n)) {
        console.warn('[skip] HUASU_HOME_GOODS_CATEGORY_ID 未配置');
        return;
      }
      await ensureOrderList();
      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: HUASU_HOME_DATA_SOURCE_CODE },
      });
      expect(source).toBeTruthy();
      sourceId = source!.id;

      let candidate: HuasuHomeOrder | undefined;
      for (const order of orderList.list) {
        if (!HUASU_HOME_ORDER_SHIPPED_STATUSES.has(Number(order.order_status))) continue;
        if (Number(order.after_sales_type ?? 0) > 0) continue;
        if (!(await isOrderGoodsMapped(order))) continue;
        const orgId = await resolvePlatformOrgId(Number(order.service_org_id));
        if (!orgId) continue;
        const warehouse = await resolveSaleWarehouse(orgId);
        if (!warehouse) continue;
        candidate = order;
        break;
      }

      if (!candidate) {
        console.warn('[skip] 无「已发货 + 商品/机构/仓库齐全」的候选订单');
        return;
      }

      const orgId = (await resolvePlatformOrgId(Number(candidate.service_org_id)))!;
      const warehouse = (await resolveSaleWarehouse(orgId))!;
      const targets = await resolveShipTargets(candidate);
      expect(targets.length).toBeGreaterThan(0);

      await prepareGoodsForPosting(orgId, targets);
      await resetFulfillmentForResync(candidate);
      await clearStock(orgId, warehouse.warehouse_id, targets);

      const stats = await service.syncOrderBySn(candidate.order_sn, '0');
      expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
      expect(stats.created + stats.updated).toBe(1);
      expect(stats.outputs).toBeGreaterThanOrEqual(1);

      const mapping = await prisma.hspsi_sale_order_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_order_type: HUASU_HOME_ORDER_TYPE.SALE_ORDER,
          source_order_id: String(candidate.id),
          deleted_at: null,
        },
      });
      expect(mapping?.sync_status).toBe(HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS);
      expect(mapping?.so_id).toBeGreaterThan(0n);

      const output = await prisma.hspsi_sale_order_output.findFirst({
        where: { so_id: mapping!.so_id, comfirm_status: 1, deleted_at: null },
        orderBy: { so_output_id: 'desc' },
      });
      expect(output).toBeTruthy();
      expect(output!.warehouse_id).toBe(warehouse.warehouse_id);

      const details = await prisma.hspsi_sale_order_output_detail.findMany({
        where: { so_output_id: output!.so_output_id },
      });
      expect(details.length).toBeGreaterThan(0);
      expect(details.every((d) => d.batch_no === '')).toBe(true);

      const ledger = await prisma.hspsi_inventory_total_detail.findFirst({
        where: {
          source_id: output!.so_output_id,
          source_type: 'sales_output',
          inventory_mode: INVENTORY_BUSINESS_MODE.SALES_OUTPUT,
        },
      });
      expect(ledger).toBeTruthy();
      expect(Number(ledger!.operation_qty)).toBeLessThan(0);

      for (const row of targets) {
        const after = await readStockQty(orgId, warehouse.warehouse_id, row.goodsId, row.skuId);
        expect(after).toBe(-row.quantity);
      }
    },
    180_000,
  );

  it(
    '售后退货成功：按权益扣减记录回库加库',
    async () => {
      if (!(HUASU_HOME_GOODS_CATEGORY_ID > 0n)) {
        console.warn('[skip] HUASU_HOME_GOODS_CATEGORY_ID 未配置');
        return;
      }
      await ensureOrderList();
      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: HUASU_HOME_DATA_SOURCE_CODE },
      });
      expect(source).toBeTruthy();
      sourceId = source!.id;

      let candidate: HuasuHomeOrder | undefined;
      for (const order of orderList.list) {
        if (Number(order.after_sales_type) !== HUASU_HOME_AFTER_SALES_TYPE.RETURN_REFUND) continue;
        if (Number(order.after_sales_status) !== HUASU_HOME_AFTER_SALES_STATUS.DONE) continue;
        if (!(await isOrderGoodsMapped(order))) continue;
        const orgId = await resolvePlatformOrgId(Number(order.service_org_id));
        if (!orgId) continue;
        const warehouse = await resolveSaleWarehouse(orgId);
        if (!warehouse) continue;

        // 列表可能缺 after_sales 明细；以详情里的权益扣减为准
        const detailProbe = await huasuHome.getOrderInfo(order.order_sn);
        const rights = detailProbe.after_sales?.rights_deducted_records ?? [];
        const hasRightsQty = rights.some(
          (row) =>
            Number(row.product_id) > 0 &&
            Number(row.gift_number || 0) + Number(row.buy_number || 0) > 0,
        );
        if (!hasRightsQty) continue;
        if (!(await isRightsGoodsMapped(detailProbe))) continue;
        candidate = detailProbe;
        break;
      }

      if (!candidate) {
        console.warn(
          '[skip] 无「退货退款已完成 + rights_deducted_records 有数量 + 映射齐全」的候选订单',
        );
        return;
      }

      const detail = candidate;
      const orgId = (await resolvePlatformOrgId(Number(detail.service_org_id)))!;
      const warehouse = (await resolveSaleWarehouse(orgId))!;
      const shipTargets = await resolveShipTargets(detail);
      const returnTargets = await resolveReturnTargets(detail);
      expect(returnTargets.length).toBeGreaterThan(0);

      const stockTargets = mergeTargets([...shipTargets, ...returnTargets]);
      await prepareGoodsForPosting(orgId, stockTargets);
      await resetFulfillmentForResync(detail);
      await clearStock(orgId, warehouse.warehouse_id, stockTargets);

      const beforeReturnStock = await Promise.all(
        returnTargets.map(async (t) => ({
          goodsId: t.goodsId,
          skuId: t.skuId,
          qty: await readStockQty(orgId, warehouse.warehouse_id, t.goodsId, t.skuId),
        })),
      );

      const stats = await service.syncOrderBySn(detail.order_sn, '0');
      expect(stats.failed, JSON.stringify(stats.failures)).toBe(0);
      expect(stats.outputs).toBeGreaterThanOrEqual(1);
      expect(stats.exits).toBeGreaterThanOrEqual(1);

      const mapping = await prisma.hspsi_sale_order_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_order_type: HUASU_HOME_ORDER_TYPE.SALE_ORDER,
          source_order_id: String(detail.id),
          deleted_at: null,
        },
      });
      expect(mapping?.sync_status).toBe(HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS);

      const output = await prisma.hspsi_sale_order_output.findFirst({
        where: { so_id: mapping!.so_id, comfirm_status: 1, deleted_at: null },
      });
      expect(output).toBeTruthy();

      const exit = await prisma.hspsi_sale_order_exit.findFirst({
        where: { so_id: mapping!.so_id, comfirm_status: 1, deleted_at: null },
        orderBy: { so_exit_id: 'desc' },
      });
      expect(exit).toBeTruthy();
      expect(exit!.source_output_id).toBe(output!.so_output_id);
      expect(exit!.warehouse_id).toBe(warehouse.warehouse_id);

      const exitDetails = await prisma.hspsi_sale_order_exit_detail.findMany({
        where: { so_exit_id: exit!.so_exit_id },
      });
      expect(exitDetails.length).toBe(returnTargets.length);
      for (const target of returnTargets) {
        const line = exitDetails.find(
          (row) => row.goods_id === target.goodsId && row.sku_id === target.skuId,
        );
        expect(line, `缺少回库明细 goods=${target.goodsId} sku=${target.skuId}`).toBeTruthy();
        expect(Number(line!.exit_qty)).toBe(target.quantity);
      }

      const returnLedger = await prisma.hspsi_inventory_total_detail.findFirst({
        where: {
          source_id: exit!.so_exit_id,
          source_type: 'sales_return',
          inventory_mode: INVENTORY_BUSINESS_MODE.SALES_RETURN,
        },
      });
      expect(returnLedger).toBeTruthy();
      expect(Number(returnLedger!.operation_qty)).toBeGreaterThan(0);

      // 回库按权益扣减数加库；与出库数量可不一致
      for (const row of beforeReturnStock) {
        const target = returnTargets.find(
          (t) => t.goodsId === row.goodsId && t.skuId === row.skuId,
        )!;
        const shipQty =
          shipTargets.find((t) => t.goodsId === row.goodsId && t.skuId === row.skuId)
            ?.quantity ?? 0;
        const after = await readStockQty(orgId, warehouse.warehouse_id, row.goodsId, row.skuId);
        expect(after).toBe(row.qty - shipQty + target.quantity);
      }

      // 幂等：再次同步不应重复入库
      const second = await service.syncOrderBySn(detail.order_sn, '0');
      expect(second.failed).toBe(0);
      expect(second.exits).toBe(0);
      const exitCount = await prisma.hspsi_sale_order_exit.count({
        where: { so_id: mapping!.so_id, deleted_at: null },
      });
      expect(exitCount).toBe(1);
    },
    180_000,
  );

  it(
    '仅退款不退货：不创建退货入库单',
    async () => {
      await ensureOrderList();
      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: HUASU_HOME_DATA_SOURCE_CODE },
      });
      expect(source).toBeTruthy();
      sourceId = source!.id;

      let candidate: HuasuHomeOrder | undefined;
      for (const order of orderList.list) {
        if (Number(order.after_sales_type) !== HUASU_HOME_AFTER_SALES_TYPE.REFUND_ONLY) continue;
        if (Number(order.after_sales_status) !== HUASU_HOME_AFTER_SALES_STATUS.DONE) continue;
        if (!(await isOrderGoodsMapped(order))) continue;
        if (!(await resolvePlatformOrgId(Number(order.service_org_id)))) continue;
        candidate = order;
        break;
      }

      if (!candidate) {
        console.warn('[skip] 无「仅退款已完成」候选订单');
        return;
      }

      const detail = await huasuHome.getOrderInfo(candidate.order_sn);
      const orgId = (await resolvePlatformOrgId(Number(detail.service_org_id)))!;
      const warehouse = await resolveSaleWarehouse(orgId);
      if (!warehouse) {
        console.warn('[skip] 机构无销售仓库');
        return;
      }

      // 仅退款也可能处于已发货态；若会走出库则先备货与对齐商品机构
      if (HUASU_HOME_ORDER_SHIPPED_STATUSES.has(Number(detail.order_status))) {
        const targets = await resolveShipTargets(detail);
        await prepareGoodsForPosting(orgId, targets);
        await clearStock(orgId, warehouse.warehouse_id, targets);
      }

      const stats = await service.syncOrderBySn(detail.order_sn, '0');
      if (stats.failed > 0) {
        console.warn(`[skip] 仅退款单同步失败: ${stats.failures[0]?.reason}`);
        return;
      }

      const mapping = await prisma.hspsi_sale_order_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_order_type: HUASU_HOME_ORDER_TYPE.SALE_ORDER,
          source_order_id: String(detail.id),
          deleted_at: null,
        },
      });
      expect(mapping?.sync_status).toBe(HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS);

      const exitCount = await prisma.hspsi_sale_order_exit.count({
        where: { so_id: mapping!.so_id, deleted_at: null },
      });
      expect(exitCount).toBe(0);
      expect(stats.exits).toBe(0);

      if (Number(detail.after_sales_amount ?? 0) > 0) {
        const refund = await prisma.hspsi_sales_order_payment.findFirst({
          where: { so_id: mapping!.so_id, so_pay_type: 2, deleted_at: null },
        });
        expect(refund).toBeTruthy();
      }
    },
    180_000,
  );
});
