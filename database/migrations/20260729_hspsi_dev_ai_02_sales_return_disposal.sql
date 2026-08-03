-- hspsi-dev-ai-02：销售退货先统一返库，处理方式仅决定返库后的后继业务。
INSERT INTO hspsi_sys_dictionary_category
  (dict_catg_name, dict_catg_code, sort, remark, created_by, updated_by, created_at, updated_at)
VALUES
  ('销售退货后处理', 'sales_return_disposal', 675, '退货确认统一先返库；售后、折价和报废作为返库后的后继业务', 1, 1, NOW(), NOW())
ON DUPLICATE KEY UPDATE
  dict_catg_name = VALUES(dict_catg_name),
  sort = VALUES(sort),
  remark = VALUES(remark),
  updated_by = VALUES(updated_by),
  updated_at = NOW(),
  deleted_at = NULL;

SET @sales_return_disposal_id = (
  SELECT dict_catg_id
  FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'sales_return_disposal'
  LIMIT 1
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at)
SELECT @sales_return_disposal_id, source.dict_name, source.dict_value, source.sort,
       '销售退货确认后处理方式', 1, 1, NOW(), NOW()
FROM (
  SELECT '正常返库' AS dict_name, '1' AS dict_value, 10 AS sort
  UNION ALL SELECT '转售后', '2', 20
  UNION ALL SELECT '折价出售', '3', 30
  UNION ALL SELECT '报废', '4', 40
) AS source
WHERE NOT EXISTS (
  SELECT 1
  FROM hspsi_sys_dictionary target
  WHERE target.dict_catg_id = @sales_return_disposal_id
    AND target.dict_value = source.dict_value
    AND target.deleted_at IS NULL
);
