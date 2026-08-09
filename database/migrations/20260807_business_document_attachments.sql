-- 全业务单据附件元数据。
-- 附件实体存放在私有阿里云 OSS；这里只保存对象 key、文件信息、上传人和上传时间。

ALTER TABLE hspsi_sys_oper_log MODIFY COLUMN ip varchar(45) NULL COMMENT '客户端IP（兼容IPv6）';

ALTER TABLE hspsi_purchase_approve ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_purchase_order ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_purchase_order_input ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_purchase_order_input_exit ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_purchase_order_payment ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_purchase_refund ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';

ALTER TABLE hspsi_inventory_adjust ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_inventory_check ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_inventory_loss ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_inventory_loss_output ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_inventory_overflow ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_inventory_general_order ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_inventory_transfer ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';

ALTER TABLE hspsi_production_bom ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_production_material_out ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_production_plan ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_production_plan_input ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_production_shortage ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';

ALTER TABLE hspsi_sale_order ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_sale_order_exit ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_sale_order_output ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_sale_order_service ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_sales_order_payment ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';

ALTER TABLE hspsi_draw_approve ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_draw_approve_output ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
ALTER TABLE hspsi_draw_approve_output_exit ADD COLUMN attachments JSON NULL COMMENT '业务附件元数据';
