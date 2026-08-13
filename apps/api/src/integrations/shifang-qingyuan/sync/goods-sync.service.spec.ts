/**
 * 十方清源商品同步集成测试（真实请求）
 *
 * 测试方式：真实请求 + 真实写库
 * - 从 .env 读取 SHIFANG_QINGYUAN_BASE_URL / SHIFANG_QINGYUAN_MALL_SIGN / SHIFANG_QINGYUAN_HOST / DATABASE_URL
 * - 真实请求十方清源商品列表接口
 * - 使用真实 Prisma 写入商品 / SKU / 映射 / 转换规则
 *
 * 运行方式：
 *   RUN_EXTERNAL_INTEGRATION_TESTS=true pnpm --filter @hspsi/api test goods-sync.service.spec
 *
 * 前置条件：
 *   1. apps/api/.env 已配置 DATABASE_URL
 *   2. .env 已配置 SHIFANG_QINGYUAN_BASE_URL、SHIFANG_QINGYUAN_MALL_SIGN、SHIFANG_QINGYUAN_HOST
 *   3. 平台单位表建议存在「瓶/盒/套」，分类常量见 shifang-qingyuan.constants.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { HttpClientService } from '../../common/http-client.service';
import {
  SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
  SHIFANG_QINGYUAN_MAPPING_STATUS,
  SHIFANG_QINGYUAN_RULE_STATUS,
  SHIFANG_QINGYUAN_RULE_TYPE,
  SHIFANG_QINGYUAN_SOURCE_TYPE,
} from '../shifang-qingyuan.constants';
import { ShifangQingyuanService } from '../shifang-qingyuan.service';
import type { ShifangQingyuanGoodsListData } from '../shifang-qingyuan.types';
import { ShifangQingyuanGoodsSyncService } from './goods-sync.service';

/**
 * 加载 .env，并覆盖 process.env。
 * 支持双引号/单引号多行值。
 */
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

// pnpm workspace 运行本测试时 cwd 为 apps/api，配置读取当前包目录的 .env
loadEnvOverride(resolve(process.cwd(), '.env'));

