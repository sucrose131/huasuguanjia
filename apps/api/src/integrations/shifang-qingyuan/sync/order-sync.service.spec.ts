/**
 * 十方清源订单同步集成测试（真实请求 + 真实写库）
 *
 * 运行：
 *   Windows: $env:RUN_EXTERNAL_INTEGRATION_TESTS='true'; pnpm --filter @hspsi/api test order-sync.service.spec
 *   Linux/macOS: RUN_EXTERNAL_INTEGRATION_TESTS=true pnpm --filter @hspsi/api test order-sync.service.spec
 *
 * 前置：
 *   1. apps/api/.env：DATABASE_URL、REDIS_URL、SHIFANG_QINGYUAN_*
 *   2. 已同步商品；SHIFANG_QINGYUAN_GOODS_CATEGORY_ID 为真实分类
 *   3. organization_mapping：source_id=data_source.id，source_object_id=String(mall_id)
 *   4. 映射机构下存在匹配 warehouse_type 的启用仓
 *
 * 约定：list 已含全量嵌套；订单/商品金额单位均为元
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { BusinessNumberService } from '../../../business-number/business-number.service';
import { RedisService } from '../../../redis/redis.service';
import { ExternalInventoryPostingService } from '../../common/external-inventory-posting.service';
import { HttpClientService } from '../../common/http-client.service';
import {
  SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
  SHIFANG_QINGYUAN_ORDER_SYNC_STATUS,
  SHIFANG_QINGYUAN_ORDER_TYPE,
  SHIFANG_QINGYUAN_PAY_STATUS,
} from '../shifang-qingyuan.constants';
import { ShifangQingyuanService } from '../shifang-qingyuan.service';
import type { ShifangQingyuanOrderListData } from '../shifang-qingyuan.types';
import { ShifangQingyuanOrderSyncService } from './order-sync.service';

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
    /* ignore */
  }
}

loadEnvOverride(resolve(process.cwd(), '../../.env'));
loadEnvOverride(resolve(process.cwd(), '.env'));

