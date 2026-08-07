import { Injectable } from '@nestjs/common';
import { XinfutongOaClient } from '../core/client';
import type { AccountSetCredential } from '../core/credential.service';
import type { XinfutongResponse } from '../core/types';
import {
  FORM_START_PATH,
  type FormStartParams,
  type FormStartResult,
} from './approval.types';

/**
 * 薪福通 OA 审批域出站服务
 *
 * 职责：向薪福通 OA 发起审批流程。
 *
 * 继承 XinfutongOaClient 复用基础请求层（签名/加解密/HTTP/assertSuccess）。
 *
 * 对应接口：
 * - 发起流程v2：/xft-oa/openapi/xft-newform/open/form-start
 *
 * 入站回调处理见 ApprovalCallbackService。
 */
@Injectable()
export class XinfutongOaApprovalService extends XinfutongOaClient {
  // ==================== 发起流程v2 ====================

  /**
   * 发起流程v2
   *
   * 向薪福通 OA 发起审批流程，支持三种发起类型：
   * - start：正式发起
   * - trialStart：试算发起（预校验流程路径）
   * - restart：重新发起（基于已有流程重新发起）
   *
   * @param credential 账套凭证
   * @param params 发起参数
   * @returns 接口响应数据（body 为流程发起结果，含 procInstId、todoTaskList 等）
   * @throws 参数校验失败或接口返回错误时抛出
   */
  async startFormProcess(
    credential: AccountSetCredential,
    params: FormStartParams,
  ): Promise<XinfutongResponse<FormStartResult>> {
    this.validateStartFormParams(params);

    const body = this.filterEmpty({
      formKey: params.formKey,
      busKey: params.busKey,
      procStartType: params.procStartType,
      formData: params.formData,
      trialId: params.trialId,
      starterOrgId: params.starterOrgId,
      startParams: params.startParams,
      agentStarterId: params.agentStarterId,
      starterId: params.starterId,
    });

    const response = await this.post<FormStartResult>(FORM_START_PATH, credential, body);
    this.assertSuccess(response);
    return response;
  }

  // ==================== 参数校验 ====================

  /**
   * 校验发起流程v2 请求参数
   *
   * @param params 发起参数
   * @throws 参数校验失败时抛出
   */
  private validateStartFormParams(params: FormStartParams): void {
    if (!params.formKey) {
      throw new Error('formKey 为必填项');
    }

    if (!params.procStartType) {
      throw new Error('procStartType 为必填项');
    }

    const validTypes = ['start', 'trialStart', 'restart'];
    if (!validTypes.includes(params.procStartType)) {
      throw new Error(
        `procStartType 必须为 ${validTypes.join('、')} 之一，当前值：${params.procStartType}`,
      );
    }

    if (!params.formData) {
      throw new Error('formData 为必填项');
    }

    if (params.procStartType === 'restart' && !params.busKey) {
      throw new Error('restart 类型发起时，busKey 为必填项');
    }
  }
}
