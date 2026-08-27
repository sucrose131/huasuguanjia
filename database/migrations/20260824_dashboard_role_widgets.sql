-- 工作台角色组件配置
--
-- 设计边界：
-- 1. 组件显示权限复用 hspsi_sys_menu(type=3) 和 hspsi_sys_role_menu，不新增表结构。
-- 2. 角色决定组件是否显示，业务菜单权限继续作为数据查询的安全下限。
-- 3. 组织授权决定组件数据范围，金额白名单决定金额是否返回，不在本补丁处理。
-- 4. 本补丁幂等执行，只维护 dashboard:overview:widget:* 权限项。

START TRANSACTION;

SET @dashboard_overview_id := (
  SELECT id
  FROM hspsi_sys_menu
  WHERE code = 'dashboard:1:view'
    AND status = 1
    AND deleted_at IS NULL
  LIMIT 1
);

INSERT INTO hspsi_sys_menu (
  parent_id, path, name, type, route, code, icon, sort, status,
  created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  @dashboard_overview_id,
  CONCAT('0,', @dashboard_overview_id),
  widget.name,
  3,
  NULL,
  widget.code,
  NULL,
  widget.sort,
  1,
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL
FROM (
  SELECT '本月销售额' AS name, 'dashboard:overview:widget:sales-amount' AS code, 10 AS sort
  UNION ALL SELECT '本月采购额', 'dashboard:overview:widget:purchase-amount', 20
  UNION ALL SELECT '库存总值', 'dashboard:overview:widget:inventory-value', 30
  UNION ALL SELECT '待办数量', 'dashboard:overview:widget:pending-count', 40
  UNION ALL SELECT '采购销售趋势', 'dashboard:overview:widget:business-trend', 50
  UNION ALL SELECT '库存健康', 'dashboard:overview:widget:inventory-health', 60
  UNION ALL SELECT '待办预览', 'dashboard:overview:widget:todo-preview', 70
  UNION ALL SELECT '快捷功能', 'dashboard:overview:widget:quick-actions', 80
  UNION ALL SELECT '消息中心', 'dashboard:overview:widget:message-summary', 90
) widget
WHERE @dashboard_overview_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  parent_id = VALUES(parent_id),
  path = VALUES(path),
  name = VALUES(name),
  type = 3,
  sort = VALUES(sort),
  status = 1,
  updated_by = 0,
  updated_at = CURRENT_TIMESTAMP,
  deleted_at = NULL;

-- 超级管理员默认拥有全部工作台组件。
INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT role.id, widget.id
FROM hspsi_sys_role role
JOIN hspsi_sys_menu widget
  ON widget.code LIKE 'dashboard:overview:widget:%'
  AND widget.status = 1
  AND widget.deleted_at IS NULL
WHERE role.code = 'admin'
  AND role.status = 1
  AND role.deleted_at IS NULL;

-- 为现有标准角色提供可直接使用的初始配置；之后可在角色管理中逐项调整。
DROP TEMPORARY TABLE IF EXISTS tmp_dashboard_role_widget;
CREATE TEMPORARY TABLE tmp_dashboard_role_widget (
  role_code varchar(50) NOT NULL,
  widget_code varchar(100) NOT NULL,
  PRIMARY KEY (role_code, widget_code)
);

INSERT INTO tmp_dashboard_role_widget (role_code, widget_code) VALUES
  ('oa-staff-applicant', 'dashboard:overview:widget:pending-count'),
  ('oa-staff-applicant', 'dashboard:overview:widget:todo-preview'),
  ('oa-staff-applicant', 'dashboard:overview:widget:quick-actions'),
  ('oa-staff-applicant', 'dashboard:overview:widget:message-summary'),

  ('purchase-specialist', 'dashboard:overview:widget:purchase-amount'),
  ('purchase-specialist', 'dashboard:overview:widget:inventory-value'),
  ('purchase-specialist', 'dashboard:overview:widget:business-trend'),
  ('purchase-specialist', 'dashboard:overview:widget:inventory-health'),
  ('purchase-specialist', 'dashboard:overview:widget:pending-count'),
  ('purchase-specialist', 'dashboard:overview:widget:todo-preview'),
  ('purchase-specialist', 'dashboard:overview:widget:quick-actions'),
  ('purchase-specialist', 'dashboard:overview:widget:message-summary'),

  ('warehouse-manager', 'dashboard:overview:widget:inventory-value'),
  ('warehouse-manager', 'dashboard:overview:widget:inventory-health'),
  ('warehouse-manager', 'dashboard:overview:widget:pending-count'),
  ('warehouse-manager', 'dashboard:overview:widget:todo-preview'),
  ('warehouse-manager', 'dashboard:overview:widget:quick-actions'),
  ('warehouse-manager', 'dashboard:overview:widget:message-summary'),

  ('finance-operator', 'dashboard:overview:widget:sales-amount'),
  ('finance-operator', 'dashboard:overview:widget:purchase-amount'),
  ('finance-operator', 'dashboard:overview:widget:inventory-value'),
  ('finance-operator', 'dashboard:overview:widget:business-trend'),
  ('finance-operator', 'dashboard:overview:widget:inventory-health'),
  ('finance-operator', 'dashboard:overview:widget:pending-count'),
  ('finance-operator', 'dashboard:overview:widget:todo-preview'),
  ('finance-operator', 'dashboard:overview:widget:quick-actions'),
  ('finance-operator', 'dashboard:overview:widget:message-summary'),

  ('production-manager', 'dashboard:overview:widget:inventory-value'),
  ('production-manager', 'dashboard:overview:widget:inventory-health'),
  ('production-manager', 'dashboard:overview:widget:pending-count'),
  ('production-manager', 'dashboard:overview:widget:todo-preview'),
  ('production-manager', 'dashboard:overview:widget:quick-actions'),
  ('production-manager', 'dashboard:overview:widget:message-summary');

INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT role.id, widget.id
FROM tmp_dashboard_role_widget defaults
JOIN hspsi_sys_role role
  ON role.code = defaults.role_code
  AND role.status = 1
  AND role.deleted_at IS NULL
JOIN hspsi_sys_menu widget
  ON widget.code = defaults.widget_code
  AND widget.status = 1
  AND widget.deleted_at IS NULL;

-- 采购经理拥有全部业务权限，因此默认展示全部工作台组件。
INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT role.id, widget.id
FROM hspsi_sys_role role
JOIN hspsi_sys_menu widget
  ON widget.code LIKE 'dashboard:overview:widget:%'
  AND widget.status = 1
  AND widget.deleted_at IS NULL
WHERE role.code = 'purchase-manager'
  AND role.status = 1
  AND role.deleted_at IS NULL;

DROP TEMPORARY TABLE IF EXISTS tmp_dashboard_role_widget;

COMMIT;

SELECT COUNT(*) AS dashboard_widget_count
FROM hspsi_sys_menu
WHERE code LIKE 'dashboard:overview:widget:%'
  AND status = 1
  AND deleted_at IS NULL;
