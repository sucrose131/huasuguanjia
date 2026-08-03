-- 05：库存业务类型以数据字典 inventory_business_mode 为准。
-- 通过来源类型修复，避免对旧的错误 inventory_mode 进行无差别替换。
UPDATE hspsi_inventory_total_detail
SET inventory_mode = 1
WHERE source_type IN ('purchase_receipt', 'purchase_receipt_reverse', 'purchase_receipt_undo');

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 2
WHERE source_type = 'purchase_return';

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 3
WHERE source_type IN ('sales_output', 'sales_output_undo');

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 4
WHERE source_type IN ('sales_return', 'sales_return_undo');

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 5
WHERE source_type IN ('production_output', 'production_output_reverse', 'requisition_output', 'requisition_output_reverse');

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 6
WHERE source_type IN ('requisition_return', 'requisition_return_reverse');

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 7
WHERE source_type IN ('inventory_loss', 'inventory_shortage', 'inventory_loss_output', 'inventory_damage_scrap');

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 8
WHERE source_type IN ('inventory_overflow', 'inventory_overflow_input');

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 9
WHERE source_type IN ('inventory_adjustment', 'inventory_check_adjustment');

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 10
WHERE source_type IN (
  'discount_sale_order',
  'discount_sale_output',
  'discount_sale_output_undo',
  'discount_sales_output',
  'discount_sales_output_undo'
);

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 11
WHERE source_type IN ('production_input', 'production_input_reverse');

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 12
WHERE source_type IN ('inventory_transfer_out', 'inventory_transfer_in');

-- 生产计划出库状态以 production_outbound_status 字典为准：2=已出库。
UPDATE hspsi_production_plan p
SET p.outbound_status = 2
WHERE EXISTS (
  SELECT 1
  FROM hspsi_production_material_out o
  WHERE o.plan_id = p.plan_id
    AND o.out_type = 1
    AND o.confirm_tag = 1
    AND o.deleted_at IS NULL
);