const describeExternal =
  process.env.RUN_EXTERNAL_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeExternal('ShifangQingyuanOrderSyncService 订单同步集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let redis: RedisService;
  let shifangQingyuan: ShifangQingyuanService;
  let service: ShifangQingyuanOrderSyncService;
  let listData: ShifangQingyuanOrderListData;
  let sourceId: bigint;

  beforeAll(async () => {
    expect(process.env.SHIFANG_QINGYUAN_BASE_URL, '缺少 SHIFANG_QINGYUAN_BASE_URL').toBeTruthy();
    expect(process.env.SHIFANG_QINGYUAN_MALL_SIGN, '缺少 SHIFANG_QINGYUAN_MALL_SIGN').toBeTruthy();
    expect(process.env.SHIFANG_QINGYUAN_HOST, '缺少 SHIFANG_QINGYUAN_HOST').toBeTruthy();
    expect(process.env.DATABASE_URL, '缺少 DATABASE_URL').toBeTruthy();
    expect(process.env.REDIS_URL, '缺少 REDIS_URL').toBeTruthy();

    const config = new ConfigService();
    const http = new HttpClientService(config);
    shifangQingyuan = new ShifangQingyuanService(config, http);

    prisma = new PrismaClient();
    await prisma.$connect();

    redis = new RedisService(config);
    await redis.ensureConnected();
    const businessNumber = new BusinessNumberService(redis, prisma as never, config);
    const externalPosting = new ExternalInventoryPostingService(prisma as never);

    service = new ShifangQingyuanOrderSyncService(
      prisma as never,
      shifangQingyuan,
      businessNumber,
      externalPosting,
    );

    const source = await prisma.hspsi_sys_data_source.findUnique({
      where: { code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE },
    });
    sourceId = source?.id ?? 0n;
  }, 60_000);

  afterAll(async () => {
    await redis?.onModuleDestroy().catch(() => undefined);
    await prisma?.$disconnect();
  });

  it(
    '能真实拉取已支付订单列表',
    async () => {
      listData = await shifangQingyuan.getOrderList({
        page: 1,
        limit: 10,
        pay_status: SHIFANG_QINGYUAN_PAY_STATUS.PAID,
        start_time: '1970-01-01 00:00:00',
      });

      expect(listData).toBeDefined();
      expect(Array.isArray(listData.list)).toBe(true);
      expect(listData.pagination.total).toBeGreaterThanOrEqual(listData.list.length);

      if (listData.list.length > 0) {
        const sample = listData.list[0]!;
        expect(sample.order.id).toBeTypeOf('number');
        expect(sample.order.order_no).toBeTruthy();
        expect(sample.order.pay_status).toBe(SHIFANG_QINGYUAN_PAY_STATUS.PAID);
        expect(Array.isArray(sample.details)).toBe(true);
      }
    },
    60_000,
  );

  it(
    '列表元素含全量嵌套（refunds/express，无需再调 detail）',
    async () => {
      if (!listData?.list?.length) {
        listData = await shifangQingyuan.getOrderList({
          page: 1,
          limit: 5,
          pay_status: SHIFANG_QINGYUAN_PAY_STATUS.PAID,
          start_time: '1970-01-01 00:00:00',
        });
      }
      if (!listData.list.length) return;

      const sample = listData.list[0]!;
      expect(sample.order.id).toBeTypeOf('number');
      expect(Array.isArray(sample.details)).toBe(true);
      expect(sample.refunds === undefined || Array.isArray(sample.refunds)).toBe(true);
      expect(sample.express === undefined || Array.isArray(sample.express)).toBe(true);
    },
    60_000,
  );

  it(
    '全量同步一批已支付订单并校验 mapping / 销售单',
    async () => {
      const source =
        sourceId > 0n
          ? { id: sourceId }
          : await prisma.hspsi_sys_data_source.findUnique({
              where: { code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE },
            });
      expect(source, '请先存在 shifang_qingyuan 数据源（可先跑商品同步）').toBeTruthy();
      sourceId = source!.id;

      const orgMappings = await prisma.hspsi_sys_organization_mapping.findMany({
        where: { source_id: sourceId, deleted_at: null },
      });
      expect(
        orgMappings.length,
        '请配置 hspsi_sys_organization_mapping（source_id=data_source.id, source_object_id=mall_id）',
      ).toBeGreaterThan(0);

      const stats = await service.syncOrders('0', {
        start_time: '1970-01-01 00:00:00',
        pay_status: SHIFANG_QINGYUAN_PAY_STATUS.PAID,
      });

      expect(stats).toBeDefined();
      expect(stats.fetched).toBeGreaterThanOrEqual(0);
      expect(stats.created + stats.updated + stats.skipped + stats.failed).toBe(stats.fetched);

      if (stats.created + stats.updated > 0) {
        const mapping = await prisma.hspsi_sale_order_source_mapping.findFirst({
          where: {
            source_id: sourceId,
            source_order_type: SHIFANG_QINGYUAN_ORDER_TYPE.SALE_ORDER,
            sync_status: SHIFANG_QINGYUAN_ORDER_SYNC_STATUS.SUCCESS,
            deleted_at: null,
            so_id: { gt: 0 },
          },
          orderBy: { id: 'desc' },
        });
        expect(mapping).toBeTruthy();
        const so = await prisma.hspsi_sale_order.findUnique({
          where: { so_id: mapping!.so_id },
        });
        expect(so).toBeTruthy();
        expect(so!.org_id).toBeGreaterThan(0n);
        expect(Number(so!.fact_amount)).toBeGreaterThanOrEqual(0);

        const details = await prisma.hspsi_sale_order_detail.findMany({
          where: { so_id: mapping!.so_id, deleted_at: null },
        });
        expect(details.length).toBeGreaterThan(0);
      }

      if (stats.failed > 0) {
        // 常见：商品未映射 / 机构未映射 — 不阻断用例，但输出供联调排查
        expect(stats.failures.length).toBe(stats.failed);
      }
    },
    300_000,
  );

  it(
    '再次同步走幂等（无变更则 skipped 增加）',
    async () => {
      const first = await service.syncOrders('0', {
        start_time: '1970-01-01 00:00:00',
        pay_status: SHIFANG_QINGYUAN_PAY_STATUS.PAID,
      });
      const second = await service.syncOrders('0', {
        start_time: '1970-01-01 00:00:00',
        pay_status: SHIFANG_QINGYUAN_PAY_STATUS.PAID,
      });

      expect(second.fetched).toBe(first.fetched);
      expect(second.created).toBe(0);
      expect(second.skipped + second.updated + second.failed).toBe(second.fetched);
    },
    300_000,
  );

  it(
    '按 order_no 单笔同步',
    async () => {
      if (!listData?.list?.length) {
        listData = await shifangQingyuan.getOrderList({
          page: 1,
          limit: 5,
          pay_status: SHIFANG_QINGYUAN_PAY_STATUS.PAID,
          start_time: '1970-01-01 00:00:00',
        });
      }
      if (!listData.list.length) return;

      const orderNo = listData.list[0]!.order.order_no;
      const stats = await service.syncOrderByNo(orderNo, '0');
      expect(stats.fetched).toBe(1);
      expect(stats.created + stats.updated + stats.skipped + stats.failed).toBe(1);
    },
    120_000,
  );
});
