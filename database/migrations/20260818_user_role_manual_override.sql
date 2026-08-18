-- 超级管理员人工维护 OA 用户角色时写入覆盖标记。
-- 有覆盖标记的用户仍由 OA 同步身份和授权组织，但角色集合以本地人工授权为准。
-- 金额白名单 hspsi_sys_user_amount_access 完全独立，不受本补丁影响。

CREATE TABLE IF NOT EXISTS `hspsi_sys_user_role_override` (
  `user_id` bigint unsigned NOT NULL COMMENT '用户ID；存在即表示角色由本地超级管理员维护',
  `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '最后操作人',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`user_id`),
  KEY `idx_user_role_override_updated_by` (`updated_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='OA用户本地角色人工覆盖';

-- RBAC 业务约束：一个用户只能绑定一个角色；角色自身可以组合多项菜单和操作权限。
-- 执行前如存在历史多角色数据应先由业务负责人确定保留角色。本项目当前审计结果为 0 条冲突。
SET @user_role_unique_exists = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'hspsi_sys_user_role'
    AND index_name = 'uk_user_role_user_id'
);
SET @user_role_unique_sql = IF(
  @user_role_unique_exists = 0,
  'ALTER TABLE `hspsi_sys_user_role` ADD UNIQUE KEY `uk_user_role_user_id` (`user_id`)',
  'SELECT 1'
);
PREPARE user_role_unique_stmt FROM @user_role_unique_sql;
EXECUTE user_role_unique_stmt;
DEALLOCATE PREPARE user_role_unique_stmt;
