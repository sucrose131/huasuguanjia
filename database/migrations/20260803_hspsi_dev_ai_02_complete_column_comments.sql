-- Target database: hspsi-dev-ai-02
-- Complete missing column comments only; preserve data, indexes, types and defaults.
-- Generated from live information_schema on 2026-08-03.

USE `hspsi-dev-ai-02`;

ALTER TABLE `hspsi_business_document_relation`
  MODIFY COLUMN `relation_id` bigint NOT NULL auto_increment COMMENT '单据关系主键',
  MODIFY COLUMN `upstream_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '上游单据类型',
  MODIFY COLUMN `upstream_id` bigint NOT NULL COMMENT '上游单据ID',
  MODIFY COLUMN `upstream_no` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '上游单号',
  MODIFY COLUMN `downstream_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT '下游单据类型',
  MODIFY COLUMN `downstream_id` bigint NOT NULL COMMENT '下游单据ID',
  MODIFY COLUMN `downstream_no` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT '' COMMENT '下游单号',
  MODIFY COLUMN `relation_kind` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'generated' COMMENT '关系类型（默认generated表示系统生成）',
  MODIFY COLUMN `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人ID',
  MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP on update CURRENT_TIMESTAMP COMMENT '更新时间',
  MODIFY COLUMN `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间';

ALTER TABLE `hspsi_draw_approve`
  MODIFY COLUMN `draw_id` bigint NOT NULL auto_increment COMMENT '领用申请单ID',
  MODIFY COLUMN `draw_qty` int NOT NULL DEFAULT 0 COMMENT '申请领用数量',
  MODIFY COLUMN `fact_draw_qty` int NOT NULL DEFAULT 0 COMMENT '实际领用数量',
  MODIFY COLUMN `applicant_id` bigint NOT NULL DEFAULT 0 COMMENT '领用申请人ID',
  MODIFY COLUMN `draw_reason` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '领用原因',
  MODIFY COLUMN `signature_content` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '电子签名内容',
  MODIFY COLUMN `signature_attachment` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '签名附件地址',
  MODIFY COLUMN `signed_by` bigint NOT NULL DEFAULT 0 COMMENT '签名人ID',
  MODIFY COLUMN `signed_at` datetime NULL DEFAULT NULL COMMENT '签名时间';

ALTER TABLE `hspsi_draw_approve_detail`
  MODIFY COLUMN `draw_qty` int NOT NULL DEFAULT 0 COMMENT '申请领用数量',
  MODIFY COLUMN `is_returnable` tinyint NOT NULL DEFAULT 0 COMMENT '是否可归还（0否，1是）',
  MODIFY COLUMN `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '备注';

ALTER TABLE `hspsi_draw_approve_output`
  MODIFY COLUMN `generation_key` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '自动生成幂等键',
  MODIFY COLUMN `auto_created` tinyint NOT NULL DEFAULT 0 COMMENT '是否由领用申请自动生成（0否，1是）',
  MODIFY COLUMN `output_date` datetime NULL DEFAULT NULL COMMENT '出库日期',
  MODIFY COLUMN `posting_version` int NOT NULL DEFAULT 0 COMMENT '库存过账版本号';

ALTER TABLE `hspsi_draw_approve_output_detail`
  MODIFY COLUMN `draw_detail_id` bigint NOT NULL DEFAULT 0 COMMENT '领用申请明细ID',
  MODIFY COLUMN `draw_qty` int NOT NULL DEFAULT 0 COMMENT '申请领用数量',
  MODIFY COLUMN `fact_draw_qty` int NOT NULL DEFAULT 0 COMMENT '实际领用数量',
  MODIFY COLUMN `is_returnable` tinyint NOT NULL DEFAULT 0 COMMENT '是否可归还（0否，1是）',
  MODIFY COLUMN `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '备注';

ALTER TABLE `hspsi_draw_approve_output_exit`
  MODIFY COLUMN `exit_qty` int NOT NULL DEFAULT 0 COMMENT '领用退还总数量',
  MODIFY COLUMN `return_date` datetime NULL DEFAULT NULL COMMENT '归还日期',
  MODIFY COLUMN `posting_version` int NOT NULL DEFAULT 0 COMMENT '库存过账版本号';

