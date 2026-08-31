-- 销售订单类型增加「无需出库」，供十方清源云库存纯入库订单使用。
-- 不改表结构，只追加字典项。

UPDATE hspsi_sys_dictionary_category
SET remark = '实物/虚拟/复合/无需出库',
    updated_at = NOW()
WHERE dict_catg_code = 'sales_order_type'
  AND deleted_at IS NULL;

SET @sales_order_type_id = (
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'sales_order_type' AND deleted_at IS NULL
  ORDER BY dict_catg_id LIMIT 1
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT @sales_order_type_id, '无需出库', '4', 4, '云库存等无实体发货订单，不生成销售出库', 0, 0
WHERE @sales_order_type_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_dictionary
    WHERE dict_catg_id = @sales_order_type_id AND dict_value = '4' AND deleted_at IS NULL
  );
