/**
 * 华溯之家对接的类型定义
 */

/** 华溯之家统一响应结构（成功码：code === 200） */
export interface HuasuHomeResponse<T = unknown> {
  code: number;
  message?: string;
  msg?: string;
  data?: T;
}

/** 华溯之家请求选项 */
export interface HuasuHomeRequestOptions {
  /** 请求超时（毫秒），默认 30000 */
  timeout?: number;
  /** 额外的请求头 */
  headers?: Record<string, string>;
}

/** 成功返回码 */
export const HUASU_HOME_SUCCESS_CODE = 200;

/* ==================== 商品列表（POST /hspsi/product/list） ==================== */

/** 套餐内包含的单品（packages[].singles） */
export interface HuasuHomePackageSingle {
  cover: string;
  created_at: string;
  gift_number: number;
  id: number;
  name: string;
  number: number;
  original_price: number;
  product_id: number;
  product_package_id: number;
  unit: number;
  unit_str: string;
  updated_at: string;
}

/** 商品套餐（packages） */
export interface HuasuHomePackage {
  banner: string[] | null;
  cate_id: number;
  /** 百岁加类型：1-主卡，2-副卡，3-次卡 */
  centenarian_type: number;
  cover: string;
  created_at: string;
  deleted_at: string;
  desc: string;
  detail: string;
  discount_price: string;
  /** 全家福类型：1-福A，2-福B */
  family_portrait_type: number;
  id: number;
  /** 是否包邮：0-否，1-是 */
  is_pinkage: number;
  /** 标签类型：1-热门，2-推荐，3-高端 */
  label_type: number;
  limit_number: number;
  name: string;
  original_price: number;
  /** 套餐类型：0-普通，1-百岁+，2-服务商，3-会议门票 */
  package_type: number;
  postage_template_id: number;
  /** 包含的单品列表 */
  singles: HuasuHomePackageSingle[];
  sort: number;
  /** 状态：0-停用，1-启用 */
  status: number;
  stock: number;
  /** 类型：0-实物，1-虚拟 */
  type: number;
  updated_at: string;
  user_level_id: number;
}

/** 商品 SKU（products[].skus / mapping.skus） */
export interface HuasuHomeProductSku {
  created_at: string;
  deleted_at: string;
  discount_price: number;
  id: number;
  name: string;
  number: number;
  original_price: number;
  product_id: number;
  sort: number;
  staff_price: number;
  /** 状态：0-停用，1-启用 */
  status: number;
  stock: number;
  unit: number;
  unit_str: string;
  updated_at: string;
}

/**
 * 单品映射（products[].mapping）
 *
 * 结构与单品基本一致，但不含 mapping 字段（不递归），deleted_at 为 null
 */
export interface HuasuHomeProductMapping {
  banner: string[] | null;
  cate_id: number;
  cover: string;
  created_at: string;
  deleted_at: null;
  desc: string;
  detail: string;
  id: number;
  is_pinkage: number;
  label_type: number;
  name: string;
  postage_template_id: number;
  single_type: number;
  skus: HuasuHomeProductSku[];
  sort: number;
  status: number;
  type: number;
  unit: number;
  unit_str: string;
  updated_at: string;
}

/** 单品（products） */
export interface HuasuHomeProduct {
  banner: string[] | null;
  cate_id: number;
  cover: string;
  created_at: string;
  deleted_at: string;
  desc: string;
  detail: string;
  id: number;
  /** 是否包邮：0-否，1-是 */
  is_pinkage: number;
  /** 标签类型：1-热门，2-推荐，3-高端 */
  label_type: number;
  /** 单品映射，可能为 null */
  mapping: HuasuHomeProductMapping | null;
  name: string;
  postage_template_id: number;
  /** 单品类型：0-其他，1-三氧自体血，2-生物共振能量舱，3-肠道排毒疗法，4-清淤疗法，5-臭氧水机，6-骨关节养护，7-女性私密清洗，8-O3介入，9-中药熏蒸，10-华溯芯，11-体验，12-会议商品，13-食宿 */
  single_type: number;
  /** sku 列表 */
  skus: HuasuHomeProductSku[];
  sort: number;
  /** 状态：0-停用，1-启用 */
  status: number;
  /** 类型：0-实物，1-虚拟 */
  type: number;
  unit: number;
  unit_str: string;
  updated_at: string;
}

/** 商品列表返回数据 */
export interface HuasuHomeProductListData {
  /** 套餐列表数据 */
  packages: HuasuHomePackage[];
  /** 单品列表数据 */
  products: HuasuHomeProduct[];
}

