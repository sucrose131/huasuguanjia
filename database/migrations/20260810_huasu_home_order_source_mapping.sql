-- 华溯之家订单同步：外部销售订单映射表（幂等、水位、原始快照）
-- 对应 docs/integrations/huasu-home/订单同步.md
-- 销售单头约定：so_source=数据源id，so_source_id=本表id；不写 business_source_*
--
-- 说明：若库中已通过 prisma db push 建表（无注释），本脚本后半段 ALTER 会补齐表/字段注释。

CREATE TABLE IF NOT EXISTS `hspsi_sale_order_source_mapping` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `source_id` bigint unsigned NOT NULL DEFAULT 0 COMMENT '数据来源ID，引用 hspsi_sys_data_source.id',
  `source_order_type` varchar(30) NOT NULL DEFAULT '' COMMENT '外部订单业务类型，如 SALE_ORDER（由拉取接口族决定）',
  `source_order_id` varchar(32) NOT NULL DEFAULT '' COMMENT '外部订单主键ID',
  `source_order_no` varchar(64) NOT NULL DEFAULT '' COMMENT '外部订单编号 order_sn',
  `so_id` bigint unsigned NOT NULL DEFAULT 0 COMMENT '平台销售订单 hspsi_sale_order.so_id',
  `source_status` int NOT NULL DEFAULT 0 COMMENT '最近一次成功应用的外部主状态（本期=order_status）',
  `source_updated_at` datetime DEFAULT NULL COMMENT '最近一次已应用的外部 updated_at（跳过无变更）',
  `last_payload` mediumtext COMMENT '最近一次成功应用的完整订单快照 JSON',
  `last_error_payload` mediumtext COMMENT '最近一次失败时的订单快照 JSON',
  `sync_status` tinyint NOT NULL DEFAULT 2 COMMENT '同步状态：1成功 2待重试 3失败',
  `last_sync_at` datetime DEFAULT NULL COMMENT '本平台最近同步时间',
  `remark` varchar(255) NOT NULL DEFAULT '' COMMENT '失败原因等备注',
  `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人',
  `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sale_order_source` (`source_id`, `source_order_type`, `source_order_id`),
  KEY `idx_sale_order_source_so` (`so_id`),
  KEY `idx_sale_order_source_no` (`source_id`, `source_order_type`, `source_order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='外部平台销售订单映射';

-- 补齐 / 刷新表注释与字段注释（兼容已存在无注释的表）
ALTER TABLE `hspsi_sale_order_source_mapping`
  COMMENT='外部平台销售订单映射',
  MODIFY COLUMN `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  MODIFY COLUMN `source_id` bigint unsigned NOT NULL DEFAULT 0 COMMENT '数据来源ID，引用 hspsi_sys_data_source.id',
  MODIFY COLUMN `source_order_type` varchar(30) NOT NULL DEFAULT '' COMMENT '外部订单业务类型，如 SALE_ORDER（由拉取接口族决定）',
  MODIFY COLUMN `source_order_id` varchar(32) NOT NULL DEFAULT '' COMMENT '外部订单主键ID',
  MODIFY COLUMN `source_order_no` varchar(64) NOT NULL DEFAULT '' COMMENT '外部订单编号 order_sn',
  MODIFY COLUMN `so_id` bigint unsigned NOT NULL DEFAULT 0 COMMENT '平台销售订单 hspsi_sale_order.so_id',
  MODIFY COLUMN `source_status` int NOT NULL DEFAULT 0 COMMENT '最近一次成功应用的外部主状态（本期=order_status）',
  MODIFY COLUMN `source_updated_at` datetime DEFAULT NULL COMMENT '最近一次已应用的外部 updated_at（跳过无变更）',
  MODIFY COLUMN `last_payload` mediumtext COMMENT '最近一次成功应用的完整订单快照 JSON',
  MODIFY COLUMN `last_error_payload` mediumtext COMMENT '最近一次失败时的订单快照 JSON',
  MODIFY COLUMN `sync_status` tinyint NOT NULL DEFAULT 2 COMMENT '同步状态：1成功 2待重试 3失败',
  MODIFY COLUMN `last_sync_at` datetime DEFAULT NULL COMMENT '本平台最近同步时间',
  MODIFY COLUMN `remark` varchar(255) NOT NULL DEFAULT '' COMMENT '失败原因等备注',
  MODIFY COLUMN `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人',
  MODIFY COLUMN `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人',
  MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  MODIFY COLUMN `deleted_at` datetime DEFAULT NULL COMMENT '删除时间';
