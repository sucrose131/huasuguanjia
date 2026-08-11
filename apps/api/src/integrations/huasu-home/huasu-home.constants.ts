/**
 * 华溯之家对接常量
 *
 * goods_catg_id：华溯同步商品统一落入同一分类，按环境修改此常量即可。
 */
export const HUASU_HOME_DATA_SOURCE_CODE = 'huashu_home';
export const HUASU_HOME_DATA_SOURCE_NAME = '华溯之家';

/**
 * 同步商品统一分类 ID（hspsi_goods_info_category.goods_catg_id）
 * TODO: 按实际环境修改为华溯商品所属叶级分类 ID
 */
export const HUASU_HOME_GOODS_CATEGORY_ID = 1n;

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

/** 外部订单业务类型（由拉取接口族决定，非订单体字段） */
export const HUASU_HOME_ORDER_TYPE = {
  SALE_ORDER: 'SALE_ORDER',
} as const;

/** 订单映射同步状态 */
export const HUASU_HOME_ORDER_SYNC_STATUS = {
  SUCCESS: 1,
  RETRY: 2,
  FAILED: 3,
} as const;

/** 华溯订单状态（仅已支付及以后入库） */
export const HUASU_HOME_ORDER_STATUS = {
  PENDING_PAY: 1,
  CANCELLED: 2,
  PAID: 3,
  SHIPPED: 4,
  COMPLETED: 5,
  REFUNDED: 6,
  AFTER_SALES: 7,
  AFTER_SALES_DONE: 8,
  PAYING: 9,
  RECEIVED: 10,
} as const;

/** 可同步入库的华溯订单状态 */
export const HUASU_HOME_ORDER_SYNCABLE_STATUSES = new Set<number>([
  HUASU_HOME_ORDER_STATUS.PAID,
  HUASU_HOME_ORDER_STATUS.SHIPPED,
  HUASU_HOME_ORDER_STATUS.COMPLETED,
  HUASU_HOME_ORDER_STATUS.REFUNDED,
  HUASU_HOME_ORDER_STATUS.AFTER_SALES,
  HUASU_HOME_ORDER_STATUS.AFTER_SALES_DONE,
  HUASU_HOME_ORDER_STATUS.RECEIVED,
]);

/** 视为已发货的华溯状态 */
export const HUASU_HOME_ORDER_SHIPPED_STATUSES = new Set<number>([
  HUASU_HOME_ORDER_STATUS.SHIPPED,
  HUASU_HOME_ORDER_STATUS.RECEIVED,
  HUASU_HOME_ORDER_STATUS.COMPLETED,
  HUASU_HOME_ORDER_STATUS.AFTER_SALES,
  HUASU_HOME_ORDER_STATUS.AFTER_SALES_DONE,
  HUASU_HOME_ORDER_STATUS.REFUNDED,
]);

/** 华溯售后类型 */
export const HUASU_HOME_AFTER_SALES_TYPE = {
  NONE: 0,
  REFUND_ONLY: 1,
  RETURN_REFUND: 2,
  EXCHANGE: 3,
  ABNORMAL: 4,
} as const;

/** 华溯售后状态 */
export const HUASU_HOME_AFTER_SALES_STATUS = {
  NONE: 0,
  PROCESSING: 1,
  DONE: 2,
  REJECTED: 3,
  USER_CANCEL: 4,
} as const;

/** 华溯订单行 product_type */
export const HUASU_HOME_PRODUCT_TYPE = {
  COMBO: 1,
  STANDARD: 2,
} as const;

/** 华溯支付方式 → 平台 pay_mode */
export const HUASU_HOME_PAY_MODE_MAP: Record<number, number> = {
  1: 3, // 微信
  2: 4, // 支付宝
  3: 6, // 余额（字典建议扩展）
  4: 7, // 线下（字典建议扩展；缺失时可回退 2）
};
