-- 通用出入库、基础件数换算快照及初期入库功能开关。
-- 通用单据创建即过账，不复用现有审批状态。

CREATE TABLE IF NOT EXISTS `hspsi_inventory_general_order` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `business_no` varchar(24) NOT NULL COMMENT '业务单号',
  `request_key` varchar(64) NOT NULL COMMENT '客户端幂等请求键',
  `direction` tinyint NOT NULL COMMENT '方向：1入库，-1出库',
  `business_type` varchar(32) NOT NULL COMMENT '业务类型：initial/entrusted_purchase/direct_output',
  `business_date` datetime NOT NULL COMMENT '业务日期',
  `org_id` bigint NOT NULL DEFAULT 0 COMMENT '所属公司/组织',
  `warehouse_id` bigint NOT NULL DEFAULT 0 COMMENT '仓库',
  `department_id` bigint NOT NULL DEFAULT 0 COMMENT '使用部门（描述维度）',
  `handler_id` bigint NOT NULL DEFAULT 0 COMMENT '经办人',
  `total_pieces` int NOT NULL DEFAULT 0 COMMENT '基础件数合计',
  `total_amount` decimal(14,2) NOT NULL DEFAULT 0.00 COMMENT '金额合计',
  `status` tinyint NOT NULL DEFAULT 1 COMMENT '状态：1已过账，0已作废（预留）',
  `remark` varchar(500) NOT NULL DEFAULT '' COMMENT '备注',
  `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人',
  `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_inventory_general_business_no` (`business_no`),
  UNIQUE KEY `uk_inventory_general_request_key` (`request_key`),
  KEY `idx_general_order_scope_date` (`org_id`,`warehouse_id`,`business_date`),
  KEY `idx_general_order_type_status` (`business_type`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通用出入库单';

CREATE TABLE IF NOT EXISTS `hspsi_inventory_general_order_detail` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `order_id` bigint unsigned NOT NULL DEFAULT 0 COMMENT '通用出入库单ID',
  `goods_id` bigint NOT NULL DEFAULT 0 COMMENT '商品ID',
  `sku_id` bigint NOT NULL DEFAULT 0 COMMENT 'SKUID',
  `batch_no` varchar(50) NOT NULL DEFAULT '' COMMENT '批次号',
  `document_unit_type` int NOT NULL DEFAULT 0 COMMENT '单据单位',
  `document_quantity` int NOT NULL DEFAULT 0 COMMENT '单据数量',
  `pieces_unit_type` int NOT NULL DEFAULT 0 COMMENT '基础单位',
  `pieces_per_unit` int NOT NULL DEFAULT 1 COMMENT '每单据单位包含的基础件数',
  `pieces_quantity` int NOT NULL DEFAULT 0 COMMENT '基础件数',
  `base_cost` decimal(12,4) NOT NULL DEFAULT 0.0000 COMMENT '每基础件成本',
  `amount` decimal(14,2) NOT NULL DEFAULT 0.00 COMMENT '金额',
  `custodian_id` bigint NOT NULL DEFAULT 0 COMMENT '使用人/保管人（描述维度）',
  `storage_location` varchar(255) NOT NULL DEFAULT '' COMMENT '库位或所在位置（描述字段）',
  `goods_code_snapshot` varchar(30) NOT NULL DEFAULT '' COMMENT '商品编码快照',
  `goods_name_snapshot` varchar(100) NOT NULL DEFAULT '' COMMENT '商品名称快照',
  `sku_spec_snapshot` varchar(200) NOT NULL DEFAULT '' COMMENT 'SKU规格快照',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_general_detail_order` (`order_id`),
  KEY `idx_general_detail_goods_sku` (`goods_id`,`sku_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='通用出入库明细';

CREATE TABLE IF NOT EXISTS `hspsi_inventory_feature_config` (
  `config_key` varchar(64) NOT NULL COMMENT '配置键',
  `enabled` tinyint NOT NULL DEFAULT 0 COMMENT '是否启用',
  `remark` varchar(255) NOT NULL DEFAULT '' COMMENT '说明',
  `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='库存功能开关';

INSERT INTO `hspsi_inventory_feature_config`
  (`config_key`, `enabled`, `remark`, `updated_by`)
VALUES
  ('initial_input.enabled', 0, '初期入库功能开关；默认关闭，由管理员手动启用', 0)
ON DUPLICATE KEY UPDATE `remark` = VALUES(`remark`);

SET @inventory_business_mode_catg_id = (
  SELECT `dict_catg_id` FROM `hspsi_sys_dictionary_category`
  WHERE `dict_catg_code` = 'inventory_business_mode' AND `deleted_at` IS NULL
  ORDER BY `dict_catg_id` LIMIT 1
);
INSERT INTO `hspsi_sys_dictionary`
  (`dict_catg_id`, `dict_name`, `dict_value`, `sort`, `remark`, `created_by`, `updated_by`)
SELECT @inventory_business_mode_catg_id, '通用入库', '14', 14, '初期入库或委托采购入库直接过账', 0, 0
WHERE @inventory_business_mode_catg_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `hspsi_sys_dictionary`
    WHERE `dict_catg_id` = @inventory_business_mode_catg_id
      AND `dict_value` = '14' AND `deleted_at` IS NULL
  );
