import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountSetCredential } from './credential.service';
import {
  decryptBody,
  encryptBody,
  sm2Sign,
  sm3Digest,
  VERIFY_ALGORITHM,
} from './crypto';
import {
  RETURN_CODE_SUCCESS,
  type XinfutongGatewayError,
  type XinfutongRequestOptions,
  type XinfutongResponse,
} from './types';

/**
 * 薪福通 OA 基础请求客户端
 *
 * 提供薪福通开放平台 API 的基础请求方法，包括：
 * - 公共 query 参数构建
 * - 请求头构建（含 SM2 签名）
 * - 加密应用的 body 加解密
 * - HTTP GET/POST 请求发送
 * - 响应解密与返回码校验
 *
 * 凭证：走数据库 hspsi_sys_account_set，由 XinfutongOaCredentialService 提供。
 * 每次请求需传入对应的账套凭证，支持多账套遍历调用。
 *
 * 业务域服务（组织/职位/审批等）应继承本类复用基础请求能力。
 *
 * 对应 PHP 版 GetOADataCommand 中的 post() / get() / buildCommonQueryParams() / assertSuccess()。
 */
@Injectable()
export class XinfutongOaClient {
  private static readonly logger = new Logger(XinfutongOaClient.name);

  /** 默认请求超时（毫秒） */
  protected static readonly DEFAULT_TIMEOUT_MS = 60_000;

  constructor(@Inject(ConfigService) protected readonly config: ConfigService) {}

  /** 薪福通平台基础地址 */
  protected get baseUrl(): string {
    return this.config.getOrThrow<string>('XINFUTONG_OA_BASE_URL');
  }

  /** 是否为加密应用（加密应用需对 body 进行 SM4 加解密） */
  protected get encrypted(): boolean {
    return this.config.get<string>('XINFUTONG_OA_ENCRYPTED', 'true') !== 'false';
  }

  /** 企业号（可选，不传则默认取应用所属企业） */
  protected get cscPrjCod(): string | null {
    const val = this.config.get<string>('XINFUTONG_OA_CSC_PRJ_COD', '');
    return val || null;
  }

  /** 薪福通企业用户号（可选，定时任务可填 A0001） */
  protected get cscUsrNbr(): string {
    return this.config.get<string>('XINFUTONG_OA_CSC_USR_NBR', '') ?? '';
  }

  /** 薪福通平台用户号（可选，定时任务可填 AUTO0001） */
  protected get cscUsrUid(): string {
    return this.config.get<string>('XINFUTONG_OA_CSC_USR_UID', '') ?? '';
  }

  // ==================== 基础请求方法 ====================

  /**
   * 发送 POST 请求
   *
   * 对应 PHP 版 post()：
   * 1. 处理请求体：数组转 JSON，加密应用进行 SM4 加密包装
   * 2. 构建公共 query 参数
   * 3. 时间戳与 body 摘要
   * 4. 构建请求头（含 apisign 签名）
   * 5. 发送请求
   * 6. 解密响应体并解析
   *
   * @param path 接口路径，如 /ORG/orgqry/xft-service-organization/org/v1/get/page
   * @param credential 账套凭证（appId / appSecret）
   * @param body 请求体（对象会转为 JSON）
   * @param options 请求选项
   * @returns 接口返回的 JSON 数据
   * @throws 请求或解密失败时抛出
   */
  async post<T = unknown>(
    path: string,
    credential: AccountSetCredential,
    body: object | string,
    options?: XinfutongRequestOptions,
  ): Promise<XinfutongResponse<T>> {
    // 1. 处理请求体：对象转 JSON，加密应用进行 SM4 加密包装
    const rawBody = typeof body === 'object' ? JSON.stringify(body) : body;
    const sendBody = this.encrypted
      ? encryptBody(rawBody, credential.appSecret)
      : rawBody;

    // 2. 构建公共 query 参数
    const queryParams = this.buildCommonQueryParams(credential, options?.extraQuery);
    const queryString = this.buildQueryString(queryParams);

    // 3. 时间戳与 body 摘要
    const timestamp = this.getSecondTimestamp();
    const digest = sm3Digest(sendBody);

    // 4. 构建请求头
    const headers: Record<string, string> = {
      appid: credential.appId,
      'x-alb-timestamp': String(timestamp),
      'x-alb-verify': VERIFY_ALGORITHM,
      'Content-Type': 'application/json',
      'x-alb-digest': digest,
    };

    // 5. 生成 apisign
    // POST 签名串 = POST {path}?{query}\nx-alb-digest: {请求体body}\nx-alb-timestamp: {ts}
    // 注意：x-alb-digest 后跟的是请求体原文（加密应用为加密后的 body），不是 SM3 摘要值
    const signStr = `POST ${path}?${queryString}\nx-alb-digest: ${sendBody}\nx-alb-timestamp: ${timestamp}`;
    headers['apisign'] = sm2Sign(signStr, credential.appSecret);

    // 6. 发送请求
    const url = `${this.baseUrl}${path}?${queryString}`;
    const response = await this.sendRequest('POST', url, headers, sendBody, options?.timeout);

    // 7. 解密响应体并解析
    const responseBody = await response.text();
    const decrypted = this.encrypted ? decryptBody(responseBody, credential.appSecret) : responseBody;
    return this.parseResponse<T>(decrypted, url, credential);
  }

