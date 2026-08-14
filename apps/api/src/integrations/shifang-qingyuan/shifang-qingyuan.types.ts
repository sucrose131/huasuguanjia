/**
 * 十方清源对接的类型定义
 * 对应 docs/global/integrations/shifang-qingyuan/goods-api.md
 */

/** 十方清源统一响应结构（成功码：code === 0） */
export interface ShifangQingyuanResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
}

/** 十方清源请求选项 */
export interface ShifangQingyuanRequestOptions {
  /** 请求超时（毫秒），默认 30000 */
  timeout?: number;
  /** 额外的请求头 */
  headers?: Record<string, string>;
}

/** 成功返回码 */
export const SHIFANG_QINGYUAN_SUCCESS_CODE = 0;

/* ==================== 商品列表 / 详情 ==================== */

/** 商品主信息（qimall_goods 表） */
export interface ShifangQingyuanGoods {
  id: number;
  mall_id: number;
  mch_id: number;
  goods_name: string;
  subtitle: string;
  /** 售价（元） */
  price: number;
  /** 原价（元） */
  original_price: number;
  /** 成本价（元） */
  cost_price: number;
  unit: string;
  cover_pic: string;
  bannar_pic: unknown[];
  video_url: string;
  video_cover_pic: string;
  /** 是否上架：1=上架，0=下架 */
  is_on_sale: number;
  is_attr: number;
  attr_groups: string;
  attr_groups_format: string;
  /** 状态：1=启用 */
  status: number;
  stock: number;
  stock_warning: number;
  is_show_stock: number;
  is_show_sales: number;
  virtual_sales: number;
  sales_num: number;
  buy_num_limit: number;
  freight_type: number;
  freight_rules_type: number;
  freight_id: number;
  shipping_fee: number;
  free_shipping_num: number;
  free_shipping_money: number;
  /** 商品类型：1=实物，2=虚拟 */
  goods_type: number;
  detail: string;
  is_area_limit: number;
  area_limit: unknown[];
  services: string;
  labels: string;
  goods_source: string;
  check_status: number;
  check_remark: string;
  sort: number;
  created_at: number;
  updated_at: number;
  is_show: number;
  comment_score: number;
  goods_no: string;
  is_pay_limit: number;
  pay_limit: unknown;
  can_feedback: number;
  goods_subtype: number;
  is_virtual_feedback: number;
  freight_compute_mode: number;
}

/** 商品分类（qimall_goods_cate 表） */
export interface ShifangQingyuanGoodsCate {
  id: number;
  mall_id: number;
  mch_id: number;
  parent_id: number;
  name: string;
  pic: string;
  big_pic: string;
  advert_pic: string;
  advert_url: string;
  advert_open_type: string;
  advert_params: unknown;
  is_show: number;
  status: number;
  sort: number;
  level: number;
  text_color: string;
  created_at: number;
  updated_at: number;
}

/** 商品SKU（qimall_goods_attr 表） */
export interface ShifangQingyuanGoodsAttr {
  id: number;
  goods_id: number;
  name: string;
  sign_id: string;
  stock: number;
  /** 售价（元） */
  price: number;
  /** 原价（元） */
  original_price: number;
  /** 成本价（元） */
  cost_price: number;
  goods_no: string;
  weight: number;
  pic_url: string;
  /** 状态：1=启用 */
  status: number;
  version: number;
  sort: number;
  created_at: number;
  updated_at: number;
  is_show: number;
  is_show_code: number;
  spec_no: string;
}

/**
 * give_goods_num 兼容两种格式：
 * - 对象格式：{ "商品id": 数量 }（旧格式）
 * - 数组格式：[{ goods_id, num }]（文档标准格式）
 */
export type GiveGoodsNum = Record<string, number> | Array<{ goods_id: number; num: number }>;

