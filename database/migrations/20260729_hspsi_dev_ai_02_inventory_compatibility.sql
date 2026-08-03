-- hspsi-dev-ai-02 库存与采购代码兼容补丁。
-- 三个业务模块的确认动作必须依赖可用的真实库存过账能力。

UPDATE hspsi_goods_info SET org_id = 0 WHERE org_id IS NULL;
ALTER TABLE hspsi_goods_info MODIFY org_id BIGINT NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_transfer
  ADD COLUMN transfer_no VARCHAR(20) NOT NULL DEFAULT '' AFTER transfer_id,
  ADD COLUMN status TINYINT NOT NULL DEFAULT 0 AFTER remark,
  ADD UNIQUE KEY uk_transfer_no (transfer_no);
UPDATE hspsi_inventory_transfer SET transfer_no = CONCAT('IT', DATE_FORMAT(COALESCE(created_at, NOW()), '%Y%m%d'), LPAD(transfer_id, 4, '0')) WHERE transfer_no = '';

ALTER TABLE hspsi_inventory_transfer_detail
  ADD COLUMN unit_type INT NOT NULL DEFAULT 0 AFTER batch_no,
  MODIFY transfer_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_adjust_detail
  ADD COLUMN warehouse_id BIGINT NOT NULL DEFAULT 0 AFTER sku_id,
  MODIFY before_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY adjust_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_alert_qty
  MODIFY safe_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY safe_less_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY purchase_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY fact_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_alert_period
  ADD COLUMN warehouse_id BIGINT NOT NULL DEFAULT 0 AFTER sku_id,
  ADD COLUMN batch_no VARCHAR(255) NOT NULL DEFAULT '' AFTER warehouse_id,
  MODIFY alter_qty DECIMAL(18,4) NULL DEFAULT 0,
  MODIFY end_day DATE NULL;

ALTER TABLE hspsi_inventory_check
  MODIFY all_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY less_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY overflow_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY overflow_process_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY less_process_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_check_detail
  ADD COLUMN unit_type INT NOT NULL DEFAULT 0 AFTER batch_no,
  MODIFY inventory_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY check_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY damaged_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  MODIFY different_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN unit_price DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER different_qty,
  ADD COLUMN different_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER unit_price;

ALTER TABLE hspsi_inventory_loss
  ADD COLUMN source_check_id BIGINT NOT NULL DEFAULT 0 AFTER loss_date,
  MODIFY loss_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_loss_detail MODIFY loss_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_loss_output
  ADD COLUMN source_loss_id BIGINT NOT NULL DEFAULT 0 AFTER loss_date,
  MODIFY loss_qty DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_loss_output_detail MODIFY loss_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_overflow
  ADD COLUMN source_check_id BIGINT NOT NULL DEFAULT 0 AFTER overflow_date,
  MODIFY overflow_qty DECIMAL(18,4) NOT NULL DEFAULT 0,
  ADD UNIQUE KEY uk_overflow_no (overflow_no);
ALTER TABLE hspsi_inventory_overflow_detail MODIFY overflow_qty DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_purchase_order_input_exit_detail
  ADD COLUMN batch_no VARCHAR(255) NOT NULL DEFAULT '' AFTER sku_id;
