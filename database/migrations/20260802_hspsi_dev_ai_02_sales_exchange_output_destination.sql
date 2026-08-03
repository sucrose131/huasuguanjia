-- hspsi-dev-ai-02：售后换货沿用销售出库主从表，通过出库去向区分，不新增数据表或字段。
INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at)
SELECT
  category.dict_catg_id, '换货出库', '3', 3, '由售后换货自动生成，确认后完成换货流程', 0, 0, NOW(), NOW()
FROM hspsi_sys_dictionary_category AS category
WHERE category.dict_catg_code = 'sales_output_destination'
  AND category.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM hspsi_sys_dictionary AS existing
    WHERE existing.dict_catg_id = category.dict_catg_id
      AND existing.dict_value = '3'
      AND existing.deleted_at IS NULL
  );
