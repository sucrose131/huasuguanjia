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
  CONFERENCE_TICKET: 'CONFERENCE_TICKET',
  INSTALLMENT: 'INSTALLMENT',
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

/** 会议门票订单状态（与普通销售单 order_status 枚举不同） */
export const HUASU_HOME_CONFERENCE_ORDER_STATUS = {
  PENDING_PAY: 1,
  CANCELLED: 2,
  PAID: 3,
  REFUND_APPLY: 4,
  REFUNDED: 5,
  PAYING: 9,
} as const;

/** 可同步入库的会议门票订单状态 */
export const HUASU_HOME_CONFERENCE_SYNCABLE_STATUSES = new Set<number>([
  HUASU_HOME_CONFERENCE_ORDER_STATUS.PAID,
  HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUND_APPLY,
  HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUNDED,
]);

/** 核销状态：0-待核销，1-已核销 */
export const HUASU_HOME_CONFERENCE_VERIFY_STATUS = {
  PENDING: 0,
  VERIFIED: 1,
} as const;

/** 权益发放：0-未发放，1-已发放 */
export const HUASU_HOME_CONFERENCE_RIGHTS_GRANTED = {
  NO: 0,
  YES: 1,
} as const;

/** 门票退款状态：1-退款中，2-已退款，3-退款失败 */
export const HUASU_HOME_CONFERENCE_REFUND_STATUS = {
  PROCESSING: 1,
  DONE: 2,
  FAILED: 3,
} as const;

/** 分期订单状态（与普通销售单 / 门票枚举不同） */
export const HUASU_HOME_INSTALLMENT_STATUS = {
  PENDING_AUDIT: 1,
  AUDIT_REJECTED: 2,
  IN_PROGRESS: 3,
  COMPLETED: 4,
  AFTER_SALES: 5,
  CONVERTED: 6,
} as const;

/** 可同步入库的分期订单状态 */
export const HUASU_HOME_INSTALLMENT_SYNCABLE_STATUSES = new Set<number>([
  HUASU_HOME_INSTALLMENT_STATUS.IN_PROGRESS,
  HUASU_HOME_INSTALLMENT_STATUS.COMPLETED,
  HUASU_HOME_INSTALLMENT_STATUS.AFTER_SALES,
  HUASU_HOME_INSTALLMENT_STATUS.CONVERTED,
]);

/** 无支付方式时分期收款默认线下 */
export const HUASU_HOME_INSTALLMENT_DEFAULT_PAY_MODE = 7;

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

/** 百岁加类型：1-主卡，2-副卡，3-次卡 */
export const HUASU_HOME_CENTENARIAN_TYPE = {
  PRIMARY: 1,
  SECONDARY: 2,
  TIMES: 3,
} as const;

export const HUASU_HOME_CENTENARIAN_TYPE_NAME: Record<number, string> = {
  [HUASU_HOME_CENTENARIAN_TYPE.PRIMARY]: '主卡',
  [HUASU_HOME_CENTENARIAN_TYPE.SECONDARY]: '副卡',
  [HUASU_HOME_CENTENARIAN_TYPE.TIMES]: '次卡',
};

/** 省级合伙人展示名 */
export const HUASU_HOME_PROVINCIAL_PARTNER_NAME = '省级合伙人';

/** 列表默认分页（后期改由数据库配置管理，不走环境变量） */
export const HUASU_HOME_USER_SYNC_DEFAULT_PAGE_SIZE = 200;
export const HUASU_HOME_USER_SYNC_MAX_PAGE_SIZE = 1000;

/** 订单列表默认分页（与用户列表同一上限；后期改由数据库配置管理） */
export const HUASU_HOME_ORDER_SYNC_DEFAULT_PAGE_SIZE = 200;
export const HUASU_HOME_ORDER_SYNC_MAX_PAGE_SIZE = 1000;
export const HUASU_HOME_ORDER_SYNC_MAX_PAGES = 10_000;
