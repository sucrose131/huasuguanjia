-- 库存管理增量迁移：不删除现有表或数据。
ALTER TABLE hspsi_inventory_transfer
  ADD COLUMN transfer_no varchar(20) NOT NULL DEFAULT '' COMMENT '调拨单号' AFTER transfer_id,
  ADD COLUMN status tinyint NOT NULL DEFAULT 0 COMMENT '0草稿 1待审批 2已完成 3已取消' AFTER remark,
  ADD COLUMN send_by bigint NOT NULL DEFAULT 0 COMMENT '发出人用户id' AFTER status,
  ADD COLUMN send_date datetime NULL COMMENT '发出时间' AFTER send_by,
  ADD UNIQUE KEY uk_transfer_no (transfer_no);
ALTER TABLE hspsi_inventory_transfer_detail
  ADD COLUMN unit_type int NOT NULL DEFAULT 0 COMMENT '单位类型' AFTER batch_no,
  MODIFY transfer_qty decimal(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_adjust_detail
  ADD COLUMN warehouse_id bigint NOT NULL DEFAULT 0 COMMENT '调整仓库' AFTER sku_id,
  MODIFY before_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY adjust_qty decimal(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_alert_qty
  ADD COLUMN warehouse_id bigint NOT NULL DEFAULT 0 COMMENT '仓库id' AFTER sku_id,
  MODIFY safe_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY safe_less_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY purchase_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY fact_qty decimal(18,4) NOT NULL DEFAULT 0,
  ADD UNIQUE KEY uk_alert_qty_warehouse_goods_sku (warehouse_id, goods_id, sku_id);
ALTER TABLE hspsi_inventory_alert_period
  ADD COLUMN warehouse_id bigint NOT NULL DEFAULT 0 AFTER sku_id,
  ADD COLUMN batch_no varchar(255) NOT NULL DEFAULT '' AFTER warehouse_id,
  MODIFY alter_qty decimal(18,4) NULL DEFAULT 0,
  MODIFY end_day date NULL;

ALTER TABLE hspsi_inventory_check
  MODIFY all_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY less_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY overflow_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY overflow_process_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY less_process_qty decimal(18,4) NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_check_detail
  ADD COLUMN unit_type int NOT NULL DEFAULT 0 AFTER batch_no,
  MODIFY inventory_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY check_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY damaged_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY different_qty decimal(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN unit_price decimal(12,2) NOT NULL DEFAULT 0 AFTER different_qty,
  ADD COLUMN different_amount decimal(12,2) NOT NULL DEFAULT 0 AFTER unit_price;

ALTER TABLE hspsi_inventory_loss
  ADD COLUMN source_check_id bigint NOT NULL DEFAULT 0 AFTER loss_date,
  MODIFY loss_qty decimal(18,4) NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_loss_detail MODIFY loss_qty decimal(18,4) NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_loss_output
  ADD COLUMN source_loss_id bigint NOT NULL DEFAULT 0 AFTER loss_date,
  MODIFY loss_qty decimal(18,4) NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_loss_output_detail MODIFY loss_qty decimal(18,4) NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_overflow
  ADD COLUMN source_check_id bigint NOT NULL DEFAULT 0 AFTER overflow_date,
  MODIFY overflow_qty decimal(18,4) NOT NULL DEFAULT 0,
  ADD UNIQUE KEY uk_overflow_no (overflow_no);
ALTER TABLE hspsi_inventory_overflow_detail MODIFY overflow_qty decimal(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_total
  MODIFY input_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY output_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY inventory_qty decimal(18,4) NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_batch_total
  MODIFY input_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY output_qty decimal(18,4) NOT NULL DEFAULT 0,
  MODIFY inventory_qty decimal(18,4) NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_total_detail
  MODIFY operation_qty decimal(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN source_type varchar(32) NOT NULL DEFAULT '' AFTER source_id,
  ADD COLUMN source_no varchar(30) NOT NULL DEFAULT '' AFTER source_type,
  ADD COLUMN operation_by bigint NOT NULL DEFAULT 0 AFTER source_no,
  ADD COLUMN after_qty decimal(18,4) NOT NULL DEFAULT 0 AFTER operation_by,
  ADD COLUMN posting_key varchar(191) NULL AFTER after_qty,
  ADD COLUMN goods_code varchar(30) NOT NULL DEFAULT '' AFTER posting_key,
  ADD COLUMN goods_name varchar(100) NOT NULL DEFAULT '' AFTER goods_code,
  ADD COLUMN sku_spec varchar(200) NOT NULL DEFAULT '' AFTER goods_name,
  ADD COLUMN org_name varchar(100) NOT NULL DEFAULT '' AFTER sku_spec,
  ADD COLUMN warehouse_name varchar(100) NOT NULL DEFAULT '' AFTER org_name,
  ADD COLUMN unit_name varchar(50) NOT NULL DEFAULT '' AFTER warehouse_name,
  ADD UNIQUE KEY uk_inventory_posting_key (posting_key);

ALTER TABLE hspsi_purchase_order_input_exit_detail
  ADD COLUMN batch_no varchar(255) NOT NULL DEFAULT '' AFTER sku_id;
