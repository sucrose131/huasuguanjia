/**
 * 全局业务单号前缀。
 *
 * 单号格式：{业务前缀}{上海时区日期YYYYMMDD}{全局当日序号6位}
 * 这些值只用于业务单号，不参与数据库主键生成。
 */
export const BUSINESS_PREFIX = {
  /** 采购申请单；hspsi_purchase_approve.pur_no。 */
  PURCHASE_APPLICATION: 'PA',
  /** 采购订单；hspsi_purchase_order.po_no。 */
  PURCHASE_ORDER: 'PO',
  /** 采购入库单；hspsi_purchase_order_input.po_input_no。 */
  PURCHASE_RECEIPT: 'GA',
  /** 采购退货单/未到货退回单；hspsi_purchase_order_input_exit.po_exit_no。 */
  PURCHASE_RETURN: 'PRT',
  /** 采购付款单；hspsi_purchase_order_payment.pay_no。 */
  PURCHASE_PAYMENT: 'PPY',
  /** 采购退款任务单；hspsi_purchase_refund.refund_no。 */
  PURCHASE_REFUND: 'PRF',
  /** 采购退款流水单；hspsi_purchase_refund_flow.flow_no。 */
  PURCHASE_REFUND_FLOW: 'PRFL',

  /** 生产物料清单；hspsi_production_bom.bom_no。 */
  PRODUCTION_BOM: 'BOM',
  /** 生产计划单；hspsi_production_plan.plan_no。 */
  PRODUCTION_PLAN: 'PP',
  /** 生产缺料清单；hspsi_production_shortage.shortage_no。 */
  PRODUCTION_SHORTAGE: 'PS',
  /** 生产原料出库单；hspsi_production_material_out.out_no。 */
  PRODUCTION_MATERIAL_OUTPUT: 'PMO',
  /** 生产成品入库单；hspsi_production_plan_input.input_no。 */
  PRODUCTION_PRODUCT_INPUT: 'PPI',

  /** 普通销售订单；hspsi_sale_order.so_no，so_property_type=1。 */
  SALES_ORDER: 'SO',
  /** 普通销售出库单；hspsi_sale_order_output.so_output_no。 */
  SALES_OUTPUT: 'SOO',
  /** 销售退货单；hspsi_sale_order_exit.so_exit_no。 */
  SALES_RETURN: 'SOR',
  /** 折价销售订单；hspsi_sale_order.so_no，so_property_type=2。 */
  DISCOUNT_SALES_ORDER: 'DS',
  /** 折价销售出库单；hspsi_sale_order_output.so_output_no。 */
  DISCOUNT_SALES_OUTPUT: 'DSO',
  /** 销售售后服务单；hspsi_sale_order_service.service_no。 */
  SALES_SERVICE: 'AS',
  /** 销售收款单；hspsi_sales_order_payment.pay_no，so_pay_type=1。 */
  SALES_RECEIPT: 'SRC',
  /** 销售退款单；hspsi_sales_order_payment.pay_no，so_pay_type=2。 */
  SALES_REFUND: 'SRF',
  /** 销售换货出库单；hspsi_sale_order_output.so_output_no。 */
  SALES_EXCHANGE_OUTPUT: 'EXO',

  /** 库存调拨单；hspsi_inventory_transfer.transfer_no。 */
  INVENTORY_TRANSFER: 'IT',
  /** 库存调整单；hspsi_inventory_adjust.adjust_no。 */
  INVENTORY_ADJUSTMENT: 'IA',
  /** 库存盘点单；hspsi_inventory_check.check_no。 */
  INVENTORY_CHECK: 'IC',
  /** 库存报亏中间单；hspsi_inventory_loss.loss_no，business_kind=1。 */
  INVENTORY_SHORTAGE: 'ILS',
  /** 报亏出库单；hspsi_inventory_loss_output.loss_no。 */
  INVENTORY_SHORTAGE_OUTPUT: 'ILO',
  /** 报损出库单；hspsi_inventory_loss.loss_no，business_kind=2。 */
  INVENTORY_DAMAGE_OUTPUT: 'ILD',
  /** 报盈入库单；hspsi_inventory_overflow.overflow_no。 */
  INVENTORY_OVERFLOW_INPUT: 'IO',
  /** 通用入库单（初期入库、委托采购入库）；hspsi_inventory_general_order.business_no。 */
  INVENTORY_GENERAL_INPUT: 'GI',
  /** 通用直接出库单；hspsi_inventory_general_order.business_no。 */
  INVENTORY_GENERAL_OUTPUT: 'GO',

  /** 领用申请单；hspsi_draw_approve.draw_no。 */
  REQUISITION_APPLICATION: 'DR',
  /** 领用出库单；hspsi_draw_approve_output.draw_output_no。 */
  REQUISITION_OUTPUT: 'DRO',
  /** 领用退还单；hspsi_draw_approve_output_exit.draw_exit_no。 */
  REQUISITION_RETURN: 'DRR',
} as const;

export type BusinessPrefix = (typeof BUSINESS_PREFIX)[keyof typeof BUSINESS_PREFIX];

export const BUSINESS_NUMBER_TIME_ZONE = 'Asia/Shanghai';
export const BUSINESS_NUMBER_DAILY_LIMIT = 999_999;
