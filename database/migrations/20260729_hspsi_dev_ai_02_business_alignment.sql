-- 以当前 hspsi-dev-ai-02 为唯一基准的无损增量迁移。
-- 目标：承载生产、销售、领用需求，并与真实库存过账和 Prisma API 对齐。

-- 库存过账基础能力（三个业务模块确认动作依赖）。
ALTER TABLE hspsi_inventory_total
  MODIFY input_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY output_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY inventory_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_batch_total
  MODIFY input_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY output_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY inventory_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_total_detail
  MODIFY operation_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN source_type VARCHAR(32) NOT NULL DEFAULT '' AFTER source_id,
  ADD COLUMN source_no VARCHAR(30) NOT NULL DEFAULT '' AFTER source_type,
  ADD COLUMN operation_by BIGINT NOT NULL DEFAULT 0 AFTER source_no,
  ADD COLUMN after_qty DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER operation_by,
  ADD COLUMN posting_key VARCHAR(191) NULL AFTER after_qty,
  ADD COLUMN goods_code VARCHAR(30) NOT NULL DEFAULT '' AFTER posting_key,
  ADD COLUMN goods_name VARCHAR(100) NOT NULL DEFAULT '' AFTER goods_code,
  ADD COLUMN sku_spec VARCHAR(200) NOT NULL DEFAULT '' AFTER goods_name,
  ADD COLUMN org_name VARCHAR(100) NOT NULL DEFAULT '' AFTER sku_spec,
  ADD COLUMN warehouse_name VARCHAR(100) NOT NULL DEFAULT '' AFTER org_name,
  ADD COLUMN unit_name VARCHAR(50) NOT NULL DEFAULT '' AFTER warehouse_name,
  ADD UNIQUE KEY uk_inventory_posting_key (posting_key);

-- 生产管理。
ALTER TABLE hspsi_production_bom
  ADD COLUMN bom_no VARCHAR(30) NOT NULL DEFAULT '' AFTER bom_id;
UPDATE hspsi_production_bom SET bom_no = CONCAT('BOM', DATE_FORMAT(COALESCE(created_at, NOW()), '%Y%m%d'), LPAD(bom_id, 4, '0')) WHERE bom_no = '';
ALTER TABLE hspsi_production_bom ADD UNIQUE KEY uk_production_bom_no (bom_no);

ALTER TABLE hspsi_production_bom_detail
  MODIFY require_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_production_plan
  ADD COLUMN plan_no VARCHAR(30) NOT NULL DEFAULT '' AFTER plan_id,
  ADD COLUMN product_warehouse_id BIGINT NOT NULL DEFAULT 0 AFTER warehouse_id,
  ADD COLUMN stock_check_status TINYINT NOT NULL DEFAULT 0 AFTER material_status,
  ADD COLUMN delivered_qty DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER outbound_status,
  ADD COLUMN source_type VARCHAR(30) NOT NULL DEFAULT '' AFTER delivered_qty,
  ADD COLUMN source_id BIGINT NOT NULL DEFAULT 0 AFTER source_type,
  MODIFY plan_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
UPDATE hspsi_production_plan p
LEFT JOIN hspsi_goods_info g ON g.goods_id = p.goods_id
SET p.plan_no = CONCAT('PP', DATE_FORMAT(COALESCE(p.created_at, NOW()), '%Y%m%d'), LPAD(p.plan_id, 4, '0')),
    p.product_warehouse_id = COALESCE(g.warehouse_id, 0),
    p.stock_check_status = CASE WHEN p.material_status IN (0,1,2) THEN p.material_status ELSE 0 END
WHERE p.plan_no = '';
ALTER TABLE hspsi_production_plan
  ADD UNIQUE KEY uk_production_plan_no (plan_no),
  ADD KEY idx_production_plan_source (source_type, source_id);

ALTER TABLE hspsi_production_plan_detail
  ADD COLUMN bom_unit_qty DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER sku_id,
  ADD COLUMN standard_qty DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER bom_unit_qty,
  MODIFY require_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY plan_out_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
UPDATE hspsi_production_plan_detail pd
JOIN hspsi_production_plan p ON p.plan_id = pd.plan_id
LEFT JOIN hspsi_production_bom_detail bd
  ON bd.bom_id = pd.bom_id AND bd.goods_id = pd.goods_id AND bd.sku_id = pd.sku_id
SET pd.bom_unit_qty = COALESCE(bd.require_qty, 0),
    pd.standard_qty = COALESCE(bd.require_qty, 0) * p.plan_qty;

