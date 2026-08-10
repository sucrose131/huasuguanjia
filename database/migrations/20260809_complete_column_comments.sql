-- 补齐已创建业务表的字段注释。
-- 可重复执行；仅修改字段定义的 COMMENT，不修改数据、索引或字段类型。
-- 应在 20260807_aftersales_and_bom_returns.sql 之后执行。

ALTER TABLE hspsi_sale_order_service_progress
  MODIFY COLUMN created_by bigint NOT NULL DEFAULT 0 COMMENT '创建人ID',
  MODIFY COLUMN updated_by bigint NOT NULL DEFAULT 0 COMMENT '最后更新人ID',
  MODIFY COLUMN created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY COLUMN updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最后更新时间',
  MODIFY COLUMN deleted_at datetime NULL COMMENT '软删除时间';

ALTER TABLE hspsi_production_material_return
  MODIFY COLUMN status tinyint NOT NULL DEFAULT 0 COMMENT '0草稿 1已完成 2已作废 3已冲正',
  MODIFY COLUMN remark varchar(255) NOT NULL DEFAULT '' COMMENT '备注',
  MODIFY COLUMN completed_by bigint NOT NULL DEFAULT 0 COMMENT '完成人ID',
  MODIFY COLUMN completed_at datetime NULL COMMENT '完成时间',
  MODIFY COLUMN voided_by bigint NOT NULL DEFAULT 0 COMMENT '作废操作人ID',
  MODIFY COLUMN voided_at datetime NULL COMMENT '作废时间',
  MODIFY COLUMN reversed_by bigint NOT NULL DEFAULT 0 COMMENT '冲正操作人ID',
  MODIFY COLUMN reversed_at datetime NULL COMMENT '冲正时间',
  MODIFY COLUMN created_by bigint NOT NULL DEFAULT 0 COMMENT '创建人ID',
  MODIFY COLUMN updated_by bigint NOT NULL DEFAULT 0 COMMENT '最后更新人ID',
  MODIFY COLUMN created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY COLUMN updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最后更新时间',
  MODIFY COLUMN deleted_at datetime NULL COMMENT '软删除时间';

ALTER TABLE hspsi_production_material_return_detail
  MODIFY COLUMN remark varchar(255) NOT NULL DEFAULT '' COMMENT '明细备注',
  MODIFY COLUMN created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY COLUMN updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最后更新时间';