INSERT INTO `hspsi_sys_dictionary`
  (`dict_catg_id`, `dict_name`, `dict_value`, `sort`, `remark`, `created_by`, `updated_by`)
SELECT @inventory_business_mode_catg_id, '直接出库', '15', 15, '无审批的通用直接出库', 0, 0
WHERE @inventory_business_mode_catg_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `hspsi_sys_dictionary`
    WHERE `dict_catg_id` = @inventory_business_mode_catg_id
      AND `dict_value` = '15' AND `deleted_at` IS NULL
  );

-- 固定资产仅作为商品形态选项，不改物资分类树，也不触发自动判定。
SET @product_form_catg_id = (
  SELECT `dict_catg_id` FROM `hspsi_sys_dictionary_category`
  WHERE `dict_catg_code` = 'product_form' AND `deleted_at` IS NULL
  ORDER BY `dict_catg_id` LIMIT 1
);
SET @fixed_asset_form_value = COALESCE(
  (
    SELECT `dict_value` FROM `hspsi_sys_dictionary`
    WHERE `dict_catg_id` = @product_form_catg_id
      AND `dict_name` = '固定资产' AND `deleted_at` IS NULL
    ORDER BY `dict_id` LIMIT 1
  ),
  (
    SELECT CAST(COALESCE(MAX(CAST(`dict_value` AS UNSIGNED)), 0) + 1 AS CHAR)
    FROM `hspsi_sys_dictionary`
    WHERE `dict_catg_id` = @product_form_catg_id AND `deleted_at` IS NULL
  )
);
INSERT INTO `hspsi_sys_dictionary`
  (`dict_catg_id`, `dict_name`, `dict_value`, `sort`, `remark`, `created_by`, `updated_by`)
SELECT @product_form_catg_id, '固定资产', @fixed_asset_form_value,
       CAST(@fixed_asset_form_value AS UNSIGNED),
       '仅作为特殊库存物资类型，由操作者判断；不启用资产卡、折旧或生命周期管理', 0, 0
WHERE @product_form_catg_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `hspsi_sys_dictionary`
    WHERE `dict_catg_id` = @product_form_catg_id
      AND `dict_name` = '固定资产' AND `deleted_at` IS NULL
  );

-- 新增通用出入库菜单。若库存管理主菜单不存在，本段不会插入孤立菜单。
SET @inventory_parent = (SELECT `id` FROM `hspsi_sys_menu` WHERE `code` = 'inventory' LIMIT 1);
INSERT INTO `hspsi_sys_menu`
  (`parent_id`, `path`, `name`, `code`, `icon`, `route`, `type`, `sort`, `status`, `remark`, `created_by`, `updated_by`)
SELECT @inventory_parent, CONCAT(IFNULL((SELECT `path` FROM `hspsi_sys_menu` WHERE `id` = @inventory_parent), '/inventory'), '/general-inputs'),
       '通用入库单', 'inventory:general-inputs', NULL, '/inventory/general-inputs', 2, 2, 1, '', 0, 0
WHERE @inventory_parent IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `hspsi_sys_menu` WHERE `code` = 'inventory:general-inputs');
INSERT INTO `hspsi_sys_menu`
  (`parent_id`, `path`, `name`, `code`, `icon`, `route`, `type`, `sort`, `status`, `remark`, `created_by`, `updated_by`)
SELECT @inventory_parent, CONCAT(IFNULL((SELECT `path` FROM `hspsi_sys_menu` WHERE `id` = @inventory_parent), '/inventory'), '/general-outputs'),
       '通用出库单', 'inventory:general-outputs', NULL, '/inventory/general-outputs', 2, 3, 1, '', 0, 0
WHERE @inventory_parent IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `hspsi_sys_menu` WHERE `code` = 'inventory:general-outputs');

UPDATE `hspsi_sys_menu`
SET `sort` = CASE `code`
  WHEN 'inventory:stocks' THEN 1
  WHEN 'inventory:general-inputs' THEN 2
  WHEN 'inventory:general-outputs' THEN 3
  WHEN 'inventory:transfers' THEN 4
  WHEN 'inventory:adjustments' THEN 5
  WHEN 'inventory:losses' THEN 6
  WHEN 'inventory:loss-outputs' THEN 7
  WHEN 'inventory:overflows' THEN 8
  WHEN 'inventory:checks' THEN 9
  WHEN 'inventory:quantity-alerts' THEN 10
  WHEN 'inventory:expiry-alerts' THEN 11
  ELSE `sort`
END
WHERE `parent_id` = @inventory_parent;

INSERT IGNORE INTO `hspsi_sys_role_menu` (`role_id`, `menu_id`)
SELECT role_row.`id`, menu_row.`id`
FROM `hspsi_sys_role` role_row
JOIN `hspsi_sys_menu` menu_row
  ON menu_row.`code` IN ('inventory:general-inputs', 'inventory:general-outputs')
  AND menu_row.`deleted_at` IS NULL
WHERE role_row.`code` = 'admin' AND role_row.`deleted_at` IS NULL;
