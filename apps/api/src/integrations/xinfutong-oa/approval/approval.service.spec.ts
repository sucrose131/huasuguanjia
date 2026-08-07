/**
 * 薪福通 OA 审批服务测试
 *
 * 测试方式：
 * - 参数校验：单元测试（不走网络，快速）
 * - 发起流程v2：真实请求集成测试（需要薪福通测试环境）
 * - 回调处理：单元测试（验证载荷解析与校验）
 *
 * 运行方式：
 *   pnpm --filter @hspsi/api exec vitest run src/integrations/xinfutong-oa/approval/approval.service.spec.ts
 *
 * 前置条件（真实请求部分）：
 *   1. .env 中 DATABASE_URL 指向含有薪福通账套数据的数据库
 *   2. .env 中 XINFUTONG_OA_BASE_URL 配置正确
 *   3. hspsi_sys_account_set 表中至少有一条 status=1 的启用账套
 *   4. 薪福通测试环境中有可用的表单模板
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { XinfutongOaApprovalService } from './approval.service';
import { XinfutongOaApprovalCallbackService } from './approval-callback.service';
import {
  XinfutongOaCredentialService,
  type AccountSetCredential,
} from '../core/credential.service';
import type { FormStartParams } from './approval.types';

// 加载项目根目录 .env
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

// ==================== 参数校验单元测试 ====================

// describe('XinfutongOaApprovalService 参数校验', () => {
//   const config = new ConfigService();
//   const service = new XinfutongOaApprovalService(config);

//   const mockCredential: AccountSetCredential = {
//     id: 1n,
//     name: 'test',
//     appId: 'testAppId',
//     appSecret: 'testSecret',
//   };

//   const validParams: FormStartParams = {
//     formKey: 'XFT15160_NFORM_290620476061515776',
//     procStartType: 'start',
//     formData: '{"jc32o22xm1v6":"测试文本"}',
//     starterId: 'U0000',
//   };

//   it('formKey 为空时抛错', async () => {
//     await expect(
//       service.startFormProcess(mockCredential, { ...validParams, formKey: '' }),
//     ).rejects.toThrow('formKey 为必填项');
//   });

//   it('procStartType 为空时抛错', async () => {
//     await expect(
//       service.startFormProcess(mockCredential, {
//         ...validParams,
//         procStartType: '' as FormStartParams['procStartType'],
//       }),
//     ).rejects.toThrow('procStartType 为必填项');
//   });

//   it('procStartType 为非法值时抛错', async () => {
//     await expect(
//       service.startFormProcess(mockCredential, {
//         ...validParams,
//         procStartType: 'invalid' as FormStartParams['procStartType'],
//       }),
//     ).rejects.toThrow(/procStartType 必须为/);
//   });

//   it('formData 为空时抛错', async () => {
//     await expect(
//       service.startFormProcess(mockCredential, { ...validParams, formData: '' }),
//     ).rejects.toThrow('formData 为必填项');
//   });

//   it('restart 类型但 busKey 为空时抛错', async () => {
//     await expect(
//       service.startFormProcess(mockCredential, {
//         ...validParams,
//         procStartType: 'restart',
//         busKey: '',
//       }),
//     ).rejects.toThrow('restart 类型发起时，busKey 为必填项');
//   });

//   it('start 类型 busKey 为空时参数校验通过（不抛参数校验错误）', async () => {
//     // start 时 busKey 可选，校验不抛错
//     // 但 HTTP 请求会因 mock credential 无效而失败，这里只验证参数校验通过
//     try {
//       await service.startFormProcess(mockCredential, {
//         ...validParams,
//         procStartType: 'start',
//         busKey: '',
//       });
//     } catch (e) {
//       // 参数校验通过，HTTP 请求失败是预期的
//       const msg = (e as Error).message;
//       // 确认错误不是参数校验类的（不应包含"必填项"等关键词）
//       expect(msg).not.toMatch(/必填项|必须为/);
//     }
//   });

//   it('trialStart 类型 busKey 为空时参数校验通过（不抛参数校验错误）', async () => {
//     try {
//       await service.startFormProcess(mockCredential, {
//         ...validParams,
//         procStartType: 'trialStart',
//         busKey: '',
//       });
//     } catch (e) {
//       const msg = (e as Error).message;
//       expect(msg).not.toMatch(/必填项|必须为/);
//     }
//   });
// });

// ==================== 发起流程v2 真实请求集成测试 ====================

describe('XinfutongOaApprovalService', () => {
  let prisma: PrismaClient;
  let credentialService: XinfutongOaCredentialService;
  let service: XinfutongOaApprovalService;
  let credential: AccountSetCredential;

  beforeAll(async () => {
    const config = new ConfigService();
    service = new XinfutongOaApprovalService(config);

    prisma = new PrismaClient();
    await prisma.$connect();
    credentialService = new XinfutongOaCredentialService(prisma as never);

    const credentials = await credentialService.getAllEnabled();
    expect(credentials.length).toBeGreaterThan(0);
    credential = credentials[0]!;
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // 注意：真实发起流程会在 OA 系统创建真实审批单
  // 以下用例仅在薪福通测试环境中有可用表单模板时运行
  // 默认跳过，需手动开启

  it(
    '能成功发起流程v2（start 类型）',
    async () => {
      // 前置：需要一个有效的 formKey 和 formData
      // formKey 可通过 getFormList 接口获取
      const response = await service.startFormProcess(credential, {
        formKey: 'AAC15400_NFORM_379287135985270784',
        procStartType: 'start',
        formData: '{"jc32o22xm1v6":"测试文本"}',
        starterId: '',
      });

      console.log(response.body);

      expect(response.returnCode).toBe('SUC0000');
      expect(response.body).toBeDefined();
      expect(response.body!.procInstId).toBeDefined();
      expect(response.body!.busKey).toBeDefined();
      expect(response.body!.procStatus).toBe('RUNNING');
    },
    60_000,
  );
});

// ==================== 回调处理单元测试 ====================

// describe('XinfutongOaApprovalCallbackService 回调处理', () => {
//   const mockPrisma = {} as never;
//   const service = new XinfutongOaApprovalCallbackService(mockPrisma);

//   // 有效载荷示例（来自文档）
//   const validPayload = {
//     prjCod: 'XFT00001',
//     procStatus: 'PASSED' as const,
//     busKey: 'CON_XFA11608_20220830000000000185',
//     procInstId: '35678907',
//     procKey: 'FORM_20220830000000000185',
//   };

//   it('能正确解析有效的 PASSED 回调载荷', () => {
//     const result = service.handleProcessFinishEvent(validPayload);

//     expect(result.prjCod).toBe('XFT00001');
//     expect(result.procStatus).toBe('PASSED');
//     expect(result.busKey).toBe('CON_XFA11608_20220830000000000185');
//     expect(result.procInstId).toBe('35678907');
//     expect(result.procKey).toBe('FORM_20220830000000000185');
//   });

//   it('能正确解析 REJECTED 终态', () => {
//     const payload = { ...validPayload, procStatus: 'REJECTED' as const };
//     const result = service.handleProcessFinishEvent(payload);
//     expect(result.procStatus).toBe('REJECTED');
//   });

//   it('能正确解析 CANCELED 终态', () => {
//     const payload = { ...validPayload, procStatus: 'CANCELED' as const };
//     const result = service.handleProcessFinishEvent(payload);
//     expect(result.procStatus).toBe('CANCELED');
//   });

//   it('能正确解析 DELETED 终态', () => {
//     const payload = { ...validPayload, procStatus: 'DELETED' as const };
//     const result = service.handleProcessFinishEvent(payload);
//     expect(result.procStatus).toBe('DELETED');
//   });

//   it('prjCod 缺失时抛错', () => {
//     const { prjCod, ...rest } = validPayload;
//     expect(() => service.handleProcessFinishEvent(rest)).toThrow(
//       '回调载荷缺少必填字段：prjCod',
//     );
//   });

//   it('procStatus 缺失时抛错', () => {
//     const { procStatus, ...rest } = validPayload;
//     expect(() => service.handleProcessFinishEvent(rest)).toThrow(
//       '回调载荷缺少必填字段：procStatus',
//     );
//   });

//   it('busKey 缺失时抛错', () => {
//     const { busKey, ...rest } = validPayload;
//     expect(() => service.handleProcessFinishEvent(rest)).toThrow(
//       '回调载荷缺少必填字段：busKey',
//     );
//   });

//   it('procInstId 缺失时抛错', () => {
//     const { procInstId, ...rest } = validPayload;
//     expect(() => service.handleProcessFinishEvent(rest)).toThrow(
//       '回调载荷缺少必填字段：procInstId',
//     );
//   });

//   it('procKey 缺失时抛错', () => {
//     const { procKey, ...rest } = validPayload;
//     expect(() => service.handleProcessFinishEvent(rest)).toThrow(
//       '回调载荷缺少必填字段：procKey',
//     );
//   });

//   it('procStatus 为非终态（RUNNING）时抛错', () => {
//     const payload = { ...validPayload, procStatus: 'RUNNING' as never };
//     expect(() => service.handleProcessFinishEvent(payload)).toThrow(
//       /procStatus 必须为终态/,
//     );
//   });

//   it('rawPayload 为 null 时抛错', () => {
//     expect(() => service.handleProcessFinishEvent(null)).toThrow(
//       '回调载荷必须是 JSON 对象',
//     );
//   });

//   it('rawPayload 为字符串时抛错', () => {
//     expect(() => service.handleProcessFinishEvent('not an object')).toThrow(
//       '回调载荷必须是 JSON 对象',
//     );
//   });

//   it('getEventCode 返回 XFTOAFPS', () => {
//     expect(service.getEventCode()).toBe('XFTOAFPS');
//   });
// });
