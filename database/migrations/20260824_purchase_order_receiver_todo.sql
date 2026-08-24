-- 采购订单指定收货人待办：业务单据ID统一使用 unsigned bigint。
-- 采购订单等业务表使用长整型雪花ID，原 int 字段无法安全保存关联关系。

ALTER TABLE `hspsi_sys_todo`
  MODIFY COLUMN `source_id` bigint unsigned NULL DEFAULT 0 COMMENT '来源ID，如业务单据ID',
  MODIFY COLUMN `business_id` bigint unsigned NULL DEFAULT 0 COMMENT '业务ID';

SET @todo_business_index_exists := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'hspsi_sys_todo'
    AND index_name = 'idx_todo_business_status'
);

SET @todo_business_index_sql := IF(
  @todo_business_index_exists = 0,
  'ALTER TABLE `hspsi_sys_todo` ADD INDEX `idx_todo_business_status` (`source_type`, `business_id`, `status`)',
  'SELECT 1'
);

PREPARE todo_business_index_stmt FROM @todo_business_index_sql;
EXECUTE todo_business_index_stmt;
DEALLOCATE PREPARE todo_business_index_stmt;
