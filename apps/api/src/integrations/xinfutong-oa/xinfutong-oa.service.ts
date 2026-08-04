import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountSetCredential } from './xinfutong-oa-credential.service';
import {
  decryptBody,
  encryptBody,
  sm2Sign,
  sm3Digest,
  VERIFY_ALGORITHM,
} from './xinfutong-oa-crypto';
import {
  JOB_LIST_PATH,
  JOB_PAGE_SIZE_MAX,
  MEMBER_LIST_PATH,
  MEMBER_PAGE_SIZE_MAX,
  ORG_LIST_PATH,
  ORG_PAGE_SIZE_MAX,
  POSITION_IDS_MAX,
  POSITION_LIST_PATH,
  POSITION_PAGE_SIZE_MAX,
  RETURN_CODE_SUCCESS,
  STAFF_LIST_PATH,
  STAFF_PAGE_SIZE_MAX,
  STAFF_QUERY_FILTER_MAX,
  XinfutongGatewayError,
  XinfutongPageBody,
  XinfutongRequestOptions,
  XinfutongResponse,
  type JobListQueryParams,
  type JobRecord,
  type MemberListQueryParams,
  type MemberRecord,
  type OrganizationRecord,
  type OrgListQueryParams,
  type PositionListQueryParams,
  type PositionRecord,
  type StaffListQueryParams,
  type StaffRecord,
} from './xinfutong-oa.types';

/**
 * 薪福通 OA 对接服务
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
 * 对应 PHP 版 GetOADataCommand 中的 post() / get() / buildCommonQueryParams() / assertSuccess()。
 */
@Injectable()
export class XinfutongOaService {
  private static readonly logger = new Logger(XinfutongOaService.name);

  /** 默认请求超时（毫秒） */
  private static readonly DEFAULT_TIMEOUT_MS = 60_000;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  /** 薪福通平台基础地址 */
  private get baseUrl(): string {
    return this.config.getOrThrow<string>('XINFUTONG_OA_BASE_URL');
  }

  /** 是否为加密应用（加密应用需对 body 进行 SM4 加解密） */
  private get encrypted(): boolean {
    return this.config.get<string>('XINFUTONG_OA_ENCRYPTED', 'true') !== 'false';
  }

  /** 企业号（可选，不传则默认取应用所属企业） */
  private get cscPrjCod(): string | null {
    const val = this.config.get<string>('XINFUTONG_OA_CSC_PRJ_COD', '');
    return val || null;
  }

  /** 薪福通企业用户号（可选，定时任务可填 A0001） */
  private get cscUsrNbr(): string {
    return this.config.get<string>('XINFUTONG_OA_CSC_USR_NBR', '') ?? '';
  }

