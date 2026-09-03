-- 采购申请创建人终止/撤回审批。
-- 赋给 admin、oa-staff-applicant、采购专员、采购经理。不修改已冻结的 20260818_*.sql。

INSERT INTO hspsi_sys_menu (
  parent_id, path, name, code, icon, route, component, redirect,
  type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  page.id,
  concat(page.path, ',', page.id),
  concat(page.name, '-终止审批'),
  'purchase:applications:terminate',
  NULL,
  NULL,
  NULL,
  NULL,
  3,
  1,
  55,
  '菜单级操作权限；页面菜单本身代表查看权限',
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL
FROM hspsi_sys_menu page
WHERE page.code = 'purchase:applications'
  AND page.type = 2
  AND page.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM hspsi_sys_menu existing
    WHERE existing.code = 'purchase:applications:terminate'
      AND existing.deleted_at IS NULL
  );

INSERT INTO hspsi_sys_menu (
  parent_id, path, name, code, icon, route, component, redirect,
  type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  page.id,
  concat(page.path, ',', page.id),
  concat(page.name, '-撤回审批'),
  'purchase:applications:withdraw',
  NULL,
  NULL,
  NULL,
  NULL,
  3,
  1,
  56,
  '菜单级操作权限；页面菜单本身代表查看权限',
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  NULL
FROM hspsi_sys_menu page
WHERE page.code = 'purchase:applications'
  AND page.type = 2
  AND page.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM hspsi_sys_menu existing
    WHERE existing.code = 'purchase:applications:withdraw'
      AND existing.deleted_at IS NULL
  );

INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT role.id, permission.id
FROM hspsi_sys_role role
JOIN hspsi_sys_menu permission
  ON permission.code IN (
    'purchase:applications:terminate',
    'purchase:applications:withdraw'
  )
  AND permission.type = 3
  AND permission.status = 1
  AND permission.deleted_at IS NULL
WHERE role.code IN ('admin', 'oa-staff-applicant', 'purchase-specialist', 'purchase-manager')
  AND role.status = 1
  AND role.deleted_at IS NULL;
