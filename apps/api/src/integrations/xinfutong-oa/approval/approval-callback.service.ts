import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { sm2Verify, sm4Decrypt } from '../core/crypto';
import {
  EVENT_CODE_OA_PROCESS_FINISH,
  type ApprovalCallbackPayload,
  type FinalProcStatus,
} from './approval.types';
import {
  buildEventCallbackSignText,
  OaEventVerifyError,
  parseEventEnvelope,
} from './event-envelope';

/**
 * 薪福通 OA 审批回调入站处理服务
 *
 * 职责：接收薪福通 OA 审批流程结束事件回调，解析并分发业务处理。
 *
 * 与 XinfutongOaApprovalService 的区别：
 * - ApprovalService 是出站：本平台 → OA（发起/查询）
 * - ApprovalCallbackService 是入站：OA → 本平台（流程结束通知）
 *
 * 回调事件：
 * - 事件编号 XFT00000：连接测试，由 Controller 直接成功回包
 * - 事件编号 XFTOAFPS：OA 审批流程结束事件
 * - 触发时机：流程到达终态（PASSED/REJECTED/CANCELED/DELETED）
 *
 * 使用方式（由 Controller 调用）：
 *   const inner = callbackService.verifyAndDecryptEvent(rawPayload, rawBody);
 *   const result = callbackService.handleProcessFinishEvent(inner);
 *   // result.procStatus 终态
 *   // result.busKey 业务编号，用于关联本地单据
 *   // result.procInstId 流程实例 id
 */
@Injectable()
export class XinfutongOaApprovalCallbackService {
  private static readonly logger = new Logger(XinfutongOaApprovalCallbackService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  // ==================== 事件订阅验签与解密 ====================

  /**
   * 校验事件签名并解密 eventRcdInf
   *
   * @param rawPayload 解析后的 JSON 对象
   * @param rawBody 原始请求体，用于保留 eventCd 的 Long 数字原文
   */
  verifyAndDecryptEvent(rawPayload: unknown, rawBody?: string): unknown {
    const envelope = parseEventEnvelope(rawPayload);
    const publicKey = this.eventPublicKey;
    const signText = buildEventCallbackSignText(envelope, rawBody);
    if (!sm2Verify(signText, envelope.signature, publicKey)) {
      throw new OaEventVerifyError('验签失败');
    }
    try {
      const plainText = sm4Decrypt(envelope.eventRcdInf, publicKey);
      return JSON.parse(plainText) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new OaEventVerifyError(`事件数据解密失败：${message}`);
    }
  }

  private get eventPublicKey(): string {
    const publicKey = this.config.get<string>('XINFUTONG_OA_EVENT_PUBLIC_KEY', '')?.trim() ?? '';
    if (!publicKey) {
      throw new OaEventVerifyError('未配置事件验签公钥');
    }
    if (publicKey.length !== 130) {
      throw new OaEventVerifyError('事件验签公钥格式不正确');
    }
    return publicKey;
  }

  // ==================== 流程结束事件 ====================

  /**
   * 处理 OA 审批流程结束事件回调
   *
   * @param rawPayload 原始回调报文（Controller 从 HTTP body 中解析的 JSON 对象）
   * @returns 解析后的回调载荷（供上层业务使用）
   * @throws 回调载荷校验失败时抛出
   */
  handleProcessFinishEvent(rawPayload: unknown): ApprovalCallbackPayload {
    const payload = this.parseAndValidate(rawPayload);

    XinfutongOaApprovalCallbackService.logger.log(
      `收到流程结束事件：busKey=${payload.busKey}，procInstId=${payload.procInstId}，procStatus=${payload.procStatus}`,
    );

    // TODO: 业务逻辑由调用方实现（如更新本地审批单状态、触发后续流程）
    // 此处仅完成协议层的解析与校验，不涉及业务落库

    return payload;
  }

  // ==================== 解析与校验 ====================

  /**
   * 解析并校验回调载荷
   *
   * @param rawPayload 原始数据
   * @returns 校验通过的回调载荷
   * @throws 字段缺失或类型错误时抛出
   */
  private parseAndValidate(rawPayload: unknown): ApprovalCallbackPayload {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new Error('回调载荷必须是 JSON 对象');
    }

    const obj = rawPayload as Record<string, unknown>;

    const prjCod = obj.prjCod as string | undefined;
    const procStatus = obj.procStatus as FinalProcStatus | undefined;
    const busKey = obj.busKey as string | undefined;
    const procInstId = obj.procInstId as string | undefined;
    const procKey = obj.procKey as string | undefined;

    if (!prjCod) {
      throw new Error('回调载荷缺少必填字段：prjCod（企业号）');
    }
    if (!procStatus) {
      throw new Error('回调载荷缺少必填字段：procStatus（流程状态）');
    }
    if (!busKey) {
      throw new Error('回调载荷缺少必填字段：busKey（业务编号）');
    }
    if (!procInstId) {
      throw new Error('回调载荷缺少必填字段：procInstId（审批编号）');
    }
    if (!procKey) {
      throw new Error('回调载荷缺少必填字段：procKey（流程Key）');
    }

    const validStatuses: FinalProcStatus[] = ['PASSED', 'REJECTED', 'CANCELED', 'DELETED'];
    if (!validStatuses.includes(procStatus)) {
      throw new Error(
        `回调载荷 procStatus 必须为终态（${validStatuses.join('、')}），当前值：${procStatus}`,
      );
    }

    return { prjCod, procStatus, busKey, procInstId, procKey };
  }

  // ==================== 辅助方法 ====================

  /**
   * 获取事件编号（供 Controller 日志/路由匹配使用）
   */
  getEventCode(): string {
    return EVENT_CODE_OA_PROCESS_FINISH;
  }
}
