-- OA 身份同步与进销存业务授权解耦
--
-- 确认口径：
-- 1. OA 维护人员、组织、部门、岗位和启停状态。
-- 2. OA 同步根据数据字典生成本地角色和授权组织结果。
-- 3. 金额白名单 hspsi_sys_user_amount_access 不参与 OA 同步。
-- 4. 会话每次只选择一个当前组织，业务查询按当前组织过滤。

-- 将旧的“用户指定组织范围”关系表升级为“用户授权组织”关系表。
SET @old_org_scope_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hspsi_sys_user_org_scope'
);
SET @new_authorized_org_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hspsi_sys_user_authorized_org'
);
SET @rename_authorized_org_sql := IF(
  @old_org_scope_exists = 1 AND @new_authorized_org_exists = 0,
  'RENAME TABLE hspsi_sys_user_org_scope TO hspsi_sys_user_authorized_org',
  'SELECT 1'
);
PREPARE rename_authorized_org_stmt FROM @rename_authorized_org_sql;
EXECUTE rename_authorized_org_stmt;
DEALLOCATE PREPARE rename_authorized_org_stmt;

CREATE TABLE IF NOT EXISTS hspsi_sys_user_authorized_org (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '本地系统用户ID',
  org_id BIGINT UNSIGNED NOT NULL COMMENT '允许切换和访问的组织ID',
  created_by BIGINT NOT NULL DEFAULT 0 COMMENT '授权来源；0=OA同步',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '授权时间',
  PRIMARY KEY (user_id, org_id),
  KEY idx_user_authorized_org_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='OA同步后的用户授权组织结果';

-- 兼容旧表改名后的索引名。
SET @old_org_scope_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hspsi_sys_user_authorized_org'
    AND INDEX_NAME = 'idx_user_org_scope_org'
);
SET @new_authorized_org_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hspsi_sys_user_authorized_org'
    AND INDEX_NAME = 'idx_user_authorized_org_org'
);
SET @rename_authorized_org_index_sql := IF(
  @old_org_scope_index_exists = 1 AND @new_authorized_org_index_exists = 0,
  'ALTER TABLE hspsi_sys_user_authorized_org RENAME INDEX idx_user_org_scope_org TO idx_user_authorized_org_org',
  'SELECT 1'
);
PREPARE rename_authorized_org_index_stmt FROM @rename_authorized_org_index_sql;
EXECUTE rename_authorized_org_index_stmt;
DEALLOCATE PREPARE rename_authorized_org_index_stmt;

-- 不丢失现有账号的主组织；后续 OA 同步会按字典规则全量刷新。
INSERT IGNORE INTO hspsi_sys_user_authorized_org (user_id, org_id, created_by, created_at)
SELECT u.id, u.org_id, 0, CURRENT_TIMESTAMP
FROM hspsi_sys_user u
JOIN hspsi_basic_organization o
  ON o.org_id = u.org_id AND o.deleted_at IS NULL AND o.operation_status = 1
WHERE u.deleted_at IS NULL AND u.org_id IS NOT NULL;

-- 角色不再承载数据范围；数据范围由“授权组织 + 会话当前组织”决定。
SET @role_scope_column_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hspsi_sys_role'
    AND COLUMN_NAME = 'data_scope_type'
);
SET @drop_role_scope_sql := IF(
  @role_scope_column_exists = 1,
  'ALTER TABLE hspsi_sys_role DROP COLUMN data_scope_type',
  'SELECT 1'
);
PREPARE drop_role_scope_stmt FROM @drop_role_scope_sql;
EXECUTE drop_role_scope_stmt;
DEALLOCATE PREPARE drop_role_scope_stmt;

-- 废弃旧的角色数据范围字典。
UPDATE hspsi_sys_dictionary d
JOIN hspsi_sys_dictionary_category c ON c.dict_catg_id = d.dict_catg_id
SET d.deleted_at = COALESCE(d.deleted_at, CURRENT_TIMESTAMP),
    d.updated_at = CURRENT_TIMESTAMP,
    d.updated_by = 0
WHERE c.dict_catg_code = 'role_scope_type';

UPDATE hspsi_sys_dictionary_category
SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
    updated_at = CURRENT_TIMESTAMP,
    updated_by = 0
WHERE dict_catg_code = 'role_scope_type';

-- 岗位→本地角色映射。
-- dict_name  = OA 岗位 outer_ref_id（稳定外部ID）
-- dict_value = hspsi_sys_role.code（本地角色编码）
-- 当前本地库没有已绑定人员的账号，因此不猜测、不预置任何岗位角色映射。
INSERT INTO hspsi_sys_dictionary_category (
  dict_catg_name, dict_catg_code, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT '岗位系统角色映射', 'oa_position_role_mapping', 900,
       'dict_name=OA岗位outer_ref_id，dict_value=本地角色code；允许一个岗位映射多个角色',
       0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'oa_position_role_mapping' AND deleted_at IS NULL
);

-- OA 组织授权来源规则。删除某个字典项即停用该来源，不需要改表结构或改代码。
INSERT INTO hspsi_sys_dictionary_category (
  dict_catg_name, dict_catg_code, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT 'OA组织授权来源', 'oa_org_authorization_rule', 901,
       '决定OA同步时哪些组织关系转换为本地授权组织',
       0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'oa_org_authorization_rule' AND deleted_at IS NULL
);

SET @org_rule_category_id := (
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'oa_org_authorization_rule' AND deleted_at IS NULL
  LIMIT 1
);

INSERT INTO hspsi_sys_dictionary (
  dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT @org_rule_category_id, '主组织', 'PRIMARY_ORG', 10, '人员的主组织或主部门所属公司', 0, 0,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE @org_rule_category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_dictionary
    WHERE dict_catg_id = @org_rule_category_id AND dict_value = 'PRIMARY_ORG' AND deleted_at IS NULL
  );

INSERT INTO hspsi_sys_dictionary (
  dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT @org_rule_category_id, '兼任组织', 'SECONDARY_ORG', 20, '人员兼任组织或兼任部门所属公司', 0, 0,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE @org_rule_category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_dictionary
    WHERE dict_catg_id = @org_rule_category_id AND dict_value = 'SECONDARY_ORG' AND deleted_at IS NULL
  );

INSERT INTO hspsi_sys_dictionary (
  dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at
)
SELECT @org_rule_category_id, '岗位所属组织', 'POSITION_ORG', 30, '岗位在OA中明确归属的组织或部门所属公司', 0, 0,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL
WHERE @org_rule_category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_dictionary
    WHERE dict_catg_id = @org_rule_category_id AND dict_value = 'POSITION_ORG' AND deleted_at IS NULL
  );
