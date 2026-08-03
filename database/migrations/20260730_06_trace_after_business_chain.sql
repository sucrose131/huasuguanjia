-- 06：在盘点、领用结构迁移完成后补齐逻辑单据关系。

UPDATE hspsi_business_document_relation r
JOIN hspsi_inventory_loss l
  ON l.loss_id = r.downstream_id
SET r.downstream_type = CASE WHEN l.business_kind = 1 THEN 'inventory_shortage' ELSE 'inventory_loss' END,
    r.updated_at = NOW()
WHERE r.upstream_type = 'inventory_check'
  AND r.downstream_type IN ('inventory_shortage', 'inventory_loss');

UPDATE hspsi_business_document_relation r
JOIN hspsi_inventory_loss l
  ON l.loss_id = r.upstream_id
SET r.upstream_type = CASE WHEN l.business_kind = 1 THEN 'inventory_shortage' ELSE 'inventory_loss' END,
    r.updated_at = NOW()
WHERE r.downstream_type = 'inventory_loss_output'
  AND r.upstream_type IN ('inventory_shortage', 'inventory_loss');

INSERT IGNORE INTO hspsi_business_document_relation
  (upstream_type, upstream_id, upstream_no, downstream_type, downstream_id, downstream_no, relation_kind, created_by)
SELECT
  'inventory_overflow',
  overflow_id,
  overflow_no,
  'inventory_overflow_input',
  overflow_id,
  input_no,
  'generated',
  input_by
FROM hspsi_inventory_overflow
WHERE input_status = 1
  AND input_no IS NOT NULL
  AND input_no <> ''
  AND deleted_at IS NULL;