ALTER TABLE `hspsi_draw_approve_output_exit_detail`
  MODIFY COLUMN `so_qty` int NOT NULL DEFAULT 0 COMMENT '原领用出库数量',
  MODIFY COLUMN `exit_qty` int NOT NULL DEFAULT 0 COMMENT '明细退还数量';

ALTER TABLE `hspsi_goods_info`
  MODIFY COLUMN `org_id` bigint NOT NULL DEFAULT 0 COMMENT '商品所属组织ID';

ALTER TABLE `hspsi_inventory_adjust_detail`
  MODIFY COLUMN `warehouse_id` bigint NOT NULL DEFAULT 0 COMMENT '调整仓库ID',
  MODIFY COLUMN `before_qty` int NOT NULL DEFAULT 0 COMMENT '调整前库存数量',
  MODIFY COLUMN `adjust_qty` int NOT NULL DEFAULT 0 COMMENT '调整数量';

ALTER TABLE `hspsi_inventory_alert_period`
  MODIFY COLUMN `warehouse_id` bigint NOT NULL DEFAULT 0 COMMENT '效期预警仓库ID',
  MODIFY COLUMN `batch_no` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '批次号',
  MODIFY COLUMN `alter_qty` int NULL DEFAULT 0 COMMENT '当前库存数量',
  MODIFY COLUMN `end_day` date NULL DEFAULT NULL COMMENT '有效期截止日期';

ALTER TABLE `hspsi_inventory_alert_qty`
  MODIFY COLUMN `safe_qty` int NOT NULL DEFAULT 0 COMMENT '安全库存数量',
  MODIFY COLUMN `safe_less_qty` int NOT NULL DEFAULT 0 COMMENT '低于安全库存的缺口数量',
  MODIFY COLUMN `purchase_qty` int NOT NULL DEFAULT 0 COMMENT '建议补货数量',
  MODIFY COLUMN `fact_qty` int NOT NULL DEFAULT 0 COMMENT '当前实际库存数量';

ALTER TABLE `hspsi_inventory_batch_total`
  MODIFY COLUMN `input_qty` int NOT NULL DEFAULT 0 COMMENT '批次累计入库数量',
  MODIFY COLUMN `output_qty` int NOT NULL DEFAULT 0 COMMENT '批次累计出库数量',
  MODIFY COLUMN `inventory_qty` int NOT NULL DEFAULT 0 COMMENT '当前库存数量';

ALTER TABLE `hspsi_inventory_check`
  MODIFY COLUMN `all_qty` int NOT NULL DEFAULT 0 COMMENT '盘点账面总数量',
  MODIFY COLUMN `less_qty` int NOT NULL DEFAULT 0 COMMENT '盘亏数量',
  MODIFY COLUMN `overflow_qty` int NOT NULL DEFAULT 0 COMMENT '盘盈数量',
  MODIFY COLUMN `overflow_process_qty` int NOT NULL DEFAULT 0 COMMENT '已处理盘盈数量',
  MODIFY COLUMN `less_process_qty` int NOT NULL DEFAULT 0 COMMENT '已处理盘亏数量';

ALTER TABLE `hspsi_inventory_check_detail`
  MODIFY COLUMN `unit_type` int NOT NULL DEFAULT 0 COMMENT '计量单位类型ID',
  MODIFY COLUMN `inventory_qty` int NOT NULL DEFAULT 0 COMMENT '盘点时账面库存数量',
  MODIFY COLUMN `check_qty` int NOT NULL DEFAULT 0 COMMENT '实盘数量',
  MODIFY COLUMN `damaged_qty` int NOT NULL DEFAULT 0 COMMENT '损坏数量',
  MODIFY COLUMN `different_qty` int NOT NULL DEFAULT 0 COMMENT '盘点差异数量',
  MODIFY COLUMN `unit_price` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT '盘点商品单位成本',
  MODIFY COLUMN `different_amount` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT '盘点差异金额';

ALTER TABLE `hspsi_inventory_loss`
  MODIFY COLUMN `source_check_id` bigint NOT NULL DEFAULT 0 COMMENT '来源盘点单ID',
  MODIFY COLUMN `loss_qty` int NOT NULL DEFAULT 0 COMMENT '报损总数量';

