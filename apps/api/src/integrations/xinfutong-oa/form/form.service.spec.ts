/**
 * 薪福通 OA 表单服务集成测试（真实请求）
 *
 * 测试方式：真实请求
 * - 从 .env 读取配置
 * - 连接真实数据库读取 hspsi_sys_account_set 凭证
 * - 用真实国密算法（SM2/SM3/SM4）加解密
 * - 真实 HTTP 请求到薪福通 API
 *
 * 运行方式：
 *   pnpm --filter @hspsi/api test form.service.spec
 *
 * 前置条件：
 *   1. .env 中 DATABASE_URL 指向含有薪福通账套数据的数据库
 *   2. .env 中 XINFUTONG_OA_BASE_URL 配置正确
 *   3. hspsi_sys_account_set 表中至少有一条 status=1 的启用账套
 *
 * 数据范围：最小调用
 *   getFormList 查询全部分类（formName 不传）
 *   getFormConfig / getFormDataList 复用 getFormList 返回的第一个 formKey
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { XinfutongOaFormService } from './form.service';
import {
  XinfutongOaCredentialService,
  type AccountSetCredential,
} from '../core/credential.service';
import type { FormCategory } from './form.types';

// 加载项目根目录 .env（指向远程开发库，含薪福通账套数据）
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
// cwd 为 apps/api，项目根目录在 ../../
loadEnvOverride(resolve(process.cwd(), '../../.env'));

describe('XinfutongOaFormService 业务接口集成测试（真实请求）', () => {
  let prisma: PrismaClient;
  let credentialService: XinfutongOaCredentialService;
  let service: XinfutongOaFormService;
  let credential: AccountSetCredential;

  // 跨用例共享：从 getFormList 返回中取到的第一个 formKey
  let sharedFormKey: string | undefined;

  beforeAll(async () => {
    // 构造 ConfigService（从 process.env 读取）
    const config = new ConfigService();
    service = new XinfutongOaFormService(config);

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

  // ==================== 表单列表查询 ====================

  describe('getFormList', () => {
    it(
      '能成功查询表单列表（不传 formName，查全部分类）',
      async () => {
        const response = await service.getFormList(credential, {});

        // 校验返回码成功
        expect(response.returnCode).toBe('SUC0000');

        // 校验 body 为数组
        expect(Array.isArray(response.body)).toBe(true);

        // 遍历分类，找到第一个可用的 formKey 供后续测试使用
        const categories = (response.body ?? []) as FormCategory[];
        for (const category of categories) {
          const formInfoList = category.formInfoList ?? [];
          if (formInfoList.length > 0) {
            sharedFormKey = formInfoList[0]!.formKey;
            break;
          }
        }

        // 若整个企业没有任何表单，后续接口无法测试，这里仅记录不抛错
        if (!sharedFormKey) {
          console.warn('当前账套下没有任何表单，getFormConfig / getFormDataList 将跳过真实请求测试');
        }
      },
      60_000,
    );

    it(
      '能按 formName 模糊查询表单列表',
      async () => {
        const response = await service.getFormList(credential, {
          formName: '测试',
        });

        expect(response.returnCode).toBe('SUC0000');
        expect(Array.isArray(response.body)).toBe(true);
      },
      60_000,
    );
  });

  // ==================== 表单配置信息查询 ====================

  describe('getFormConfig', () => {
    it(
      '能通过 formKey 查询表单配置信息',
      async () => {
        sharedFormKey = "AAC15400_NFORM_379287135985270784";
        if (!sharedFormKey) {
          console.warn('跳过：当前账套下没有可用的 formKey');
          return;
        }

        const response = await service.getFormConfig(credential, {
          // formKey: sharedFormKey,
          formId: 'AAC15400_NFORM_379287135985270784:4',
        });

        expect(response.returnCode).toBe('SUC0000');

        // 校验返回的表单配置结构
        const body = response.body;
        console.log(body);
        expect(body).toBeDefined();
        expect(body).toHaveProperty('formName');
        expect(body).toHaveProperty('formConfig');

        // formConfig 是 JSON 字符串（可能很长），验证可被 JSON.parse
        if (body!.formConfig) {
          expect(() => JSON.parse(body!.formConfig)).not.toThrow();
        }
      },
      60_000,
    );

    it('formId 和 formKey 均为空时抛错', async () => {
      await expect(
        service.getFormConfig(credential, {}),
      ).rejects.toThrow('formId 和 formKey 至少传一个');
    });
  });

  // ==================== 表单数据查询 ====================

  describe('getFormDataList', () => {
    it(
      '能通过 formKey 作为 busKey 查询表单数据',
      async () => {
        if (!sharedFormKey) {
          console.warn('跳过：当前账套下没有可用的 formKey');
          return;
        }

        const response = await service.getFormDataList(credential, {
          busKeyList: [sharedFormKey],
        });

        expect(response.returnCode).toBe('SUC0000');
        expect(Array.isArray(response.body)).toBe(true);

        // 若有数据，校验记录结构
        const records = response.body ?? [];
        if (records.length > 0) {
          const record = records[0]!;
          expect(record).toHaveProperty('formId');
          expect(record).toHaveProperty('busKey');
          expect(record).toHaveProperty('formData');
          // formData 是 JSON 字符串（兼容历史/新两种层级），验证可被 JSON.parse
          if (record.formData) {
            expect(() => JSON.parse(record.formData)).not.toThrow();
          }
        }
      },
      60_000,
    );

    it('busKeyList 和 procInstIdList 均为空时抛错', async () => {
      await expect(
        service.getFormDataList(credential, {}),
      ).rejects.toThrow('busKeyList 和 procInstIdList 至少传一个');
    });

    it('busKeyList 超过 300 个时抛错', async () => {
      const oversized = Array.from({ length: 301 }, (_, i) => `KEY_${i}`);
      await expect(
        service.getFormDataList(credential, { busKeyList: oversized }),
      ).rejects.toThrow(/业务编号集合数量不能超过 300/);
    });

    it('procInstIdList 超过 300 个时抛错', async () => {
      const oversized = Array.from({ length: 301 }, (_, i) => `PROC_${i}`);
      await expect(
        service.getFormDataList(credential, { procInstIdList: oversized }),
      ).rejects.toThrow(/流程实例 id 集合数量不能超过 300/);
    });
  });
});
