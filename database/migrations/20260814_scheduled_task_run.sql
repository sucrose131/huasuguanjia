-- 定时任务执行历史：每次触发插入一行，不覆盖最近结果。
-- 状态：0失败 1成功 2跳过 3运行中；触发：0定时 1手动。message 仅存脱敏文案。

CREATE TABLE IF NOT EXISTS `hspsi_sys_scheduled_task_run` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '执行记录ID',
  `task_id` bigint unsigned NOT NULL COMMENT '关联 hspsi_sys_scheduled_task.id',
  `started_at` datetime NOT NULL COMMENT '开始时间',
  `finished_at` datetime DEFAULT NULL COMMENT '结束时间',
  `duration_ms` int unsigned DEFAULT NULL COMMENT '耗时毫秒',
  `status` tinyint NOT NULL DEFAULT 3 COMMENT '0失败 1成功 2跳过 3运行中',
  `message` varchar(500) NOT NULL DEFAULT '' COMMENT '结果摘要；失败时为原始错误（截断500）',
  `trigger_type` tinyint NOT NULL DEFAULT 0 COMMENT '0定时 1手动',
  `triggered_by` bigint NOT NULL DEFAULT 0 COMMENT '手动触发用户ID，定时为0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_scheduled_task_run_task` (`task_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统定时任务执行历史';