ALTER TABLE `hspsi_inventory_loss_detail`
  MODIFY COLUMN `loss_qty` int NOT NULL DEFAULT 0 COMMENT '明细报损数量';

ALTER TABLE `hspsi_inventory_loss_output`
  MODIFY COLUMN `source_loss_id` bigint NOT NULL DEFAULT 0 COMMENT '来源报损单ID',
  MODIFY COLUMN `loss_qty` int NOT NULL DEFAULT 0 COMMENT '报亏出库总数量';

ALTER TABLE `hspsi_inventory_loss_output_detail`
  MODIFY COLUMN `loss_qty` int NOT NULL DEFAULT 0 COMMENT '明细报亏出库数量';

ALTER TABLE `hspsi_inventory_overflow`
  MODIFY COLUMN `source_check_id` bigint NOT NULL DEFAULT 0 COMMENT '来源盘点单ID',
  MODIFY COLUMN `overflow_qty` int NOT NULL DEFAULT 0 COMMENT '报盈总数量';

ALTER TABLE `hspsi_inventory_overflow_detail`
  MODIFY COLUMN `overflow_qty` int NOT NULL DEFAULT 0 COMMENT '明细报盈数量';

ALTER TABLE `hspsi_inventory_total`
  MODIFY COLUMN `input_qty` int NOT NULL DEFAULT 0 COMMENT '商品累计入库数量',
  MODIFY COLUMN `output_qty` int NOT NULL DEFAULT 0 COMMENT '商品累计出库数量',
  MODIFY COLUMN `inventory_qty` int NOT NULL DEFAULT 0 COMMENT '当前库存数量';

ALTER TABLE `hspsi_inventory_total_detail`
  MODIFY COLUMN `operation_qty` int NOT NULL DEFAULT 0 COMMENT '本次库存变动数量',
  MODIFY COLUMN `source_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '库存变动来源类型',
  MODIFY COLUMN `source_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '库存变动来源单号',
  MODIFY COLUMN `operation_by` bigint NOT NULL DEFAULT 0 COMMENT '库存操作人ID',
  MODIFY COLUMN `after_qty` int NOT NULL DEFAULT 0 COMMENT '变动后库存数量',
  MODIFY COLUMN `posting_key` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '库存过账幂等键',
  MODIFY COLUMN `goods_code` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '商品编码快照',
  MODIFY COLUMN `goods_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '商品名称快照',
  MODIFY COLUMN `sku_spec` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '规格型号快照',
  MODIFY COLUMN `org_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '组织名称快照',
  MODIFY COLUMN `warehouse_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '仓库名称快照',
  MODIFY COLUMN `unit_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '计量单位名称快照';

ALTER TABLE `hspsi_inventory_transfer`
  MODIFY COLUMN `transfer_no` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '库存调拨单号',
  MODIFY COLUMN `status` tinyint NOT NULL DEFAULT 0 COMMENT '调拨单状态（数据字典）';

ALTER TABLE `hspsi_inventory_transfer_detail`
  MODIFY COLUMN `unit_type` int NOT NULL DEFAULT 0 COMMENT '计量单位类型ID',
  MODIFY COLUMN `transfer_qty` int NOT NULL DEFAULT 0 COMMENT '调拨数量';

