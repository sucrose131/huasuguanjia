-- OA 有效员工的进销存基础登录角色
--
-- 业务口径：
-- 1. 每名 OA 有效员工都必须有进销存登录账号。
-- 2. 所有人默认只能获得“基础申请人”角色，用于提交采购申请和领用申请。
-- 3. 岗位角色通过 oa_position_role_mapping 继续叠加。
-- 4. 金额白名单不参与本补丁，也不会被自动授予。

-- 一个自然人登录账号可以在多个 OA 账套中拥有不同员工身份。
CREATE TABLE IF NOT EXISTS hspsi_sys_user_oa_staff (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '进销存登录用户ID',
  staff_id BIGINT NOT NULL COMMENT 'OA同步员工ID',
  account_set_id BIGINT UNSIGNED NOT NULL COMMENT 'OA账套ID',
  created_by BIGINT NOT NULL DEFAULT 0 COMMENT '0=OA同步',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, staff_id),
  UNIQUE KEY uk_user_oa_staff_staff (staff_id),
  KEY idx_user_oa_staff_account (user_id, account_set_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='进销存账号与多OA账套员工身份映射';

-- 兼容已有单身份账号，并按登录手机号补齐同一自然人在其他OA账套中的身份。
INSERT IGNORE INTO hspsi_sys_user_oa_staff (
  user_id, staff_id, account_set_id, created_by, created_at
)
SELECT u.id, s.id, s.account_set_id, 0, CURRENT_TIMESTAMP
FROM hspsi_sys_user u
JOIN hspsi_basic_staff s ON s.mobile = u.username
WHERE u.deleted_at IS NULL
  AND s.deleted_at IS NULL;

INSERT INTO hspsi_sys_role (
  name, code, status, created_by, updated_by, created_at, updated_at, deleted_at
)
VALUES (
  '基础申请人', 'oa-staff-applicant', 1, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  status = 1,
  updated_by = 0,
  updated_at = CURRENT_TIMESTAMP,
  deleted_at = NULL;

SET @oa_staff_applicant_role_id := (
  SELECT id FROM hspsi_sys_role
  WHERE code = 'oa-staff-applicant' AND deleted_at IS NULL
  LIMIT 1
);

-- 仅开放采购申请、领用申请及其一级菜单。
INSERT IGNORE INTO hspsi_sys_role_menu (role_id, menu_id)
SELECT @oa_staff_applicant_role_id, id
FROM hspsi_sys_menu
WHERE deleted_at IS NULL
  AND status = 1
  AND code IN ('purchase', 'purchase:applications', 'requisitions', 'requisitions:applications')
  AND @oa_staff_applicant_role_id IS NOT NULL;

-- 全员基础角色映射必须通过数据字典维护，禁止在同步代码中写死角色 ID。
INSERT INTO hspsi_sys_dictionary_category (
  dict_catg_name, dict_catg_code, sort, remark,
  created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  'OA员工基础角色', 'oa_default_staff_role', 899,
  'OA有效员工同步进销存时自动授予；dict_value=hspsi_sys_role.code',
  0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'oa_default_staff_role' AND deleted_at IS NULL
);

SET @oa_default_role_category_id := (
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'oa_default_staff_role' AND deleted_at IS NULL
  LIMIT 1
);

INSERT INTO hspsi_sys_dictionary (
  dict_catg_id, dict_name, dict_value, sort, remark,
  created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT
  @oa_default_role_category_id, '全员基础申请人', 'oa-staff-applicant', 10,
  '所有OA有效员工默认获得；岗位角色在此基础上叠加',
  0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE @oa_default_role_category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_dictionary
    WHERE dict_catg_id = @oa_default_role_category_id
      AND dict_value = 'oa-staff-applicant'
      AND deleted_at IS NULL
  );
