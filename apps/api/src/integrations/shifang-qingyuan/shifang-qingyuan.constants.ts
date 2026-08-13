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

/** SKU 转换规则类型（与华溯约定一致） */
export const SHIFANG_QINGYUAN_RULE_TYPE = {
  /** 一对一替换：give_goods_num 仅 1 个目标 */
  REPLACE: 1,
  /** 组合拆解：give_goods_num 有多个目标 */
  COMBO_SPLIT: 2,
} as const;

/** 转换规则状态 */
export const SHIFANG_QINGYUAN_RULE_STATUS = {
  ENABLED: 1,
  DISABLED: 2,
} as const;

/** 外部订单业务类型（由拉取接口族决定，非订单体字段） */
export const SHIFANG_QINGYUAN_ORDER_TYPE = {
  SALE_ORDER: 'SALE_ORDER',
} as const;

/** 订单映射同步状态 */
export const SHIFANG_QINGYUAN_ORDER_SYNC_STATUS = {
  SUCCESS: 1,
  RETRY: 2,
  FAILED: 3,
} as const;

/**
 * 十方清源订单状态（order-api constants）
 * 0待付款 1待发货 2已发货 3已收货 4已完成 6待自提 7自提成功 -4已关闭
 */
export const SHIFANG_QINGYUAN_ORDER_STATUS = {
  PENDING_PAY: 0,
  PENDING_SHIP: 1,
  SHIPPED: 2,
  RECEIVED: 3,
  COMPLETED: 4,
  PENDING_PICKUP: 6,
  PICKUP_DONE: 7,
  CLOSED: -4,
} as const;

/** 支付状态 */
export const SHIFANG_QINGYUAN_PAY_STATUS = {
  UNPAID: 0,
  PAID: 1,
} as const;

/** 可同步入库：已支付且非待付款（具体还需 pay_status=1） */
export const SHIFANG_QINGYUAN_ORDER_SYNCABLE_STATUSES = new Set<number>([
  SHIFANG_QINGYUAN_ORDER_STATUS.PENDING_SHIP,
  SHIFANG_QINGYUAN_ORDER_STATUS.SHIPPED,
  SHIFANG_QINGYUAN_ORDER_STATUS.RECEIVED,
  SHIFANG_QINGYUAN_ORDER_STATUS.COMPLETED,
  SHIFANG_QINGYUAN_ORDER_STATUS.PENDING_PICKUP,
  SHIFANG_QINGYUAN_ORDER_STATUS.PICKUP_DONE,
  SHIFANG_QINGYUAN_ORDER_STATUS.CLOSED,
]);

/** 视为已发货 */
export const SHIFANG_QINGYUAN_ORDER_SHIPPED_STATUSES = new Set<number>([
  SHIFANG_QINGYUAN_ORDER_STATUS.SHIPPED,
  SHIFANG_QINGYUAN_ORDER_STATUS.RECEIVED,
  SHIFANG_QINGYUAN_ORDER_STATUS.COMPLETED,
  SHIFANG_QINGYUAN_ORDER_STATUS.PICKUP_DONE,
]);

/** 售后类型 */
export const SHIFANG_QINGYUAN_REFUND_TYPE = {
  REFUND_ONLY: 1,
  RETURN_REFUND: 2,
  EXCHANGE: 3,
} as const;

/**
 * 售后状态（以 order/constants 实拉为准；缺省按常见维权态）
 * 若环境枚举不同，仅改本常量即可。
 */
export const SHIFANG_QINGYUAN_REFUND_STATUS = {
  APPLY: 0,
  PROCESSING: 1,
  DONE: 2,
  REJECTED: 3,
  CANCELLED: 4,
} as const;

export const SHIFANG_QINGYUAN_REFUND_DONE_STATUSES = new Set<number>([
  SHIFANG_QINGYUAN_REFUND_STATUS.DONE,
]);

export const SHIFANG_QINGYUAN_REFUND_REJECTED_STATUSES = new Set<number>([
  SHIFANG_QINGYUAN_REFUND_STATUS.REJECTED,
  SHIFANG_QINGYUAN_REFUND_STATUS.CANCELLED,
]);

/** 订单 is_feedback */
export const SHIFANG_QINGYUAN_FEEDBACK = {
  NONE: 0,
  PROCESSING: 1,
  DONE: 2,
} as const;

/**
 * 十方 payment_type → 平台 pay_mode
 * 未知类型回退 2（银行转账）；具体枚举以 constants 为准时可再调。
 */
export const SHIFANG_QINGYUAN_PAY_MODE_MAP: Record<number, number> = {
  1: 3, // 微信
  2: 4, // 支付宝
  3: 6, // 余额
  4: 7, // 线下/其它
};

/** 用户列表分页（接口 limit 最大值 100；后期改由数据库配置管理，不走环境变量） */
export const SHIFANG_QINGYUAN_USER_SYNC_DEFAULT_PAGE_SIZE = 100;
export const SHIFANG_QINGYUAN_USER_SYNC_MAX_PAGE_SIZE = 100;
/** 用户同步默认间隔：1 小时 */
export const SHIFANG_QINGYUAN_USER_SYNC_DEFAULT_INTERVAL_MS = 3_600_000;
/** 增量水位重叠窗口，避免边界漏单 */
export const SHIFANG_QINGYUAN_USER_SYNC_OVERLAP_MS = 5 * 60 * 1000;