/* ==================== 订单列表 / 详情（结构一致） ==================== */

export interface HuasuHomeOrderAddress {
  address: string;
  city: string;
  city_id: number;
  district: string;
  district_id: number;
  province: string;
  province_id: number;
}

/** 收货地址：列表多为对象；详情文档为 string[] | null */
export type HuasuHomeOrderAddressValue =
  | HuasuHomeOrderAddress
  | string[]
  | string
  | null;

export interface HuasuHomeOrderUser {
  avatar?: string;
  birth?: string;
  /** 百岁加类型：1主卡 2副卡 3次卡 */
  centenarian_type?: number;
  gender?: number;
  id: number;
  /** 是否百岁加会员：1是 */
  is_centenarian?: number;
  /** 是否省级合伙人：1是 */
  is_provincial_partner?: number;
  level?: HuasuHomeUserLevel | null;
  level_id?: number;
  mobile?: string;
  nickname?: string;
  organization_id?: number;
  referrer_id?: number;
  remark?: string;
  status?: number;
  uid?: number;
}

export interface HuasuHomeOrderReferrer {
  id?: number;
  mobile?: string;
  nickname?: string;
  organization_id?: number;
}

export interface HuasuHomeOrderShipment {
  channel_id?: number;
  created_at?: number;
  id: number;
  items?: unknown;
  order_id?: number;
  pickup_address?: string;
  pickup_hospital_id?: number;
  pickup_organization_id?: number;
  status?: number;
  tracking_no?: string;
  type?: number;
  updated_at?: number;
}

export interface HuasuHomeOrderPackageItem {
  cover?: string;
  discount_price?: string;
  name?: string;
  number: number;
  original_price?: string;
  product_id: number;
  staff_price?: string;
  unit?: number;
  gift_number?: number;
}

export interface HuasuHomeOrderItem {
  after_sales_amount?: number;
  created_at?: string;
  id: number;
  is_repurchase?: number;
  /** 套餐商品 id（product_type=1 时） */
  package_id?: number;
  /** 实际发货单品快照；数量按 (number+gift_number)*quantity */
  package_items?: HuasuHomeOrderPackageItem[] | null;
  package_snapshot?: unknown;
  price: number;
  /** 单品商品 id（product_type=2 时） */
  product_id: number;
  product_snapshot?: { type?: number; [key: string]: unknown };
  /** 1=套餐，2=单品 */
  product_type?: number;
  quantity: number;
  /** 规格 id（单品有意义；套餐下单规格通常为 0） */
  sku_id: number;
  updated_at?: string;
}

export interface HuasuHomeOrderPayment {
  amount?: string | number;
  app_id?: string;
  created_at?: string;
  id?: number;
  mch_id?: string;
  order_sn?: string;
  order_type?: string;
  out_trade_no?: string;
  pay_time?: string;
  payment_method?: string | number;
  refund_amount?: string | number;
  refund_status?: number;
  refund_time?: string;
  status?: string | number;
  transaction_id?: string;
  user_id?: number;
  [key: string]: unknown;
}

