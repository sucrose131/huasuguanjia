-- 01：销售出库、销售退货、采购入库支持“撤销后再次确认”。
-- posting_version 在每次确认时递增，确认/撤销库存流水使用同一版本号，
-- 从而既能阻止并发重复过账，也允许下一轮重新确认。

ALTER TABLE `hspsi_sale_order_output`
  ADD COLUMN `posting_version` INT NOT NULL DEFAULT 0 COMMENT '库存过账版本' AFTER `comfirm_date`;

ALTER TABLE `hspsi_sale_order_exit`
  ADD COLUMN `posting_version` INT NOT NULL DEFAULT 0 COMMENT '库存过账版本' AFTER `comfirm_date`;

ALTER TABLE `hspsi_purchase_order_input`
  ADD COLUMN `posting_version` INT NOT NULL DEFAULT 0 COMMENT '库存过账版本' AFTER `comfirm_comment`;