ALTER TABLE `hspsi_production_bom`
  MODIFY COLUMN `bom_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT 'BOM单号';

ALTER TABLE `hspsi_production_bom_detail`
  MODIFY COLUMN `require_qty` int NOT NULL DEFAULT 0 COMMENT 'BOM单位需求数量';

ALTER TABLE `hspsi_production_material_out`
  MODIFY COLUMN `out_id` int NOT NULL auto_increment COMMENT '生产出库单主键',
  MODIFY COLUMN `out_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '生产出库单号',
  MODIFY COLUMN `plan_id` bigint NULL DEFAULT NULL COMMENT '生产计划ID',
  MODIFY COLUMN `warehouse_id` int NULL DEFAULT NULL COMMENT '原料出库仓库ID',
  MODIFY COLUMN `org_id` int NULL DEFAULT NULL COMMENT '生产出库所属组织ID',
  MODIFY COLUMN `out_date` datetime NULL DEFAULT NULL COMMENT '生产出库日期',
  MODIFY COLUMN `out_type` tinyint NOT NULL DEFAULT 1 COMMENT '生产出库类型（数据字典）',
  MODIFY COLUMN `confirm_tag` int NOT NULL DEFAULT 0 COMMENT '出库确认状态（0待确认，1已确认）',
  MODIFY COLUMN `remark` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NULL DEFAULT NULL COMMENT '备注',
  MODIFY COLUMN `created_by` int NULL DEFAULT NULL COMMENT '创建人ID',
  MODIFY COLUMN `created_date` datetime NULL DEFAULT NULL COMMENT '创建时间',
  MODIFY COLUMN `updated_by` int NULL DEFAULT NULL COMMENT '更新人ID',
  MODIFY COLUMN `updated_date` datetime NULL DEFAULT NULL COMMENT '更新时间',
  MODIFY COLUMN `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间';

ALTER TABLE `hspsi_production_material_out_detail`
  MODIFY COLUMN `serial_number` int NOT NULL auto_increment COMMENT '生产出库明细主键',
  MODIFY COLUMN `out_id` int NOT NULL COMMENT '生产出库单ID',
  MODIFY COLUMN `goods_id` int NULL DEFAULT NULL COMMENT '商品ID',
  MODIFY COLUMN `sku_id` int NULL DEFAULT NULL COMMENT 'SKU ID',
  MODIFY COLUMN `unit_type` int NULL DEFAULT NULL COMMENT '计量单位类型ID',
  MODIFY COLUMN `out_qty` int NULL DEFAULT NULL COMMENT '本批次原料出库数量',
  MODIFY COLUMN `batch_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '批次号',
  MODIFY COLUMN `remark` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '备注';

ALTER TABLE `hspsi_production_out_plan`
  MODIFY COLUMN `out_plan_id` bigint NOT NULL auto_increment COMMENT '生产出库计划主键',
  MODIFY COLUMN `out_plan_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '生产出库计划单号',
  MODIFY COLUMN `plan_id` bigint NOT NULL COMMENT '生产计划ID',
  MODIFY COLUMN `org_id` bigint NOT NULL DEFAULT 0 COMMENT '生产出库计划所属组织ID',
  MODIFY COLUMN `warehouse_id` bigint NOT NULL DEFAULT 0 COMMENT '计划出库仓库ID',
  MODIFY COLUMN `out_type` tinyint NOT NULL DEFAULT 1 COMMENT '生产出库类型（数据字典）',
  MODIFY COLUMN `stock_check_status` tinyint NOT NULL DEFAULT 0 COMMENT '出库原料库存校验状态（数据字典）',
  MODIFY COLUMN `status` tinyint NOT NULL DEFAULT 0 COMMENT '生产出库计划状态（数据字典）',
  MODIFY COLUMN `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '备注',
  MODIFY COLUMN `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人ID',
  MODIFY COLUMN `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人ID',
  MODIFY COLUMN `created_at` datetime NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime NULL DEFAULT CURRENT_TIMESTAMP on update CURRENT_TIMESTAMP COMMENT '更新时间',
  MODIFY COLUMN `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间';

ALTER TABLE `hspsi_production_plan`
  MODIFY COLUMN `plan_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '生产计划单号',
  MODIFY COLUMN `plan_qty` int NOT NULL DEFAULT 0 COMMENT '计划生产数量',
  MODIFY COLUMN `product_warehouse_id` bigint NOT NULL DEFAULT 0 COMMENT '成品目标仓库ID',
  MODIFY COLUMN `stock_check_status` tinyint NOT NULL DEFAULT 0 COMMENT '生产计划原料库存校验状态（数据字典）',
  MODIFY COLUMN `delivered_qty` int NOT NULL DEFAULT 0 COMMENT '已完工入库数量',
  MODIFY COLUMN `source_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '生产计划来源类型',
  MODIFY COLUMN `source_id` bigint NOT NULL DEFAULT 0 COMMENT '生产计划来源单据ID';

ALTER TABLE `hspsi_production_plan_detail`
  MODIFY COLUMN `bom_unit_qty` int NOT NULL DEFAULT 0 COMMENT 'BOM单位用量',
  MODIFY COLUMN `standard_qty` int NOT NULL DEFAULT 0 COMMENT '计划标准用料数量',
  MODIFY COLUMN `require_qty` int NOT NULL DEFAULT 0 COMMENT '本计划原料需求数量',
  MODIFY COLUMN `plan_out_qty` int NOT NULL DEFAULT 0 COMMENT '计划原料出库数量';

ALTER TABLE `hspsi_production_plan_input`
  MODIFY COLUMN `id` bigint NOT NULL auto_increment COMMENT '生产成品入库记录主键',
  MODIFY COLUMN `input_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '成品入库单号',
  MODIFY COLUMN `input_date` datetime NULL DEFAULT NULL COMMENT '成品入库日期',
  MODIFY COLUMN `fact_input_qty` int NOT NULL DEFAULT 0 COMMENT '实际成品入库数量',
  MODIFY COLUMN `input_position` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '入库库位';

