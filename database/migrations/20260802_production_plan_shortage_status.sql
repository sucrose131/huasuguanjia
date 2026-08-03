-- 生产计划增加“缺料”状态（不新增字典类型、不修改表结构）
-- 新建计划立即校验原料：充足进入待审核，不足进入缺料。

START TRANSACTION;

SET @production_plan_status_catg_id=(
  SELECT dict_catg_id
  FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code='production_plan_status' AND deleted_at IS NULL
  ORDER BY dict_catg_id
  LIMIT 1
);

UPDATE hspsi_sys_dictionary
SET sort=sort+1, updated_by=1, updated_at=NOW()
WHERE dict_catg_id=@production_plan_status_catg_id
  AND sort>=2
  AND dict_value<>'7'
  AND deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM (
      SELECT dict_id FROM hspsi_sys_dictionary
      WHERE dict_catg_id=@production_plan_status_catg_id
        AND dict_value='7'
        AND deleted_at IS NULL
    ) existing_shortage
  );

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @production_plan_status_catg_id, '缺料', '7', 2,
       '生产计划创建或重校时BOM原料库存不足，补齐重校后进入待审核',
       1, 1, NOW(), NOW(), NULL
WHERE @production_plan_status_catg_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_dictionary
    WHERE dict_catg_id=@production_plan_status_catg_id
      AND dict_value='7'
      AND deleted_at IS NULL
  );

UPDATE hspsi_sys_dictionary
SET dict_name='缺料', sort=2,
    remark='生产计划创建或重校时BOM原料库存不足，补齐重校后进入待审核',
    updated_by=1, updated_at=NOW(), deleted_at=NULL
WHERE dict_catg_id=@production_plan_status_catg_id
  AND dict_value='7';

-- 将尚未执行的历史缺料/补齐待重启计划收敛到新状态机。
-- 已生产、已出库、已入库、已完成或已终止的记录不做改写。
UPDATE hspsi_production_plan p
SET p.plan_status=7,
    p.approve_status=0,
    p.approve_comment='',
    p.approve_by=0,
    p.approve_date=NULL,
    p.updated_at=NOW()
WHERE p.deleted_at IS NULL
  AND p.plan_status IN (1,2)
  AND p.material_status IN (2,3,4)
  AND p.outbound_status=0
  AND p.delivered_qty=0
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_production_material_out o
    WHERE o.plan_id=p.plan_id AND o.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_production_plan_input i
    WHERE i.plan_id=p.plan_id AND i.deleted_at IS NULL
  );

COMMIT;