/** 云库存赠送方案（qimall_addons_cloud_stock_gift_plan 表） */
export interface ShifangQingyuanCloudStockGiftPlan {
  id: number;
  mall_id: number;
  goods_id: number[];
  give_goods_num: GiveGoodsNum;
  give_goods_id: string | number[];
  gift_condition_level: string;
  gift_condition_self_level: string;
  /** 0=固定数量，1=按购买数量倍数 */
  is_gift_goods_quantity: number;
  /** 1=启用，0=禁用，-1=删除 */
  status: number;
  created_at: number;
  updated_at: number;
}

/** level_reward 数组元素 */
export interface ShifangQingyuanLevelReward {
  level: number;
  name: string;
  direct_over_reward: number;
  direct_equal_reward: number;
  indirect_over_reward: number;
  indirect_equal_reward: number;
}

/** 云库存升级礼包（qimall_addons_cloud_stock_upgrade_bag 表） */
export interface ShifangQingyuanCloudStockUpgradeBag {
  id: number;
  mall_id: number;
  name: string;
  level: number;
  goods_id: number[];
  give_goods_num: GiveGoodsNum;
  give_goods_id: number[];
  /** 1=启用，0=禁用 */
  is_enable: number;
  level_reward: ShifangQingyuanLevelReward[];
  /** 0=固定金额，1=百分比 */
  is_percent: number;
  /** 1=启用，0=禁用，-1=删除 */
  status: number;
  created_at: number;
  updated_at: number;
}

/** 商品列表/详情单条数据（列表与详情结构一致） */
export interface ShifangQingyuanGoodsItem {
  goods: ShifangQingyuanGoods;
  goods_cate: ShifangQingyuanGoodsCate[];
  qimall_goods_attr: ShifangQingyuanGoodsAttr[];
  cloud_stock_gift_plan: ShifangQingyuanCloudStockGiftPlan[];
  cloud_stock_upgrade_bag: ShifangQingyuanCloudStockUpgradeBag[];
}

/** 商品列表返回数据 */
export interface ShifangQingyuanGoodsListData {
  list: ShifangQingyuanGoodsItem[];
  pagination: {
    total: number;
    page: number;
    page_size: number;
  };
}

/** 商品列表请求参数 */
export interface ShifangQingyuanGoodsListQuery {
  page?: number;
  limit?: number;
  keyword?: string;
  is_on_sale?: number;
  cate_id?: number;
  goods_ids?: number[];
}

/** 商品详情返回数据 */
export interface ShifangQingyuanGoodsDetailData extends ShifangQingyuanGoodsItem {}

/** 商品常量枚举映射项 */
export interface ShifangQingyuanConstantMapItem {
  value: number;
  label: string;
}

/** 商品常量字段定义 */
export interface ShifangQingyuanConstantField {
  desc: string;
  map: ShifangQingyuanConstantMapItem[];
}

/** 商品常量返回数据 */
export interface ShifangQingyuanGoodsConstantsData {
  goods: Record<string, ShifangQingyuanConstantField>;
  goods_attr: Record<string, ShifangQingyuanConstantField>;
  goods_cate: Record<string, ShifangQingyuanConstantField>;
  cloud_stock_gift_plan: Record<string, ShifangQingyuanConstantField>;
  cloud_stock_upgrade_bag: Record<string, ShifangQingyuanConstantField>;
}

/* ==================== 订单列表 / 详情 / 售后 ==================== */

/** 订单主信息（qimall_order）；金额字段单位为元（与商品接口一致） */
export interface ShifangQingyuanOrder {
  id: number;
  mall_id: number;
  mch_id: number;
  store_id: number;
  user_id: number;
  order_no: string;
  out_trade_no: string;
  mobile: string;
  province: number;
  city: number;
  area: number;
  town: number;
  community: number;
  address: string;
  region_name: string;
  zip: string;
  receiver_name: string;
  remark: string;
  seller_remark: string;
  shipping_type: number;
  shipping_money: number;
  reduce_shipping_money: number;
  refund_money: number;
  /** 实付金额（元） */
  pay_money: number;
  /** 商品优惠后总价（元） */
  goods_price: number;
  /** 商品原本总价（元） */
  original_goods_price: number;
  ip: string;
  coupon_id: number;
  coupon_money: number;
  score: number;
  score_money: number;
  order_status: number;
  pay_status: number;
  shipping_status: number;
  review_status: number;
  is_feedback: number;
  payment_type: number;
  marketing_id: number;
  marketing_type: string;
  invoice_id: number;
  status: number;
  is_comment: number;
  is_recycle: number;
  is_virtual: number;
  is_new_user: number;
  pay_time: number;
  shipping_time: number;
  sign_time: number;
  consign_time: number;
  finish_time: number;
  close_time: number;
  extra_info: string;
  order_source: string;
  created_at: number;
  updated_at: number;
  is_bill: number;
  bill_time: number;
  clerk_code: string;
  is_print: number;
  extra_data?: unknown;
  goods_subtype: number;
}

