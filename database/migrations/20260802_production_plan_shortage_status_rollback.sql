-- 回滚生产计划“缺料”状态（仅用于完整回退本次状态流时执行）

START TRANSACTION;

SET @production_plan_status_catg_id=(
  SELECT dict_catg_id
  FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code='production_plan_status' AND deleted_at IS NULL
  ORDER BY dict_catg_id
  LIMIT 1
);

UPDATE hspsi_sys_dictionary
SET deleted_at=NOW(), updated_by=1, updated_at=NOW()
WHERE dict_catg_id=@production_plan_status_catg_id
  AND dict_value='7'
  AND deleted_at IS NULL;

UPDATE hspsi_sys_dictionary
SET sort=sort-1, updated_by=1, updated_at=NOW()
WHERE dict_catg_id=@production_plan_status_catg_id
  AND sort>=3
  AND deleted_at IS NULL;

COMMIT;
