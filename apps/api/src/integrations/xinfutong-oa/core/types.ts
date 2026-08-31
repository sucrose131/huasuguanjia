/**
 * 薪福通 OA 协议层类型定义
 *
 * 仅包含与 HTTP 协议/网关/分页结构相关的通用类型，
 * 业务域类型（组织/职位/成员/审批等）放在各自业务域目录下的 types.ts。
 */

/**
 * 薪福通接口标准响应格式
 *
 * 对应 PHP 版 assertSuccess 中校验的格式：
 *   - 标准格式：{ returnCode, errorMsg, body }
 *   - 网关错误格式：{ SYCOMRETZ: [{ ERRCOD, ERRMSG, ERRDTL, ERRPAM }] }
 */
export interface XinfutongResponse<T = unknown> {
  /** 返回码（SUC0000 表示成功） */
  returnCode?: string;
  /** 错误信息 */
  errorMsg?: string | null;
  /** 业务数据 */
  body?: T;
  /** 网关错误时的错误信息集合 */
  SYCOMRETZ?: XinfutongGatewayError[];
}

/**
 * 网关错误信息
 */
export interface XinfutongGatewayError {
  ERRCOD?: string;
  ERRMSG?: string;
  ERRDTL?: string;
  ERRPAM?: string;
}

/**
 * 分页响应数据
 *
 * 对应 PHP 版各查询接口的 body 结构
 */
export interface XinfutongPageBody<T = unknown> {
  /** 当前页 */
  currentPage?: number;
  /** 每页大小 */
  pageSize?: number;
  /** 总记录数 */
  totalSize?: number;
  /** 记录集合 */
  records?: T[];
}

/**
 * 请求选项（基础请求方法共用）
 */
export interface XinfutongRequestOptions {
  /** 额外的 query 参数 */
  extraQuery?: Record<string, string>;
  /** 请求超时时间（毫秒，默认 60000） */
  timeout?: number;
}

/** 接口调用成功返回码 */
export const RETURN_CODE_SUCCESS = 'SUC0000';