/** 售后权益扣减记录（回库数量 = gift_number + buy_number） */
export interface HuasuHomeRightsDeductedRecord {
  id?: number;
  after_sales_id?: number;
  user_id?: number;
  /** 1-个人权益 2-家庭组权益 */
  rights_type?: number;
  /** 退回商品 id（华溯 product_id） */
  product_id: number;
  family_code?: string;
  buy_number?: number;
  gift_number?: number;
  remark?: string;
  operator_id?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

/** 售后单（列表/详情嵌套 after_sales） */
export interface HuasuHomeAfterSales {
  id?: number;
  order_id?: number;
  order_sn?: string;
  user_id?: number;
  after_sales_no?: string;
  /** 1-退款 2-退货退款 3-换货 4-异常售后 */
  type?: number;
  initiator_type?: number;
  reason?: string;
  remark?: string;
  /** 0-待处理 1-处理中 2-已完成 3-已拒绝 */
  status?: number;
  images?: string;
  amount?: string | number;
  operator_id?: number;
  operator_type?: number;
  processed_at?: string;
  created_at?: string;
  updated_at?: string;
  rights_deducted_records?: HuasuHomeRightsDeductedRecord[] | null;
}

/** 订单快照（列表单条 / 详情主体字段一致；个别字段类型可能略有差异） */
export interface HuasuHomeOrder {
  actual_amount: number | string;
  address?: HuasuHomeOrderAddressValue;
  address_id?: number;
  after_sales_amount?: number;
  after_sales_status?: number;
  after_sales_type?: number;
  after_sales?: HuasuHomeAfterSales | null;
  auto_ship_time?: number;
  cancel_reason?: string;
  consignee?: string;
  created_at: string;
  deleted_at?: string | null;
  id: number;
  items: HuasuHomeOrderItem[];
  mobile?: string;
  order_sn: string;
  order_status: number;
  org_id?: number;
  payment_method: number;
  referrer?: HuasuHomeOrderReferrer | null;
  referrer_id?: number;
  remark?: string;
  service_org_id: number;
  shipments?: HuasuHomeOrderShipment[] | null;
  payments?: HuasuHomeOrderPayment | null;
  total_amount: number | string;
  updated_at: string;
  user?: HuasuHomeOrderUser | null;
  user_id: number;
  ver?: number;
  /**
   * 完款后由分期单转来的普通订单会带此字段。
   * 接口可能尚未返回：必须先判断字段是否存在，有值才跳过同步。
   */
  order_installment_no?: string;
}

export interface HuasuHomeOrderListData {
  list: HuasuHomeOrder[];
  page: number;
  page_size: number;
  total: number;
}

export interface HuasuHomeOrderListQuery {
  page: number;
  page_size: number;
  /** 必填：更新时间，格式 Y-m-d H:i:s */
  updated_at: string;
}

/* ==================== 会议门票订单列表（POST /hspsi/order-conference/list） ==================== */

export interface HuasuHomeConferenceTicket {
  conference_id?: number;
  created_at?: string;
  deleted_at?: string;
  id?: number;
  product_package_id?: number;
  remark?: string;
  sort?: number;
  updated_at?: string;
  user_group_limit?: string;
}

export interface HuasuHomeConferenceInfo {
  address?: string;
  cover?: string;
  created_at?: string;
  date?: string;
  deadline?: string;
  deleted_at?: string;
  description?: string;
  id?: number;
  location_type?: number;
  max_participants?: number;
  name?: string;
  sort?: number;
  status?: number;
  time?: string;
  type?: number;
  updated_at?: string;
}

export interface HuasuHomeConferencePackageSnapshot {
  centenarian_type?: number;
  cover?: string;
  discount_price?: string;
  family_portrait_type?: number;
  id?: number;
  name?: string;
  original_price?: string;
  package_type?: number;
  user_level_id?: number;
}

export interface HuasuHomeConferenceRefund {
  created_at?: string;
  deleted_at?: string;
  id?: number;
  operator_id?: number;
  operator_type?: string;
  order_id?: number;
  order_sn?: string;
  out_refund_no?: string;
  reason?: string;
  refund_amount?: number;
  /** 1-退款中，2-已退款，3-退款失败 */
  refund_status?: number;
  remark?: string;
  updated_at?: string;
  user_id?: number;
}

export interface HuasuHomeConferenceOrder {
  actual_amount: number | string;
  conference?: HuasuHomeConferenceInfo | null;
  conference_id?: number;
  conference_ticket?: HuasuHomeConferenceTicket | null;
  conference_ticket_id?: number;
  created_at: string;
  deleted_at?: string;
  id: number;
  order_sn: string;
  /** 1-待付款，2-已取消，3-已付款，4-退款申请，5-已退款，9-支付中 */
  order_status: number;
  package_items?: HuasuHomeOrderPackageItem[] | null;
  package_snapshot?: HuasuHomeConferencePackageSnapshot | null;
  pay_time?: string;
  /** 0-未选择，1-微信，2-支付宝，3-余额支付 */
  payment_method: number;
  price: number;
  product_package_id: number;
  quantity: number;
  refund?: HuasuHomeConferenceRefund | null;
  remark?: string;
  /** 0-未发放，1-已发放 */
  rights_granted: number;
  total_amount: number | string;
  updated_at: string;
  user?: HuasuHomeOrderUser | null;
  user_id: number;
  /** 0-待核销，1-已核销 */
  verify_status: number;
  verify_time?: string;
}

export interface HuasuHomeConferenceOrderListData {
  list: HuasuHomeConferenceOrder[];
  page: number;
  page_size: number;
  total: number;
}

/* ==================== 分期订单列表（POST /hspsi/order-installment/list） ==================== */

/** 分期期次权益发放（rights_issue） */
export interface HuasuHomeInstallmentRightsIssue {
  id?: number;
  installment_no?: string;
  installment_period_no?: string;
  package_id?: number;
  product_id: number;
  /** 本期发放的购买数量 */
  number: number;
  cumulative_issue_number?: number;
  cumulative_issued_rate?: number;
  operator_id?: number;
  remark?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

/** 分期期次 */
export interface HuasuHomeInstallmentPeriod {
  id?: number;
  installment_no?: string;
  no: string;
  period?: number;
  amount?: number;
  paid_amount?: number;
  unpaid_amount?: number;
  completion_rate?: number;
  offline_paid_time?: string;
  operator_id?: number;
  remark?: string;
  rights_issue?: HuasuHomeInstallmentRightsIssue | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

/** 分期购买商品（单品） */
export interface HuasuHomeInstallmentProduct {
  id?: number;
  installment_no?: string;
  package_id?: number;
  product_id: number;
  name?: string;
  number: number;
  gift_number?: number;
  issued_number?: number;
  issued_gift_number?: number;
  issued_rate?: number;
  original_price?: number;
  unit?: number;
  cover?: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

/**
 * 分期售后（hszj_order_installment_aftersale）
 * 列表字段名为 aftersale，可能是单条、数组或 null。
 */
export interface HuasuHomeInstallmentAftersale {
  id?: number;
  installment_no?: string;
  package_id?: number;
  /** 售后单品 id */
  product_id: number;
  /** 售后数量 */
  number: number;
  remark?: string;
  operator_id?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

/** 分期订单快照 */
export interface HuasuHomeInstallmentOrder {
  id: number;
  no: string;
  order_sn?: string;
  /**
   * 1-待审核 2-审核驳回 3-进行中 4-已完成 5-已售后 6-已转正常订单
   */
  status: number;
  amount?: number;
  package_amount?: number;
  paid_amount?: number;
  unpaid_amount?: number;
  paid_period?: number;
  completion_rate?: number;
  rights_issue_rate?: number;
  package_id?: number;
  organization_id?: number;
  operator_id?: number;
  is_modify_price?: number;
  offline_order_time?: string;
  remark?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  user_id: number;
  user?: HuasuHomeOrderUser | null;
  products?: HuasuHomeInstallmentProduct[] | null;
  periods?: HuasuHomeInstallmentPeriod[] | null;
  aftersale?: HuasuHomeInstallmentAftersale | HuasuHomeInstallmentAftersale[] | null;
  audits?: unknown;
}

export interface HuasuHomeInstallmentOrderListData {
  list: HuasuHomeInstallmentOrder[];
  page: number;
  page_size: number;
  total: number;
}

/* ==================== 用户列表（POST /hspsi/user/list） ==================== */

export interface HuasuHomeUserLevel {
  created_at?: string;
  icon?: string;
  id?: number;
  /** 等级值：-1拓展 0基础 1全家福 2事业合伙人 3创始合伙人（不是主键 id） */
  level?: number;
  name?: string;
  sort?: number;
  status?: number;
  updated_at?: string;
}

export interface HuasuHomeUserReferrer {
  avatar?: string;
  id?: number;
  mobile?: string;
  nickname?: string;
  uid?: number;
}

export interface HuasuHomeUserOrganization {
  id: number;
  name?: string;
  code?: string;
  [key: string]: unknown;
}

export interface HuasuHomeUser {
  avatar?: string;
  birth?: string;
  /** 百岁加类型：1主卡 2副卡 3次卡 */
  centenarian_type?: number;
  country_code?: string;
  created_at?: string;
  gender?: number;
  /** 华溯用户主键 */
  id: number;
  /** 是否百岁加会员：1是 */
  is_centenarian?: number;
  /** 是否省级合伙人：1是 */
  is_provincial_partner?: number;
  level?: HuasuHomeUserLevel | null;
  level_id?: number;
  mobile?: string;
  nickname?: string;
  organization?: HuasuHomeUserOrganization | null;
  organization_id?: number;
  referrer?: HuasuHomeUserReferrer | null;
  referrer_id?: number;
  remark?: string;
  status?: number;
  uid?: number;
  updated_at?: string;
  [key: string]: unknown;
}

export interface HuasuHomeUserListData {
  list: HuasuHomeUser[];
  page: number;
  page_size: number;
  total: number;
}

export interface HuasuHomeUserListQuery {
  page: number;
  page_size: number;
  /** 最小用户 ID：返回 id 大于该值的用户 */
  id: number;
}

/**
 * 平台客户身份描述（hspsi_basic_customer.levels）
 * 仅存中文标签数组，例如：["全家福会员","省级合伙人","百岁加会员-主卡"]
 */
export type CustomerIdentityLevels = string[];

