-- 预置十方清源自提订单同步任务。默认停用，Cron 为每天 01:00。
-- 不改表结构；未删除记录中同一 task_code 仍由应用层保证唯一。

INSERT INTO `hspsi_sys_scheduled_task` (
  `task_code`, `task_name`, `cron_expr`, `status`, `last_message`, `remark`, `created_by`, `updated_by`
)
SELECT 'shifang-qingyuan:agent-orders', '十方清源自提订单同步', '0 1 * * *', 0, '', '系统预置，默认停用', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM `hspsi_sys_scheduled_task` WHERE `task_code` = 'shifang-qingyuan:agent-orders' AND `deleted_at` IS NULL
);
