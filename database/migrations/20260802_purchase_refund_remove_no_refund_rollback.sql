-- 仅将“已关闭”编号恢复为4；不会恢复已废止的“无需退款”状态或零金额错误任务。

START TRANSACTION;

UPDATE hspsi_purchase_refund
SET refund_status=4, updated_at=NOW()
WHERE refund_status=3;

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
SELECT @purchase_refund_status_catg_id, x.dict_name, x.dict_value, x.sort, '采购退款状态', 1, 1, NOW(), NOW(), NULL
FROM (
  SELECT '已关闭' dict_name, '4' dict_value, 4 sort
) x
WHERE @purchase_refund_status_catg_id IS NOT NULL;

COMMIT;
