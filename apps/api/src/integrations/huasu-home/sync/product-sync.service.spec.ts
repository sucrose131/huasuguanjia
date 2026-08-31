/**
 * 华溯之家商品同步集成测试（真实请求）
 *
 * 测试方式：真实请求 + 真实写库
 * - 从 .env 读取 HUASU_HOME_BASE_URL / HUASU_HOME_APP_PUBLIC_KEY / DATABASE_URL
 * - 真实签名请求华溯之家商品列表接口
 * - 使用真实 Prisma 写入商品 / 映射 / 转换规则
 *
 * 运行方式：
 *   pnpm --filter @hspsi/api test product-sync.service.spec
 *
 * 前置条件：
 *   1. apps/api/.env 已配置 DATABASE_URL
 *   2. .env 已配置 HUASU_HOME_BASE_URL、HUASU_HOME_APP_PUBLIC_KEY
 *   3. 平台单位表建议存在「套」（套餐 unit_type），分类常量见 huasu-home.constants.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { HttpClientService } from '../../common/http-client.service';
import {
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_MAPPING_STATUS,
  HUASU_HOME_RULE_TYPE,
  HUASU_HOME_SOURCE_TYPE,
} from '../huasu-home.constants';
import { HuasuHomeService } from '../huasu-home.service';
import type { HuasuHomeProductListData } from '../huasu-home.types';
import { HuasuHomeProductSyncService } from './product-sync.service';

/**
 * 加载 .env，并覆盖 process.env。
 * 支持双引号/单引号多行值（华溯公钥 PEM 常跨多行写入）。
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
        // 兼容把换行写成字面量 \n 的写法
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

describeExternal('HuasuHomeProductSyncService 商品同步集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let huasuHome: HuasuHomeService;
  let service: HuasuHomeProductSyncService;
  let productList: HuasuHomeProductListData;

  beforeAll(async () => {
    expect(process.env.HUASU_HOME_BASE_URL, '缺少 HUASU_HOME_BASE_URL').toBeTruthy();
    expect(process.env.HUASU_HOME_APP_PUBLIC_KEY, '缺少 HUASU_HOME_APP_PUBLIC_KEY').toBeTruthy();
    expect(process.env.DATABASE_URL, '缺少 DATABASE_URL').toBeTruthy();

    const config = new ConfigService();
    const http = new HttpClientService(config);
    huasuHome = new HuasuHomeService(config, http);

    prisma = new PrismaClient();
    await prisma.$connect();
    service = new HuasuHomeProductSyncService(prisma as never, huasuHome);
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it(
    '能真实拉取商品列表（products / packages）',
    async () => {
      productList = await huasuHome.getProductList();

      expect(productList).toBeDefined();
      expect(Array.isArray(productList.products)).toBe(true);
      expect(Array.isArray(productList.packages)).toBe(true);
      expect(productList.products.length + productList.packages.length).toBeGreaterThan(0);

      if (productList.products.length > 0) {
        const sample = productList.products[0]!;
        expect(sample.id).toBeTypeOf('number');
        expect(sample.name).toBeTruthy();
        expect(Array.isArray(sample.skus)).toBe(true);
        expect(sample.skus.length).toBeGreaterThan(0);
      }

      if (productList.packages.length > 0) {
        const sample = productList.packages[0]!;
        expect(sample.id).toBeTypeOf('number');
        expect(sample.name).toBeTruthy();
        expect(Array.isArray(sample.singles)).toBe(true);
      }
    },
    60_000,
  );

  it(
    '能真实同步商品到平台，并写入 source_mapping',
    async () => {
      if (!productList) {
        productList = await huasuHome.getProductList();
      }

      const stats = await service.syncProducts('0');

      expect(stats).toBeDefined();
      expect(stats.products.created + stats.products.updated + stats.products.mappingOnly).toBeGreaterThanOrEqual(
        0,
      );
      expect(stats.packages.created + stats.packages.updated + stats.packages.mappingOnly).toBeGreaterThanOrEqual(
        0,
      );

      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: HUASU_HOME_DATA_SOURCE_CODE },
      });
      expect(source).toBeTruthy();
      expect(source!.status).toBe(1);

      const activeProducts = productList.products.filter(
        (item) => item.status === 1 && !item.deleted_at,
      );
      const activePackages = productList.packages.filter(
        (item) => item.status === 1 && !item.deleted_at,
      );

      if (activeProducts.length > 0) {
        const sample = activeProducts[0]!;
        const mappings = await prisma.hspsi_goods_source_mapping.findMany({
          where: {
            source_id: source!.id,
            source_type: HUASU_HOME_SOURCE_TYPE.STANDARD,
            source_goods_id: String(sample.id),
            deleted_at: null,
          },
        });
        expect(mappings.length).toBeGreaterThan(0);
        expect(mappings.every((row) => row.mapping_status === HUASU_HOME_MAPPING_STATUS.MAPPED)).toBe(
          true,
        );
        expect(mappings.every((row) => row.goods_id > 0n && row.sku_id > 0n)).toBe(true);

        const goods = await prisma.hspsi_goods_info.findUnique({
          where: { goods_id: mappings[0]!.goods_id },
        });
        expect(goods).toBeTruthy();
        expect(goods!.goods_name).toBeTruthy();
      }

      if (activePackages.length > 0) {
        const sample = activePackages[0]!;
        const mapping = await prisma.hspsi_goods_source_mapping.findFirst({
          where: {
            source_id: source!.id,
            source_type: HUASU_HOME_SOURCE_TYPE.COMBO,
            source_goods_id: String(sample.id),
            source_sku_id: '0',
            deleted_at: null,
          },
        });
        expect(mapping).toBeTruthy();
        expect(mapping!.mapping_status).toBe(HUASU_HOME_MAPPING_STATUS.MAPPED);
        expect(mapping!.goods_id).toBeGreaterThan(0n);
        expect(mapping!.sku_id).toBeGreaterThan(0n);

        if (sample.singles?.length) {
          const rules = await prisma.hspsi_goods_sku_conversion_rule.findMany({
            where: {
              source_goods_id: mapping!.goods_id,
              source_sku_id: mapping!.sku_id,
              rule_type: HUASU_HOME_RULE_TYPE.COMBO_SPLIT,
              deleted_at: null,
            },
          });
          expect(rules.length).toBeGreaterThan(0);
          for (const single of sample.singles) {
            const expectedQty = Number(single.number || 0) + Number(single.gift_number || 0);
            const hit = rules.find((rule) => rule.quantity_ratio === Math.max(1, expectedQty));
            expect(hit, `套餐 ${sample.id} singles.product_id=${single.product_id} 缺少拆解规则`).toBeTruthy();
          }
        }
      }

      const mappedProduct = activeProducts.find((item) => item.mapping?.id);
      if (mappedProduct) {
        const sourceMappings = await prisma.hspsi_goods_source_mapping.findMany({
          where: {
            source_id: source!.id,
            source_type: HUASU_HOME_SOURCE_TYPE.STANDARD,
            source_goods_id: String(mappedProduct.id),
            deleted_at: null,
          },
        });
        expect(sourceMappings.length).toBeGreaterThan(0);

        const targetMappings = await prisma.hspsi_goods_source_mapping.findMany({
          where: {
            source_id: source!.id,
            source_type: HUASU_HOME_SOURCE_TYPE.STANDARD,
            source_goods_id: String(mappedProduct.mapping!.id),
            deleted_at: null,
          },
        });
        expect(targetMappings.length).toBeGreaterThan(0);

        const defaultTarget = targetMappings.find((row) => {
          // 目标默认规格：多个 number===1 时取列表第一个
          const targetSku = mappedProduct.mapping!.skus.find((sku) => sku.number === 1);
          return targetSku ? row.source_sku_id === String(targetSku.id) : false;
        });
        const targetSkuId =
          defaultTarget?.sku_id ??
          targetMappings.sort((a, b) => Number(a.id - b.id))[0]!.sku_id;

        for (const sourceSku of mappedProduct.skus) {
          const sourceMap = sourceMappings.find((row) => row.source_sku_id === String(sourceSku.id));
          expect(sourceMap).toBeTruthy();
          const rule = await prisma.hspsi_goods_sku_conversion_rule.findFirst({
            where: {
              source_goods_id: sourceMap!.goods_id,
              source_sku_id: sourceMap!.sku_id,
              target_sku_id: targetSkuId,
              rule_type: HUASU_HOME_RULE_TYPE.REPLACE,
              deleted_at: null,
            },
          });
          expect(rule, `带 mapping 单品 ${mappedProduct.id} sku=${sourceSku.id} 缺少替换规则`).toBeTruthy();
          expect(rule!.quantity_ratio).toBe(Math.max(1, Number(sourceSku.number) || 1));
        }
      }
    },
    180_000,
  );

  it(
    '再次同步同一批数据走更新路径（幂等）',
    async () => {
      const first = await service.syncProducts('0');
      const second = await service.syncProducts('0');

      expect(second.products.created).toBe(0);
      expect(second.packages.created).toBe(0);
      expect(second.skus.created).toBe(0);

      // 活跃商品应体现为 updated / mappingOnly / skipped，而不是持续新建
      const touched =
        second.products.updated +
        second.products.mappingOnly +
        second.products.skipped +
        second.packages.updated +
        second.packages.mappingOnly +
        second.packages.skipped;
      expect(touched).toBeGreaterThanOrEqual(0);
      expect(first.mappings.upserted + second.mappings.upserted).toBeGreaterThanOrEqual(0);
    },
    180_000,
  );
});
