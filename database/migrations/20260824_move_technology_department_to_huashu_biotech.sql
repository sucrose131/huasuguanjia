-- 将华溯控股（深圳）有限公司的技术部及其人员迁移到
-- 当前启用的华溯生物科技（深圳）有限公司。
--
-- 迁移范围：
-- 1. 技术部的所属组织；
-- 2. 技术部人员登录账号的固定所属组织；
-- 3. 上述账号的本组织数据访问授权。
-- 历史业务单据的所属组织保持不变。

START TRANSACTION;

SET @source_org_id := (
  SELECT `org_id`
  FROM `hspsi_basic_organization`
  WHERE `name` = '华溯控股（深圳）有限公司'
    AND `operation_status` = 1
    AND `deleted_at` IS NULL
  ORDER BY `org_id`
  LIMIT 1
);

SET @target_org_id := (
  SELECT `org_id`
  FROM `hspsi_basic_organization`
  WHERE `name` = '华溯生物科技（深圳）有限公司'
    AND `operation_status` = 1
    AND `deleted_at` IS NULL
  ORDER BY `org_id` DESC
  LIMIT 1
);

SET @technology_dept_id := (
  SELECT `dept_id`
  FROM `hspsi_basic_dept`
  WHERE `name` = '技术部'
    AND `outer_ref_id` = '0003'
    AND `status` = 1
    AND `deleted_at` IS NULL
  ORDER BY `dept_id`
  LIMIT 1
);

UPDATE `hspsi_basic_dept`
SET
  `org_id` = @target_org_id,
  `updated_by` = 0,
  `updated_at` = NOW()
WHERE `dept_id` = @technology_dept_id
  AND @source_org_id IS NOT NULL
  AND @target_org_id IS NOT NULL
  AND @source_org_id <> @target_org_id;

DELETE `source_scope`
FROM `hspsi_sys_user_authorized_org` AS `source_scope`
INNER JOIN `hspsi_sys_user` AS `user`
  ON `user`.`id` = `source_scope`.`user_id`
INNER JOIN `hspsi_sys_user_authorized_org` AS `target_scope`
  ON `target_scope`.`user_id` = `source_scope`.`user_id`
  AND `target_scope`.`org_id` = @target_org_id
WHERE `user`.`dept_id` = @technology_dept_id
  AND `user`.`deleted_at` IS NULL
  AND `source_scope`.`org_id` = @source_org_id;

UPDATE `hspsi_sys_user_authorized_org` AS `scope`
INNER JOIN `hspsi_sys_user` AS `user`
  ON `user`.`id` = `scope`.`user_id`
SET `scope`.`org_id` = @target_org_id
WHERE `user`.`dept_id` = @technology_dept_id
  AND `user`.`deleted_at` IS NULL
  AND `scope`.`org_id` = @source_org_id
  AND @target_org_id IS NOT NULL;

UPDATE `hspsi_sys_user`
SET
  `org_id` = @target_org_id,
  `updated_by` = 0,
  `updated_at` = NOW()
WHERE `dept_id` = @technology_dept_id
  AND `deleted_at` IS NULL
  AND `org_id` <> @target_org_id
  AND @target_org_id IS NOT NULL;

COMMIT;
