-- 基础资料“组织”三级菜单：仅更新菜单数据，不修改任何业务表结构或字段。
START TRANSACTION;

SET @base_parent := (
  SELECT id FROM hspsi_sys_menu
  WHERE code = 'master-data' AND deleted_at IS NULL
  ORDER BY id LIMIT 1
);

SET @organization_directory := (
  SELECT id FROM hspsi_sys_menu
  WHERE code = 'master-data:organizations' AND deleted_at IS NULL
  ORDER BY id LIMIT 1
);

UPDATE hspsi_sys_menu
SET parent_id = @base_parent,
    path = CONCAT('0,', @base_parent),
    name = '组织', route = NULL, redirect = '/base/organizations',
    type = 1, status = 1, sort = 3,
    remark = '公司、部门、职位和员工资料目录',
    updated_by = 1, updated_at = NOW()
WHERE id = @organization_directory;

INSERT INTO hspsi_sys_menu
  (parent_id, path, name, code, icon, route, component, redirect, type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @organization_directory, CONCAT('0,', @base_parent, ',', @organization_directory), '公司', 'master-data:companies', NULL, '/base/organizations', NULL, NULL, 2, 1, 1, '组织资料-公司', 1, 1, NOW(), NOW(), NULL
WHERE @organization_directory IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM hspsi_sys_menu WHERE code = 'master-data:companies' AND deleted_at IS NULL);

INSERT INTO hspsi_sys_menu
  (parent_id, path, name, code, icon, route, component, redirect, type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @organization_directory, CONCAT('0,', @base_parent, ',', @organization_directory), '部门', 'master-data:departments', NULL, '/base/departments', NULL, NULL, 2, 1, 2, '组织资料-部门', 1, 1, NOW(), NOW(), NULL
WHERE @organization_directory IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM hspsi_sys_menu WHERE code = 'master-data:departments' AND deleted_at IS NULL);

INSERT INTO hspsi_sys_menu
  (parent_id, path, name, code, icon, route, component, redirect, type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @organization_directory, CONCAT('0,', @base_parent, ',', @organization_directory), '职位', 'master-data:positions', NULL, '/base/positions', NULL, NULL, 2, 1, 3, '组织资料-职位', 1, 1, NOW(), NOW(), NULL
WHERE @organization_directory IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM hspsi_sys_menu WHERE code = 'master-data:positions' AND deleted_at IS NULL);

INSERT INTO hspsi_sys_menu
  (parent_id, path, name, code, icon, route, component, redirect, type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @organization_directory, CONCAT('0,', @base_parent, ',', @organization_directory), '员工', 'master-data:employees', NULL, '/base/employees', NULL, NULL, 2, 1, 4, '组织资料-员工', 1, 1, NOW(), NOW(), NULL
WHERE @organization_directory IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM hspsi_sys_menu WHERE code = 'master-data:employees' AND deleted_at IS NULL);

-- 原来拥有“组织”菜单权限的角色继承四个三级菜单。
INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT rm.role_id, child.id
FROM hspsi_sys_role_menu rm
JOIN hspsi_sys_menu child
  ON child.parent_id = @organization_directory
 AND child.code IN ('master-data:companies', 'master-data:departments', 'master-data:positions', 'master-data:employees')
 AND child.deleted_at IS NULL
WHERE rm.menu_id = @organization_directory;

COMMIT;