/** 订单明细（qimall_order_detail）；金额字段单位为元 */
export interface ShifangQingyuanOrderDetail {
  id: number;
  mall_id: number;
  order_id: number;
  user_id: number;
  mch_id: number;
  store_id: number;
  goods_id: number;
  goods_name: string;
  goods_attr_id: number;
  goods_attr_name: string;
  sign_id: string;
  attr_groups_format: string;
  /** 单价（元） */
  price: number;
  cost_price: number;
  num: number;
  adjust_money: number;
  /** 行优惠后总价（元） */
  goods_price: number;
  /** 行原本总价（元） */
  original_goods_price: number;
  pic_url: string;
  marketing_id: number;
  marketing_type: string;
  order_type: number;
  give_score: number;
  order_status: number;
  shipping_status: number;
  is_feedback: number;
  remark: string;
  is_evaluate: number;
  refund_balance_money: number;
  is_virtual: number;
  status: number;
  extra_info: string;
  created_at: number;
  updated_at: number;
  order_source: string;
  shipped_num: number;
  extra_data?: unknown;
  unit: string;
  goods_subtype: number;
  marketing?: unknown;
}

/** 售后单（qimall_order_refund） */
export interface ShifangQingyuanOrderRefund {
  id: number;
  mall_id: number;
  mch_id: number;
  store_id: number;
  user_id: number;
  order_id: number;
  order_detail_id: number;
  order_no: string;
  type: number;
  reason: string;
  remark: string;
  pic_list?: unknown[];
  refuse_remark: string;
  express: string;
  express_no: string;
  saler_express: string;
  customer_name: string;
  saler_express_no: string;
  saler_address?: unknown;
  is_refund: number;
  refund_at: number;
  /** 申请退款金额（元） */
  refund_price: number;
  /** 实际退款金额（元） */
  reality_refund_price: number;
  express_at: number;
  saler_express_at: number;
  step_status: number;
  refund_status: number;
  status: number;
  created_at: number;
  updated_at: number;
  goods_type: number;
  refund_remark: string;
  old_reality_refund_price: number;
  num: number;
  order_source: string;
  is_auto_refund: number;
  steps?: ShifangQingyuanOrderRefundStep[];
}

export interface ShifangQingyuanOrderRefundStep {
  id: number;
  order_refund_id: number;
  role: number;
  content: string;
  step_num: number;
  step_status: number;
  status: number;
  created_at: number;
  updated_at: number;
}

/** 物流（qimall_order_express） */
export interface ShifangQingyuanOrderExpress {
  id: number;
  order_id: number;
  cs_order_id: number;
  order_detail_ids?: unknown;
  shipping_type: number;
  express_id: number;
  express_name: string;
  express_no: string;
  customer_name: string;
  buyer_id: number;
  buyer_name: string;
  operator_id: number;
  operator_username: string;
  memo: string;
  status: number;
  created_at: number;
  updated_at: number;
  nums?: unknown;
  source_table: string;
  source_table_id: number;
  edit_num: number;
}

