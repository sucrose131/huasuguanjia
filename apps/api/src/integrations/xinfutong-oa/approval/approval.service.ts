import { Injectable } from '@nestjs/common';
import { XinfutongOaClient } from '../core/client';
import type { AccountSetCredential } from '../core/credential.service';
import type { XinfutongResponse } from '../core/types';
import {
  ADD_SIGN_TYPES,
  FILE_UPLOAD_ALLOWED_EXTENSIONS,
  FILE_UPLOAD_FILENAME_MAX_LENGTH,
  FILE_UPLOAD_MAX_SIZE,
  FILE_UPLOAD_PATH,
  FORM_START_PATH,
  PROC_INST_DEAL_PATH,
  PROC_OPERATE_TYPES,
  PROC_OPERATE_TYPES_REQUIRE_TASK_ID,
  type FileUploadParams,
  type FileUploadResult,
  type FormStartParams,
  type FormStartResult,
  type ProcInstDealParams,
  type ProcInstDealResult,
} from './approval.types';

/**
 * 薪福通 OA 审批域出站服务
 *
 * 职责：向薪福通 OA 发起审批流程，以及对已发起流程执行处理操作。
 *
 * 继承 XinfutongOaClient 复用基础请求层（签名/加解密/HTTP/assertSuccess）。
 *
 * 对应接口：
 * - 发起流程v2：/xft-oa/openapi/xft-newform/open/form-start
 * - 审批流程处理：/xft-oa/openapi/xft-oa/open/operate/proc/inst/deal
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

  // ==================== 审批流程处理 ====================

  /**
   * 审批流程处理
   *
   * 对已发起的流程执行提交（办理节点）、通过、否决、转派、加签、退回、撤销。
   * 仅支持自定义流程及包含套件的系统表单。
   *
   * 条件必填（与官方错误码一致）：
   * - 退回：backNodeId
   * - 转派：transferApproverId
   * - 加签：addSignType、addSignApproverIdList
   * - 通过 / 提交 / 否决 / 转派 / 加签：taskId
   *
   * @param credential 账套凭证
   * @param params 流程处理参数
   * @returns 接口响应数据（body 含 procInstId、procStatus、todoTaskList 等）
   * @throws 参数校验失败或接口返回错误时抛出
   */
  async dealProcess(
    credential: AccountSetCredential,
    params: ProcInstDealParams,
  ): Promise<XinfutongResponse<ProcInstDealResult>> {
    this.validateDealProcessParams(params);

    const addSignApproverIdList = params.addSignApproverIdList?.filter((id) => Boolean(id));

    const body = this.filterEmpty({
      approverId: params.approverId,
      operateType: params.operateType,
      busKey: params.busKey,
      taskId: params.taskId,
      approveComment: params.approveComment,
      busData: params.busData,
      backNodeId: params.backNodeId,
      transferApproverId: params.transferApproverId,
      addSignType: params.addSignType,
      addSignApproverIdList,
      picAttachmentList: params.picAttachmentList,
      fileAttachmentList: params.fileAttachmentList,
      signKey: params.signKey,
    });

    const response = await this.post<ProcInstDealResult>(
      PROC_INST_DEAL_PATH,
      credential,
      body,
    );
    this.assertSuccess(response);
    return response;
  }

  // ==================== 文件上传 ====================

  /**
   * 上传文件
   *
   * 通过薪福通 OA 文件上传接口上传文件，获取文件下载链接。
   * 文件下载链接 7 天有效，过期后可通过 /file/download 接口使用 fileId 下载。
   *
   * 限制：
   * - 文件大小不超过 20MB
   * - 文件名长度不超过 100
   * - 仅支持指定格式（BMP, DOC, DOCX, PDF, PNG, JPG, XLS, XLSX, ZIP 等）
   *
   * @param credential 账套凭证
   * @param params 文件上传参数（fileName + fileBuffer 必填）
   * @returns 接口响应数据（body 含 fileId、fileUrl 等）
   * @throws 文件校验失败或接口返回错误时抛出
   */
  async uploadFile(
    credential: AccountSetCredential,
    params: FileUploadParams,
  ): Promise<XinfutongResponse<FileUploadResult>> {
    this.validateFileUploadParams(params);

    // 构建 FormData
    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(params.fileBuffer)]), params.fileName);

    const response = await this.postMultipart<FileUploadResult>(
      FILE_UPLOAD_PATH,
      credential,
      formData,
    );
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

  /**
   * 校验审批流程处理请求参数
   *
   * @param params 流程处理参数
   * @throws 参数校验失败时抛出
   */
  private validateDealProcessParams(params: ProcInstDealParams): void {
    if (!params.approverId) {
      throw new Error('approverId 为必填项');
    }

    if (!params.operateType) {
      throw new Error('operateType 为必填项');
    }

    if (!PROC_OPERATE_TYPES.includes(params.operateType)) {
      throw new Error(
        `operateType 必须为 ${PROC_OPERATE_TYPES.join('、')} 之一，当前值：${params.operateType}`,
      );
    }

    if (!params.busKey) {
      throw new Error('busKey 为必填项');
    }

    if (PROC_OPERATE_TYPES_REQUIRE_TASK_ID.has(params.operateType) && !this.hasTaskId(params.taskId)) {
      throw new Error('通过、提交、否决、转派、加签操作时，taskId 为必填项');
    }

    if (params.operateType === 'back' && !params.backNodeId) {
      throw new Error('退回操作时，backNodeId 为必填项');
    }

    if (params.operateType === 'transfer' && !params.transferApproverId) {
      throw new Error('转派操作时，transferApproverId 为必填项');
    }

    if (params.operateType === 'addSign') {
      if (!params.addSignType || !ADD_SIGN_TYPES.includes(params.addSignType)) {
        throw new Error(
          `加签操作时，addSignType 必须为 ${ADD_SIGN_TYPES.join('、')} 之一`,
        );
      }

      const approverIds = (params.addSignApproverIdList ?? []).filter((id) => Boolean(id));
      if (approverIds.length === 0) {
        throw new Error('加签操作时，addSignApproverIdList 不能为空');
      }
    }
  }

  /** taskId 文档类型为 LONG，示例为字符串；空字符串视为未传 */
  private hasTaskId(taskId: string | number | undefined): boolean {
    if (taskId === undefined || taskId === null) {
      return false;
    }
    if (typeof taskId === 'string') {
      return taskId.trim() !== '';
    }
    return true;
  }

  /**
   * 校验文件上传请求参数
   *
   * 校验规则：
   * - fileName 必填且长度不超过 100
   * - fileBuffer 必填且大小不超过 20MB
   * - 文件扩展名必须在允许列表中
   *
   * @param params 文件上传参数
   * @throws 参数校验失败时抛出
   */
  private validateFileUploadParams(params: FileUploadParams): void {
    if (!params.fileName) {
      throw new Error('fileName 为必填项');
    }

    if (params.fileName.length > FILE_UPLOAD_FILENAME_MAX_LENGTH) {
      throw new Error(
        `附件名称长度不能超过 ${FILE_UPLOAD_FILENAME_MAX_LENGTH}，当前长度：${params.fileName.length}`,
      );
    }

    if (!params.fileBuffer || params.fileBuffer.length === 0) {
      throw new Error('fileBuffer 为必填项且不能为空');
    }

    if (params.fileBuffer.length > FILE_UPLOAD_MAX_SIZE) {
      throw new Error(
        `文件大小不能超过 20MB，当前大小：${(params.fileBuffer.length / 1024 / 1024).toFixed(2)}MB`,
      );
    }

    // 提取扩展名（不区分大小写）
    const lastDotIdx = params.fileName.lastIndexOf('.');
    if (lastDotIdx === -1) {
      throw new Error('文件名必须包含扩展名');
    }
    const ext = params.fileName.slice(lastDotIdx + 1).toUpperCase();
    if (!FILE_UPLOAD_ALLOWED_EXTENSIONS.has(ext)) {
      throw new Error(
        `不允许的文件类型：${ext}，允许的类型：${[...FILE_UPLOAD_ALLOWED_EXTENSIONS].sort().join('、')}`,
      );
    }
  }
}
