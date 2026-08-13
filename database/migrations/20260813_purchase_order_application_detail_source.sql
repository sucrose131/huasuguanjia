-- 采购申请拆分生成多张采购订单：建立订单明细到申请明细的唯一来源映射。
-- 历史订单和直接采购订单保持 NULL；MySQL 唯一索引允许存在多条 NULL。

ALTER TABLE `hspsi_purchase_order_detail`
  ADD COLUMN `source_application_detail_id` bigint NULL COMMENT '来源采购申请明细ID，引用 hspsi_purchase_approve_detail.id' AFTER `po_id`,
  ADD UNIQUE KEY `uk_purchase_order_source_application_detail` (`source_application_detail_id`);

ALTER TABLE `hspsi_purchase_order`
  ADD INDEX `idx_purchase_order_pur_id` (`pur_id`);
