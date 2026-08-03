-- hspsi-dev-ai-02 全系统数量字段整数化
-- 仅修改数量字段；金额、单价、比例继续使用 DECIMAL。
-- DDL 在 MySQL 中会隐式提交，执行前应保留数据库备份。

-- 当前新库仅以下两条临时补料记录存在小数数量，显式四舍五入，避免隐式转换不透明。
UPDATE hspsi_production_material_out_detail
SET out_qty = ROUND(out_qty)
WHERE out_qty IS NOT NULL AND out_qty <> TRUNCATE(out_qty, 0);

ALTER TABLE hspsi_draw_approve MODIFY COLUMN draw_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_draw_approve MODIFY COLUMN fact_draw_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_draw_approve_detail MODIFY COLUMN draw_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_draw_approve_output_detail MODIFY COLUMN draw_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_draw_approve_output_detail MODIFY COLUMN fact_draw_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_draw_approve_output_exit MODIFY COLUMN exit_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_draw_approve_output_exit_detail MODIFY COLUMN so_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_draw_approve_output_exit_detail MODIFY COLUMN exit_qty INT NOT NULL DEFAULT 0;

ALTER TABLE hspsi_inventory_adjust_detail MODIFY COLUMN before_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_adjust_detail MODIFY COLUMN adjust_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_alert_period MODIFY COLUMN alter_qty INT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_alert_qty MODIFY COLUMN safe_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_alert_qty MODIFY COLUMN safe_less_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_alert_qty MODIFY COLUMN purchase_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_alert_qty MODIFY COLUMN fact_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_batch_total MODIFY COLUMN input_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_batch_total MODIFY COLUMN output_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_batch_total MODIFY COLUMN inventory_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_check MODIFY COLUMN all_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_check MODIFY COLUMN less_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_check MODIFY COLUMN overflow_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_check MODIFY COLUMN overflow_process_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_check MODIFY COLUMN less_process_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_check_detail MODIFY COLUMN inventory_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_check_detail MODIFY COLUMN check_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_check_detail MODIFY COLUMN damaged_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_check_detail MODIFY COLUMN different_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_loss MODIFY COLUMN loss_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_loss_detail MODIFY COLUMN loss_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_loss_output MODIFY COLUMN loss_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_loss_output_detail MODIFY COLUMN loss_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_overflow MODIFY COLUMN overflow_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_overflow_detail MODIFY COLUMN overflow_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_total MODIFY COLUMN input_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_total MODIFY COLUMN output_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_total MODIFY COLUMN inventory_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_total_detail MODIFY COLUMN operation_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_total_detail MODIFY COLUMN after_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_inventory_transfer_detail MODIFY COLUMN transfer_qty INT NOT NULL DEFAULT 0;

ALTER TABLE hspsi_production_bom_detail MODIFY COLUMN require_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_production_material_out_detail MODIFY COLUMN out_qty INT NULL;
ALTER TABLE hspsi_production_plan MODIFY COLUMN plan_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_production_plan MODIFY COLUMN delivered_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_production_plan_detail MODIFY COLUMN bom_unit_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_production_plan_detail MODIFY COLUMN standard_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_production_plan_detail MODIFY COLUMN require_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_production_plan_detail MODIFY COLUMN plan_out_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_production_plan_input MODIFY COLUMN fact_input_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_production_shortage MODIFY COLUMN require_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_production_shortage MODIFY COLUMN fact_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_production_shortage MODIFY COLUMN suggest_purchase_qty INT NOT NULL DEFAULT 0;

ALTER TABLE hspsi_sale_order MODIFY COLUMN so_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_sale_order_detail MODIFY COLUMN sale_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_sale_order_exit MODIFY COLUMN exit_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_sale_order_exit_detail MODIFY COLUMN so_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_sale_order_exit_detail MODIFY COLUMN exit_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_sale_order_output_detail MODIFY COLUMN sale_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_sale_order_output_detail MODIFY COLUMN output_qty INT NOT NULL DEFAULT 0;
ALTER TABLE hspsi_sale_order_service_detail MODIFY COLUMN service_qty INT NOT NULL DEFAULT 0;