  /**
   * 发送 GET 请求
   *
   * 对应 PHP 版 get()：
   * 1. 构建公共 query 参数
   * 2. 时间戳
   * 3. 构建请求头（GET 无需 x-alb-digest）
   * 4. 生成 apisign
   * 5. 发送请求
   * 6. 解密响应体并解析
   *
   * @param path 接口路径
   * @param credential 账套凭证
   * @param options 请求选项
   * @returns 接口返回的 JSON 数据
   * @throws 请求失败时抛出
   */
  async get<T = unknown>(
    path: string,
    credential: AccountSetCredential,
    options?: XinfutongRequestOptions,
  ): Promise<XinfutongResponse<T>> {
    // 1. 构建公共 query 参数
    const queryParams = this.buildCommonQueryParams(credential, options?.extraQuery);
    const queryString = this.buildQueryString(queryParams);

    // 2. 时间戳
    const timestamp = this.getSecondTimestamp();

    // 3. 构建请求头（GET 无需 x-alb-digest）
    const headers: Record<string, string> = {
      appid: credential.appId,
      'x-alb-timestamp': String(timestamp),
      'x-alb-verify': VERIFY_ALGORITHM,
      'Content-Type': 'application/json',
    };

    // 4. 生成 apisign：GET 签名串 = GET {path}?{query}\nx-alb-timestamp: {ts}
    const signStr = `GET ${path}?${queryString}\nx-alb-timestamp: ${timestamp}`;
    headers['apisign'] = sm2Sign(signStr, credential.appSecret);

    // 5. 发送请求
    const url = `${this.baseUrl}${path}?${queryString}`;
    const response = await this.sendRequest('GET', url, headers, undefined, options?.timeout);

    // 6. 解密响应体并解析
    const responseBody = await response.text();
    const decrypted = this.encrypted ? decryptBody(responseBody, credential.appSecret) : responseBody;
    return this.parseResponse<T>(decrypted, url, credential);
  }

  // ==================== 公共参数 ====================

  /**
   * 构建公共 query 参数（按文档顺序排列）
   *
   * 对应 PHP 版 buildCommonQueryParams()：
   *   CSCAPPUID → CSCPRJCOD(可选) → CSCREQTIM → CSCUSRNBR(可选) → CSCUSRUID(可选) → extra
   *
   * @param credential 账套凭证（CSCAPPUID 通常与 appId 一致）
   * @param extra 额外的业务参数
   */
  protected buildCommonQueryParams(
    credential: AccountSetCredential,
    extra?: Record<string, string>,
  ): Record<string, string> {
    const params: Record<string, string> = {
      CSCAPPUID: credential.appId,
    };
    if (this.cscPrjCod) {
      params['CSCPRJCOD'] = this.cscPrjCod;
    }
    params['CSCREQTIM'] = String(this.getMillisecondTimestamp());
    if (this.cscUsrNbr) {
      params['CSCUSRNBR'] = this.cscUsrNbr;
    }
    if (this.cscUsrUid) {
      params['CSCUSRUID'] = this.cscUsrUid;
    }
    return { ...params, ...extra };
  }

