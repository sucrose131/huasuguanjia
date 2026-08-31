/**
 * 薪福通 OA 组织域类型定义
 *
 * 包含：组织 / 职位 / 岗位 / 企业成员 / 员工花名册
 * 这些均围绕"组织架构"这一业务域，故统一放在 organization/ 目录。
 */

// ==================== 接口路径与分页上限 ====================

/** 组织列表查询接口路径 */
export const ORG_LIST_PATH = '/ORG/orgqry/xft-service-organization/org/v1/get/page';
/** 组织列表单次查询最大页大小 */
export const ORG_PAGE_SIZE_MAX = 2000;

/** 职位分页查询接口路径 */
export const JOB_LIST_PATH = '/hrm/hrm2/organization-management/openapi/job/query/page';
/** 职位列表单次查询最大页大小 */
export const JOB_PAGE_SIZE_MAX = 1000;

/** 岗位分页查询接口路径 */
export const POSITION_LIST_PATH = '/hrm/hrm2/organization-management/openapi/position/query/page';
/** 岗位列表单次查询最大页大小 */
export const POSITION_PAGE_SIZE_MAX = 1000;
/** 岗位流水号/组织 ID 列表最大数量 */
export const POSITION_IDS_MAX = 1000;

/** 企业成员分页查询接口路径 */
export const MEMBER_LIST_PATH = '/xft-member/openapi/xft-member/member/page/by-condition';
/** 企业成员单次查询最大页大小 */
export const MEMBER_PAGE_SIZE_MAX = 1000;

/** 员工花名册信息查询接口路径 */
export const STAFF_LIST_PATH = '/hrm/hrm2/xft-employeeprofile/employee/external/api/query/staffInfo';
/** 员工花名册单次查询最大页大小 */
export const STAFF_PAGE_SIZE_MAX = 1000;
/** 员工花名册查询条件最大数量 */
export const STAFF_QUERY_FILTER_MAX = 10;

// ==================== 组织列表查询 ====================

/** 组织生效状态 */
export type OrgStatus = 'active' | 'delete' | 'stopped';

/** 组织扩展查询选项 */
export type OrgExtOption = 'leader' | 'approver' | 'extData' | 'namePath' | 'allDisplayOrderNumber' | 'leaf';

/** 组织列表查询参数 */
export interface OrgListQueryParams {
  /** 组织编码集合（最大 2000） */
  codes?: string[];
  /** 组织 id 集合（最大 2000） */
  ids?: string[];
  /** 搜索关键词 */
  keyword?: string;
  /** 父组织 id */
  parentId?: string;
  /** 生效状态集合 */
  status?: OrgStatus[];
  /** 当前页（起始页为 1，默认 1） */
  currentPage?: number;
  /** 页大小（最大 2000，默认 10） */
  pageSize?: number;
  /** 扩展查询选项 */
  extOptions?: OrgExtOption[];
}

/** 组织记录 */
export interface OrganizationRecord {
  id?: string;
  code?: string;
  name?: string;
  type?: string;
  parentId?: string;
  idPath?: string;
  status?: string;
  orderNumber?: number;
  effectiveDate?: string;
  remark?: string;
  leaders?: Array<{ name?: string }>;
}

// ==================== 职位分页查询 ====================

/** 职位分页查询参数 */
export interface JobListQueryParams {
  /** 流水号列表（最大 1000，每项最大长度 10） */
  sequenceNumbers?: string[];
  /** 职位名称（模糊查询，最大 150） */
  jobName?: string;
  /** 职位编号（模糊查询，最大 8） */
  codeNumber?: string;
  /** 当前页（起始值 1，必填，默认 1） */
  currentPage?: number;
  /** 每页大小（默认 10，最大 1000） */
  pageSize?: number;
}

/** 职位记录 */
export interface JobRecord {
  sequenceNumber?: string;
  codeNumber?: string;
  jobName?: string;
  remark?: string;
  orderNumber?: number;
}

// ==================== 岗位分页查询 ====================

/** 岗位分页查询参数 */
export interface PositionListQueryParams {
  /** 流水号列表（最大 1000，每项最大长度 10） */
  sequenceNumbers?: string[];
  /** 岗位名称（模糊查询，最大 150） */
  positionName?: string;
  /** 所属组织机构 ID 列表（最大 1000，每项最大长度 4） */
  organizationIds?: string[];
  /** 岗位编号（模糊查询，最大 8） */
  codeNumber?: string;
  /** 当前页（起始值 1，必填，默认 1） */
  currentPage?: number;
  /** 每页大小（默认 10，最大 1000） */
  pageSize?: number;
}

