-- 库存盘点三类衍生单据闭环：字典与菜单收口（无表结构变更）。
-- 盘亏、盘盈只允许由盘点生成；报损保留盘点生成和独立新增。

START TRANSACTION;

SET @inventory_business_mode_catg_id := (
  SELECT dict_catg_id
  FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'inventory_business_mode' AND deleted_at IS NULL
  ORDER BY dict_catg_id
  LIMIT 1
);

UPDATE hspsi_sys_dictionary
SET dict_name = '报亏出库', sort = 7, remark = '盘点盘亏生成报亏出库单，整单审核通过后扣库',
    updated_by = 1, updated_at = NOW(), deleted_at = NULL
WHERE dict_catg_id = @inventory_business_mode_catg_id AND dict_value = '7';

UPDATE hspsi_sys_dictionary
SET dict_name = '报损报废出库', sort = 13, remark = '报损处置方式为直接报废时扣库',
    updated_by = 1, updated_at = NOW(), deleted_at = NULL
WHERE dict_catg_id = @inventory_business_mode_catg_id AND dict_value = '13';

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @inventory_business_mode_catg_id, '报损报废出库', '13', 13,
       '报损处置方式为直接报废时扣库', 1, 1, NOW(), NOW(), NULL
WHERE @inventory_business_mode_catg_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM hspsi_sys_dictionary
    WHERE dict_catg_id = @inventory_business_mode_catg_id
      AND dict_value = '13'
      AND deleted_at IS NULL
  );

-- 业务菜单只保留报损出库、报亏出库、报盈入库三个对象。
SET @inventory_parent := (
  SELECT id FROM hspsi_sys_menu
  WHERE code = 'inventory' AND deleted_at IS NULL
  ORDER BY id LIMIT 1
);

UPDATE hspsi_sys_menu
SET name = '报损出库单', sort = 4, route = '/inventory/losses',
    remark = '盘点生成或独立新增报损出库单', updated_by = 1, updated_at = NOW()
WHERE parent_id = @inventory_parent AND code = 'inventory:losses';

UPDATE hspsi_sys_menu
SET name = '报亏出库单', sort = 5, route = '/inventory/loss-outputs',
    remark = '仅由盘点盘亏生成，整单审核通过后扣库', updated_by = 1, updated_at = NOW()
WHERE parent_id = @inventory_parent AND code = 'inventory:loss-outputs';

-- 兼容改造前已经由盘点生成、尚未执行“确认出库”的记录，统一转为待审批。
UPDATE hspsi_inventory_loss_output
SET status = 1, updated_at = NOW()
WHERE source_check_id > 0 AND status = 0 AND approve_status = 0 AND deleted_at IS NULL;

UPDATE hspsi_sys_menu
SET name = '报盈入库单', sort = 6, route = '/inventory/overflows',
    remark = '仅由盘点盘盈生成，审批后直接入库', updated_by = 1, updated_at = NOW()
WHERE parent_id = @inventory_parent AND code = 'inventory:overflows';

UPDATE hspsi_sys_menu SET sort = 7, updated_by = 1, updated_at = NOW()
WHERE parent_id = @inventory_parent AND code = 'inventory:checks';
UPDATE hspsi_sys_menu SET sort = 8, updated_by = 1, updated_at = NOW()
WHERE parent_id = @inventory_parent AND code = 'inventory:quantity-alerts';
UPDATE hspsi_sys_menu SET sort = 9, updated_by = 1, updated_at = NOW()
WHERE parent_id = @inventory_parent AND code = 'inventory:expiry-alerts';

DELETE FROM hspsi_sys_role_menu
WHERE menu_id IN (
  SELECT id FROM hspsi_sys_menu
  WHERE parent_id = @inventory_parent AND code = 'inventory:overflow-inputs'
);

DELETE FROM hspsi_sys_menu
WHERE parent_id = @inventory_parent AND code = 'inventory:overflow-inputs';

-- 历史业务类型7流水均保留；未来报损报废使用类型13。
UPDATE hspsi_inventory_total_detail
SET inventory_mode = 7
WHERE source_type = 'inventory_loss_output';

UPDATE hspsi_inventory_total_detail
SET inventory_mode = 13
WHERE source_type = 'inventory_damage_scrap';

COMMIT;
