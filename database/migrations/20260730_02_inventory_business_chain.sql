-- 02：库存盘点业务链增量迁移。
-- 仅增加阶段/来源字段，不删除、不重建现有表，也不改动既有字典值。

ALTER TABLE hspsi_inventory_loss
  ADD COLUMN business_kind TINYINT NOT NULL DEFAULT 2
    COMMENT '业务类别：1报亏单，2报损出库单' AFTER loss_no,
  MODIFY COLUMN go_where TINYINT NOT NULL DEFAULT -1
    COMMENT '报损去向：-1未选择，0直接报废，1折价出售',
  ADD KEY idx_inventory_loss_check_kind (source_check_id, business_kind);

ALTER TABLE hspsi_inventory_loss_output
  ADD COLUMN source_check_id BIGINT NOT NULL DEFAULT 0
    COMMENT '来源盘点单ID（由来源报亏单带入）' AFTER source_loss_id,
  ADD KEY idx_inventory_loss_output_source (source_loss_id),
  ADD KEY idx_inventory_loss_output_check (source_check_id);

ALTER TABLE hspsi_inventory_overflow
  ADD COLUMN input_no VARCHAR(20) NULL
    COMMENT '审批后生成的报盈入库单号' AFTER source_check_id,
  ADD COLUMN input_status TINYINT NOT NULL DEFAULT 0
    COMMENT '报盈入库状态：0待确认，1已确认入库' AFTER input_no,
  ADD COLUMN input_by BIGINT NOT NULL DEFAULT 0
    COMMENT '报盈入库确认人' AFTER input_status,
  ADD COLUMN input_date DATETIME NULL
    COMMENT '报盈入库确认时间' AFTER input_by,
  ADD UNIQUE KEY uk_inventory_overflow_input_no (input_no),
  ADD KEY idx_inventory_overflow_check (source_check_id);

-- 既有已审批报溢单已在旧逻辑中完成入库，仅补齐逻辑后继单号和阶段状态，
-- 不再重复生成库存流水。
UPDATE hspsi_inventory_overflow
SET input_no = CONCAT('IOI', DATE_FORMAT(COALESCE(approve_date, created_at, NOW()), '%Y%m%d'),
                      LPAD(overflow_id, 4, '0')),
    input_status = 1,
    input_by = approve_by,
    input_date = COALESCE(approve_date, updated_at, created_at)
WHERE approve_status = 1
  AND (input_no IS NULL OR input_no = '');

-- 页面同时承载盘点生成的报亏单和报损出库单。
UPDATE hspsi_sys_menu
SET name = '报亏/报损单', updated_at = NOW()
WHERE code = 'inventory:losses' AND deleted_at IS NULL;

SET @inventory_menu_id = (
  SELECT id FROM hspsi_sys_menu
  WHERE code = 'inventory' AND deleted_at IS NULL
  ORDER BY id LIMIT 1
);
INSERT INTO hspsi_sys_menu
  (parent_id, path, name, code, route, type, status, sort, remark, created_by, updated_by)
SELECT
  @inventory_menu_id, CAST(@inventory_menu_id AS CHAR), '报盈入库单',
  'inventory:overflow-inputs', '/inventory/overflow-inputs',
  1, 1, 7, '报盈单审批生成的逻辑入库单', 1, 1
WHERE @inventory_menu_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_menu
    WHERE code = 'inventory:overflow-inputs' AND deleted_at IS NULL
  );

UPDATE hspsi_sys_menu
SET sort = CASE code
  WHEN 'inventory:checks' THEN 8
  WHEN 'inventory:quantity-alerts' THEN 9
  WHEN 'inventory:expiry-alerts' THEN 10
  ELSE sort
END,
updated_at = NOW()
WHERE parent_id = @inventory_menu_id
  AND code IN ('inventory:checks', 'inventory:quantity-alerts', 'inventory:expiry-alerts')
  AND deleted_at IS NULL;

INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT role_menu.role_id, menu.id
FROM hspsi_sys_role_menu role_menu
JOIN hspsi_sys_menu parent_menu
  ON parent_menu.id = role_menu.menu_id
 AND parent_menu.code = 'inventory'
 AND parent_menu.deleted_at IS NULL
JOIN hspsi_sys_menu menu
  ON menu.code = 'inventory:overflow-inputs'
 AND menu.deleted_at IS NULL;
