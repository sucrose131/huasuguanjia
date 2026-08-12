/**
 * 十方清源对接常量
 *
 * goods_catg_id：十方清源同步商品统一落入同一分类，按环境修改此常量即可。
 */
export const SHIFANG_QINGYUAN_DATA_SOURCE_CODE = 'shifang_qingyuan';
export const SHIFANG_QINGYUAN_DATA_SOURCE_NAME = '十方清源';

/**
 * 同步商品统一分类 ID（hspsi_goods_info_category.goods_catg_id）
 * TODO: 按实际环境修改为十方清源商品所属叶级分类 ID
 */
export const SHIFANG_QINGYUAN_GOODS_CATEGORY_ID = 1n;

/** 外部对象类型（hspsi_goods_source_mapping.source_type） */
export const SHIFANG_QINGYUAN_SOURCE_TYPE = {
  /** 自身出库 */
  STANDARD: 'STANDARD',
  /** 有 gift_plan 或 upgrade_bag，按转换规则出库 */
  MAPPED: 'MAPPED',
} as const;

/** 映射状态 */
export const SHIFANG_QINGYUAN_MAPPING_STATUS = {
  MAPPED: 1,
  PENDING: 2,
  DISABLED: 3,
} as const;

/** SKU 转换规则类型 */
export const SHIFANG_QINGYUAN_RULE_TYPE = {
  /** gift_plan / upgrade_bag 映射替换 */
  REPLACE: 1,
} as const;

/** 转换规则状态 */
export const SHIFANG_QINGYUAN_RULE_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
} as const;
