/**
 * 薪福通 OA 组织同步集成测试（真实请求 + 真实写库）
 *
 * 测试方式：真实请求
 * - 从 .env 读取配置
 * - 连接真实数据库读取 hspsi_sys_account_set 凭证
 * - 用真实国密算法（SM2/SM3/SM4）加解密
 * - 真实 HTTP 请求到薪福通 API 拉取组织数据
 * - 调用 syncOrganizations 同步到本地表
 *
 * 运行方式：
 *   pnpm --filter @hspsi/api test xinfutong-oa/sync/sync.service.spec
 *
 * 前置条件：
 *   1. .env 中 DATABASE_URL 指向含有薪福通账套数据的数据库
 *   2. .env 中 XINFUTONG_OA_BASE_URL 配置正确
 *   3. hspsi_sys_account_set 表中至少有一条 status=1 的启用账套
 *   4. 设置环境变量 RUN_EXTERNAL_INTEGRATION_TESTS=true
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { XinfutongOaOrganizationService } from '../organization/organization.service';
import {
  XinfutongOaCredentialService,
  type AccountSetCredential,
} from '../core/credential.service';
import { XinfutongOaSyncService } from './sync.service';

function loadEnvOverride(filePath: string) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      process.env[key] = value;
    }
  } catch {
    /* 文件不存在则跳过 */
  }
}
loadEnvOverride(resolve(process.cwd(), '../../.env'));
loadEnvOverride(resolve(process.cwd(), '.env'));

const describeExternal =
  process.env.RUN_EXTERNAL_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeExternal('XinfutongOaSyncService 组织同步集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let credentialService: XinfutongOaCredentialService;
  let orgService: XinfutongOaOrganizationService;
  let syncService: XinfutongOaSyncService;
  let credential: AccountSetCredential;

  beforeAll(async () => {
    const config = new ConfigService();
    orgService = new XinfutongOaOrganizationService(config);

    prisma = new PrismaClient();
    await prisma.$connect();
    credentialService = new XinfutongOaCredentialService(prisma as never);
    syncService = new XinfutongOaSyncService(prisma as never);

    const credentials = await credentialService.getAllEnabled();
    expect(credentials.length).toBeGreaterThan(0);
    credential = credentials[0]!;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it(
    '拉取组织数据并同步到本地表',
    async () => {
      // 1. 从 OA 拉取组织数据
      const records = await orgService.getAllOrganizations(credential);
      console.log(`拉取到 ${records.length} 条组织记录`);

      // 2. 先执行一次同步，确保本地有数据
      const stats1 = await syncService.syncOrganizations(credential, records);
      console.log('首次同步统计:', stats1);

      // 3. 找一条已存在的组织，手动禁用
      const existingOrg = await prisma.hspsi_basic_organization.findFirst({
        where: { account_set_id: credential.id, operation_status: 1 },
        select: { org_id: true, outer_ref_id: true, name: true, operation_status: true },
      });
      expect(existingOrg, '至少存在一条启用的组织记录').toBeTruthy();

      // 手动禁用该组织
      await prisma.hspsi_basic_organization.update({
        where: { org_id: existingOrg!.org_id },
        data: { operation_status: 2 },
      });
      console.log(`已手动禁用组织: ${existingOrg!.name} (org_id=${existingOrg!.org_id})`);

      // 4. 再次同步，验证禁用状态未被覆盖
      const stats2 = await syncService.syncOrganizations(credential, records);
      console.log('二次同步统计:', stats2);

      const afterSync = await prisma.hspsi_basic_organization.findUnique({
        where: { org_id: existingOrg!.org_id },
        select: { operation_status: true, name: true },
      });
      console.log(`同步后组织状态: ${afterSync!.name} operation_status=${afterSync!.operation_status}`);

      // 验证：本地已禁用的组织，同步后仍保持禁用
      expect(afterSync!.operation_status).toBe(2);

      // 5. 恢复原始状态
      await prisma.hspsi_basic_organization.update({
        where: { org_id: existingOrg!.org_id },
        data: { operation_status: 1 },
      });
      console.log('已恢复组织为启用状态');
    },
    120_000,
  );

  it(
    '拉取部门数据并同步到本地表',
    async () => {
      // 1. 从 OA 拉取组织数据（含部门）
      const records = await orgService.getAllOrganizations(credential);
      const deptRecords = records.filter((r) => r.type === 'D');
      console.log(`拉取到 ${deptRecords.length} 条部门记录`);

      if (deptRecords.length === 0) {
        console.log('无部门数据，跳过部门禁用保持测试');
        return;
      }

      // 2. 先执行一次同步，确保本地有数据
      await syncService.syncOrganizations(credential, records);

      // 3. 找一条已存在的部门，手动禁用
      const existingDept = await prisma.hspsi_basic_dept.findFirst({
        where: { account_set_id: credential.id, status: 1 },
        select: { dept_id: true, outer_ref_id: true, name: true, status: true },
      });
      if (!existingDept) {
        console.log('无已启用的部门记录，跳过部门禁用保持测试');
        return;
      }

      // 手动禁用该部门
      await prisma.hspsi_basic_dept.update({
        where: { dept_id: existingDept.dept_id },
        data: { status: 2 },
      });
      console.log(`已手动禁用部门: ${existingDept.name} (dept_id=${existingDept.dept_id})`);

      // 4. 再次同步，验证禁用状态未被覆盖
      await syncService.syncOrganizations(credential, records);

      const afterSync = await prisma.hspsi_basic_dept.findUnique({
        where: { dept_id: existingDept.dept_id },
        select: { status: true, name: true },
      });
      console.log(`同步后部门状态: ${afterSync!.name} status=${afterSync!.status}`);

      // 验证：本地已禁用的部门，同步后仍保持禁用
      expect(afterSync!.status).toBe(2);

      // 5. 恢复原始状态
      await prisma.hspsi_basic_dept.update({
        where: { dept_id: existingDept.dept_id },
        data: { status: 1 },
      });
      console.log('已恢复部门为启用状态');
    },
    120_000,
  );
});