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

import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
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
import type { FormStartParams, FileUploadParams, ProcInstDealParams } from './approval.types';
import {
  FILE_UPLOAD_ALLOWED_EXTENSIONS,
  FILE_UPLOAD_FILENAME_MAX_LENGTH,
  FILE_UPLOAD_MAX_SIZE,
  PROC_INST_DEAL_PATH,
} from './approval.types';

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
loadEnvOverride(resolve(process.cwd(), '.env'));

// ==================== 审批流程处理参数校验单元测试 ====================

describe('XinfutongOaApprovalService 审批流程处理参数校验', () => {
  const config = new ConfigService();
  const service = new XinfutongOaApprovalService(config);

  const mockCredential: AccountSetCredential = {
    id: 1n,
    name: 'test',
    appId: 'testAppId',
    appSecret: 'testSecret',
  };

  const passParams: ProcInstDealParams = {
    approverId: 'V1234',
    operateType: 'pass',
    busKey: 'FORM_123456',
    taskId: '123456',
  };

  it('approverId 为空时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, { ...passParams, approverId: '' }),
    ).rejects.toThrow('approverId 为必填项');
  });

  it('operateType 为空时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, {
        ...passParams,
        operateType: '' as ProcInstDealParams['operateType'],
      }),
    ).rejects.toThrow('operateType 为必填项');
  });

  it('operateType 为非法值时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, {
        ...passParams,
        operateType: 'invalid' as ProcInstDealParams['operateType'],
      }),
    ).rejects.toThrow(/operateType 必须为/);
  });

  it('busKey 为空时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, { ...passParams, busKey: '' }),
    ).rejects.toThrow('busKey 为必填项');
  });

  it('通过操作缺少 taskId 时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, { ...passParams, taskId: undefined }),
    ).rejects.toThrow('通过、提交、否决、转派、加签操作时，taskId 为必填项');
  });

  it('通过操作 taskId 为空字符串时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, { ...passParams, taskId: '' }),
    ).rejects.toThrow('通过、提交、否决、转派、加签操作时，taskId 为必填项');
  });

  it('退回操作缺少 backNodeId 时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, {
        approverId: 'V1234',
        operateType: 'back',
        busKey: 'FORM_123456',
      }),
    ).rejects.toThrow('退回操作时，backNodeId 为必填项');
  });

  it('转派操作缺少 transferApproverId 时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, {
        ...passParams,
        operateType: 'transfer',
        transferApproverId: '',
      }),
    ).rejects.toThrow('转派操作时，transferApproverId 为必填项');
  });

  it('加签操作缺少 addSignType 时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, {
        ...passParams,
        operateType: 'addSign',
        addSignApproverIdList: ['U1234'],
      }),
    ).rejects.toThrow(/加签操作时，addSignType 必须为/);
  });

  it('加签操作 addSignType 非法时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, {
        ...passParams,
        operateType: 'addSign',
        addSignType: 'INVALID' as ProcInstDealParams['addSignType'],
        addSignApproverIdList: ['U1234'],
      }),
    ).rejects.toThrow(/加签操作时，addSignType 必须为/);
  });

  it('加签操作加签人为空时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, {
        ...passParams,
        operateType: 'addSign',
        addSignType: 'FRONT',
        addSignApproverIdList: [],
      }),
    ).rejects.toThrow('加签操作时，addSignApproverIdList 不能为空');
  });

  it('加签操作加签人仅含空字符串时抛错', async () => {
    await expect(
      service.dealProcess(mockCredential, {
        ...passParams,
        operateType: 'addSign',
        addSignType: 'FRONT',
        addSignApproverIdList: [''],
      }),
    ).rejects.toThrow('加签操作时，addSignApproverIdList 不能为空');
  });

  it('通过操作会提交必填字段', async () => {
    const post = vi.spyOn(service, 'post').mockResolvedValue({
      returnCode: 'SUC0000',
      body: { busKey: 'FORM_123456', procStatus: 'RUNNING' },
    });

    const response = await service.dealProcess(mockCredential, {
      ...passParams,
      approveComment: '同意',
    });

    expect(response.returnCode).toBe('SUC0000');
    expect(post).toHaveBeenCalledWith(PROC_INST_DEAL_PATH, mockCredential, {
      approverId: 'V1234',
      operateType: 'pass',
      busKey: 'FORM_123456',
      taskId: '123456',
      approveComment: '同意',
    });
    post.mockRestore();
  });

  it('撤销操作不要求 taskId', async () => {
    const post = vi.spyOn(service, 'post').mockResolvedValue({
      returnCode: 'SUC0000',
      body: { busKey: 'FORM_123456', procStatus: 'CANCELED' },
    });

    await service.dealProcess(mockCredential, {
      approverId: 'V1234',
      operateType: 'cancel',
      busKey: 'FORM_123456',
    });

    expect(post).toHaveBeenCalledWith(PROC_INST_DEAL_PATH, mockCredential, {
      approverId: 'V1234',
      operateType: 'cancel',
      busKey: 'FORM_123456',
    });
    post.mockRestore();
  });

  it('退回操作提交 backNodeId', async () => {
    const post = vi.spyOn(service, 'post').mockResolvedValue({
      returnCode: 'SUC0000',
      body: { busKey: 'FORM_123456', procStatus: 'BACKTOSTART' },
    });

    await service.dealProcess(mockCredential, {
      approverId: 'V1234',
      operateType: 'back',
      busKey: 'FORM_123456',
      backNodeId: 'restart',
      approveComment: '退回修改',
    });

    expect(post).toHaveBeenCalledWith(PROC_INST_DEAL_PATH, mockCredential, {
      approverId: 'V1234',
      operateType: 'back',
      busKey: 'FORM_123456',
      backNodeId: 'restart',
      approveComment: '退回修改',
    });
    post.mockRestore();
  });
});

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

