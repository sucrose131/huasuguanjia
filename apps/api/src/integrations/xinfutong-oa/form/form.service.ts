import { Injectable } from '@nestjs/common';
import { XinfutongOaClient } from '../core/client';
import type { AccountSetCredential } from '../core/credential.service';
import type { XinfutongResponse } from '../core/types';
import {
  FORM_CONFIG_PATH,
  FORM_DATA_LIST_PATH,
  FORM_DATA_QUERY_MAX,
  FORM_LIST_PATH,
  type FormCategory,
  type FormConfig,
  type FormConfigQueryParams,
  type FormDataListQueryParams,
  type FormDataRecord,
  type FormListQueryParams,
} from './form.types';

/**
 * 薪福通 OA 表单域服务
 *
 * 职责：提供表单列表、表单数据、表单配置信息的查询能力。
 *
 * 继承 XinfutongOaClient 复用基础请求层（签名/加解密/HTTP/assertSuccess）。
 *
 * 对应接口：
 * - 获取表单列表：/xft-oa/openapi/xft-oaquery/form/query-list
 * - 获取表单数据：/xft-oa/openapi/xft-oaquery/form-data/query-list
 * - 获取表单配置信息：/xft-oa/openapi/xft-oaquery/form-config/query
 */
@Injectable()
export class XinfutongOaFormService extends XinfutongOaClient {
  // ==================== 表单列表查询 ====================

  /**
   * 查询表单列表
   *
   * 通过表单名称模糊查询该企业下的所有表单列表相关信息。
   * 返回结果按分类分组，每个分类下包含该分类的表单列表。
   *
   * @param credential 账套凭证
   * @param params 查询条件（formName 可选，不传则查全部分类与表单）
   * @returns 接口响应数据（body 为分类数组，每个分类含 formInfoList）
   */
  async getFormList(
    credential: AccountSetCredential,
    params: FormListQueryParams = {},
  ): Promise<XinfutongResponse<FormCategory[]>> {
    const body = this.filterEmpty({
      formName: params.formName,
    });

    const response = await this.post<FormCategory[]>(FORM_LIST_PATH, credential, body);
    this.assertSuccess(response);
    return response;
  }

  // ==================== 表单数据查询 ====================

  /**
   * 查询表单数据
   *
   * 通过流程实例 id 集合或业务编号集合查询表单数据。
   * busKeyList 与 procInstIdList 至少传一个，每个集合最多 300 个。
   *
   * @param credential 账套凭证
   * @param params 查询条件
   * @returns 接口响应数据（body 为表单数据记录数组）
   * @throws 两个集合均为空或超过 300 个时抛出
   */
  async getFormDataList(
    credential: AccountSetCredential,
    params: FormDataListQueryParams,
  ): Promise<XinfutongResponse<FormDataRecord[]>> {
    const busKeyList = params.busKeyList ?? [];
    const procInstIdList = params.procInstIdList ?? [];

    if (busKeyList.length === 0 && procInstIdList.length === 0) {
      throw new Error('busKeyList 和 procInstIdList 至少传一个');
    }

    if (busKeyList.length > FORM_DATA_QUERY_MAX) {
      throw new Error(
        `业务编号集合数量不能超过 ${FORM_DATA_QUERY_MAX}，当前值：${busKeyList.length}`,
      );
    }

    if (procInstIdList.length > FORM_DATA_QUERY_MAX) {
      throw new Error(
        `流程实例 id 集合数量不能超过 ${FORM_DATA_QUERY_MAX}，当前值：${procInstIdList.length}`,
      );
    }

    const body = this.filterEmpty({
      busKeyList,
      procInstIdList,
    });

    const response = await this.post<FormDataRecord[]>(FORM_DATA_LIST_PATH, credential, body);
    this.assertSuccess(response);
    return response;
  }

  // ==================== 表单配置信息查询 ====================

  /**
   * 查询表单配置信息
   *
   * 通过 formId 或 formKey 查询表单配置信息，两个参数二选一。
   * formConfig 字段为 JSON 字符串，由调用方自行解析。
   *
   * @param credential 账套凭证
   * @param params 查询条件（formId 与 formKey 二选一）
   * @returns 接口响应数据（body 为表单配置对象）
   * @throws formId 和 formKey 均为空时抛出
   */
  async getFormConfig(
    credential: AccountSetCredential,
    params: FormConfigQueryParams,
  ): Promise<XinfutongResponse<FormConfig>> {
    const hasFormId = params.formId !== undefined && params.formId !== '';
    const hasFormKey = params.formKey !== undefined && params.formKey !== '';

    if (!hasFormId && !hasFormKey) {
      throw new Error('formId 和 formKey 至少传一个');
    }

    const body = this.filterEmpty({
      formId: params.formId,
      formKey: params.formKey,
    });

    const response = await this.post<FormConfig>(FORM_CONFIG_PATH, credential, body);
    this.assertSuccess(response);
    return response;
  }
}
