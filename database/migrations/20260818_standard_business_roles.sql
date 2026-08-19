-- 标准业务角色权限基线
--
-- 设计原则：
-- 1. 角色只定义“可以做什么”，不绑定具体组织；同一角色可供不同组织复用。
-- 2. 用户可访问哪些组织，由 hspsi_sys_user_authorized_org 单独维护。
-- 3. 金额可见、金额编辑继续由 hspsi_sys_user_amount_access 白名单单独维护。
-- 4. 一个用户只绑定一个角色；如需组合职责，应新建一个符合岗位职责的组合角色。
-- 5. 本补丁只配置角色及菜单权限，不修改用户角色、用户组织和金额白名单。

START TRANSACTION;

INSERT INTO hspsi_sys_role (
  name, code, status, created_by, updated_by, created_at, updated_at, deleted_at
) VALUES
  ('采购专员', 'purchase-specialist', 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
  ('仓库管理员', 'warehouse-manager', 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
  ('财务人员', 'finance-operator', 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
  ('生产管理员', 'production-manager', 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  status = 1,
  updated_by = 0,
  updated_at = CURRENT_TIMESTAMP,
  deleted_at = NULL;

-- 基础申请人已经由 OA 员工基础角色补丁建立，这里只校正显示名称和启用状态。
UPDATE hspsi_sys_role
SET name = '基础申请人',
    status = 1,
    updated_by = 0,
    updated_at = CURRENT_TIMESTAMP,
    deleted_at = NULL
WHERE code = 'oa-staff-applicant';

DROP TEMPORARY TABLE IF EXISTS tmp_standard_role_permission;
CREATE TEMPORARY TABLE tmp_standard_role_permission (
  role_code varchar(50) NOT NULL,
  menu_code varchar(100) NOT NULL,
  PRIMARY KEY (role_code, menu_code)
);

-- 基础申请人：仅允许本人发起和维护采购申请、领用申请草稿并提交 OA。
INSERT INTO tmp_standard_role_permission (role_code, menu_code) VALUES
  ('oa-staff-applicant', 'purchase'),
  ('oa-staff-applicant', 'purchase:applications'),
  ('oa-staff-applicant', 'purchase:applications:create'),
  ('oa-staff-applicant', 'purchase:applications:update'),
  ('oa-staff-applicant', 'purchase:applications:delete'),
  ('oa-staff-applicant', 'purchase:applications:submit'),
  ('oa-staff-applicant', 'requisitions'),
  ('oa-staff-applicant', 'requisitions:applications'),
  ('oa-staff-applicant', 'requisitions:applications:create'),
  ('oa-staff-applicant', 'requisitions:applications:update'),
  ('oa-staff-applicant', 'requisitions:applications:delete'),
  ('oa-staff-applicant', 'requisitions:applications:submit');

-- 采购专员：维护供应商和采购执行链路；采购申请审核仍由 OA 完成。
INSERT INTO tmp_standard_role_permission (role_code, menu_code) VALUES
  ('purchase-specialist', 'master-data'),
  ('purchase-specialist', 'master-data:vendors'),
  ('purchase-specialist', 'master-data:vendors:create'),
  ('purchase-specialist', 'master-data:vendors:update'),
  ('purchase-specialist', 'master-data:vendors:status'),
  ('purchase-specialist', 'master-data:warehouses'),
  ('purchase-specialist', 'master-data:units'),
  ('purchase-specialist', 'goods'),
  ('purchase-specialist', 'goods:products'),
  ('purchase-specialist', 'goods:categories'),
  ('purchase-specialist', 'purchase'),
  ('purchase-specialist', 'purchase:applications'),
  ('purchase-specialist', 'purchase:applications:generate-order'),
  ('purchase-specialist', 'purchase:orders'),
  ('purchase-specialist', 'purchase:orders:create'),
  ('purchase-specialist', 'purchase:orders:update'),
  ('purchase-specialist', 'purchase:orders:delete'),
  ('purchase-specialist', 'purchase:orders:start'),
  ('purchase-specialist', 'purchase:orders:generate-receipt'),
  ('purchase-specialist', 'purchase:orders:cancel-pending'),
  ('purchase-specialist', 'purchase:receipts'),
  ('purchase-specialist', 'purchase:returns'),
  ('purchase-specialist', 'purchase:returns:create'),
  ('purchase-specialist', 'purchase:returns:update'),
  ('purchase-specialist', 'purchase:returns:delete'),
  ('purchase-specialist', 'purchase:returns:submit'),
  ('purchase-specialist', 'inventory'),
  ('purchase-specialist', 'inventory:stocks');

-- 仓库管理员：执行各类出入库、调拨、盘点和退回；不自动获得金额权限。
INSERT INTO tmp_standard_role_permission (role_code, menu_code) VALUES
  ('warehouse-manager', 'master-data'),
  ('warehouse-manager', 'master-data:warehouses'),
  ('warehouse-manager', 'master-data:units'),
  ('warehouse-manager', 'goods'),
  ('warehouse-manager', 'goods:products'),
  ('warehouse-manager', 'goods:categories'),
  ('warehouse-manager', 'purchase'),
  ('warehouse-manager', 'purchase:receipts'),
  ('warehouse-manager', 'purchase:receipts:confirm'),
  ('warehouse-manager', 'purchase:receipts:cancel'),
  ('warehouse-manager', 'purchase:receipts:return'),
  ('warehouse-manager', 'inventory'),
  ('warehouse-manager', 'inventory:stocks'),
  ('warehouse-manager', 'inventory:general-inputs'),
  ('warehouse-manager', 'inventory:general-inputs:create'),
  ('warehouse-manager', 'inventory:general-outputs'),
  ('warehouse-manager', 'inventory:general-outputs:create'),
  ('warehouse-manager', 'inventory:transfers'),
  ('warehouse-manager', 'inventory:transfers:create'),
  ('warehouse-manager', 'inventory:transfers:update'),
  ('warehouse-manager', 'inventory:transfers:delete'),
  ('warehouse-manager', 'inventory:transfers:submit'),
  ('warehouse-manager', 'inventory:adjustments'),
  ('warehouse-manager', 'inventory:adjustments:create'),
  ('warehouse-manager', 'inventory:adjustments:update'),
  ('warehouse-manager', 'inventory:adjustments:delete'),
  ('warehouse-manager', 'inventory:adjustments:submit'),
  ('warehouse-manager', 'inventory:losses'),
  ('warehouse-manager', 'inventory:losses:create'),
  ('warehouse-manager', 'inventory:losses:update'),
  ('warehouse-manager', 'inventory:losses:delete'),
  ('warehouse-manager', 'inventory:losses:submit'),
  ('warehouse-manager', 'inventory:loss-outputs'),
  ('warehouse-manager', 'inventory:loss-outputs:confirm'),
  ('warehouse-manager', 'inventory:overflows'),
  ('warehouse-manager', 'inventory:overflows:create'),
  ('warehouse-manager', 'inventory:overflows:update'),
  ('warehouse-manager', 'inventory:overflows:delete'),
  ('warehouse-manager', 'inventory:overflows:submit'),
  ('warehouse-manager', 'inventory:overflows:confirm'),
  ('warehouse-manager', 'inventory:checks'),
  ('warehouse-manager', 'inventory:checks:create'),
  ('warehouse-manager', 'inventory:checks:update'),
  ('warehouse-manager', 'inventory:checks:delete'),
  ('warehouse-manager', 'inventory:quantity-alerts'),
  ('warehouse-manager', 'inventory:expiry-alerts'),
  ('warehouse-manager', 'production'),
  ('warehouse-manager', 'production:outputs'),
  ('warehouse-manager', 'production:outputs:confirm'),
  ('warehouse-manager', 'production:outputs:confirm-material-return'),
  ('warehouse-manager', 'sales'),
  ('warehouse-manager', 'sales:outputs'),
  ('warehouse-manager', 'sales:outputs:confirm'),
  ('warehouse-manager', 'sales:outputs:undo-confirm'),
  ('warehouse-manager', 'sales:returns'),
  ('warehouse-manager', 'sales:returns:confirm'),
  ('warehouse-manager', 'sales:returns:undo-confirm'),
  ('warehouse-manager', 'requisitions'),
  ('warehouse-manager', 'requisitions:outputs'),
  ('warehouse-manager', 'requisitions:outputs:confirm'),
  ('warehouse-manager', 'requisitions:outputs:undo-confirm'),
  ('warehouse-manager', 'requisitions:returns'),
  ('warehouse-manager', 'requisitions:returns:confirm'),
  ('warehouse-manager', 'requisitions:returns:undo-confirm');

-- 财务人员：以查看业务金额、登记收付款和导出报表为主。
-- 是否真正显示或编辑金额，仍必须由金额白名单二次授权。
INSERT INTO tmp_standard_role_permission (role_code, menu_code) VALUES
  ('finance-operator', 'master-data'),
  ('finance-operator', 'master-data:vendors'),
  ('finance-operator', 'master-data:customers'),
  ('finance-operator', 'goods'),
  ('finance-operator', 'goods:products'),
  ('finance-operator', 'purchase'),
  ('finance-operator', 'purchase:applications'),
  ('finance-operator', 'purchase:orders'),
  ('finance-operator', 'purchase:receipts'),
  ('finance-operator', 'purchase:returns'),
  ('finance-operator', 'purchase:payments'),
  ('finance-operator', 'purchase:payments:create'),
  ('finance-operator', 'purchase:payments:update'),
  ('finance-operator', 'purchase:payments:delete'),
  ('finance-operator', 'purchase:refunds'),
  ('finance-operator', 'purchase:refunds:record'),
  ('finance-operator', 'purchase:refunds:void-record'),
  ('finance-operator', 'purchase:refunds:close'),
  ('finance-operator', 'inventory'),
  ('finance-operator', 'inventory:stocks'),
  ('finance-operator', 'inventory:checks'),
  ('finance-operator', 'sales'),
  ('finance-operator', 'sales:orders'),
  ('finance-operator', 'sales:outputs'),
  ('finance-operator', 'sales:returns'),
  ('finance-operator', 'sales:payments'),
  ('finance-operator', 'sales:payments:create'),
  ('finance-operator', 'sales:payments:delete'),
  ('finance-operator', 'sales:refunds'),
  ('finance-operator', 'sales:refunds:create'),
  ('finance-operator', 'sales:refunds:delete'),
  ('finance-operator', 'reports'),
  ('finance-operator', 'reports:1:view'),
  ('finance-operator', 'reports:1:export'),
  ('finance-operator', 'reports:2:view'),
  ('finance-operator', 'reports:2:export'),
  ('finance-operator', 'reports:3:view'),
  ('finance-operator', 'reports:3:export'),
  ('finance-operator', 'reports:4:view'),
  ('finance-operator', 'reports:4:export'),
  ('finance-operator', 'reports:5:view'),
  ('finance-operator', 'reports:5:export'),
  ('finance-operator', 'reports:6:view'),
  ('finance-operator', 'reports:6:export'),
  ('finance-operator', 'reports:7:view'),
  ('finance-operator', 'reports:7:export'),
  ('finance-operator', 'reports:8:view'),
  ('finance-operator', 'reports:8:export'),
  ('finance-operator', 'reports:9:view'),
  ('finance-operator', 'reports:9:export'),
  ('finance-operator', 'reports:10:view'),
  ('finance-operator', 'reports:10:export'),
  ('finance-operator', 'reports:11:view'),
  ('finance-operator', 'reports:11:export'),
  ('finance-operator', 'reports:12:view'),
  ('finance-operator', 'reports:12:export'),
  ('finance-operator', 'reports:13:view'),
  ('finance-operator', 'reports:13:export'),
  ('finance-operator', 'reports:14:view'),
  ('finance-operator', 'reports:14:export'),
  ('finance-operator', 'reports:15:view'),
  ('finance-operator', 'reports:15:export'),
  ('finance-operator', 'reports:16:view'),
  ('finance-operator', 'reports:16:export'),
  ('finance-operator', 'reports:17:view'),
  ('finance-operator', 'reports:17:export'),
  ('finance-operator', 'reports:18:view'),
  ('finance-operator', 'reports:18:export'),
  ('finance-operator', 'reports:19:view'),
  ('finance-operator', 'reports:19:export'),
  ('finance-operator', 'reports:20:view'),
  ('finance-operator', 'reports:20:export'),
  ('finance-operator', 'reports:21:view'),
  ('finance-operator', 'reports:21:export');

-- 生产管理员：维护生产计划、BOM、领料和产成品入库，并查看库存。
INSERT INTO tmp_standard_role_permission (role_code, menu_code) VALUES
  ('production-manager', 'goods'),
  ('production-manager', 'goods:products'),
  ('production-manager', 'goods:categories'),
  ('production-manager', 'inventory'),
  ('production-manager', 'inventory:stocks'),
  ('production-manager', 'inventory:quantity-alerts'),
  ('production-manager', 'production'),
  ('production-manager', 'production:plans'),
  ('production-manager', 'production:plans:create'),
  ('production-manager', 'production:plans:update'),
  ('production-manager', 'production:plans:delete'),
  ('production-manager', 'production:plans:export'),
  ('production-manager', 'production:plans:recheck'),
  ('production-manager', 'production:plans:restart'),
  ('production-manager', 'production:plans:terminate'),
  ('production-manager', 'production:outputs'),
  ('production-manager', 'production:outputs:create'),
  ('production-manager', 'production:outputs:update'),
  ('production-manager', 'production:outputs:delete'),
  ('production-manager', 'production:outputs:create-material-return'),
  ('production-manager', 'production:outputs:void-material-return'),
  ('production-manager', 'production:outputs:reverse-material-return'),
  ('production-manager', 'production:inputs'),
  ('production-manager', 'production:inputs:create'),
  ('production-manager', 'production:inputs:delete'),
  ('production-manager', 'production:boms'),
  ('production-manager', 'production:boms:create'),
  ('production-manager', 'production:boms:update'),
  ('production-manager', 'production:boms:delete'),
  ('production-manager', 'production:boms:status');

-- 本补丁作为一次性权限基线：只重置上述五个标准角色，不触碰系统管理员和自定义角色。
DELETE role_menu
FROM hspsi_sys_role_menu role_menu
JOIN hspsi_sys_role role ON role.id = role_menu.role_id
WHERE role.code IN (
  'oa-staff-applicant',
  'purchase-specialist',
  'warehouse-manager',
  'finance-operator',
  'production-manager'
);

INSERT INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT role.id, menu.id
FROM tmp_standard_role_permission permission
JOIN hspsi_sys_role role
  ON role.code = permission.role_code
  AND role.status = 1
  AND role.deleted_at IS NULL
JOIN hspsi_sys_menu menu
  ON menu.code = permission.menu_code
  AND menu.status = 1
  AND menu.deleted_at IS NULL;

-- 防止菜单字典缺项导致角色静默少权限：预期所有角色权限编码都必须成功映射。
SET @missing_standard_role_permission_count := (
  SELECT COUNT(*)
  FROM tmp_standard_role_permission permission
  LEFT JOIN hspsi_sys_menu menu
    ON menu.code = permission.menu_code
    AND menu.status = 1
    AND menu.deleted_at IS NULL
  WHERE menu.id IS NULL
);

DROP TEMPORARY TABLE IF EXISTS tmp_standard_role_permission;

COMMIT;

SELECT @missing_standard_role_permission_count AS missing_permission_count;
