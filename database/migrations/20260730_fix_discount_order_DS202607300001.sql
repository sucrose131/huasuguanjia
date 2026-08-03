-- 修复折价销售单 DS202607300001
-- 从来源报损单同步 warehouse_id 和 business_source 追溯字段

UPDATE hspsi_sale_order o
JOIN hspsi_inventory_loss l ON l.loss_id = o.so_source_id
SET 
  o.warehouse_id = l.warehouse_id,
  o.business_source_type = 'inventory_loss',
  o.business_source_id = l.loss_id,
  o.business_source_no = l.loss_no
WHERE o.so_no = 'DS202607300001'
  AND o.so_source = 4
  AND o.so_property_type = 2;

-- 验证结果
SELECT 
  o.so_no AS 折价单号,
  o.warehouse_id AS 仓库ID,
  w.name AS 仓库名称,
  o.business_source_type AS 来源类型,
  o.business_source_no AS 来源单号,
  o.so_qty AS 数量,
  o.fact_amount AS 金额
FROM hspsi_sale_order o
LEFT JOIN hspsi_basic_warehouse w ON w.warehouse_id = o.warehouse_id
WHERE o.so_no = 'DS202607300001';