ALTER TABLE hspsi_production_shortage
  ADD COLUMN unit_type INT NOT NULL DEFAULT 0 AFTER sku_id,
  ADD COLUMN suggest_purchase_days INT NOT NULL DEFAULT 0 AFTER suggest_purchase_qty,
  MODIFY require_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY fact_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY suggest_purchase_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
UPDATE hspsi_production_shortage s
LEFT JOIN hspsi_goods_info_sku sku ON sku.sku_id = s.sku_id
LEFT JOIN hspsi_goods_info g ON g.goods_id = s.goods_id
SET s.unit_type = COALESCE(NULLIF(sku.unit_type, 0), g.unit_type, 0)
WHERE s.unit_type = 0;

ALTER TABLE hspsi_production_material_out
  ADD COLUMN out_no VARCHAR(30) NOT NULL DEFAULT '' AFTER out_id,
  ADD COLUMN deleted_at DATETIME NULL AFTER updated_date;
UPDATE hspsi_production_material_out SET out_no = CONCAT('PMO', DATE_FORMAT(COALESCE(created_date, NOW()), '%Y%m%d'), LPAD(out_id, 4, '0')) WHERE out_no = '';
ALTER TABLE hspsi_production_material_out ADD UNIQUE KEY uk_production_material_out_no (out_no);

ALTER TABLE hspsi_production_material_out_detail
  MODIFY out_qty DECIMAL(18,4) NULL;

ALTER TABLE hspsi_production_plan_input
  MODIFY id BIGINT NOT NULL AUTO_INCREMENT,
  ADD COLUMN input_no VARCHAR(30) NOT NULL DEFAULT '' AFTER id,
  ADD COLUMN input_date DATETIME NULL AFTER warehouse_id,
  ADD COLUMN input_position VARCHAR(100) NOT NULL DEFAULT '' AFTER fact_input_qty,
  MODIFY fact_input_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
UPDATE hspsi_production_plan_input SET input_no = CONCAT('PPI', DATE_FORMAT(COALESCE(created_at, NOW()), '%Y%m%d'), LPAD(id, 4, '0')), input_date = COALESCE(input_date, created_at) WHERE input_no = '';
ALTER TABLE hspsi_production_plan_input ADD UNIQUE KEY uk_production_input_no (input_no);

