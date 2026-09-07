-- 领用申请（借用/OA 渠道）创建人（领用人）撤回/终止 OA 审批。
-- 与 20260903_purchase_application_terminate_withdraw_permission.sql 同款菜单权限结构；
-- 字典为领用侧补齐 approve_status=3（取消/终止）项，展示口径与采购申请一致。
-- 角色授予沿用采购先例：admin + oa-staff-applicant（基础申请人，即领用人主体）；
-- 若业务后续要求更多角色可见按钮，可在此追加 hspsi_sys_role_menu 授权。

-- 1) 菜单级操作权限：撤回 / 终止
INSERT INTO hspsi_sys_menu (
  parent_id, path, name, code, icon, route, component, redirect,
  type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  page.id,
  concat(page.path, ',', page.id),
  concat(page.name, '-撤回审批'),
  'requisitions:applications:withdraw',
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
WHERE page.code = 'requisitions:applications'
  AND page.type = 2
  AND page.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM hspsi_sys_menu existing
    WHERE existing.code = 'requisitions:applications:withdraw'
      AND existing.deleted_at IS NULL
  );

INSERT INTO hspsi_sys_menu (
  parent_id, path, name, code, icon, route, component, redirect,
  type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  page.id,
  concat(page.path, ',', page.id),
  concat(page.name, '-终止审批'),
  'requisitions:applications:terminate',
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
WHERE page.code = 'requisitions:applications'
  AND page.type = 2
  AND page.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM hspsi_sys_menu existing
    WHERE existing.code = 'requisitions:applications:terminate'
      AND existing.deleted_at IS NULL
  );

INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT role.id, permission.id
FROM hspsi_sys_role role
JOIN hspsi_sys_menu permission
  ON permission.code IN (
    'requisitions:applications:terminate',
    'requisitions:applications:withdraw'
  )
  AND permission.type = 3
  AND permission.status = 1
  AND permission.deleted_at IS NULL
WHERE role.code IN ('admin', 'oa-staff-applicant')
  AND role.status = 1
  AND role.deleted_at IS NULL;

-- 2) 审批状态字典补齐 value=3（取消/终止），领用与采购共用展示文案。
--    requisition_approval_status 原只有 0 待审批 / 1 已通过 / 2 已驳回。
INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT
  c.dict_catg_id,
  '已取消',
  '3',
  4,
  'OA取消或本系统终止（创建人），展示口径与采购申请一致',
  0,
  0
FROM hspsi_sys_dictionary_category c
WHERE c.dict_catg_code = 'requisition_approval_status'
  AND c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM hspsi_sys_dictionary d
    WHERE d.dict_catg_id = c.dict_catg_id
      AND d.dict_value = '3'
      AND d.deleted_at IS NULL
  );

-- 采购侧 approval_status 若缺 value=3 一并补齐（防御性；已有则不重复插入）。
INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT
  c.dict_catg_id,
  '已取消',
  '3',
  4,
  'OA取消或本系统终止（创建人），展示口径与采购申请一致',
  0,
  0
FROM hspsi_sys_dictionary_category c
WHERE c.dict_catg_code = 'approval_status'
  AND c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM hspsi_sys_dictionary d
    WHERE d.dict_catg_id = c.dict_catg_id
      AND d.dict_value = '3'
      AND d.deleted_at IS NULL
  );
