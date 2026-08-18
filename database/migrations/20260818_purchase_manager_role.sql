-- 集团采购经理角色
--
-- 1. 拥有除系统管理之外的全部业务页面和业务操作。
-- 2. 不授予角色管理、用户管理、系统配置和任务管理权限。
-- 3. 总部及分公司数据范围由用户授权组织单独配置，不写死在角色中。
-- 4. 金额可见、金额编辑继续由金额白名单单独控制。
-- 5. 本补丁只处理 purchase-manager，不修改其他角色、用户和组织授权。

START TRANSACTION;

INSERT INTO hspsi_sys_role (
  name, code, status, created_by, updated_by, created_at, updated_at, deleted_at
) VALUES (
  '采购经理', 'purchase-manager', 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  status = 1,
  updated_by = 0,
  updated_at = CURRENT_TIMESTAMP,
  deleted_at = NULL;

SET @purchase_manager_role_id := (
  SELECT id
  FROM hspsi_sys_role
  WHERE code = 'purchase-manager'
    AND deleted_at IS NULL
  LIMIT 1
);

-- 只重建采购经理自己的权限，不触碰其他角色。
DELETE FROM hspsi_sys_role_menu
WHERE role_id = @purchase_manager_role_id;

INSERT INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT @purchase_manager_role_id, menu.id
FROM hspsi_sys_menu menu
WHERE @purchase_manager_role_id IS NOT NULL
  AND menu.status = 1
  AND menu.deleted_at IS NULL
  AND menu.code <> 'system'
  AND menu.code NOT LIKE 'system:%';

COMMIT;