const describeExternal =
  process.env.RUN_EXTERNAL_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describeExternal('XinfutongOaApprovalService 发起流程', () => {
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

    const credentials = await credentialService.getById(BigInt(2));
    expect(credentials).toBeDefined();
    credential = credentials!;
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
      const filesArr =[  
          {  
              "id": "OAFL-20260808182952141-zJSbbqo", // fileId，文件id  
              "objectKey": "OAFL-cb586165-ae65-485b-ba5d-04b951b21ce4",  
              "name": "测试文件.pdf" // 文件名  
          },
          {  
            "id": "OAFL-20260808182952415-aWZSXxz", // fileId，文件id  
            "objectKey": "OAFL-67a60e67-1ce5-4e14-ae9c-d869e27a851d",  
            "name": "测试图片.jpg" // 文件名  
        }
      ] ;
      
      const response = await service.startFormProcess(credential, {
        formKey: 'AAC22502_NFORM_379451564510347266',
        procStartType: 'trialStart',
        formData: `{"hxvvnrk6daq5":"测试文本22", "ud58jnh9xhwe":"10", "1slqa8j2o2vj":${JSON.stringify(filesArr)}}`,
        starterId: 'V001C',
      });

      console.log(response.body);
      // 结果写入文件
      const fs = require('node:fs');
      fs.writeFileSync(
        resolve(process.cwd(), '../../docs/integrations/xinfutong-oa/return-result/trial-start-form-process.json'),
        JSON.stringify(response.body, null, 2),
      );

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

// ==================== 文件上传参数校验单元测试 ====================

// describe('XinfutongOaApprovalService 文件上传参数校验', () => {
//   const config = new ConfigService();
//   const service = new XinfutongOaApprovalService(config);

//   const mockCredential: AccountSetCredential = {
//     id: 1n,
//     name: 'test',
//     appId: 'testAppId',
//     appSecret: 'testSecret',
//   };

//   /** 构造合法的文件上传参数 */
//   const validParams: FileUploadParams = {
//     fileName: '测试文件.pdf',
//     fileBuffer: Buffer.from('test file content'),
//   };

//   it('fileName 为空字符串时抛错', async () => {
//     await expect(
//       service.uploadFile(mockCredential, { ...validParams, fileName: '' }),
//     ).rejects.toThrow('fileName 为必填项');
//   });

//   it('fileName 超过最大长度时抛错', async () => {
//     const longName = 'a'.repeat(FILE_UPLOAD_FILENAME_MAX_LENGTH + 1) + '.pdf';
//     await expect(
//       service.uploadFile(mockCredential, { ...validParams, fileName: longName }),
//     ).rejects.toThrow(
//       `附件名称长度不能超过 ${FILE_UPLOAD_FILENAME_MAX_LENGTH}`,
//     );
//   });

//   it('fileName 恰好等于最大长度时参数校验通过', async () => {
//     // 文件名长度恰好 100，校验不抛参数错误（HTTP 请求会因 mock credential 失败）
//     const maxLenName = 'a'.repeat(FILE_UPLOAD_FILENAME_MAX_LENGTH - 4) + '.pdf';
//     try {
//       await service.uploadFile(mockCredential, {
//         ...validParams,
//         fileName: maxLenName,
//       });
//     } catch (e) {
//       const msg = (e as Error).message;
//       expect(msg).not.toMatch(/fileName 为必填项|附件名称长度/);
//     }
//   });

//   it('fileBuffer 为空 Buffer 时抛错', async () => {
//     await expect(
//       service.uploadFile(mockCredential, { ...validParams, fileBuffer: Buffer.alloc(0) }),
//     ).rejects.toThrow('fileBuffer 为必填项且不能为空');
//   });

//   it('fileBuffer 超过 20MB 时抛错', async () => {
//     const oversizedBuffer = Buffer.alloc(FILE_UPLOAD_MAX_SIZE + 1);
//     await expect(
//       service.uploadFile(mockCredential, { ...validParams, fileBuffer: oversizedBuffer }),
//     ).rejects.toThrow('文件大小不能超过 20MB');
//   });

//   it('fileBuffer 恰好等于 20MB 时参数校验通过', async () => {
//     const exactSizeBuffer = Buffer.alloc(FILE_UPLOAD_MAX_SIZE);
//     try {
//       await service.uploadFile(mockCredential, {
//         ...validParams,
//         fileBuffer: exactSizeBuffer,
//       });
//     } catch (e) {
//       const msg = (e as Error).message;
//       expect(msg).not.toMatch(/fileBuffer 为必填项|文件大小不能超过/);
//     }
//   });

//   it('文件名没有扩展名时抛错', async () => {
//     await expect(
//       service.uploadFile(mockCredential, { ...validParams, fileName: 'noextension' }),
//     ).rejects.toThrow('文件名必须包含扩展名');
//   });

//   it('不允许的文件扩展名时抛错', async () => {
//     await expect(
//       service.uploadFile(mockCredential, { ...validParams, fileName: '恶意文件.exe' }),
//     ).rejects.toThrow(/不允许的文件类型：EXE/);
//   });

//   it('扩展名大小写不敏感（小写 jpg 应通过校验）', async () => {
//     try {
//       await service.uploadFile(mockCredential, {
//         ...validParams,
//         fileName: 'photo.jpg',
//       });
//     } catch (e) {
//       const msg = (e as Error).message;
//       expect(msg).not.toMatch(/不允许的文件类型/);
//     }
//   });

//   it('扩展名大小写不敏感（大写 PNG 应通过校验）', async () => {
//     try {
//       await service.uploadFile(mockCredential, {
//         ...validParams,
//         fileName: 'image.PNG',
//       });
//     } catch (e) {
//       const msg = (e as Error).message;
//       expect(msg).not.toMatch(/不允许的文件类型/);
//     }
//   });

//   it('允许的常见文件类型校验通过（DOCX）', async () => {
//     try {
//       await service.uploadFile(mockCredential, {
//         ...validParams,
//         fileName: '文档.docx',
//       });
//     } catch (e) {
//       const msg = (e as Error).message;
//       expect(msg).not.toMatch(/不允许的文件类型/);
//     }
//   });

//   it('允许的常见文件类型校验通过（XLSX）', async () => {
//     try {
//       await service.uploadFile(mockCredential, {
//         ...validParams,
//         fileName: '表格.xlsx',
//       });
//     } catch (e) {
//       const msg = (e as Error).message;
//       expect(msg).not.toMatch(/不允许的文件类型/);
//     }
//   });

//   it('允许的常见文件类型校验通过（ZIP）', async () => {
//     try {
//       await service.uploadFile(mockCredential, {
//         ...validParams,
//         fileName: '压缩包.zip',
//       });
//     } catch (e) {
//       const msg = (e as Error).message;
//       expect(msg).not.toMatch(/不允许的文件类型/);
//     }
//   });
// });

// // ==================== 文件上传真实请求集成测试 ====================

// describe('XinfutongOaApprovalService 文件上传集成测试', () => {
//   let prisma: PrismaClient;
//   let credentialService: XinfutongOaCredentialService;
//   let service: XinfutongOaApprovalService;
//   let credential: AccountSetCredential;

//   beforeAll(async () => {
//     const config = new ConfigService();
//     service = new XinfutongOaApprovalService(config);

//     prisma = new PrismaClient();
//     await prisma.$connect();
//     credentialService = new XinfutongOaCredentialService(prisma as never);

//     const credentials = await credentialService.getById(BigInt(2));
//     expect(credentials).toBeDefined();
//     credential = credentials!;
//   }, 30_000);

//   afterAll(async () => {
//     await prisma?.$disconnect();
//   });

//   it(
//     '能成功上传 PDF 文件',
//     async () => {
//       // 构造一个简单的 PDF 文件内容（PDF 头部 + 空内容）
//       const pdfContent = Buffer.from(
//         '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n109\n%%EOF',
//       );

//       const response = await service.uploadFile(credential, {
//         fileName: '测试文件.pdf',
//         fileBuffer: pdfContent,
//       });

//       console.log('文件上传结果:', response.body);

//       // 结果写入文件
//       const fs = require('node:fs');
//       fs.writeFileSync(
//         resolve(
//           process.cwd(),
//           '../../docs/integrations/xinfutong-oa/return-result/file-upload.json',
//         ),
//         JSON.stringify(response.body, null, 2),
//       );

//       expect(response.returnCode).toBe('SUC0000');
//       expect(response.body).toBeDefined();
//       expect(response.body!.fileId).toBeDefined();
//       expect(response.body!.fileUrl).toBeDefined();
//       expect(response.body!.fileType).toBe('pdf');
//       expect(response.body!.fileName).toBe('测试文件.pdf');
//     },
//     60_000,
//   );

//   it(
//     '能成功上传 JPG 图片文件',
//     async () => {
//       // 构造一个最小的 JPEG 文件（SOI + EOI 标记）
//       const jpgContent = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);

//       const response = await service.uploadFile(credential, {
//         fileName: '测试图片.jpg',
//         fileBuffer: jpgContent,
//       });

//       console.log('图片上传结果:', response.body);

//       expect(response.returnCode).toBe('SUC0000');
//       expect(response.body).toBeDefined();
//       expect(response.body!.fileId).toBeDefined();
//       expect(response.body!.fileType).toBe('jpg');
//     },
//     60_000,
//   );
// });