  /**
   * 将参数对象转为 URL 查询字符串（RFC3986 编码）
   *
   * 对应 PHP 版 buildQueryString()
   */
  protected buildQueryString(params: Record<string, string>): string {
    return Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  // ==================== 时间戳 ====================

  /** 获取毫秒级时间戳 */
  protected getMillisecondTimestamp(): number {
    return Date.now();
  }

  /** 获取秒级时间戳 */
  protected getSecondTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  // ==================== 响应处理 ====================

  /**
   * 校验接口返回码是否成功
   *
   * 对应 PHP 版 assertSuccess()：
   *   - 标准格式：returnCode === 'SUC0000' 表示成功
   *   - 标准格式但失败：优先使用标准错误信息
   *   - 网关错误格式：SYCOMRETZ
   *   - 未知格式
   *
   * @param response 接口响应数据
   * @throws 返回码非 SUC0000 时抛出
   */
  protected assertSuccess(response: XinfutongResponse): void {
    // 标准格式校验
    const returnCode = response.returnCode ?? '';
    if (returnCode === RETURN_CODE_SUCCESS) {
      return;
    }

    // 标准格式但失败
    if (returnCode !== '') {
      const errorMsg = response.errorMsg ?? '未知错误';
      throw new Error(`薪福通接口调用失败，returnCode: ${returnCode}，errorMsg: ${errorMsg}`);
    }

    // 网关错误格式：SYCOMRETZ
    const sycomretz = response.SYCOMRETZ;
    if (Array.isArray(sycomretz) && sycomretz.length > 0) {
      const err: XinfutongGatewayError = sycomretz[0] ?? {};
      const errCod = err.ERRCOD ?? 'UNKNOWN';
      const errMsg = err.ERRMSG ?? '未知错误';
      const errDtl = err.ERRDTL ?? '';
      const errPam = err.ERRPAM ?? '';
      const detail = [
        `ERRCOD: ${errCod}`,
        `ERRMSG: ${errMsg}`,
        errDtl ? `ERRDTL: ${errDtl}` : '',
        errPam ? `ERRPAM: ${errPam}` : '',
      ]
        .filter(Boolean)
        .join('，');
      throw new Error(`薪福通接口调用失败，${detail}`);
    }

    // 未知格式
    throw new Error(`薪福通接口返回未知格式，响应内容：${JSON.stringify(response)}`);
  }

  // ==================== 内部辅助 ====================

  /**
   * 过滤掉值为 null、空字符串、空数组的字段
   *
   * 对应 PHP 版 array_filter($arr, fn($v) => $v !== null && $v !== '' && $v !== [])
   */
  protected filterEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string' && v === '') continue;
      if (Array.isArray(v) && v.length === 0) continue;
      result[k] = v;
    }
    return result as Partial<T>;
  }

  /**
   * 发送 HTTP 请求（封装 fetch，含超时控制）
   */
  private async sendRequest(
    method: 'GET' | 'POST',
    url: string,
    headers: Record<string, string>,
    body?: string,
    timeoutMs?: number,
  ): Promise<Response> {
    const timeout = timeoutMs ?? XinfutongOaClient.DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const respBody = await response.text().catch(() => '');
        throw new Error(
          `${method} 请求失败，HTTP 状态码：${response.status}，URL：${url}，响应体：${respBody}`,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${method} 请求超时（${timeout}ms），URL：${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 解析响应体为 JSON
   */
  private parseResponse<T>(
    responseBody: string,
    url: string,
    credential: AccountSetCredential,
  ): XinfutongResponse<T> {
    let data: XinfutongResponse<T>;
    try {
      data = JSON.parse(responseBody) as XinfutongResponse<T>;
    } catch {
      throw new Error(
        `响应数据 JSON 解析失败，账套：${credential.name}，URL：${url}，响应体：${responseBody}`,
      );
    }
    return data;
  }
}
