-- 进销存本地人员金额白名单
-- 业务规则：无记录即无金额权限；编辑权限必须同时包含查看权限。
-- 本表只关联本地系统用户，不参与 OA 人员、岗位、组织同步。

CREATE TABLE IF NOT EXISTS `hspsi_sys_user_amount_access` (
  `user_id` bigint unsigned NOT NULL COMMENT '本地系统用户ID',
  `can_view_amount` tinyint NOT NULL DEFAULT '0' COMMENT '是否允许查看金额 0=否 1=是',
  `can_edit_amount` tinyint NOT NULL DEFAULT '0' COMMENT '是否允许录入或修改金额 0=否 1=是',
  `grant_reason` varchar(255) NOT NULL DEFAULT '' COMMENT '授权或变更原因',
  `created_by` bigint NOT NULL DEFAULT '0' COMMENT '首次授权人',
  `updated_by` bigint NOT NULL DEFAULT '0' COMMENT '最后操作人',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '首次授权时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后操作时间',
  PRIMARY KEY (`user_id`) USING BTREE,
  CONSTRAINT `chk_user_amount_access_view` CHECK (`can_view_amount` IN (0, 1)),
  CONSTRAINT `chk_user_amount_access_edit` CHECK (`can_edit_amount` IN (0, 1)),
  CONSTRAINT `chk_user_amount_access_edit_requires_view`
    CHECK (`can_edit_amount` = 0 OR `can_view_amount` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='本地系统用户金额白名单';
