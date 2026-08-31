/**
 * 薪福通 OA 业务接口集成测试
 *
 * 测试方式：真实请求
 * - 从 .env 读取配置
 * - 连接真实数据库读取 hspsi_sys_account_set 凭证
 * - 用真实国密算法（SM2/SM3/SM4）加解密
 * - 真实 HTTP 请求到薪福通 API
 *
 * 运行方式：
 *   pnpm --filter @hspsi/api test organization.service.spec
 *
 * 前置条件：
 *   1. .env 中 DATABASE_URL 指向含有薪福通账套数据的数据库
 *   2. .env 中 XINFUTONG_OA_BASE_URL 配置正确
 *   3. hspsi_sys_account_set 表中至少有一条 status=1 的启用账套
 *
 * 数据范围：最小调用
 *   每个接口仅查 1 页 pageSize=1，验证请求/加解密/响应解析链路通畅即可。
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { XinfutongOaOrganizationService } from './organization.service';
import {
  XinfutongOaCredentialService,
  type AccountSetCredential,
} from '../core/credential.service';

// 加载apps/api/.env（指向远程开发库，含薪福通账套数据）
// vitest 运行时 cwd 为 apps/api，往上一层即项目根目录
// 用 dotenv-style 手动解析并覆盖 process.env（process.loadEnvFile 不覆盖已有变量）
import { readFileSync } from 'node:fs';
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
// pnpm workspace 运行本测试时 cwd 为 apps/api，配置读取当前包目录的 .env
loadEnvOverride(resolve(process.cwd(), '.env'));

const describeExternal =
  process.env.RUN_EXTERNAL_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeExternal('XinfutongOaOrganizationService 业务接口集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let credentialService: XinfutongOaCredentialService;
  let service: XinfutongOaOrganizationService;
  let credential: AccountSetCredential;

  beforeAll(async () => {
    // 构造 ConfigService（从 process.env 读取）
    const config = new ConfigService();
    service = new XinfutongOaOrganizationService(config);

    // 连接真实数据库
    prisma = new PrismaClient();
    await prisma.$connect();
    // PrismaService 继承自 PrismaClient，这里用类型断言兼容
    credentialService = new XinfutongOaCredentialService(prisma as never);

    // 读取第一个启用的账套凭证
    const credentials = await credentialService.getAllEnabled();
    expect(credentials.length).toBeGreaterThan(0);
    credential = credentials[0]!;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ==================== 组织列表查询 ====================

  describe('getOrganizationList', () => {
    it(
      '能成功查询组织列表（1 条）',
      async () => {
        const response = await service.getOrganizationList(credential, {
          currentPage: 1,
          pageSize: 1,
        });

        // 校验返回码成功
        expect(response.returnCode).toBe('SUC0000');

        // 校验分页结构
        const body = response.body;
        expect(body).toBeDefined();
        expect(typeof body?.totalSize).toBe('number');
        expect(Array.isArray(body?.records)).toBe(true);

        // 若有数据，校验记录结构
        if (body!.records!.length > 0) {
          const org = body!.records![0]!;
          expect(org).toHaveProperty('id');
        }
      },
      60_000,
    );
  });

  // ==================== 职位查询 ====================

  describe('getJobList', () => {
    it(
      '能成功查询职位列表（1 条）',
      async () => {
        const response = await service.getJobList(credential, {
          currentPage: 1,
          pageSize: 1,
        });

        expect(response.returnCode).toBe('SUC0000');
        expect(response.body).toBeDefined();
        expect(Array.isArray(response.body?.records)).toBe(true);
      },
      60_000,
    );
  });

  // ==================== 岗位查询 ====================

  describe('getPositionList', () => {
    it(
      '能成功查询岗位列表（1 条）',
      async () => {
        const response = await service.getPositionList(credential, {
          currentPage: 1,
          pageSize: 1,
        });

        expect(response.returnCode).toBe('SUC0000');
        expect(response.body).toBeDefined();
        expect(Array.isArray(response.body?.records)).toBe(true);
      },
      60_000,
    );
  });

  // ==================== 企业成员查询 ====================

  describe('getMemberList', () => {
    it(
      '能成功查询企业成员（1 条）',
      async () => {
        const response = await service.getMemberList(credential, {
          currentPage: 1,
          pageSize: 1,
          status: 'ENABLE',
          extFields: ['org', 'position', 'personal'],
        });

        expect(response.returnCode).toBe('SUC0000');
        expect(response.body).toBeDefined();
        expect(Array.isArray(response.body?.records)).toBe(true);
      },
      60_000,
    );
  });

  // ==================== 员工花名册查询 ====================

  describe('getStaffList', () => {
    it(
      '能成功查询员工花名册（1 条，按分组返回）',
      async () => {
        const response = await service.getStaffList(credential, {
          queryFilterList: [],
          queryResultType: {
            queryType: 'GROUP',
            queryClassKeyList: ['S01BASIC'],
          },
          currentPage: 1,
          pageSize: 1,
        });

        expect(response.returnCode).toBe('SUC0000');
        expect(response.body).toBeDefined();
        expect(Array.isArray(response.body?.records)).toBe(true);
      },
      60_000,
    );
  });

  // ==================== 链路验证总结 ====================

  describe('请求/加解密/响应解析链路', () => {
    it(
      '国密 SM2 签名 + SM4 加解密链路通畅（通过组织查询间接验证）',
      async () => {
        // 若组织查询成功返回 SUC0000，说明以下链路全部正常：
        // 1. SM4 加密请求体 ✓
        // 2. SM2 签名 ✓
        // 3. HTTP 请求发送 ✓
        // 4. SM4 解密响应体 ✓
        // 5. JSON 解析响应 ✓
        // 6. 返回码校验 ✓
        const response = await service.getOrganizationList(credential, {
          currentPage: 1,
          pageSize: 1,
        });
        expect(response.returnCode).toBe('SUC0000');
      },
      60_000,
    );
  });
});
