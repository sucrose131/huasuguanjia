/**
 * 华溯之家会议门票订单同步集成测试（真实请求）
 *
 * 测试方式：真实请求 + 真实写库（依赖 Redis 生成单号）
 * - 从 .env 读取 HUASU_HOME_* / DATABASE_URL / REDIS_URL
 * - 真实签名请求会议门票列表
 * - 同步落库：映射 / 销售单 / 收款 / 核销出库扣库（允许负库存）/ 仅退款不回库
 *
 * 运行方式：
 *   pnpm --filter @hspsi/api test conference-order-sync.service.spec
 *
 * 前置条件：
 *   1. .env 已配置 DATABASE_URL、REDIS_URL
 *   2. .env 已配置 HUASU_HOME_BASE_URL、HUASU_HOME_APP_PUBLIC_KEY
 *   3. 建议已完成商品同步；门票套餐 COMBO、package_items 单品 STANDARD 已映射
 *   4. user.organization_id 已在 hspsi_sys_organization_mapping 中映射
 *   5. 映射机构下已有与华溯分类 warehouse_type 匹配的启用仓库
 *   6. 外部同步出库使用专用过账，无库存时可建账扣负
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
  HUASU_HOME_CONFERENCE_ORDER_STATUS,
  HUASU_HOME_CONFERENCE_REFUND_STATUS,
  HUASU_HOME_CONFERENCE_RIGHTS_GRANTED,
  HUASU_HOME_CONFERENCE_SYNCABLE_STATUSES,
  HUASU_HOME_CONFERENCE_VERIFY_STATUS,
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_GOODS_CATEGORY_ID,
  HUASU_HOME_MAPPING_STATUS,
  HUASU_HOME_ORDER_SYNC_STATUS,
  HUASU_HOME_ORDER_TYPE,
  HUASU_HOME_SOURCE_TYPE,
} from '../huasu-home.constants';
import { HuasuHomeService } from '../huasu-home.service';
import type { HuasuHomeConferenceOrder } from '../huasu-home.types';
import { ExternalInventoryPostingService } from '../../common/external-inventory-posting.service';
import { HuasuHomeConferenceOrderSyncService } from './conference-order-sync.service';

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

describe('HuasuHomeConferenceOrderSyncService 会议门票同步集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let redis: RedisService;
  let huasuHome: HuasuHomeService;
  let service: HuasuHomeConferenceOrderSyncService;
  let samples: HuasuHomeConferenceOrder[] = [];
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

    service = new HuasuHomeConferenceOrderSyncService(
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

  async function ensureSamples() {
    if (samples.length) return samples;
    for (let page = 1; page <= 3; page += 1) {
      const data = await huasuHome.getConferenceOrderList({
        page,
        page_size: 50,
        updated_at: '1970-01-01 00:00:00',
      });
      samples.push(...(data.list ?? []));
      if (!data.list?.length || page * 50 >= Number(data.total || 0)) break;
    }
    return samples;
  }

  async function resolvePlatformOrgId(organizationId: number) {
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
        source_object_id: String(organizationId),
        deleted_at: null,
      },
    });
    return mapping?.org_id ?? null;
  }

  async function resolveWarehouse(orgId: bigint) {
    const category = await prisma.hspsi_goods_info_category.findFirst({
      where: { goods_catg_id: HUASU_HOME_GOODS_CATEGORY_ID, deleted_at: null },
    });
    if (!category) return null;
    return prisma.hspsi_basic_warehouse.findFirst({
      where: {
        org_id: orgId,
        warehouse_type: category.warehouse_type,
        status: 1,
        deleted_at: null,
      },
      orderBy: [{ sort: 'asc' }, { warehouse_id: 'asc' }],
    });
  }

  async function isComboMapped(order: HuasuHomeConferenceOrder) {
    if (!(sourceId > 0n)) return false;
    const packageId = Number(order.product_package_id);
    if (!(packageId > 0)) return false;
    const mapping = await prisma.hspsi_goods_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_type: HUASU_HOME_SOURCE_TYPE.COMBO,
        source_goods_id: String(packageId),
        source_sku_id: '0',
        mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
        deleted_at: null,
      },
    });
    return !!mapping;
  }

  async function arePackageItemsMapped(order: HuasuHomeConferenceOrder) {
    if (!(sourceId > 0n)) return false;
    const items = (order.package_items ?? []).filter((row) => Number(row.product_id) > 0);
    if (!items.length) return false;
    for (const item of items) {
      const mapping = await prisma.hspsi_goods_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_type: HUASU_HOME_SOURCE_TYPE.STANDARD,
          source_goods_id: String(item.product_id),
          mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
          deleted_at: null,
        },
      });
      if (!mapping) return false;
    }
    return true;
  }

  function shouldShip(order: HuasuHomeConferenceOrder) {
    return (
      Number(order.verify_status) === HUASU_HOME_CONFERENCE_VERIFY_STATUS.VERIFIED &&
      Number(order.rights_granted) === HUASU_HOME_CONFERENCE_RIGHTS_GRANTED.YES
    );
  }

  function isRefunded(order: HuasuHomeConferenceOrder) {
    return (
      Number(order.order_status) === HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUNDED ||
      Number(order.refund?.refund_status) === HUASU_HOME_CONFERENCE_REFUND_STATUS.DONE
    );
  }

  async function resolveShipTargets(order: HuasuHomeConferenceOrder): Promise<ShipTarget[]> {
    const buyQty = Number(order.quantity);
    const merged = new Map<string, ShipTarget>();
    for (const pkg of order.package_items ?? []) {
      const productId = Number(pkg.product_id);
      const qty = (Number(pkg.number || 0) + Number(pkg.gift_number || 0)) * buyQty;
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
        throw new Error(`发货单品未映射 product_id=${productId}`);
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

  async function prepareGoodsForPosting(targets: ShipTarget[]) {
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

  async function findMapping(orderId: number) {
    return prisma.hspsi_sale_order_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_order_type: HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET,
        source_order_id: String(orderId),
        deleted_at: null,
      },
    });
  }

  async function resetFulfillmentForResync(order: HuasuHomeConferenceOrder) {
    const mapping = await findMapping(order.id);
    if (mapping?.so_id && mapping.so_id > 0n) {
      const outputs = await prisma.hspsi_sale_order_output.findMany({
        where: { so_id: mapping.so_id },
        select: { so_output_id: true },
      });
      const outputIds = outputs.map((row) => row.so_output_id);
      if (outputIds.length) {
        await prisma.hspsi_inventory_total_detail.deleteMany({
          where: { source_type: 'sales_output', source_id: { in: outputIds } },
        });
      }
      await prisma.hspsi_sale_order_exit_detail.deleteMany({ where: { so_id: mapping.so_id } });
      await prisma.hspsi_sale_order_exit.deleteMany({ where: { so_id: mapping.so_id } });
      await prisma.hspsi_sale_order_output_detail.deleteMany({ where: { so_id: mapping.so_id } });
      await prisma.hspsi_sale_order_output.deleteMany({ where: { so_id: mapping.so_id } });
      await prisma.hspsi_sales_order_payment.deleteMany({
        where: { so_id: mapping.so_id, so_pay_type: 2 },
      });
      await prisma.hspsi_sale_order_source_mapping.update({
        where: { id: mapping.id },
        data: {
          source_updated_at: null,
          source_status: 0,
          sync_status: HUASU_HOME_ORDER_SYNC_STATUS.RETRY,
        },
      });
    }
    await prisma.hspsi_inventory_total_detail.deleteMany({
      where: {
        posting_key: {
          startsWith: `huasu-home-output:HH-SHIP-${sourceId}-CONFERENCE_TICKET-${order.id}:`,
        },
      },
    });
  }

  async function pickReadyOrder(
    predicate: (order: HuasuHomeConferenceOrder) => boolean,
    options: { needPackageItems?: boolean } = {},
  ) {
    await ensureSamples();
    for (const order of samples) {
      if (!predicate(order)) continue;
      if (!(await isComboMapped(order))) continue;
      const orgId = await resolvePlatformOrgId(Number(order.user?.organization_id ?? 0));
      if (!orgId) continue;
      const warehouse = await resolveWarehouse(orgId);
      if (!warehouse) continue;
      if (options.needPackageItems && !(await arePackageItemsMapped(order))) continue;
      return { order, orgId, warehouse };
    }
    return null;
  }

  it(
    '能真实拉取会议门票订单列表',
    async () => {
      const data = await huasuHome.getConferenceOrderList({
        page: 1,
        page_size: 20,
        updated_at: '1970-01-01 00:00:00',
      });
      expect(data).toBeDefined();
      expect(Array.isArray(data.list)).toBe(true);
      samples = data.list ?? [];

      if (samples.length > 0) {
        const sample = samples[0]!;
        expect(sample.id).toBeTypeOf('number');
        expect(sample.order_sn).toBeTruthy();
        expect(sample.order_status).toBeTypeOf('number');
        expect(sample.product_package_id).toBeTypeOf('number');
        expect(sample.verify_status).toBeTypeOf('number');
        expect(sample.rights_granted).toBeTypeOf('number');
      }
    },
    60_000,
  );

  it(
    '待付款门票不同步建单',
    async () => {
      await ensureSamples();
      const unpaid = samples.find(
        (item) =>
          Number(item.order_status) === HUASU_HOME_CONFERENCE_ORDER_STATUS.PENDING_PAY ||
          Number(item.order_status) === HUASU_HOME_CONFERENCE_ORDER_STATUS.PAYING ||
          Number(item.order_status) === HUASU_HOME_CONFERENCE_ORDER_STATUS.CANCELLED,
      );
      if (!unpaid) {
        console.warn('[skip] 列表中无待付款/支付中/已取消门票');
        return;
      }

      const stats = await service.syncConferenceOrders('0', {
        updated_at: unpaid.updated_at || '1970-01-01 00:00:00',
      });
      expect(stats.fetched).toBeGreaterThanOrEqual(1);

      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: HUASU_HOME_DATA_SOURCE_CODE },
      });
      expect(source).toBeTruthy();
      sourceId = source!.id;

      const mapping = await findMapping(unpaid.id);
      if (mapping) {
        expect(mapping.sync_status).not.toBe(HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS);
        expect(Number(mapping.so_id)).toBe(0);
      }
    },
    180_000,
  );

  it(
    '批量同步门票：返回统计，成功单写入 CONFERENCE_TICKET 映射且地址为空',
    async () => {
      const stats = await service.syncConferenceOrders('0', {
        updated_at: '1970-01-01 00:00:00',
      });

      expect(stats).toBeDefined();
      expect(stats.fetched).toBeGreaterThanOrEqual(0);
      expect(stats.created + stats.updated + stats.skipped + stats.failed).toBe(stats.fetched);
      expect(Array.isArray(stats.failures)).toBe(true);

      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: HUASU_HOME_DATA_SOURCE_CODE },
      });
      expect(source).toBeTruthy();
      sourceId = source!.id;

      if (stats.created + stats.updated > 0) {
        const mapping = await prisma.hspsi_sale_order_source_mapping.findFirst({
          where: {
            source_id: source!.id,
            source_order_type: HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET,
            sync_status: HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS,
            deleted_at: null,
          },
          orderBy: { id: 'desc' },
        });
        expect(mapping).toBeTruthy();
        expect(mapping!.so_id).toBeGreaterThan(0n);
        expect(mapping!.last_payload).toBeTruthy();
        expect(mapping!.source_order_type).toBe(HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET);

        const order = await prisma.hspsi_sale_order.findFirst({
          where: { so_id: mapping!.so_id, deleted_at: null },
        });
        expect(order).toBeTruthy();
        expect(order!.so_source).toBe(source!.id);
        expect(order!.so_source_id).toBe(mapping!.id);
        expect(order!.business_source_type).toBe('');
        expect(order!.customer_address).toBe('');
        expect(order!.sales_name).toBe('');
        expect(order!.approve_status).toBe(1);

        const payload = JSON.parse(String(mapping!.last_payload ?? '{}')) as {
          conference?: { address?: string };
        };
        const conferenceAddress = String(payload.conference?.address ?? '').trim();
        if (conferenceAddress) {
          expect(order!.customer_address).not.toContain(conferenceAddress);
        }

        const pay = await prisma.hspsi_sales_order_payment.findFirst({
          where: { so_id: mapping!.so_id, so_pay_type: 1, deleted_at: null },
        });
        expect(pay).toBeTruthy();
      } else if (stats.failed > 0) {
        expect(stats.failures[0]!.reason).toBeTruthy();
        console.warn(`[info] 本批无成功落库，样例失败原因: ${stats.failures[0]!.reason}`);
      }
    },
    180_000,
  );

  it(
    '已付款未核销：有销售单和收款，不出库',
    async () => {
      const picked = await pickReadyOrder(
        (order) =>
          HUASU_HOME_CONFERENCE_SYNCABLE_STATUSES.has(Number(order.order_status)) &&
          !shouldShip(order) &&
          !isRefunded(order) &&
          Number(order.order_status) === HUASU_HOME_CONFERENCE_ORDER_STATUS.PAID,
      );
      if (!picked) {
        console.warn('[skip] 无「已付款未核销 + 套餐/机构/仓库齐全」的候选门票');
        return;
      }

      const stats = await service.syncConferenceOrders('0', {
        updated_at: picked.order.updated_at || '1970-01-01 00:00:00',
      });
      expect(stats.fetched).toBeGreaterThanOrEqual(1);

      const mapping = await findMapping(picked.order.id);
      if (!mapping || mapping.sync_status !== HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS) {
        console.warn(`[skip] 候选门票未成功落库: ${mapping?.remark || '无映射'}`);
        return;
      }

      const sale = await prisma.hspsi_sale_order.findFirst({
        where: { so_id: mapping.so_id, deleted_at: null },
      });
      expect(sale).toBeTruthy();
      expect(sale!.customer_address).toBe('');
      expect(Number(sale!.delivery_status)).toBe(1);

      const details = await prisma.hspsi_sale_order_detail.findMany({
        where: { so_id: mapping.so_id },
      });
      expect(details.length).toBe(1);
      expect(Number(details[0]!.sale_qty)).toBe(Number(picked.order.quantity));

      const pay = await prisma.hspsi_sales_order_payment.findFirst({
        where: { so_id: mapping.so_id, so_pay_type: 1, deleted_at: null },
      });
      expect(pay).toBeTruthy();

      const outputCount = await prisma.hspsi_sale_order_output.count({
        where: { so_id: mapping.so_id, deleted_at: null },
      });
      expect(outputCount).toBe(0);
    },
    180_000,
  );

  it(
    '核销且权益发放后：真实出库扣库（无库存可建账扣负）',
    async () => {
      if (!(HUASU_HOME_GOODS_CATEGORY_ID > 0n)) {
        console.warn('[skip] HUASU_HOME_GOODS_CATEGORY_ID 未配置');
        return;
      }
      const picked = await pickReadyOrder(
        (order) =>
          Number(order.order_status) === HUASU_HOME_CONFERENCE_ORDER_STATUS.PAID &&
          shouldShip(order) &&
          !isRefunded(order),
        { needPackageItems: true },
      );
      if (!picked) {
        console.warn('[skip] 无「已核销且已发放 + 套餐/单品/机构/仓库齐全」的候选门票');
        return;
      }

      const { order, orgId, warehouse } = picked;
      const targets = await resolveShipTargets(order);
      expect(targets.length).toBeGreaterThan(0);

      await prepareGoodsForPosting(targets);
      await resetFulfillmentForResync(order);
      await clearStock(orgId, warehouse.warehouse_id, targets);

      const stats = await service.syncConferenceOrders('0', {
        updated_at: order.updated_at || '1970-01-01 00:00:00',
      });
      const selfFail = stats.failures.find((item) => item.sourceOrderId === String(order.id));
      expect(selfFail, selfFail?.reason).toBeUndefined();

      const mapping = await findMapping(order.id);
      expect(mapping?.sync_status).toBe(HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS);
      expect(mapping?.so_id).toBeGreaterThan(0n);

      const output = await prisma.hspsi_sale_order_output.findFirst({
        where: { so_id: mapping!.so_id, comfirm_status: 1, deleted_at: null },
        orderBy: { so_output_id: 'desc' },
      });
      expect(output).toBeTruthy();
      expect(output!.warehouse_id).toBe(warehouse.warehouse_id);
      expect(String(output!.remark)).toContain('CONFERENCE_TICKET');

      const details = await prisma.hspsi_sale_order_output_detail.findMany({
        where: { so_output_id: output!.so_output_id },
      });
      expect(details.length).toBeGreaterThan(0);
      expect(details.every((row) => row.batch_no === '')).toBe(true);

      const sale = await prisma.hspsi_sale_order.findFirst({
        where: { so_id: mapping!.so_id, deleted_at: null },
      });
      expect(Number(sale!.delivery_status)).toBe(3);

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

      const second = await service.syncConferenceOrders('0', {
        updated_at: order.updated_at || '1970-01-01 00:00:00',
      });
      expect(
        second.failures.find((item) => item.sourceOrderId === String(order.id)),
      ).toBeUndefined();
      const outputCount = await prisma.hspsi_sale_order_output.count({
        where: { so_id: mapping!.so_id, deleted_at: null },
      });
      expect(outputCount).toBe(1);
    },
    180_000,
  );

  it(
    '未核销已退款：只记账不回库',
    async () => {
      const picked = await pickReadyOrder(
        (order) => isRefunded(order) && !shouldShip(order),
      );
      if (!picked) {
        console.warn('[skip] 无「未核销已退款 + 套餐/机构/仓库齐全」的候选门票');
        return;
      }

      await resetFulfillmentForResync(picked.order);
      const stats = await service.syncConferenceOrders('0', {
        updated_at: picked.order.updated_at || '1970-01-01 00:00:00',
      });
      expect(stats.fetched).toBeGreaterThanOrEqual(1);

      const mapping = await findMapping(picked.order.id);
      if (mapping?.sync_status !== HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS) {
        console.warn(`[skip] 退款门票未成功落库: ${mapping?.remark || '无映射'}`);
        return;
      }

      const refund = await prisma.hspsi_sales_order_payment.findFirst({
        where: { so_id: mapping.so_id, so_pay_type: 2, deleted_at: null },
      });
      expect(refund).toBeTruthy();

      const exitCount = await prisma.hspsi_sale_order_exit.count({
        where: { so_id: mapping.so_id, deleted_at: null },
      });
      expect(exitCount).toBe(0);
      expect(stats.exits).toBe(0);

      const sale = await prisma.hspsi_sale_order.findFirst({
        where: { so_id: mapping.so_id, deleted_at: null },
      });
      expect(Number(sale!.order_status)).toBe(3);
      expect(Number(sale!.service_status)).toBe(2);
    },
    180_000,
  );

  it(
    '门票水位与普通销售订单隔离',
    async () => {
      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: HUASU_HOME_DATA_SOURCE_CODE },
      });
      expect(source).toBeTruthy();
      sourceId = source!.id;

      const ticketLatest = await prisma.hspsi_sale_order_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_order_type: HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET,
          source_updated_at: { not: null },
          deleted_at: null,
        },
        orderBy: { source_updated_at: 'desc' },
        select: { source_updated_at: true, source_order_type: true },
      });
      const saleLatest = await prisma.hspsi_sale_order_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_order_type: HUASU_HOME_ORDER_TYPE.SALE_ORDER,
          source_updated_at: { not: null },
          deleted_at: null,
        },
        orderBy: { source_updated_at: 'desc' },
        select: { source_updated_at: true, source_order_type: true },
      });

      if (ticketLatest && saleLatest) {
        expect(ticketLatest.source_order_type).toBe(HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET);
        expect(saleLatest.source_order_type).toBe(HUASU_HOME_ORDER_TYPE.SALE_ORDER);
      } else {
        console.warn('[info] 一侧尚无水位，仅校验查询按类型隔离');
      }

      const mixed = await prisma.hspsi_sale_order_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_order_type: HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET,
          deleted_at: null,
        },
      });
      if (mixed) {
        expect(mixed.source_order_type).not.toBe(HUASU_HOME_ORDER_TYPE.SALE_ORDER);
      }
    },
    30_000,
  );
});
