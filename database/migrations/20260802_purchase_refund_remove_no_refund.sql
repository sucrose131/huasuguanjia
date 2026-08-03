-- 修正采购退款触发与状态：仅真实应退款任务进入采购退款模块。
-- 本迁移先清理应退金额为 0 的错误任务，再将“已关闭”状态统一为 dict_value=3。

START TRANSACTION;

DELETE relation
FROM hspsi_business_document_relation relation
JOIN hspsi_purchase_refund refund
  ON relation.downstream_type='purchase_refund'
 AND relation.downstream_id=refund.refund_id
WHERE refund.refundable_amount<=0;

DELETE flow
FROM hspsi_purchase_refund_flow flow
JOIN hspsi_purchase_refund refund ON refund.refund_id=flow.refund_id
WHERE refund.refundable_amount<=0;

DELETE FROM hspsi_purchase_refund
WHERE refundable_amount<=0;

UPDATE hspsi_purchase_refund
SET refund_status=3, updated_at=NOW()
WHERE refund_status=4;

SET @purchase_refund_status_catg_id=(
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code='purchase_refund_status' AND deleted_at IS NULL
  ORDER BY dict_catg_id LIMIT 1
);

DELETE FROM hspsi_sys_dictionary
WHERE dict_catg_id=@purchase_refund_status_catg_id
  AND dict_value IN ('3','4');

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @purchase_refund_status_catg_id, '已关闭', '3', 4, '采购退款状态', 1, 1, NOW(), NOW(), NULL
WHERE @purchase_refund_status_catg_id IS NOT NULL;

COMMIT;
