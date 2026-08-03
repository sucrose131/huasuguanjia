-- 采购单据编号统一为两位英文前缀：
-- 采购申请 PA、采购订单 PO、采购入库 GA。
UPDATE hspsi_purchase_approve
SET pur_no = CONCAT('PA', SUBSTRING(pur_no, 5))
WHERE pur_no LIKE 'CGSQ%';

UPDATE hspsi_purchase_order
SET po_no = CONCAT('PO', SUBSTRING(po_no, 5))
WHERE po_no LIKE 'CGDD%';

UPDATE hspsi_purchase_order_input
SET po_input_no = CONCAT('GA', SUBSTRING(po_input_no, 5))
WHERE po_input_no LIKE 'CGRK%';

UPDATE hspsi_business_document_relation
SET upstream_no = CASE
    WHEN upstream_type = 'purchase_application' AND upstream_no LIKE 'CGSQ%' THEN CONCAT('PA', SUBSTRING(upstream_no, 5))
    WHEN upstream_type = 'purchase_order' AND upstream_no LIKE 'CGDD%' THEN CONCAT('PO', SUBSTRING(upstream_no, 5))
    WHEN upstream_type = 'purchase_receipt' AND upstream_no LIKE 'CGRK%' THEN CONCAT('GA', SUBSTRING(upstream_no, 5))
    ELSE upstream_no
  END,
  downstream_no = CASE
    WHEN downstream_type = 'purchase_application' AND downstream_no LIKE 'CGSQ%' THEN CONCAT('PA', SUBSTRING(downstream_no, 5))
    WHEN downstream_type = 'purchase_order' AND downstream_no LIKE 'CGDD%' THEN CONCAT('PO', SUBSTRING(downstream_no, 5))
    WHEN downstream_type = 'purchase_receipt' AND downstream_no LIKE 'CGRK%' THEN CONCAT('GA', SUBSTRING(downstream_no, 5))
    ELSE downstream_no
  END
WHERE (upstream_type IN ('purchase_application', 'purchase_order', 'purchase_receipt')
       AND upstream_no REGEXP '^(CGSQ|CGDD|CGRK)')
   OR (downstream_type IN ('purchase_application', 'purchase_order', 'purchase_receipt')
       AND downstream_no REGEXP '^(CGSQ|CGDD|CGRK)');
