-- 采购入库仓库属性细化
-- 目标：商品必须落在叶级分类，叶级分类通过 warehouse_type 精确约束可选仓库。
-- 本脚本不修改表结构，可重复执行。

START TRANSACTION;

SET @warehouse_type_category_id := (
  SELECT dict_catg_id
  FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'warehouse_type' AND deleted_at IS NULL
  LIMIT 1
);

UPDATE hspsi_sys_dictionary
SET dict_name = '销售实体成品库', sort = 1, updated_at = NOW(), deleted_at = NULL
WHERE dict_catg_id = @warehouse_type_category_id AND dict_value = '1';

UPDATE hspsi_sys_dictionary
SET dict_name = '生产原料库', sort = 2, updated_at = NOW(), deleted_at = NULL
WHERE dict_catg_id = @warehouse_type_category_id AND dict_value = '2';

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at)
SELECT @warehouse_type_category_id, values_to_add.dict_name, values_to_add.dict_value,
       values_to_add.sort, '仓库业务属性', 0, 0, NOW(), NOW()
FROM (
  SELECT '销售虚拟商品库' AS dict_name, '3' AS dict_value, 3 AS sort
  UNION ALL SELECT '礼品赠品库', '4', 4
  UNION ALL SELECT '办公设备库', '5', 5
  UNION ALL SELECT '办公家具库', '6', 6
  UNION ALL SELECT '办公耗材库', '7', 7
  UNION ALL SELECT '废旧物资库', '8', 8
  UNION ALL SELECT '医疗耗材库', '9', 9
  UNION ALL SELECT '医疗器械库', '10', 10
  UNION ALL SELECT '药品库', '11', 11
  UNION ALL SELECT '实验用品库', '12', 12
  UNION ALL SELECT '生产备件库', '13', 13
) AS values_to_add
WHERE NOT EXISTS (
  SELECT 1
  FROM hspsi_sys_dictionary existing
  WHERE existing.dict_catg_id = @warehouse_type_category_id
    AND existing.dict_value = values_to_add.dict_value
    AND existing.deleted_at IS NULL
);

UPDATE hspsi_basic_warehouse
SET warehouse_type = CASE warehouse_id
  WHEN 1 THEN 1
  WHEN 2 THEN 3
  WHEN 3 THEN 4
  WHEN 4 THEN 5
  WHEN 5 THEN 6
  WHEN 6 THEN 7
  WHEN 7 THEN 4
  WHEN 8 THEN 8
  WHEN 9 THEN 9
  WHEN 10 THEN 10
  WHEN 11 THEN 11
  WHEN 12 THEN 2
  WHEN 13 THEN 13
  WHEN 14 THEN 12
  WHEN 15 THEN 2
  ELSE warehouse_type
END,
updated_at = NOW()
WHERE warehouse_id IN (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15)
  AND deleted_at IS NULL;

UPDATE hspsi_goods_info_category
SET warehouse_type = CASE goods_catg_id
  WHEN 1 THEN 1
  WHEN 2 THEN 7
  WHEN 3 THEN 9
  WHEN 4 THEN 12
  WHEN 5 THEN 2
  WHEN 6 THEN 4
  WHEN 7 THEN 1
  WHEN 8 THEN 1
  WHEN 9 THEN 1
  WHEN 10 THEN 5
  WHEN 11 THEN 6
  WHEN 12 THEN 7
  WHEN 13 THEN 10
  WHEN 14 THEN 9
  WHEN 15 THEN 11
  WHEN 16 THEN 12
  WHEN 17 THEN 12
  WHEN 18 THEN 2
  WHEN 19 THEN 2
  WHEN 20 THEN 2
  WHEN 21 THEN 4
  WHEN 22 THEN 4
  ELSE warehouse_type
END,
updated_at = NOW()
WHERE goods_catg_id BETWEEN 1 AND 22
  AND deleted_at IS NULL;

-- 已有商品迁移到叶级分类，避免父分类产生宽泛仓库候选。
UPDATE hspsi_goods_info
SET goods_catg_id = CASE goods_id
  WHEN 1900700110 THEN 7       -- 华溯康复训练拉力套装 -> 外用理疗
  WHEN 1826165794 THEN 14      -- 康复训练弹力带（中阻） -> 医疗耗材
  WHEN 1900700108 THEN 19      -- 医用级天然乳胶原片 -> 结构类原料
  WHEN 1900700109 THEN 19      -- 环保防滑织物套 -> 结构类原料
  ELSE goods_catg_id
END,
updated_at = NOW()
WHERE goods_id IN (1900700110,1826165794,1900700108,1900700109)
  AND deleted_at IS NULL;

-- 同步叶级分类对应的默认仓库；业务入库仍可选择同组织、同属性的其他仓库。
UPDATE hspsi_goods_info
SET warehouse_id = 9, updated_at = NOW()
WHERE goods_id = 1826165794
  AND deleted_at IS NULL;

COMMIT;
