-- 库存查询 Excel 导出独立操作权限。
-- 仅默认授予超级管理员；其他角色由管理员在角色管理中按需授权。
-- 本迁移只调整菜单权限基础数据，不修改业务表结构和库存数据。

INSERT INTO hspsi_sys_menu (
  parent_id, path, name, code, icon, route, component, redirect,
  type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  page.id,
  concat(page.path, ',', page.id),
  '库存查询-导出',
  'inventory:stocks:export',
  NULL,
  NULL,
  NULL,
  NULL,
  3,
  1,
  60,
  '菜单级操作权限；页面菜单本身代表查看权限',
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL
FROM hspsi_sys_menu page
WHERE page.code = 'inventory:stocks'
  AND page.type = 2
  AND page.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM hspsi_sys_menu existing
    WHERE existing.code = 'inventory:stocks:export'
      AND existing.deleted_at IS NULL
  );

-- 重复执行时校正现有有效权限，不改变主键及已有角色授权关系。
UPDATE hspsi_sys_menu permission
JOIN hspsi_sys_menu page
  ON page.code = 'inventory:stocks'
  AND page.type = 2
  AND page.deleted_at IS NULL
SET permission.parent_id = page.id,
    permission.path = concat(page.path, ',', page.id),
    permission.name = '库存查询-导出',
    permission.type = 3,
    permission.status = 1,
    permission.sort = 60,
    permission.remark = '菜单级操作权限；页面菜单本身代表查看权限',
    permission.updated_by = 0,
    permission.updated_at = CURRENT_TIMESTAMP
WHERE permission.code = 'inventory:stocks:export'
  AND permission.deleted_at IS NULL;

INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT role.id, permission.id
FROM hspsi_sys_role role
JOIN hspsi_sys_menu permission
  ON permission.code = 'inventory:stocks:export'
  AND permission.type = 3
  AND permission.status = 1
  AND permission.deleted_at IS NULL
WHERE role.code = 'admin'
  AND role.status = 1
  AND role.deleted_at IS NULL;