ALTER TABLE `hspsi_production_shortage`
  MODIFY COLUMN `unit_type` int NOT NULL DEFAULT 0 COMMENT '计量单位类型ID',
  MODIFY COLUMN `require_qty` int NOT NULL DEFAULT 0 COMMENT '缺料校验需求数量',
  MODIFY COLUMN `fact_qty` int NOT NULL DEFAULT 0 COMMENT '当前可用库存数量',
  MODIFY COLUMN `suggest_purchase_qty` int NOT NULL DEFAULT 0 COMMENT '建议采购数量',
  MODIFY COLUMN `suggest_purchase_days` int NOT NULL DEFAULT 0 COMMENT '建议采购提前天数';

ALTER TABLE `hspsi_purchase_approve`
  MODIFY COLUMN `pur_id` bigint NOT NULL auto_increment COMMENT '采购申请ID',
  MODIFY COLUMN `pur_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '采购申请单号',
  MODIFY COLUMN `source_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '采购申请来源类型',
  MODIFY COLUMN `source_id` bigint NOT NULL DEFAULT 0 COMMENT '采购申请来源单据ID';

ALTER TABLE `hspsi_purchase_approve_detail`
  MODIFY COLUMN `source_shortage_id` bigint NOT NULL DEFAULT 0 COMMENT '来源生产缺料记录ID';

ALTER TABLE `hspsi_purchase_order`
  MODIFY COLUMN `po_id` bigint NOT NULL auto_increment COMMENT '采购订单ID',
  MODIFY COLUMN `po_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '采购订单号',
  MODIFY COLUMN `arrival_type` tinyint unsigned NOT NULL COMMENT '到货方式（数据字典）',
  MODIFY COLUMN `plan_arrival_date` datetime NOT NULL COMMENT '计划到货日期';

ALTER TABLE `hspsi_purchase_order_input`
  MODIFY COLUMN `po_input_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '采购入库单号';

ALTER TABLE `hspsi_purchase_order_input_exit`
  MODIFY COLUMN `po_exit_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '采购退货单号';

ALTER TABLE `hspsi_purchase_order_input_exit_detail`
  MODIFY COLUMN `batch_no` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '批次号';

ALTER TABLE `hspsi_purchase_order_payment`
  MODIFY COLUMN `pay_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '采购付款单号';

