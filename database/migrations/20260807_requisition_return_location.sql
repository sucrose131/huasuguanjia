-- 领用退回可指定与原出库不同的同组织仓库，并记录用户填写的目标库位。
-- 本脚本仅提供结构变更，不会由应用启动过程自动执行。

ALTER TABLE `hspsi_draw_approve_output_exit_detail`
  ADD COLUMN `storage_location` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '退回目标库位（用户自定义文本）' AFTER `exit_qty`;
