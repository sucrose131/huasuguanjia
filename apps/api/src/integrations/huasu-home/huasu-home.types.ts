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
  gender?: number;
  id: number;
  mobile?: string;
  nickname?: string;
  organization_id?: number;
  referrer_id?: number;
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

/** 订单快照（列表单条 / 详情主体字段一致；个别字段类型可能略有差异） */
export interface HuasuHomeOrder {
  actual_amount: number | string;
  address?: HuasuHomeOrderAddressValue;
  address_id?: number;
  after_sales_amount?: number;
  after_sales_status?: number;
  after_sales_type?: number;
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
}

export interface HuasuHomeOrderListData {
  list: HuasuHomeOrder[];
  /** 文档已作废，兼容保留 */
  page?: number;
  page_size?: number;
  total?: number;
}

export interface HuasuHomeOrderListQuery {
  /** 必填：更新时间，格式 Y-m-d H:i:s */
  updated_at: string;
  [key: string]: unknown;
}