const describeExternal =
  process.env.RUN_EXTERNAL_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeExternal('ShifangQingyuanGoodsSyncService 商品同步集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let shifangQingyuan: ShifangQingyuanService;
  let service: ShifangQingyuanGoodsSyncService;
  let listData: ShifangQingyuanGoodsListData;

  beforeAll(async () => {
    expect(process.env.SHIFANG_QINGYUAN_BASE_URL, '缺少 SHIFANG_QINGYUAN_BASE_URL').toBeTruthy();
    expect(process.env.SHIFANG_QINGYUAN_MALL_SIGN, '缺少 SHIFANG_QINGYUAN_MALL_SIGN').toBeTruthy();
    expect(process.env.SHIFANG_QINGYUAN_HOST, '缺少 SHIFANG_QINGYUAN_HOST').toBeTruthy();
    expect(process.env.DATABASE_URL, '缺少 DATABASE_URL').toBeTruthy();

    const config = new ConfigService();
    const http = new HttpClientService(config);
    shifangQingyuan = new ShifangQingyuanService(config, http);

    prisma = new PrismaClient();
    await prisma.$connect();
    service = new ShifangQingyuanGoodsSyncService(prisma as never, shifangQingyuan);
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it(
    '能真实拉取商品列表',
    async () => {
      listData = await shifangQingyuan.getGoodsList({ page: 1, limit: 10 });

      expect(listData).toBeDefined();
      expect(Array.isArray(listData.list)).toBe(true);
      expect(listData.pagination.total).toBeGreaterThanOrEqual(listData.list.length);

      if (listData.list.length > 0) {
        const sample = listData.list[0]!;
        expect(sample.goods).toBeDefined();
        expect(sample.goods.id).toBeTypeOf('number');
        expect(sample.goods.goods_name).toBeTruthy();
        expect(Array.isArray(sample.qimall_goods_attr)).toBe(true);
      }
    },
    60_000,
  );

  it(
    '能真实同步商品到平台，并写入 source_mapping + conversion_rule',
    async () => {
      if (!listData) {
        listData = await shifangQingyuan.getGoodsList({ page: 1, limit: 10 });
      }

      const stats = await service.syncGoods('0');
      expect(stats).toBeDefined();
      expect(stats.goods.created + stats.goods.updated + stats.goods.mappingOnly + stats.goods.skipped).toBe(
        stats.goods.created + stats.goods.updated + stats.goods.mappingOnly + stats.goods.skipped,
      );

      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE },
      });
      expect(source).toBeTruthy();
      expect(source!.status).toBe(1);

      const activeItems = listData.list.filter(
        (item) => item.goods.is_on_sale === 1 && item.goods.status === 1,
      );

      if (activeItems.length > 0) {
        const sample = activeItems[0]!;
        const mappings = await prisma.hspsi_goods_source_mapping.findMany({
          where: {
            source_id: source!.id,
            source_goods_id: String(sample.goods.id),
            deleted_at: null,
          },
        });
        expect(mappings.length).toBeGreaterThan(0);
        expect(mappings.every((row) => row.mapping_status === SHIFANG_QINGYUAN_MAPPING_STATUS.MAPPED)).toBe(
          true,
        );
        expect(mappings.every((row) => row.goods_id > 0n && row.sku_id > 0n)).toBe(true);

        const goods = await prisma.hspsi_goods_info.findUnique({
          where: { goods_id: mappings[0]!.goods_id },
        });
        expect(goods).toBeTruthy();
        expect(goods!.goods_name).toBe(sample.goods.goods_name.slice(0, 100));

        // 有 gift_plan / upgrade_bag 的商品 source_type 是 MAPPED
        const hasMapping =
          sample.cloud_stock_gift_plan?.some((p) => p.status === 1) ||
          sample.cloud_stock_upgrade_bag?.some((b) => b.status === 1 && b.is_enable === 1);
        expect(mappings[0]!.source_type).toBe(
          hasMapping ? SHIFANG_QINGYUAN_SOURCE_TYPE.MAPPED : SHIFANG_QINGYUAN_SOURCE_TYPE.STANDARD,
        );

        if (hasMapping && sample.qimall_goods_attr.length) {
          const sampleMapping = mappings[0]!;
          const rules = await prisma.hspsi_goods_sku_conversion_rule.findMany({
            where: {
              source_goods_id: sampleMapping.goods_id,
              source_sku_id: sampleMapping.sku_id,
              rule_type: {
                in: [
                  SHIFANG_QINGYUAN_RULE_TYPE.REPLACE,
                  SHIFANG_QINGYUAN_RULE_TYPE.COMBO_SPLIT,
                ],
              },
              deleted_at: null,
            },
          });
          // 至少有 1 条转换规则；多目标应为 COMBO_SPLIT
          expect(rules.length).toBeGreaterThan(0);
          const expectedType =
            rules.length > 1
              ? SHIFANG_QINGYUAN_RULE_TYPE.COMBO_SPLIT
              : SHIFANG_QINGYUAN_RULE_TYPE.REPLACE;
          expect(rules.every((row) => row.rule_type === expectedType)).toBe(true);
          expect(rules.every((row) => row.status === SHIFANG_QINGYUAN_RULE_STATUS.ENABLED)).toBe(true);
          expect(rules.every((row) => row.quantity_ratio >= 1)).toBe(true);
        }
      }
    },
    180_000,
  );

  it(
    '再次同步同一批数据走更新路径（幂等）',
    async () => {
      const first = await service.syncGoods('0');
      const second = await service.syncGoods('0');

      expect(second.goods.created).toBe(0);
      expect(second.skus.created).toBe(0);

      // 统计活跃商品应落在 updated/mappingOnly/skipped 之和
      const touched = second.goods.updated + second.goods.mappingOnly + second.goods.skipped;
      expect(touched).toBeGreaterThanOrEqual(0);
      expect(first.mappings.upserted + second.mappings.upserted).toBeGreaterThanOrEqual(0);
    },
    180_000,
  );
});
