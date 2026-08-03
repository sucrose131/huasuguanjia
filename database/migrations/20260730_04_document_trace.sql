-- 04：通用单据关系表及历史关系回填（依赖 02 的 business_kind 字段）。
CREATE TABLE IF NOT EXISTS hspsi_business_document_relation (
  relation_id BIGINT NOT NULL AUTO_INCREMENT,
  upstream_type VARCHAR(50) NOT NULL,
  upstream_id BIGINT NOT NULL,
  upstream_no VARCHAR(50) NOT NULL DEFAULT '',
  downstream_type VARCHAR(50) NOT NULL,
  downstream_id BIGINT NOT NULL,
  downstream_no VARCHAR(50) NOT NULL DEFAULT '',
  relation_kind VARCHAR(30) NOT NULL DEFAULT 'generated',
  created_by BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (relation_id),
  UNIQUE KEY uk_business_document_relation (
    upstream_type,
    upstream_id,
    downstream_type,
    downstream_id
  ),
  KEY idx_business_document_upstream (upstream_type, upstream_id, deleted_at),
  KEY idx_business_document_downstream (downstream_type, downstream_id, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  IF(s.so_property_type = 2, 'discount_sale_order', 'sales_order'),
  s.so_id,
  s.so_no,
  IF(s.so_property_type = 2, 'discount_sale_output', 'sales_output'),
  o.so_output_id,
  o.so_output_no,
  'generated',
  o.created_by
FROM hspsi_sale_order_output o
JOIN hspsi_sale_order s ON s.so_id = o.so_id
WHERE o.deleted_at IS NULL AND s.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  IF(s.so_property_type = 2, 'discount_sale_order', 'sales_order'),
  s.so_id,
  s.so_no,
  'sales_return',
  r.so_exit_id,
  r.so_exit_no,
  'generated',
  r.created_by
FROM hspsi_sale_order_exit r
JOIN hspsi_sale_order s ON s.so_id = r.so_id
WHERE r.deleted_at IS NULL AND s.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  IF(s.so_property_type = 2, 'discount_sale_output', 'sales_output'),
  o.so_output_id,
  o.so_output_no,
  'sales_return',
  r.so_exit_id,
  r.so_exit_no,
  'generated',
  r.created_by
FROM hspsi_sale_order_exit r
JOIN hspsi_sale_order_output o ON o.so_output_id = r.source_output_id
JOIN hspsi_sale_order s ON s.so_id = o.so_id
WHERE r.source_output_id > 0 AND r.deleted_at IS NULL AND o.deleted_at IS NULL AND s.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  IF(s.so_property_type = 2, 'discount_sale_order', 'sales_order'),
  s.so_id,
  s.so_no,
  IF(p.so_pay_type = 2, 'sales_refund', 'sales_payment'),
  p.pay_id,
  p.pay_no,
  'financial',
  p.created_by
FROM hspsi_sales_order_payment p
JOIN hspsi_sale_order s ON s.so_id = p.so_id
WHERE p.deleted_at IS NULL AND s.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  IF(s.so_property_type = 2, 'discount_sale_order', 'sales_order'),
  s.so_id,
  s.so_no,
  'production_plan',
  p.plan_id,
  p.plan_no,
  'generated',
  p.created_by
FROM hspsi_production_plan p
JOIN hspsi_sale_order s ON s.so_id = p.source_id
WHERE p.source_type = 'sales_order' AND p.source_id > 0
  AND p.deleted_at IS NULL AND s.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'production_plan',
  p.plan_id,
  p.plan_no,
  'production_shortage',
  s.shortage_id,
  s.shortage_no,
  'generated',
  s.created_by
FROM hspsi_production_shortage s
JOIN hspsi_production_plan p ON p.plan_id = s.plan_id
WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'production_plan',
  p.plan_id,
  p.plan_no,
  'production_material_output',
  o.out_id,
  o.out_no,
  'generated',
  COALESCE(o.created_by, 0)
FROM hspsi_production_material_out o
JOIN hspsi_production_plan p ON p.plan_id = o.plan_id
WHERE o.plan_id IS NOT NULL AND o.deleted_at IS NULL AND p.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'production_plan',
  p.plan_id,
  p.plan_no,
  'production_input',
  i.id,
  i.input_no,
  'generated',
  i.created_by
FROM hspsi_production_plan_input i
JOIN hspsi_production_plan p ON p.plan_id = i.plan_id
WHERE i.deleted_at IS NULL AND p.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT DISTINCT
  'production_shortage',
  s.shortage_id,
  s.shortage_no,
  'purchase_application',
  a.pur_id,
  a.pur_no,
  'generated',
  a.created_by
FROM hspsi_purchase_approve_detail d
JOIN hspsi_production_shortage s ON s.shortage_id = d.source_shortage_id
JOIN hspsi_purchase_approve a ON a.pur_id = d.pur_id
WHERE d.source_shortage_id > 0 AND s.deleted_at IS NULL AND a.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'production_plan',
  p.plan_id,
  p.plan_no,
  'purchase_application',
  a.pur_id,
  a.pur_no,
  'generated',
  a.created_by
FROM hspsi_purchase_approve a
JOIN hspsi_production_plan p ON p.plan_id = a.source_id
WHERE a.source_type = 'production_plan' AND a.source_id > 0
  AND a.deleted_at IS NULL AND p.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'purchase_application',
  a.pur_id,
  a.pur_no,
  'purchase_order',
  o.po_id,
  o.po_no,
  'generated',
  o.created_by
FROM hspsi_purchase_order o
JOIN hspsi_purchase_approve a ON a.pur_id = o.pur_id
WHERE o.pur_id > 0 AND o.deleted_at IS NULL AND a.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'purchase_order',
  o.po_id,
  o.po_no,
  'purchase_receipt',
  i.po_input_id,
  i.po_input_no,
  'generated',
  i.created_by
FROM hspsi_purchase_order_input i
JOIN hspsi_purchase_order o ON o.po_id = i.po_id
WHERE i.deleted_at IS NULL AND o.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'purchase_receipt',
  i.po_input_id,
  i.po_input_no,
  'purchase_return',
  r.po_exit_id,
  r.po_exit_no,
  'generated',
  r.created_by
FROM hspsi_purchase_order_input_exit r
JOIN hspsi_purchase_order_input i ON i.po_input_id = r.po_input_id
WHERE r.deleted_at IS NULL AND i.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'purchase_order',
  o.po_id,
  o.po_no,
  'purchase_payment',
  p.pay_id,
  p.pay_no,
  'financial',
  p.created_by
FROM hspsi_purchase_order_payment p
JOIN hspsi_purchase_order o ON o.po_id = p.po_id
WHERE p.deleted_at IS NULL AND o.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'inventory_check',
  c.check_id,
  c.check_no,
  IF(l.business_kind = 1, 'inventory_shortage', 'inventory_loss'),
  l.loss_id,
  l.loss_no,
  'generated',
  l.created_by
FROM hspsi_inventory_loss l
JOIN hspsi_inventory_check c ON c.check_id = l.source_check_id
WHERE l.source_check_id > 0 AND l.deleted_at IS NULL AND c.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'inventory_check',
  c.check_id,
  c.check_no,
  'inventory_overflow',
  o.overflow_id,
  o.overflow_no,
  'generated',
  o.created_by
FROM hspsi_inventory_overflow o
JOIN hspsi_inventory_check c ON c.check_id = o.source_check_id
WHERE o.source_check_id > 0 AND o.deleted_at IS NULL AND c.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  IF(l.business_kind = 1, 'inventory_shortage', 'inventory_loss'),
  l.loss_id,
  l.loss_no,
  'inventory_loss_output',
  o.loss_id,
  o.loss_no,
  'generated',
  o.created_by
FROM hspsi_inventory_loss_output o
JOIN hspsi_inventory_loss l ON l.loss_id = o.source_loss_id
WHERE o.source_loss_id > 0 AND o.deleted_at IS NULL AND l.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'inventory_loss',
  l.loss_id,
  l.loss_no,
  'discount_sale_order',
  s.so_id,
  s.so_no,
  'generated',
  COALESCE(s.created_by, 0)
FROM hspsi_sale_order s
JOIN hspsi_inventory_loss l ON l.loss_id = s.business_source_id
WHERE s.business_source_type = 'inventory_loss' AND s.business_source_id > 0
  AND s.deleted_at IS NULL AND l.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'sales_return',
  r.so_exit_id,
  r.so_exit_no,
  'discount_sale_order',
  s.so_id,
  s.so_no,
  'generated',
  COALESCE(s.created_by, 0)
FROM hspsi_sale_order s
JOIN hspsi_sale_order_exit r ON r.so_exit_id = s.business_source_id
WHERE s.business_source_type = 'sales_return' AND s.business_source_id > 0
  AND s.deleted_at IS NULL AND r.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  IF(s.so_property_type = 2, 'discount_sale_order', 'sales_order'),
  s.so_id,
  s.so_no,
  'purchase_application',
  a.pur_id,
  a.pur_no,
  'generated',
  a.created_by
FROM hspsi_purchase_approve a
JOIN hspsi_sale_order s ON s.so_id = a.source_id
WHERE a.source_type = 'sales_order' AND a.source_id > 0
  AND a.deleted_at IS NULL AND s.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'requisition_application',
  a.draw_id,
  a.draw_no,
  'requisition_output',
  o.draw_output_id,
  o.draw_output_no,
  'generated',
  o.created_by
FROM hspsi_draw_approve_output o
JOIN hspsi_draw_approve a ON a.draw_id = o.draw_id
WHERE o.deleted_at IS NULL AND a.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'requisition_output',
  o.draw_output_id,
  o.draw_output_no,
  'requisition_return',
  r.draw_exit_id,
  r.draw_exit_no,
  'generated',
  r.created_by
FROM hspsi_draw_approve_output_exit r
JOIN hspsi_draw_approve_output o ON o.draw_output_id = r.draw_output_id
WHERE r.deleted_at IS NULL AND o.deleted_at IS NULL;