CREATE TABLE hspsi_production_out_plan (
  out_plan_id BIGINT NOT NULL AUTO_INCREMENT,
  out_plan_no VARCHAR(30) NOT NULL DEFAULT '',
  plan_id BIGINT NOT NULL,
  org_id BIGINT NOT NULL DEFAULT 0,
  warehouse_id BIGINT NOT NULL DEFAULT 0,
  out_type TINYINT NOT NULL DEFAULT 1,
  stock_check_status TINYINT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 0,
  remark VARCHAR(255) NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (out_plan_id),
  UNIQUE KEY uk_production_out_plan_no (out_plan_no),
  UNIQUE KEY uk_production_out_plan_source (plan_id, out_type),
  KEY idx_production_out_plan_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='生产BOM出库计划/实验领料计划';

-- 缺料生成采购申请的结构化来源。
ALTER TABLE hspsi_purchase_approve
  ADD COLUMN source_type VARCHAR(30) NOT NULL DEFAULT '' AFTER pur_reson,
  ADD COLUMN source_id BIGINT NOT NULL DEFAULT 0 AFTER source_type,
  ADD KEY idx_purchase_approve_source (source_type, source_id);
ALTER TABLE hspsi_purchase_approve_detail
  ADD COLUMN source_shortage_id BIGINT NOT NULL DEFAULT 0 AFTER sku_id;

-- 销售管理。
ALTER TABLE hspsi_sale_order
  MODIFY so_id BIGINT NOT NULL AUTO_INCREMENT,
  ADD COLUMN order_date DATETIME NULL AFTER customer_address,
  ADD COLUMN warehouse_id BIGINT NOT NULL DEFAULT 0 AFTER org_id,
  ADD COLUMN approve_status TINYINT NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN approve_comment VARCHAR(255) NOT NULL DEFAULT '' AFTER approve_status,
  ADD COLUMN approve_by BIGINT NOT NULL DEFAULT 0 AFTER approve_comment,
  ADD COLUMN approve_date DATETIME NULL AFTER approve_by,
  ADD COLUMN business_source_type VARCHAR(30) NOT NULL DEFAULT '' AFTER so_source_id,
  ADD COLUMN business_source_id BIGINT NOT NULL DEFAULT 0 AFTER business_source_type,
  ADD COLUMN business_source_no VARCHAR(30) NOT NULL DEFAULT '' AFTER business_source_id,
  MODIFY so_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
UPDATE hspsi_sale_order SET order_date = COALESCE(order_date, created_at) WHERE order_date IS NULL;

ALTER TABLE hspsi_sale_order_detail
  MODIFY id BIGINT NOT NULL AUTO_INCREMENT,
  MODIFY sale_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_sale_order_output
  ADD COLUMN output_date DATETIME NULL AFTER warehouse_id;
UPDATE hspsi_sale_order_output SET output_date = COALESCE(output_date, created_at) WHERE output_date IS NULL;
ALTER TABLE hspsi_sale_order_output_detail
  ADD COLUMN batch_no VARCHAR(50) NOT NULL DEFAULT '' AFTER sku_id,
  MODIFY sale_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY output_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_sale_order_exit
  ADD COLUMN source_output_id BIGINT NOT NULL DEFAULT 0 AFTER so_id,
  ADD COLUMN exit_date DATETIME NULL AFTER warehouse_id,
  ADD COLUMN disposal_type TINYINT NOT NULL DEFAULT 1 AFTER exit_qty,
  MODIFY exit_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD KEY idx_sale_exit_source_output (source_output_id);
UPDATE hspsi_sale_order_exit SET exit_date = COALESCE(exit_date, created_at) WHERE exit_date IS NULL;
ALTER TABLE hspsi_sale_order_exit_detail
  ADD COLUMN batch_no VARCHAR(50) NOT NULL DEFAULT '' AFTER sku_id,
  MODIFY so_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY exit_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_sale_order_service
  ADD COLUMN service_no VARCHAR(30) NOT NULL DEFAULT '' AFTER service_id,
  ADD COLUMN handler_id BIGINT NOT NULL DEFAULT 0 AFTER event_status,
  ADD COLUMN next_document_type VARCHAR(30) NOT NULL DEFAULT '' AFTER remark,
  ADD COLUMN next_document_id BIGINT NOT NULL DEFAULT 0 AFTER next_document_type,
  ADD COLUMN next_document_no VARCHAR(30) NOT NULL DEFAULT '' AFTER next_document_id;
UPDATE hspsi_sale_order_service SET service_no = CONCAT('AS', DATE_FORMAT(COALESCE(created_at, NOW()), '%Y%m%d'), LPAD(service_id, 4, '0')), handler_id = COALESCE(NULLIF(updated_by, 0), created_by) WHERE service_no = '';
ALTER TABLE hspsi_sale_order_service ADD UNIQUE KEY uk_sale_service_no (service_no);

ALTER TABLE hspsi_sales_order_payment
  ADD COLUMN request_key VARCHAR(80) NOT NULL DEFAULT '' AFTER pay_date,
  ADD UNIQUE KEY uk_sales_payment_request_key (request_key);

-- 领用管理。
ALTER TABLE hspsi_draw_approve
  MODIFY draw_id BIGINT NOT NULL AUTO_INCREMENT,
  ADD COLUMN applicant_id BIGINT NOT NULL DEFAULT 0 AFTER dept_id,
  ADD COLUMN draw_reason VARCHAR(300) NOT NULL DEFAULT '' AFTER draw_date,
  MODIFY draw_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY fact_draw_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_draw_approve_detail
  ADD COLUMN remark VARCHAR(255) NOT NULL DEFAULT '' AFTER draw_qty,
  MODIFY draw_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_draw_approve_output
  ADD COLUMN output_date DATETIME NULL AFTER receiver_id,
  ADD UNIQUE KEY uk_draw_output_no (draw_output_no);
UPDATE hspsi_draw_approve_output SET output_date = COALESCE(output_date, created_at) WHERE output_date IS NULL;
ALTER TABLE hspsi_draw_approve_output_detail
  ADD COLUMN remark VARCHAR(255) NOT NULL DEFAULT '' AFTER fact_draw_qty,
  MODIFY draw_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY fact_draw_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_draw_approve_output_exit
  ADD COLUMN return_date DATETIME NULL AFTER receiver_id,
  MODIFY exit_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
UPDATE hspsi_draw_approve_output_exit SET return_date = COALESCE(return_date, created_at) WHERE return_date IS NULL;
ALTER TABLE hspsi_draw_approve_output_exit_detail
  MODIFY so_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY exit_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
