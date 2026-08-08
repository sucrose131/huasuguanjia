/**
 * 华溯之家商品同步常量
 *
 * goods_catg_id：华溯同步商品统一落入同一分类，按环境修改此常量即可。
 */
export const HUASU_HOME_DATA_SOURCE_CODE = 'huashu_home';
export const HUASU_HOME_DATA_SOURCE_NAME = '华溯之家';

/**
 * 同步商品统一分类 ID（hspsi_goods_info_category.goods_catg_id）
 * TODO: 按实际环境修改为华溯商品所属叶级分类 ID
 */
export const HUASU_HOME_GOODS_CATEGORY_ID = 0n;

/** 套餐 SKU 业务单位名称（对应 hspsi_basic_unit.name） */
export const HUASU_HOME_COMBO_UNIT_NAME = '套';

/** 外部对象类型（hspsi_goods_source_mapping.source_type） */
export const HUASU_HOME_SOURCE_TYPE = {
  STANDARD: 'STANDARD',
  COMBO: 'COMBO',
} as const;

/** 映射状态 */
export const HUASU_HOME_MAPPING_STATUS = {
  MAPPED: 1,
  PENDING: 2,
  DISABLED: 3,
} as const;

/** SKU 转换规则类型 */
export const HUASU_HOME_RULE_TYPE = {
  REPLACE: 1,
  COMBO_SPLIT: 2,
} as const;

/** 转换规则状态 */
export const HUASU_HOME_RULE_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
} as const;