/** 岗位记录 */
export interface PositionRecord {
  sequenceNumber?: string;
  positionName?: string;
  codeNumber?: string;
  orderNumber?: number;
  remark?: string;
  organizations?: Array<{ organizationId?: string }>;
}

// ==================== 企业成员查询 ====================

/** 企业成员返回数据控制字段 */
export type MemberExtField = 'position' | 'org' | 'historyId' | 'personal';

/** 成员状态 */
export type MemberStatus = 'ENABLE' | 'DISABLE';

/** 成员加入状态 */
export type MemberJoinStatus = 'TO_JOIN' | 'INVITING' | 'FAILED' | 'REJECT' | 'ENABLE' | 'EXIT' | 'DISABLE';

/** 成员类型 */
export type MemberType = 'INNER' | 'OUTER';

/** 企业成员查询参数 */
export interface MemberListQueryParams {
  /** 当前页（起始值 1，必填，默认 1） */
  currentPage?: number;
  /** 分页大小（默认 10，最大 1000） */
  pageSize?: number;
  /** 返回数据控制字段（position-职位岗位、org-组织、historyId-历史ID、personal-个人隐私数据） */
  extFields?: MemberExtField[];
  /** 关键字（姓名、手机号、员工号模糊检索，最大 32） */
  keyWord?: string;
  /** 手机号（最大 20） */
  mobile?: string;
  /** 姓名（最大 20） */
  name?: string;
  /** 组织条件 */
  orgCondition?: { orgIds?: string[]; type?: string };
  /** 员工条件 */
  staffCondition?: { jobCodes?: string[]; postCodes?: string[] };
  /** 状态（ENABLE-有效，DISABLE-无效） */
  status?: MemberStatus;
  /** 加入状态 */
  joinStatus?: MemberJoinStatus;
  /** 成员类型（INNER-内部员工，OUTER-外部人员） */
  type?: MemberType;
}

/** 企业成员记录 */
export interface MemberRecord {
  memberId?: string;
  name?: string;
  mobile?: string;
  number?: string;
  gender?: 'M' | 'F' | string;
  status?: string;
  deleted?: boolean;
  post?: { id?: string };
  idRelation?: { staffId?: string };
  organizations?: Array<{ organizationId?: string; type?: string }>;
}

// ==================== 员工花名册查询 ====================

/** 员工花名册查询类别 */
export type StaffQueryType = 'FIELD' | 'GROUP';

/** 员工花名册查询分组 Key */
export type StaffQueryClassKey =
  | 'S01BASIC'
  | 'S02ONJOB'
  | 'S02QUITMSG'
  | 'S03PERSN'
  | 'S04SAISR';

/** 查询条件项 */
export interface StaffQueryFilter {
  /** 字段 Key */
  fieldKey: string;
  /** 查询方式 */
  fieldQueryMethod: string;
  /** 字段值 */
  fieldValue: string | string[];
}

/** 员工花名册查询参数 */
export interface StaffListQueryParams {
  /** 查询条件列表（最大 10），传空数组 [] 表示无条件查询 */
  queryFilterList: StaffQueryFilter[];
  /** 查询类别 */
  queryResultType: {
    /** 查询类型：FIELD-按字段查询、GROUP-按分组查询 */
    queryType: StaffQueryType;
    /** queryType=FIELD 时生效，指定返回字段 */
    queryFieldList?: string[];
    /** queryType=GROUP 时生效，指定返回分组 */
    queryClassKeyList?: StaffQueryClassKey[];
  };
  /** 当前页（起始值 1，必填，默认 1） */
  currentPage?: number;
  /** 每页查询数量（默认 10，最大 1000） */
  pageSize?: number;
}

/** 员工花名册记录（结构较灵活，保留索引签名以便按分组返回） */
export interface StaffRecord {
  staffSeq?: string;
  staffBasicInfo?: {
    stfName?: string;
    mobileNumber?: string;
    stfNumber?: string;
    stfStatus?: string;
  };
  [key: string]: unknown;
}
