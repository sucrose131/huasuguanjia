-- 组织—部门—岗位—人员—系统用户权限链
-- OA 继续维护组织、部门、岗位和人员；本表只维护本地登录账号的稳定人员映射及指定组织授权。

SET @staff_column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hspsi_sys_user'
    AND COLUMN_NAME = 'staff_id'
);
SET @staff_column_sql := IF(
  @staff_column_exists = 0,
  'ALTER TABLE hspsi_sys_user ADD COLUMN staff_id BIGINT NULL COMMENT ''关联OA同步人员ID；本地测试账号可为空'' AFTER dept_id',
  'SELECT 1'
);
PREPARE staff_column_stmt FROM @staff_column_sql;
EXECUTE staff_column_stmt;
DEALLOCATE PREPARE staff_column_stmt;

SET @staff_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hspsi_sys_user'
    AND INDEX_NAME = 'uk_user_staff_id'
);
SET @staff_index_sql := IF(
  @staff_index_exists = 0,
  'ALTER TABLE hspsi_sys_user ADD UNIQUE KEY uk_user_staff_id (staff_id)',
  'SELECT 1'
);
PREPARE staff_index_stmt FROM @staff_index_sql;
EXECUTE staff_index_stmt;
DEALLOCATE PREPARE staff_index_stmt;

CREATE TABLE IF NOT EXISTS hspsi_sys_user_org_scope (
  user_id BIGINT UNSIGNED NOT NULL COMMENT '本地系统用户ID',
  org_id BIGINT UNSIGNED NOT NULL COMMENT '明确授权的组织ID',
  created_by BIGINT NOT NULL DEFAULT 0 COMMENT '授权人',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '授权时间',
  PRIMARY KEY (user_id, org_id),
  KEY idx_user_org_scope_org (org_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='本地用户指定组织数据范围';
