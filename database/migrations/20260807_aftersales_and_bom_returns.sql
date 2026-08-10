-- 售后处理进展与 BOM 物料退库。
-- 本脚本由部署人员审阅后一次性执行，不应重复运行。

ALTER TABLE hspsi_sale_order_service
  ADD COLUMN source_system varchar(32) NULL COMMENT '售后来源系统',
  ADD COLUMN external_request_id varchar(100) NULL COMMENT '外部申请唯一ID',
  ADD COLUMN external_request_no varchar(100) NULL COMMENT '外部申请单号',
  ADD COLUMN external_payload json NULL COMMENT '外部原始申请快照',
  ADD COLUMN received_at datetime NULL COMMENT '外部申请接收时间',
  ADD UNIQUE KEY uk_sale_service_external_request (source_system, external_request_id);

CREATE TABLE hspsi_sale_order_service_progress (
  progress_id bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '进展ID',
  service_id bigint NOT NULL COMMENT '售后主单ID',
  progress_content text NOT NULL COMMENT '本次处理进展',
  progress_status tinyint NOT NULL DEFAULT 0 COMMENT '处理后状态',
  source_type tinyint NOT NULL DEFAULT 1 COMMENT '1人工 2外部同步 3系统自动',
  source_system varchar(32) NULL COMMENT '外部来源系统',
  external_progress_id varchar(100) NULL COMMENT '外部进展唯一ID',
  handler_id bigint NOT NULL DEFAULT 0 COMMENT '处理人',
  occurred_at datetime NOT NULL COMMENT '实际处理时间',
  created_by bigint NOT NULL DEFAULT 0 COMMENT '创建人ID',
  updated_by bigint NOT NULL DEFAULT 0 COMMENT '最后更新人ID',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最后更新时间',
  deleted_at datetime NULL COMMENT '软删除时间',
  PRIMARY KEY (progress_id),
  KEY idx_service_progress_time (service_id, occurred_at),
  UNIQUE KEY uk_service_external_progress (source_system, external_progress_id)
) COMMENT='售后处理进展明细';

CREATE TABLE hspsi_production_material_return (
  return_id bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '退库单ID',
  return_no varchar(30) NOT NULL COMMENT '退库单号',
  request_key varchar(64) NOT NULL COMMENT '请求幂等键',
  source_out_id int NOT NULL COMMENT '原BOM物料出库单ID',
  plan_id bigint NULL COMMENT '生产计划ID',
  org_id bigint NOT NULL DEFAULT 0 COMMENT '组织ID',
  warehouse_id bigint NOT NULL DEFAULT 0 COMMENT '退回仓库ID',
  return_date datetime NOT NULL COMMENT '退库日期',
  total_qty int NOT NULL DEFAULT 0 COMMENT '本次退库总基础件数',
  status tinyint NOT NULL DEFAULT 0 COMMENT '0草稿 1已完成 2已作废 3已冲正',
  posting_version int NOT NULL DEFAULT 0 COMMENT '库存过账版本',
  attachments json NULL COMMENT '业务附件元数据',
  return_reason varchar(255) NOT NULL DEFAULT '' COMMENT '退库原因',
  remark varchar(255) NOT NULL DEFAULT '' COMMENT '备注',
  completed_by bigint NOT NULL DEFAULT 0 COMMENT '完成人ID',
  completed_at datetime NULL COMMENT '完成时间',
  voided_by bigint NOT NULL DEFAULT 0 COMMENT '作废操作人ID',
  voided_at datetime NULL COMMENT '作废时间',
  reversal_reason varchar(255) NOT NULL DEFAULT '' COMMENT '已完成退库的冲正原因',
  reversed_by bigint NOT NULL DEFAULT 0 COMMENT '冲正操作人ID',
  reversed_at datetime NULL COMMENT '冲正时间',
  created_by bigint NOT NULL DEFAULT 0 COMMENT '创建人ID',
  updated_by bigint NOT NULL DEFAULT 0 COMMENT '最后更新人ID',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最后更新时间',
  deleted_at datetime NULL COMMENT '软删除时间',
  PRIMARY KEY (return_id),
  UNIQUE KEY uk_production_material_return_no (return_no),
  UNIQUE KEY uk_production_material_return_request (request_key),
  KEY idx_production_material_return_source (source_out_id, status),
  KEY idx_production_material_return_scope (org_id, warehouse_id, return_date)
) COMMENT='BOM物料退库单';

CREATE TABLE hspsi_production_material_return_detail (
  detail_id bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '退库明细ID',
  return_id bigint unsigned NOT NULL COMMENT '退库单ID',
  source_out_detail_id int NOT NULL COMMENT '原BOM出库明细ID',
  goods_id bigint NOT NULL DEFAULT 0 COMMENT '商品ID',
  sku_id bigint NOT NULL DEFAULT 0 COMMENT 'SKUID',
  batch_no varchar(100) NOT NULL DEFAULT '' COMMENT '原出库批号',
  unit_type int NOT NULL DEFAULT 0 COMMENT '单位',
  source_output_qty int NOT NULL DEFAULT 0 COMMENT '原实际出库数量快照',
  return_qty int NOT NULL DEFAULT 0 COMMENT '本次退库数量',
  storage_location varchar(255) NOT NULL DEFAULT '' COMMENT '退回库位自由文本',
  remark varchar(255) NOT NULL DEFAULT '' COMMENT '明细备注',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '最后更新时间',
  PRIMARY KEY (detail_id),
  UNIQUE KEY uk_production_material_return_line (return_id, source_out_detail_id),
  KEY idx_production_material_return_detail_source (source_out_detail_id),
  KEY idx_production_material_return_detail_goods (goods_id, sku_id, batch_no)
) COMMENT='BOM物料退库明细';

INSERT INTO hspsi_sys_dictionary_category
  (dict_catg_name, dict_catg_code, sort, remark, created_by, updated_by)
SELECT 'BOM退库状态', 'bom_return_status', 0, '受保护的BOM退库流转状态', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'bom_return_status' AND deleted_at IS NULL
);

SET @bom_return_status_id = (
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'bom_return_status' AND deleted_at IS NULL
  ORDER BY dict_catg_id LIMIT 1
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT @bom_return_status_id, '草稿', '0', 0, '未过账，可编辑', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary
  WHERE dict_catg_id = @bom_return_status_id AND dict_value = '0' AND deleted_at IS NULL
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT @bom_return_status_id, '已完成', '1', 1, '已执行唯一一次库存入库', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary
  WHERE dict_catg_id = @bom_return_status_id AND dict_value = '1' AND deleted_at IS NULL
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT @bom_return_status_id, '已作废', '2', 2, '仅未过账草稿可作废', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary
  WHERE dict_catg_id = @bom_return_status_id AND dict_value = '2' AND deleted_at IS NULL
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT @bom_return_status_id, '已冲正', '3', 3, '原退库库存已执行反向扣减', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary
  WHERE dict_catg_id = @bom_return_status_id AND dict_value = '3' AND deleted_at IS NULL
);

-- BOM退库是独立的库存入库语义，不复用领用退回类型。
SET @inventory_business_mode_id = (
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'inventory_business_mode' AND deleted_at IS NULL
  ORDER BY dict_catg_id LIMIT 1
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT @inventory_business_mode_id, 'BOM退库', '16', 16, 'BOM出库物料退回原出库仓库', 0, 0
WHERE @inventory_business_mode_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_dictionary
    WHERE dict_catg_id = @inventory_business_mode_id
      AND dict_value = '16'
      AND deleted_at IS NULL
  );
