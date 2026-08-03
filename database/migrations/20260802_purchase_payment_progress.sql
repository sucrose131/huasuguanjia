-- 采购付款进度字典（无表结构变更）
-- 付款进度由订单应付、有效付款及退款流水实时计算，数据库只保存字典展示值。

START TRANSACTION;

INSERT INTO hspsi_sys_dictionary_category
  (dict_catg_name, dict_catg_code, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
VALUES
  ('采购付款进度', 'purchase_payment_progress_status', 78, '采购订单付款进度，按金额实时计算', 1, 1, NOW(), NOW(), NULL)
ON DUPLICATE KEY UPDATE
  dict_catg_name=VALUES(dict_catg_name), sort=VALUES(sort), remark=VALUES(remark),
  updated_by=1, updated_at=NOW(), deleted_at=NULL;

SET @purchase_payment_progress_catg_id=(
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code='purchase_payment_progress_status' AND deleted_at IS NULL
  ORDER BY dict_catg_id LIMIT 1
);

UPDATE hspsi_sys_dictionary d
JOIN (
  SELECT '未付款' dict_name, '0' dict_value, 1 sort
  UNION ALL SELECT '部分付款', '1', 2
  UNION ALL SELECT '已付清', '2', 3
) x ON x.dict_value=d.dict_value
SET d.dict_name=x.dict_name, d.sort=x.sort, d.remark='采购付款进度',
    d.updated_by=1, d.updated_at=NOW(), d.deleted_at=NULL
WHERE d.dict_catg_id=@purchase_payment_progress_catg_id;

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @purchase_payment_progress_catg_id, x.dict_name, x.dict_value, x.sort,
       '采购付款进度', 1, 1, NOW(), NOW(), NULL
FROM (
  SELECT '未付款' dict_name, '0' dict_value, 1 sort
  UNION ALL SELECT '部分付款', '1', 2
  UNION ALL SELECT '已付清', '2', 3
) x
WHERE @purchase_payment_progress_catg_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_dictionary d
    WHERE d.dict_catg_id=@purchase_payment_progress_catg_id
      AND d.dict_value=x.dict_value
      AND d.deleted_at IS NULL
  );

COMMIT;
