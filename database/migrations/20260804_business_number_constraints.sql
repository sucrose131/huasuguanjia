-- 全局业务单号改造：补齐数据库最终唯一性保护。
-- 其他正式业务单号字段已存在唯一索引；生产缺料单号是本次核验发现的唯一缺口。
-- 若历史数据存在重复 shortage_no，本迁移会失败并保留原结构，需先人工核对历史数据；
-- 本迁移不会自动重写任何历史业务单号。

ALTER TABLE `hspsi_production_shortage`
  ADD UNIQUE KEY `uk_production_shortage_no` (`shortage_no`);