  /** 薪福通平台用户号（可选，定时任务可填 AUTO0001） */
  private get cscUsrUid(): string {
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

  // ==================== 组织列表查询 ====================

  /**
   * 分页查询组织列表
   *
   * 对应 PHP 版 getOrganizationList()：
   * 支持按组织编码、组织id、父组织id、关键词、状态等条件查询，所有参数均为可选。
   *
   * @param credential 账套凭证
   * @param params 查询条件
   * @returns 接口响应数据（body 为分页结构）
   * @throws 请求失败或返回码非成功时抛出
   */
  async getOrganizationList(
    credential: AccountSetCredential,
    params: OrgListQueryParams = {},
  ): Promise<XinfutongResponse<XinfutongPageBody<OrganizationRecord>>> {
    const currentPage = params.currentPage ?? 1;
    const pageSize = params.pageSize ?? 10;

    if (pageSize > ORG_PAGE_SIZE_MAX) {
      throw new Error(`页大小不能超过 ${ORG_PAGE_SIZE_MAX}，当前值：${pageSize}`);
    }

    // 组装请求体，过滤掉未传（null 或空字符串）的可选参数
    const body = this.filterEmpty({
      codes: params.codes,
      ids: params.ids,
      keyword: params.keyword,
      parentId: params.parentId,
      status: params.status,
      currentPage,
      pageSize,
      extOptions: params.extOptions,
    });

    const response = await this.post<XinfutongPageBody<OrganizationRecord>>(
      ORG_LIST_PATH,
      credential,
      body,
    );
    this.assertSuccess(response);
    return response;
  }

  /**
   * 查询全部组织（自动翻页）
   *
   * 对应 PHP 版 getAllOrganizations()：
   * 以最大页大小循环调用 getOrganizationList()，直至取完所有分页数据。
   *
   * @param credential 账套凭证
   * @param params 查询条件（currentPage/pageSize 会被覆盖）
   * @returns 全部组织记录集合
   */
  async getAllOrganizations(
    credential: AccountSetCredential,
    params: OrgListQueryParams = {},
  ): Promise<OrganizationRecord[]> {
    params.pageSize = ORG_PAGE_SIZE_MAX;
    params.currentPage = 1;

    const allRecords: OrganizationRecord[] = [];
    let hasNext = true;
    while (hasNext) {
      const response = await this.getOrganizationList(credential, params);
      const body = response.body ?? {};
      const records = body.records ?? [];
      allRecords.push(...records);

      const totalSize = body.totalSize ?? 0;
      hasNext = allRecords.length < totalSize && records.length > 0;
      if (hasNext) {
        params.currentPage = (params.currentPage ?? 1) + 1;
      }
    }
    return allRecords;
  }

  // ==================== 职位分页查询 ====================

  /**
   * 分页查询职位
   *
   * 对应 PHP 版 getJobList()：
   * 支持按流水号列表、职位编号、职位名称等条件查询，所有过滤条件均为可选。
   *
   * @param credential 账套凭证
   * @param params 查询条件
   * @returns 接口响应数据（body 为分页结构）
   */
  async getJobList(
    credential: AccountSetCredential,
    params: JobListQueryParams = {},
  ): Promise<XinfutongResponse<XinfutongPageBody<JobRecord>>> {
    const currentPage = params.currentPage ?? 1;
    const pageSize = params.pageSize ?? 10;

    if (pageSize > JOB_PAGE_SIZE_MAX) {
      throw new Error(`页大小不能超过 ${JOB_PAGE_SIZE_MAX}，当前值：${pageSize}`);
    }

    const body = this.filterEmpty({
      sequenceNumbers: params.sequenceNumbers,
      jobName: params.jobName,
      codeNumber: params.codeNumber,
      currentPage,
      pageSize,
    });

    const response = await this.post<XinfutongPageBody<JobRecord>>(
      JOB_LIST_PATH,
      credential,
      body,
    );
    this.assertSuccess(response);
    return response;
  }

  /**
   * 查询全部职位（自动翻页）
   *
   * 对应 PHP 版 getAllJobs()
   *
   * @param credential 账套凭证
   * @param params 查询条件（currentPage/pageSize 会被覆盖）
   * @returns 全部职位记录集合
   */
  async getAllJobs(
    credential: AccountSetCredential,
    params: JobListQueryParams = {},
  ): Promise<JobRecord[]> {
    params.pageSize = JOB_PAGE_SIZE_MAX;
    params.currentPage = 1;

    const allRecords: JobRecord[] = [];
    let hasNext = true;
    while (hasNext) {
      const response = await this.getJobList(credential, params);
      const body = response.body ?? {};
      const records = body.records ?? [];
      allRecords.push(...records);

      const totalSize = body.totalSize ?? 0;
      hasNext = allRecords.length < totalSize && records.length > 0;
      if (hasNext) {
        params.currentPage = (params.currentPage ?? 1) + 1;
      }
    }
    return allRecords;
  }

  // ==================== 岗位分页查询 ====================

  /**
   * 分页查询岗位
   *
   * 对应 PHP 版 getPositionList()：
   * 支持按流水号列表、岗位名称、所属组织机构 ID、岗位编号等条件查询。
   *
   * @param credential 账套凭证
   * @param params 查询条件
   * @returns 接口响应数据（body 为分页结构）
   */
  async getPositionList(
    credential: AccountSetCredential,
    params: PositionListQueryParams = {},
  ): Promise<XinfutongResponse<XinfutongPageBody<PositionRecord>>> {
    const currentPage = params.currentPage ?? 1;
    const pageSize = params.pageSize ?? 10;

    if (pageSize > POSITION_PAGE_SIZE_MAX) {
      throw new Error(`页大小不能超过 ${POSITION_PAGE_SIZE_MAX}，当前值：${pageSize}`);
    }

    // 流水号列表数量校验
    const sequenceNumbers = params.sequenceNumbers ?? [];
    if (sequenceNumbers.length > POSITION_IDS_MAX) {
      throw new Error(
        `流水号数量不能超过 ${POSITION_IDS_MAX}，当前值：${sequenceNumbers.length}`,
      );
    }

    // 组织 ID 列表数量校验
    const organizationIds = params.organizationIds ?? [];
    if (organizationIds.length > POSITION_IDS_MAX) {
      throw new Error(
        `所属组织机构 ID 数量不能超过 ${POSITION_IDS_MAX}，当前值：${organizationIds.length}`,
      );
    }

    const body = this.filterEmpty({
      sequenceNumbers,
      positionName: params.positionName,
      organizationIds,
      codeNumber: params.codeNumber,
      currentPage,
      pageSize,
    });

    const response = await this.post<XinfutongPageBody<PositionRecord>>(
      POSITION_LIST_PATH,
      credential,
      body,
    );
    this.assertSuccess(response);
    return response;
  }

  /**
   * 查询全部岗位（自动翻页）
   *
   * 对应 PHP 版 getAllPositions()
   *
   * @param credential 账套凭证
   * @param params 查询条件（currentPage/pageSize 会被覆盖）
   * @returns 全部岗位记录集合
   */
  async getAllPositions(
    credential: AccountSetCredential,
    params: PositionListQueryParams = {},
  ): Promise<PositionRecord[]> {
    params.pageSize = POSITION_PAGE_SIZE_MAX;
    params.currentPage = 1;

    const allRecords: PositionRecord[] = [];
    let hasNext = true;
    while (hasNext) {
      const response = await this.getPositionList(credential, params);
      const body = response.body ?? {};
      const records = body.records ?? [];
      allRecords.push(...records);

      const totalSize = body.totalSize ?? 0;
      hasNext = allRecords.length < totalSize && records.length > 0;
      if (hasNext) {
        params.currentPage = (params.currentPage ?? 1) + 1;
      }
    }
    return allRecords;
  }

  // ==================== 企业成员查询 ====================

  /**
   * 按条件分页查询企业成员
   *
   * 对应 PHP 版 getMemberList()：
   * 支持按关键字、手机号、姓名、组织条件、员工条件、状态、加入状态、成员类型等条件查询。
   *
   * @param credential 账套凭证
   * @param params 查询条件
   * @returns 接口响应数据（body 为分页结构）
   */
  async getMemberList(
    credential: AccountSetCredential,
    params: MemberListQueryParams = {},
  ): Promise<XinfutongResponse<XinfutongPageBody<MemberRecord>>> {
    const currentPage = params.currentPage ?? 1;
    const pageSize = params.pageSize ?? 10;

    if (pageSize > MEMBER_PAGE_SIZE_MAX) {
      throw new Error(`分页大小不能超过 ${MEMBER_PAGE_SIZE_MAX}，当前值：${pageSize}`);
    }

    const body = this.filterEmpty({
      currentPage,
      pageSize,
      extFields: params.extFields,
      keyWord: params.keyWord,
      mobile: params.mobile,
      name: params.name,
      orgCondition: params.orgCondition,
      staffCondition: params.staffCondition,
      status: params.status,
      joinStatus: params.joinStatus,
      type: params.type,
    });

    const response = await this.post<XinfutongPageBody<MemberRecord>>(
      MEMBER_LIST_PATH,
      credential,
      body,
    );
    this.assertSuccess(response);
    return response;
  }

  /**
   * 查询全部企业成员（自动翻页）
   *
   * 对应 PHP 版 getAllMembers()
   *
   * @param credential 账套凭证
   * @param params 查询条件（currentPage/pageSize 会被覆盖）
   * @returns 全部成员记录集合
   */
  async getAllMembers(
    credential: AccountSetCredential,
    params: MemberListQueryParams = {},
  ): Promise<MemberRecord[]> {
    params.pageSize = MEMBER_PAGE_SIZE_MAX;
    params.currentPage = 1;

    const allRecords: MemberRecord[] = [];
    let hasNext = true;
    while (hasNext) {
      const response = await this.getMemberList(credential, params);
      const body = response.body ?? {};
      const records = body.records ?? [];
      allRecords.push(...records);

      const totalSize = body.totalSize ?? 0;
      hasNext = allRecords.length < totalSize && records.length > 0;
      if (hasNext) {
        params.currentPage = (params.currentPage ?? 1) + 1;
      }
    }
    return allRecords;
  }

  // ==================== 员工花名册查询 ====================

  /**
   * 分页查询员工花名册信息
   *
   * 对应 PHP 版 getStaffList()：
   * 支持按字段等值/模糊/范围/日期等条件查询，查询结果支持按字段或按分组返回。
   * - queryFilterList 最多 10 个条件的与查询，传空数组 [] 表示无条件查询
   * - queryResultType.queryType=FIELD 时用 queryFieldList 指定返回字段
   * - queryResultType.queryType=GROUP 时用 queryClassKeyList 指定返回分组
   *
   * @param credential 账套凭证
   * @param params 查询条件
   * @returns 接口响应数据（body 为分页结构）
   */
  async getStaffList(
    credential: AccountSetCredential,
    params: StaffListQueryParams,
  ): Promise<XinfutongResponse<XinfutongPageBody<StaffRecord>>> {
    const currentPage = params.currentPage ?? 1;
    const pageSize = params.pageSize ?? 10;

    if (pageSize > STAFF_PAGE_SIZE_MAX) {
      throw new Error(`页大小不能超过 ${STAFF_PAGE_SIZE_MAX}，当前值：${pageSize}`);
    }

    // 查询条件数量校验（最多 10 个）
    const queryFilterList = params.queryFilterList ?? [];
    if (queryFilterList.length > STAFF_QUERY_FILTER_MAX) {
      throw new Error(
        `查询条件数量不能超过 ${STAFF_QUERY_FILTER_MAX}，当前值：${queryFilterList.length}`,
      );
    }

    // 查询类别必填校验
    const queryResultType = params.queryResultType;
    if (!queryResultType || typeof queryResultType !== 'object') {
      throw new Error('queryResultType 查询类别不能为空');
    }

    // 组装请求体（接口文档示例中 currentPage/pageSize 为字符串，此处保持字符串以兼容）
    const body = {
      queryFilterList,
      queryResultType,
      currentPage: String(currentPage),
      pageSize: String(pageSize),
    };

    const response = await this.post<XinfutongPageBody<StaffRecord>>(
      STAFF_LIST_PATH,
      credential,
      body,
    );
    this.assertSuccess(response);
    return response;
  }

  /**
   * 查询全部员工花名册（自动翻页）
   *
   * 对应 PHP 版 getAllStaffs()
   *
   * @param credential 账套凭证
   * @param params 查询条件（currentPage/pageSize 会被覆盖）
   * @returns 全部员工花名册记录集合
   */
  async getAllStaffs(
    credential: AccountSetCredential,
    params: StaffListQueryParams,
  ): Promise<StaffRecord[]> {
    params.pageSize = STAFF_PAGE_SIZE_MAX;
    params.currentPage = 1;

    const allRecords: StaffRecord[] = [];
    let hasNext = true;
    while (hasNext) {
      const response = await this.getStaffList(credential, params);
      const body = response.body ?? {};
      const records = body.records ?? [];
      allRecords.push(...records);

      const totalSize = body.totalSize ?? 0;
      hasNext = allRecords.length < totalSize && records.length > 0;
      if (hasNext) {
        params.currentPage = (params.currentPage ?? 1) + 1;
      }
    }
    return allRecords;
  }

  // ==================== 内部辅助 ====================

  /**
   * 过滤掉值为 null、空字符串、空数组的字段
   *
   * 对应 PHP 版 array_filter($arr, fn($v) => $v !== null && $v !== '' && $v !== [])
   */
  private filterEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
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
    const timeout = timeoutMs ?? XinfutongOaService.DEFAULT_TIMEOUT_MS;
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
