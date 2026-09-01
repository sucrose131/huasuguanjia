-- 采购申请明确拆分成本承担组织、OA发起组织和收货责任人。
-- org_id 继续承载成本承担组织，dept_id 继续承载申请部门；本补丁只增加缺失字段。

SET @purchase_application_oa_org_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hspsi_purchase_approve'
    AND COLUMN_NAME = 'oa_org_id'
);
SET @purchase_application_oa_org_sql := IF(
  @purchase_application_oa_org_exists = 0,
  'ALTER TABLE hspsi_purchase_approve ADD COLUMN oa_org_id BIGINT NOT NULL DEFAULT 0 COMMENT ''本次采购申请推送OA使用的组织ID'' AFTER dept_id',
  'SELECT 1'
);
PREPARE purchase_application_oa_org_stmt FROM @purchase_application_oa_org_sql;
EXECUTE purchase_application_oa_org_stmt;
DEALLOCATE PREPARE purchase_application_oa_org_stmt;

SET @purchase_application_receiver_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'hspsi_purchase_approve'
    AND COLUMN_NAME = 'receiver_id'
);
SET @purchase_application_receiver_sql := IF(
  @purchase_application_receiver_exists = 0,
  'ALTER TABLE hspsi_purchase_approve ADD COLUMN receiver_id BIGINT NOT NULL DEFAULT 0 COMMENT ''采购申请指定的收货人系统用户ID'' AFTER oa_org_id',
  'SELECT 1'
);
PREPARE purchase_application_receiver_stmt FROM @purchase_application_receiver_sql;
EXECUTE purchase_application_receiver_stmt;
DEALLOCATE PREPARE purchase_application_receiver_stmt;
