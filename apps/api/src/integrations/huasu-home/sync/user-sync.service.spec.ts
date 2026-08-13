/**
 * 华溯之家用户同步集成测试（真实请求 + 真实写库）
 *
 * 运行：
 *   set RUN_EXTERNAL_INTEGRATION_TESTS=true
 *   pnpm --filter @hspsi/api test user-sync.service.spec
 *
 * 前置条件：
 *   1. .env 已配置 DATABASE_URL、HUASU_HOME_BASE_URL、HUASU_HOME_APP_PUBLIC_KEY
 *   2. 已执行 database/migrations/20260813_customer_identity_levels.sql
 *   3. 华溯用户 organization_id 已在 hspsi_sys_organization_mapping 中映射（未映射用户应记 failed）
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { HttpClientService } from '../../common/http-client.service';
import { HUASU_HOME_DATA_SOURCE_CODE } from '../huasu-home.constants';
import { HuasuHomeService } from '../huasu-home.service';
import type { HuasuHomeUser } from '../huasu-home.types';
import { HuasuHomeUserSyncService } from './user-sync.service';

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

const describeExternal =
  process.env.RUN_EXTERNAL_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

function asLevels(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => String(item));
}

describeExternal('HuasuHomeUserSyncService 用户同步集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let huasuHome: HuasuHomeService;
  let service: HuasuHomeUserSyncService;
  let sampleUser: HuasuHomeUser | undefined;
  let sourceId = 0n;

  beforeAll(async () => {
    expect(process.env.HUASU_HOME_BASE_URL, '缺少 HUASU_HOME_BASE_URL').toBeTruthy();
    expect(process.env.HUASU_HOME_APP_PUBLIC_KEY, '缺少 HUASU_HOME_APP_PUBLIC_KEY').toBeTruthy();
    expect(process.env.DATABASE_URL, '缺少 DATABASE_URL').toBeTruthy();

    const config = new ConfigService();
    const http = new HttpClientService(config);
    huasuHome = new HuasuHomeService(config, http);
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new HuasuHomeUserSyncService(prisma as never, huasuHome);

    const page = await huasuHome.getUserList({ page: 1, page_size: 20, id: 0 });
    expect(page.list?.length, '华溯用户列表为空，无法继续集成测试').toBeGreaterThan(0);
    sampleUser = page.list[0];
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it(
    'TC-IT-01 能真实拉取用户列表',
    async () => {
      const data = await huasuHome.getUserList({ page: 1, page_size: 10, id: 0 });
      expect(data.total).toBeGreaterThan(0);
      expect(Array.isArray(data.list)).toBe(true);
      expect(data.list[0]?.id).toBeTruthy();
    },
    60_000,
  );

  it(
    'TC-IT-02 同步后客户按 source_type + related_customer_id 落库，并写入 levels 描述',
    async () => {
      const afterUserId = Math.max(0, Number(sampleUser?.id || 1) - 1);
      const stats = await service.syncUsers({ pageSize: 50, afterUserId });
      expect(stats).toBeTruthy();
      expect(stats!.fetched).toBeGreaterThan(0);
      expect(stats!.created + stats!.updated + stats!.failed).toBe(stats!.fetched);
      expect(stats!.afterUserId).toBe(afterUserId);
      expect(stats!.lastUserId).toBeGreaterThanOrEqual(afterUserId);

      const source = await prisma.hspsi_sys_data_source.findUnique({
        where: { code: HUASU_HOME_DATA_SOURCE_CODE },
      });
      expect(source?.status).toBe(1);
      sourceId = source!.id;

      expect(sampleUser?.id).toBeTruthy();
      const customer = await prisma.hspsi_basic_customer.findFirst({
        where: {
          source_type: Number(sourceId),
          related_customer_id: BigInt(sampleUser!.id),
          deleted_at: null,
        },
      });

      if (!customer) {
        // 首条样例若机构未映射，应出现在 failed warnings 中
        expect(stats!.failed).toBeGreaterThan(0);
        expect(
          stats!.warnings.some((item) => item.includes(`user.id=${sampleUser!.id}`)),
        ).toBe(true);
        return;
      }

      expect(customer.name).toBeTruthy();
      expect(customer.org_id > 0n).toBe(true);
      const levels = asLevels(customer.levels);
      expect(levels).toBeTruthy();
      expect(Array.isArray(levels)).toBe(true);
      expect(JSON.stringify(levels)).not.toMatch(/"level_id"/);
      expect(JSON.stringify(levels)).not.toMatch(/"enabled"/);
    },
    300_000,
  );

  it(
    'TC-IT-03 再次同步同一用户应为更新且幂等键不变',
    async () => {
      if (!sampleUser?.id || !(sourceId > 0n)) return;

      const before = await prisma.hspsi_basic_customer.findFirst({
        where: {
          source_type: Number(sourceId),
          related_customer_id: BigInt(sampleUser.id),
          deleted_at: null,
        },
      });
      if (!before) return;

      // 增量水位下需回拨 afterUserId，才能再次拉到同一用户并更新
      const stats = await service.syncUsers({
        pageSize: 50,
        afterUserId: Math.max(0, Number(sampleUser.id) - 1),
      });
      expect(stats).toBeTruthy();
      expect(stats!.updated).toBeGreaterThan(0);

      const after = await prisma.hspsi_basic_customer.findFirst({
        where: {
          source_type: Number(sourceId),
          related_customer_id: BigInt(sampleUser.id),
          deleted_at: null,
        },
      });
      expect(after?.customer_id).toBe(before.customer_id);
    },
    300_000,
  );
});
