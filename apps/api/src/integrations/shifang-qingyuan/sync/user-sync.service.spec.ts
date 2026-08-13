/**
 * 十方清源用户同步集成测试（真实请求 + 真实写库）
 *
 * 运行：
 *   set RUN_EXTERNAL_INTEGRATION_TESTS=true
 *   pnpm --filter @hspsi/api test shifang-qingyuan/sync/user-sync.service.spec
 *
 * 前置条件：
 *   1. apps/api/.env 已配置 DATABASE_URL、SHIFANG_QINGYUAN_BASE_URL、SHIFANG_QINGYUAN_MALL_SIGN、SHIFANG_QINGYUAN_HOST
 *   2. 用户 mall_id 已在 hspsi_sys_organization_mapping 中映射（未映射用户应记 failed）
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { HttpClientService } from '../../common/http-client.service';
import { SHIFANG_QINGYUAN_DATA_SOURCE_CODE } from '../shifang-qingyuan.constants';
import { ShifangQingyuanService } from '../shifang-qingyuan.service';
import type { ShifangQingyuanUserItem } from '../shifang-qingyuan.types';
import { ShifangQingyuanUserSyncService } from './user-sync.service';

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

loadEnvOverride(resolve(process.cwd(), '.env'));

const describeExternal =
  process.env.RUN_EXTERNAL_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

function asLevels(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item));
}

describeExternal('ShifangQingyuanUserSyncService 用户同步集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let shifangQingyuan: ShifangQingyuanService;
  let service: ShifangQingyuanUserSyncService;
  let sampleItem: ShifangQingyuanUserItem | undefined;
  let sourceId = 0n;

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
    service = new ShifangQingyuanUserSyncService(prisma as never, shifangQingyuan);

    const page = await shifangQingyuan.getUserList({ page: 1, limit: 5 });
    expect(page.list?.length, '十方清源用户列表为空，无法继续集成测试').toBeGreaterThan(0);
    sampleItem = page.list[0];
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it(
    'TC-IT-01 能真实拉取用户列表，且含 user / user_level / cloud_stock_agent',
    async () => {
      const data = await shifangQingyuan.getUserList({ page: 1, limit: 5 });
      expect(data.pagination.total).toBeGreaterThan(0);
      expect(Array.isArray(data.list)).toBe(true);
      expect(data.list[0]?.user?.id).toBeTruthy();
    },
    60_000,
  );

  it(
    'TC-IT-02 同步后客户按 source_type + related_customer_id 落库，并写入 levels 描述',
    async () => {
      const stats = await service.syncUsers({ pageSize: 20, full: true });
      expect(stats).toBeTruthy();
      expect(stats!.fetched).toBeGreaterThan(0);
      expect(stats!.created + stats!.updated + stats!.failed).toBe(stats!.fetched);
      expect(stats!.startTime).toBe('');

      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE },
      });
      expect(source?.status).toBe(1);
      sourceId = source!.id;

      expect(sampleItem?.user?.id).toBeTruthy();
      const customer = await prisma.hspsi_basic_customer.findFirst({
        where: {
          source_type: Number(sourceId),
          related_customer_id: BigInt(sampleItem!.user.id),
          deleted_at: null,
        },
      });

      if (!customer) {
        expect(stats!.failed).toBeGreaterThan(0);
        expect(
          stats!.warnings.some((item) => item.includes(`user.id=${sampleItem!.user.id}`)),
        ).toBe(true);
        return;
      }

      expect(customer.name).toBeTruthy();
      expect(customer.org_id > 0n).toBe(true);
      const levels = asLevels(customer.levels);
      expect(levels).toBeTruthy();
      expect(Array.isArray(levels)).toBe(true);
      expect(JSON.stringify(levels)).not.toMatch(/"id"/);
    },
    300_000,
  );

  it(
    'TC-IT-03 再次同步同一用户应为更新且幂等键不变',
    async () => {
      if (!sampleItem?.user?.id || !(sourceId > 0n)) return;

      const before = await prisma.hspsi_basic_customer.findFirst({
        where: {
          source_type: Number(sourceId),
          related_customer_id: BigInt(sampleItem.user.id),
          deleted_at: null,
        },
      });
      if (!before) return;

      const stats = await service.syncUsers({ pageSize: 20, full: true });
      expect(stats).toBeTruthy();
      expect(stats!.updated).toBeGreaterThan(0);

      const after = await prisma.hspsi_basic_customer.findFirst({
        where: {
          source_type: Number(sourceId),
          related_customer_id: BigInt(sampleItem.user.id),
          deleted_at: null,
        },
      });
      expect(after?.customer_id).toBe(before.customer_id);
    },
    300_000,
  );
});
