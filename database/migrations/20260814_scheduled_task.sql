-- 定时任务定义表：保存预置同步任务的名称、开关和 Linux Cron 执行时间。
-- task_code 在未删除记录中由应用层保证唯一，库表使用普通索引，以便软删除后可再新增同一类型。

CREATE TABLE IF NOT EXISTS `hspsi_sys_scheduled_task` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `task_code` varchar(64) NOT NULL DEFAULT '' COMMENT '任务类型编码（程序路由键）',
  `task_name` varchar(100) NOT NULL DEFAULT '' COMMENT '任务显示名称',
  `cron_expr` varchar(64) NOT NULL DEFAULT '0 1 * * *' COMMENT 'Linux五段Cron（分 时 日 月 周）',
  `status` tinyint NOT NULL DEFAULT 0 COMMENT '状态：1启用 0停用',
  `last_run_at` datetime DEFAULT NULL COMMENT '最近一次开始执行时间',
  `last_status` tinyint DEFAULT NULL COMMENT '最近结果：1成功 0失败 2跳过',
  `last_message` varchar(500) NOT NULL DEFAULT '' COMMENT '最近执行摘要或错误',
  `remark` varchar(255) NOT NULL DEFAULT '' COMMENT '备注',
  `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人',
  `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `idx_scheduled_task_code` (`task_code`),
  KEY `idx_scheduled_task_status` (`status`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统定时任务定义';

INSERT INTO `hspsi_sys_scheduled_task` (
  `task_code`, `task_name`, `cron_expr`, `status`, `last_message`, `remark`, `created_by`, `updated_by`
)
SELECT 'huasu-home:users', '华溯之家用户同步', '0 1 * * *', 0, '', '系统预置，默认停用', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM `hspsi_sys_scheduled_task` WHERE `task_code` = 'huasu-home:users' AND `deleted_at` IS NULL
);

INSERT INTO `hspsi_sys_scheduled_task` (
  `task_code`, `task_name`, `cron_expr`, `status`, `last_message`, `remark`, `created_by`, `updated_by`
)
SELECT 'huasu-home:products', '华溯之家商品同步', '0 1 * * *', 0, '', '系统预置，默认停用', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM `hspsi_sys_scheduled_task` WHERE `task_code` = 'huasu-home:products' AND `deleted_at` IS NULL
);

INSERT INTO `hspsi_sys_scheduled_task` (
  `task_code`, `task_name`, `cron_expr`, `status`, `last_message`, `remark`, `created_by`, `updated_by`
)
SELECT 'huasu-home:orders', '华溯之家订单同步', '0 1 * * *', 0, '', '含销售订单、会议门票、分期订单', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM `hspsi_sys_scheduled_task` WHERE `task_code` = 'huasu-home:orders' AND `deleted_at` IS NULL
);

INSERT INTO `hspsi_sys_scheduled_task` (
  `task_code`, `task_name`, `cron_expr`, `status`, `last_message`, `remark`, `created_by`, `updated_by`
)
SELECT 'xinfutong-oa:org', '薪福通OA组织同步', '0 1 * * *', 0, '', '组织、职位、人员顺序同步', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM `hspsi_sys_scheduled_task` WHERE `task_code` = 'xinfutong-oa:org' AND `deleted_at` IS NULL
);
