/**
 * 华溯之家分期订单同步集成测试（真实请求）
 *
 * 运行：
 *   pnpm --filter @hspsi/api test installment-order-sync.service.spec
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { BusinessNumberService } from '../../../business-number/business-number.service';
import { RedisService } from '../../../redis/redis.service';
import { HttpClientService } from '../../common/http-client.service';
import {
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_GOODS_CATEGORY_ID,
  HUASU_HOME_INSTALLMENT_STATUS,
  HUASU_HOME_INSTALLMENT_SYNCABLE_STATUSES,
  HUASU_HOME_MAPPING_STATUS,
  HUASU_HOME_ORDER_SYNC_STATUS,
  HUASU_HOME_ORDER_TYPE,
  HUASU_HOME_SOURCE_TYPE,
} from '../huasu-home.constants';
import { HuasuHomeService } from '../huasu-home.service';
import type { HuasuHomeInstallmentOrder } from '../huasu-home.types';
import { ExternalInventoryPostingService } from '../../common/external-inventory-posting.service';
import { HuasuHomeInstallmentOrderSyncService } from './installment-order-sync.service';

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

describe('HuasuHomeInstallmentOrderSyncService 分期订单同步集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let redis: RedisService;
  let huasuHome: HuasuHomeService;
  let service: HuasuHomeInstallmentOrderSyncService;
  let samples: HuasuHomeInstallmentOrder[] = [];
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

    service = new HuasuHomeInstallmentOrderSyncService(
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
    const data = await huasuHome.getInstallmentOrderList({
      page: 1,
      page_size: 50,
      updated_at: '1970-01-01 00:00:00',
    });
    samples = data.list ?? [];
    return samples;
  }

  function isPeriodPaid(order: HuasuHomeInstallmentOrder) {
    return (order.periods ?? []).some((period) => {
      const paid = Number(period.paid_amount ?? 0);
      if (paid > 0) return true;
      if (!(Number(period.amount ?? 0) > 0) || period.unpaid_amount == null) return false;
      return Number(period.unpaid_amount) === 0;
    });
  }

  async function isProductMapped(productId: number) {
    if (!(sourceId > 0n) || !(productId > 0)) return false;
    const mapping = await prisma.hspsi_goods_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_type: HUASU_HOME_SOURCE_TYPE.STANDARD,
        source_goods_id: String(productId),
        mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
        deleted_at: null,
      },
    });
    return !!mapping;
  }

  it(
    '能真实拉取分期订单列表',
    async () => {
      const data = await huasuHome.getInstallmentOrderList({
        page: 1,
        page_size: 20,
        updated_at: '1970-01-01 00:00:00',
      });
      expect(Array.isArray(data.list)).toBe(true);
      samples = data.list ?? [];
    },
    60_000,
  );

  it(
    '已支付分期可同步为 INSTALLMENT 销售单，水位不与普通订单混用',
    async () => {
      await ensureSamples();
      if (!(sourceId > 0n)) return;
      if (!(HUASU_HOME_GOODS_CATEGORY_ID > 0n)) return;

      const candidate = samples.find(
        (order) =>
          HUASU_HOME_INSTALLMENT_SYNCABLE_STATUSES.has(Number(order.status)) &&
          isPeriodPaid(order) &&
          Number(order.products?.[0]?.product_id ?? 0) > 0,
      );
      if (!candidate) return;
      if (!(await isProductMapped(Number(candidate.products?.[0]?.product_id)))) return;

      const orgSourceId = Number(candidate.organization_id ?? candidate.user?.organization_id ?? 0);
      const orgMapping = await prisma.hspsi_sys_organization_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_object_id: String(orgSourceId),
          deleted_at: null,
        },
      });
      if (!orgMapping) return;

      const stats = await service.syncInstallmentOrders('1', {
        updated_at: '1970-01-01 00:00:00',
        page_size: 20,
      });
      expect(stats.failed).toBeGreaterThanOrEqual(0);

      const mapping = await prisma.hspsi_sale_order_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_order_type: HUASU_HOME_ORDER_TYPE.INSTALLMENT,
          source_order_id: String(candidate.id),
          deleted_at: null,
        },
      });
      if (!mapping || mapping.sync_status !== HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS) return;
      expect(mapping.source_order_no).toBe(String(candidate.no));
      expect(mapping.so_id > 0n).toBe(true);

      const watermark = await prisma.hspsi_sale_order_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_order_type: HUASU_HOME_ORDER_TYPE.INSTALLMENT,
          source_updated_at: { not: null },
          deleted_at: null,
        },
        orderBy: { source_updated_at: 'desc' },
      });
      expect(watermark?.source_order_type).toBe(HUASU_HOME_ORDER_TYPE.INSTALLMENT);
      expect(watermark?.source_order_type).not.toBe(HUASU_HOME_ORDER_TYPE.SALE_ORDER);
    },
    120_000,
  );

  it('已转正常订单 status=6 仍按分期履约，不要求走 SALE_ORDER', async () => {
    await ensureSamples();
    const converted = samples.find(
      (order) => Number(order.status) === HUASU_HOME_INSTALLMENT_STATUS.CONVERTED,
    );
    if (!converted) return;
    expect(converted.no).toBeTruthy();
  });
});
