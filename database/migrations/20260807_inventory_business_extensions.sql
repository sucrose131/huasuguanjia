-- 临时出库去向、报损退货字典及生产出库字段。

ALTER TABLE hspsi_production_material_out
  ADD COLUMN destination_type tinyint NULL COMMENT '临时出库去向：1实验出库，2其他' AFTER out_type;

ALTER TABLE hspsi_inventory_loss_detail
  ADD COLUMN source_receipt_detail_id bigint NOT NULL DEFAULT 0 COMMENT '退货去向选择的原采购入库明细ID' AFTER loss_amount,
  ADD INDEX idx_inventory_loss_purchase_source (source_receipt_detail_id);

ALTER TABLE hspsi_purchase_order_input_exit
  ADD COLUMN generation_key varchar(100) NULL COMMENT '自动生成幂等键' AFTER po_id,
  ADD COLUMN auto_created tinyint NOT NULL DEFAULT 0 COMMENT '是否系统自动生成' AFTER generation_key,
  ADD COLUMN source_document_type varchar(32) NULL COMMENT '来源单据类型' AFTER auto_created,
  ADD COLUMN source_document_id bigint NULL COMMENT '来源单据ID' AFTER source_document_type,
  ADD UNIQUE KEY uk_purchase_exit_generation_key (generation_key),
  ADD INDEX idx_purchase_exit_source_document (source_document_type, source_document_id);

UPDATE hspsi_production_material_out
SET destination_type = 1
WHERE out_type = 3 AND destination_type IS NULL;

INSERT INTO hspsi_sys_dictionary_category
  (dict_catg_name, dict_catg_code, sort, remark, created_by, updated_by)
SELECT '临时出库去向', 'temporary_outbound_destination', 0,
       '生产临时出库的业务去向', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'temporary_outbound_destination' AND deleted_at IS NULL
);

SET @temporary_destination_id = (
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'temporary_outbound_destination' AND deleted_at IS NULL
  ORDER BY dict_catg_id LIMIT 1
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT @temporary_destination_id, '实验出库', '1', 1, '用于实验的临时出库', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary
  WHERE dict_catg_id = @temporary_destination_id AND dict_value = '1' AND deleted_at IS NULL
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT @temporary_destination_id, '其他', '2', 2, '其他临时出库', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary
  WHERE dict_catg_id = @temporary_destination_id AND dict_value = '2' AND deleted_at IS NULL
);

SET @loss_disposal_id = (
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'inventory_loss_disposal' AND deleted_at IS NULL
  ORDER BY dict_catg_id LIMIT 1
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT @loss_disposal_id, '退货', '2', 2, '报损后生成采购退货执行库存扣减', 0, 0
WHERE @loss_disposal_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_dictionary
    WHERE dict_catg_id = @loss_disposal_id AND dict_value = '2' AND deleted_at IS NULL
  );