/** 列表/详情共用完整订单快照（list 自 2026-08-12 起与 detail 同构） */
export interface ShifangQingyuanOrderDetailData {
  order: ShifangQingyuanOrder;
  details: ShifangQingyuanOrderDetail[];
  refunds?: ShifangQingyuanOrderRefund[];
  actions?: unknown[];
  behavior_logs?: unknown[];
  express?: ShifangQingyuanOrderExpress[];
  extra?: unknown;
  invoice?: unknown;
  /** list 独有：下单会员（已过滤敏感字段） */
  user?: unknown;
}

/** 列表单条 = 完整快照 */
export type ShifangQingyuanOrderListItem = ShifangQingyuanOrderDetailData;

export interface ShifangQingyuanOrderListData {
  list: ShifangQingyuanOrderListItem[];
  pagination: {
    total: number;
    page: number;
    page_size: number;
  };
}

export interface ShifangQingyuanOrderListQuery {
  page?: number;
  limit?: number;
  order_no?: string;
  order_status?: number;
  pay_status?: number;
  shipping_status?: number;
  start_time?: string;
  end_time?: string;
}

export interface ShifangQingyuanRefundListQuery {
  page?: number;
  limit?: number;
  order_id?: number;
  refund_status?: number;
  type?: number;
  start_time?: string;
  end_time?: string;
}

export interface ShifangQingyuanRefundListItem {
  refund: ShifangQingyuanOrderRefund;
  steps?: ShifangQingyuanOrderRefundStep[];
  detail?: ShifangQingyuanOrderDetail;
  order?: ShifangQingyuanOrder;
}

export interface ShifangQingyuanRefundListData {
  list: ShifangQingyuanRefundListItem[];
  pagination: {
    total: number;
    page: number;
    page_size: number;
  };
}

export interface ShifangQingyuanOrderConstantsData {
  order: Record<string, ShifangQingyuanConstantField>;
  order_detail: Record<string, ShifangQingyuanConstantField>;
  order_refund: Record<string, ShifangQingyuanConstantField>;
  order_refund_step: Record<string, ShifangQingyuanConstantField>;
  order_action: Record<string, ShifangQingyuanConstantField>;
  order_behavior_logs: Record<string, ShifangQingyuanConstantField>;
  order_express: Record<string, ShifangQingyuanConstantField>;
}

/* ==================== 用户列表 / 详情 ==================== */

/** 用户主信息（qimall_user 全量字段 + 补充字段，已过滤 password、transaction_password） */
export interface ShifangQingyuanUser {
  id: number;
  mall_id: number;
  username?: string;
  mobile?: string;
  nickname?: string;
  birthday?: string;
  parent_id?: number;
  parent_mobile?: string;
  parent_username?: string;
  parent_nickname?: string;
  status?: number;
  level?: number;
  level_name?: string;
  created_at?: number;
  updated_at?: number;
  [key: string]: unknown;
}

/** 会员等级记录（qimall_user_level）；level=0 时为 null */
export interface ShifangQingyuanUserLevel {
  id: number;
  mall_id: number;
  level: number;
  name: string;
  status?: number;
  [key: string]: unknown;
}

/** 云库存代理（全量字段 + level_name）；非代理为 null */
export interface ShifangQingyuanCloudStockAgent {
  id: number;
  mall_id: number;
  user_id: number;
  level?: number;
  level_name?: string;
  status?: number;
  [key: string]: unknown;
}

/** 列表/详情共用：每个用户含 user / user_level / cloud_stock_agent */
export interface ShifangQingyuanUserItem {
  user: ShifangQingyuanUser;
  user_level: ShifangQingyuanUserLevel | null;
  cloud_stock_agent: ShifangQingyuanCloudStockAgent | null;
}

export interface ShifangQingyuanUserListData {
  list: ShifangQingyuanUserItem[];
  pagination: {
    total: number;
    page: number;
    page_size: number;
  };
}

export interface ShifangQingyuanUserListQuery {
  page?: number;
  limit?: number;
  keyword?: string;
  level?: number;
  status?: number;
  start_time?: string;
  end_time?: string;
}

/**
 * 平台客户身份描述（hspsi_basic_customer.levels）
 * 仅存中文标签数组，例如：["经销商","城市合伙人"]
 */
export type CustomerIdentityLevels = string[];
