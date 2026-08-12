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
  /** 售价（分） */
  price: number;
  /** 原价（分） */
  original_price: number;
  /** 成本价（分） */
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
  /** 售价（分） */
  price: number;
  /** 原价（分） */
  original_price: number;
  /** 成本价（分） */
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
