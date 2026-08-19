import { Injectable } from '@nestjs/common';
import { XinfutongOaClient } from '../core/client';
import type { AccountSetCredential } from '../core/credential.service';
import type {
  XinfutongPageBody,
  XinfutongResponse,
} from '../core/types';
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
  STAFF_LIST_PATH,
  STAFF_PAGE_SIZE_MAX,
  STAFF_QUERY_FILTER_MAX,
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
} from './organization.types';

/**
 * 薪福通 OA 组织域业务查询服务
 *
 * 职责：提供组织 / 职位 / 岗位 / 企业成员 / 员工花名册的查询能力。
 *
 * 继承 XinfutongOaClient 复用基础请求层（签名/加解密/HTTP/assertSuccess）。
 * 同步逻辑见 sync/sync.service.ts。
 */
@Injectable()
export class XinfutongOaOrganizationService extends XinfutongOaClient {
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
    // 同步需要成员-员工身份与岗位：idRelation.staffId → out_staff_id、post.id → post_id。
    // 两者必须通过 extFields 请求才会返回（position 同时返回 idRelation 与 post；org 返回组织详情）。
    // 缺省补齐；调用方显式传入时尊重调用方。
    params.extFields = params.extFields ?? ['org', 'position'];

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
}
