/**
 * 薪福通 OA 表单域类型定义
 *
 * 包含：表单列表查询、表单数据查询、表单配置信息查询
 */

// ==================== 接口路径与上限 ====================

/** 表单列表查询接口路径 */
export const FORM_LIST_PATH = '/xft-oa/openapi/xft-oaquery/form/query-list';
/** 表单数据查询接口路径 */
export const FORM_DATA_LIST_PATH = '/xft-oa/openapi/xft-oaquery/form-data/query-list';
/** 表单配置信息查询接口路径 */
export const FORM_CONFIG_PATH = '/xft-oa/openapi/xft-oaquery/form-config/query';

/** 表单数据查询：业务编号集合 / 流程实例 id 集合各自最多 300 个 */
export const FORM_DATA_QUERY_MAX = 300;

// ==================== 表单列表查询 ====================

/** 表单列表查询参数 */
export interface FormListQueryParams {
  /** 表单名称（模糊查询） */
  formName?: string;
}

/** 表单信息 */
export interface FormInfo {
  /** 表单 key */
  formKey?: string;
  /** 表单名称 */
  formName?: string;
  /** 图标 */
  icon?: string;
  /** 所属分类 id */
  categoryId?: string;
}

/** 表单分类（含该分类下的表单列表） */
export interface FormCategory {
  /** 分类 id */
  categoryId?: string;
  /** 分类名称 */
  categoryName?: string;
  /** 该分类下的表单列表 */
  formInfoList?: FormInfo[];
}

// ==================== 表单数据查询 ====================

/** 表单数据查询参数 */
export interface FormDataListQueryParams {
  /** 业务编号集合（最多 300 个） */
  busKeyList?: string[];
  /** 流程实例 id 集合（最多 300 个） */
  procInstIdList?: string[];
}

/** 表单数据记录 */
export interface FormDataRecord {
  /** 表单 id */
  formId?: string;
  /** 业务编码 */
  busKey?: string;
  /**
   * 表单数据（JSON 字符串）
   *
   * 注意：开发者需要兼容两种表单数据：
   * 1. 历史 formData 数据没有 value 这一层级
   * 2. 新发起的表单 formData 数据都存在 value 这一层级
   */
  formData?: string;
}

// ==================== 表单配置信息查询 ====================

/** 表单配置信息查询参数 */
export interface FormConfigQueryParams {
  /** 表单编码（与 formKey 二选一） */
  formId?: string;
  /** 表单 id（与 formId 二选一） */
  formKey?: string;
}

/** 表单配置信息 */
export interface FormConfig {
  /** 项目编码 */
  prjCod?: string;
  /** 表单名称 */
  formName?: string;
  /** 表单 key */
  formKey?: string;
  /** 表单 id（可能为 null） */
  formId?: string | null;
  /** 图标 */
  icon?: string;
  /** 表单配置（JSON 字符串，由调用方自行解析） */
  formConfig?: string;
}
