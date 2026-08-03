ALTER TABLE hspsi_purchase_approve
  ADD COLUMN source_type VARCHAR(30) NOT NULL DEFAULT '' AFTER pur_reson,
  ADD COLUMN source_id BIGINT NOT NULL DEFAULT 0 AFTER source_type,
  ADD KEY idx_purchase_approve_source (source_type, source_id);

ALTER TABLE hspsi_purchase_approve_detail
  ADD COLUMN source_shortage_id BIGINT NOT NULL DEFAULT 0 AFTER sku_id;