ALTER TABLE `hspsi_purchase_refund`
  MODIFY COLUMN `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人ID',
  MODIFY COLUMN `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人ID',
  MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP on update CURRENT_TIMESTAMP COMMENT '更新时间',
  MODIFY COLUMN `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间';

ALTER TABLE `hspsi_purchase_refund_flow`
  MODIFY COLUMN `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人ID',
  MODIFY COLUMN `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人ID',
  MODIFY COLUMN `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP on update CURRENT_TIMESTAMP COMMENT '更新时间',
  MODIFY COLUMN `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间';

ALTER TABLE `hspsi_sale_order`
  MODIFY COLUMN `so_id` bigint NOT NULL auto_increment COMMENT '销售订单ID',
  MODIFY COLUMN `warehouse_id` bigint NOT NULL DEFAULT 0 COMMENT '销售出库仓库ID',
  MODIFY COLUMN `business_source_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '业务来源类型',
  MODIFY COLUMN `business_source_id` bigint NOT NULL DEFAULT 0 COMMENT '业务来源单据ID',
  MODIFY COLUMN `business_source_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '业务来源单号',
  MODIFY COLUMN `order_date` datetime NULL DEFAULT NULL COMMENT '销售订单日期',
  MODIFY COLUMN `so_qty` int NOT NULL DEFAULT 0 COMMENT '销售订单总数量',
  MODIFY COLUMN `approve_status` tinyint NOT NULL DEFAULT 0 COMMENT '销售订单审批状态（数据字典）',
  MODIFY COLUMN `approve_comment` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '审批意见',
  MODIFY COLUMN `approve_by` bigint NOT NULL DEFAULT 0 COMMENT '审批人ID',
  MODIFY COLUMN `approve_date` datetime NULL DEFAULT NULL COMMENT '审批时间';

ALTER TABLE `hspsi_sale_order_detail`
  MODIFY COLUMN `id` bigint NOT NULL auto_increment COMMENT '销售订单明细主键',
  MODIFY COLUMN `sale_qty` int NOT NULL DEFAULT 0 COMMENT '明细销售数量';

ALTER TABLE `hspsi_sale_order_exit`
  MODIFY COLUMN `source_output_id` bigint NOT NULL DEFAULT 0 COMMENT '来源销售出库单ID',
  MODIFY COLUMN `exit_qty` int NOT NULL DEFAULT 0 COMMENT '销售退货总数量',
  MODIFY COLUMN `disposal_type` tinyint NOT NULL DEFAULT 1 COMMENT '退货处置方式（数据字典）',
  MODIFY COLUMN `exit_date` datetime NULL DEFAULT NULL COMMENT '退货日期';

ALTER TABLE `hspsi_sale_order_exit_detail`
  MODIFY COLUMN `batch_no` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '批次号',
  MODIFY COLUMN `so_qty` int NOT NULL DEFAULT 0 COMMENT '原销售订单数量',
  MODIFY COLUMN `exit_qty` int NOT NULL DEFAULT 0 COMMENT '明细退货数量';

ALTER TABLE `hspsi_sale_order_output`
  MODIFY COLUMN `output_date` datetime NULL DEFAULT NULL COMMENT '出库日期';

ALTER TABLE `hspsi_sale_order_output_detail`
  MODIFY COLUMN `batch_no` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '批次号',
  MODIFY COLUMN `sale_qty` int NOT NULL DEFAULT 0 COMMENT '订单应出库数量',
  MODIFY COLUMN `output_qty` int NOT NULL DEFAULT 0 COMMENT '本次销售出库数量';

ALTER TABLE `hspsi_sale_order_service`
  MODIFY COLUMN `service_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '售后单号',
  MODIFY COLUMN `handler_id` bigint NOT NULL DEFAULT 0 COMMENT '售后处理人ID',
  MODIFY COLUMN `next_document_type` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '后续单据类型',
  MODIFY COLUMN `next_document_id` bigint NOT NULL DEFAULT 0 COMMENT '后续单据ID',
  MODIFY COLUMN `next_document_no` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '后续单号';

ALTER TABLE `hspsi_sale_order_service_detail`
  MODIFY COLUMN `service_qty` int NOT NULL DEFAULT 0 COMMENT '售后处理数量';

ALTER TABLE `hspsi_sales_order_payment`
  MODIFY COLUMN `request_key` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT '' COMMENT '收款请求幂等键';

ALTER TABLE `hspsi_sys_notice_receiver`
  MODIFY COLUMN `id` int unsigned NOT NULL auto_increment COMMENT '通知接收记录主键';

ALTER TABLE `hspsi_sys_role`
  MODIFY COLUMN `deleted_at` datetime NULL DEFAULT NULL COMMENT '软删除时间';

-- Expected result: 0
SELECT COUNT(*) AS missing_comment_count
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'hspsi-dev-ai-02'
  AND TRIM(COALESCE(COLUMN_COMMENT, '')) = '';
