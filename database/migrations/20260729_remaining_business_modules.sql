-- 生产、销售、领用模块的无损增量结构。
-- 仅补充需求文档要求的字段和精度，不删除现有表或历史数据。

ALTER TABLE hspsi_production_bom_detail
  MODIFY require_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_production_plan
  ADD COLUMN plan_no VARCHAR(30) NOT NULL DEFAULT '' AFTER plan_id,
  ADD COLUMN plan_status TINYINT NOT NULL DEFAULT 0 AFTER warehouse_id,
  ADD COLUMN material_status TINYINT NOT NULL DEFAULT 0 AFTER plan_status,
  ADD COLUMN delivered_qty DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER outbound_status,
  ADD COLUMN source_type VARCHAR(30) NOT NULL DEFAULT '' AFTER delivered_qty,
  ADD COLUMN source_id BIGINT NOT NULL DEFAULT 0 AFTER source_type,
  MODIFY plan_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD KEY idx_production_plan_source (source_type, source_id);

UPDATE hspsi_production_plan SET plan_no = CONCAT('PP', LPAD(plan_id, 12, '0')) WHERE plan_no = '';
ALTER TABLE hspsi_production_plan ADD UNIQUE KEY uk_production_plan_no (plan_no);

ALTER TABLE hspsi_production_plan_detail
  ADD COLUMN bom_unit_qty DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER sku_id,
  ADD COLUMN standard_qty DECIMAL(18,4) NOT NULL DEFAULT 0 AFTER bom_unit_qty,
  MODIFY require_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY plan_out_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_production_shortage
  ADD COLUMN purchase_id BIGINT NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN unit_type INT NOT NULL DEFAULT 0 AFTER sku_id,
  MODIFY require_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY fact_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY mark_purchase_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_production_material_out
  ADD COLUMN out_no VARCHAR(30) NOT NULL DEFAULT '' AFTER out_id,
  ADD COLUMN deleted_at DATETIME NULL AFTER updated_date;

UPDATE hspsi_production_material_out SET out_no = CONCAT('PMO', LPAD(out_id, 12, '0')) WHERE out_no = '';
ALTER TABLE hspsi_production_material_out ADD UNIQUE KEY uk_production_material_out_no (out_no);

ALTER TABLE hspsi_production_material_out_detail
  MODIFY out_qty DECIMAL(18,4) NULL;

ALTER TABLE hspsi_production_plan_input
  MODIFY id BIGINT NOT NULL AUTO_INCREMENT,
  ADD COLUMN input_no VARCHAR(30) NOT NULL DEFAULT '' AFTER id,
  ADD COLUMN input_position VARCHAR(100) NOT NULL DEFAULT '' AFTER fact_input_qty,
  MODIFY fact_input_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

UPDATE hspsi_production_plan_input SET input_no = CONCAT('PPI', LPAD(id, 12, '0')) WHERE input_no = '';
ALTER TABLE hspsi_production_plan_input ADD UNIQUE KEY uk_production_input_no (input_no);

ALTER TABLE hspsi_sale_order
  MODIFY so_id BIGINT NOT NULL AUTO_INCREMENT,
  MODIFY so_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_sale_order_detail
  MODIFY id BIGINT NOT NULL AUTO_INCREMENT,
  MODIFY sale_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_sale_order_output_detail
  ADD COLUMN batch_no VARCHAR(50) NOT NULL DEFAULT '' AFTER sku_id,
  MODIFY sale_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY output_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_sale_order_exit
  ADD COLUMN disposal_type TINYINT NOT NULL DEFAULT 1 AFTER exit_qty,
  MODIFY exit_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_sale_order_exit_detail
  ADD COLUMN batch_no VARCHAR(50) NOT NULL DEFAULT '' AFTER sku_id,
  MODIFY so_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY exit_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS hspsi_sales_order_payment (
  pay_id BIGINT NOT NULL AUTO_INCREMENT,
  org_id BIGINT NOT NULL DEFAULT 0,
  dept_id BIGINT NOT NULL DEFAULT 0,
  pay_no VARCHAR(30) NOT NULL DEFAULT '',
  so_id BIGINT NOT NULL DEFAULT 0,
  so_pay_type TINYINT NOT NULL DEFAULT 0,
  pay_mode TINYINT NOT NULL DEFAULT 0,
  fact_pay_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  pay_date DATETIME NULL,
  request_key VARCHAR(80) NOT NULL DEFAULT '',
  remark VARCHAR(255) NOT NULL DEFAULT '',
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (pay_id),
  UNIQUE KEY uk_sales_payment_pay_no (pay_no),
  UNIQUE KEY uk_sales_payment_request_key (request_key),
  KEY idx_sales_payment_order_type_deleted (so_id, so_pay_type, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE hspsi_draw_approve
  MODIFY draw_id BIGINT NOT NULL AUTO_INCREMENT,
  MODIFY draw_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY fact_draw_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_draw_approve_detail
  ADD COLUMN batch_no VARCHAR(50) NULL AFTER sku_id,
  MODIFY draw_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_draw_approve_output_detail
  MODIFY draw_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY fact_draw_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_draw_approve_output_exit
  MODIFY exit_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_draw_approve_output_exit_detail
  MODIFY so_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY exit_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
