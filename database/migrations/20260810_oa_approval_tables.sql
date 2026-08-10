-- 薪福通OA审批对接：表单模板、字段映射、审批实例、回调日志。
-- mapping 表只存字段映射关系，取值转换逻辑在代码中按 business_type 策略模式实现。

-- 1. OA表单模板配置
CREATE TABLE IF NOT EXISTS `hspsi_oa_form_template` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `form_id` varchar(50) NOT NULL DEFAULT '' COMMENT 'OA表单ID',
  `form_key` varchar(100) NOT NULL DEFAULT '' COMMENT 'OA表单Key',
  `form_name` varchar(100) NOT NULL DEFAULT '' COMMENT '表单名称/业务用途描述',
  `form_config` mediumtext NOT NULL COMMENT 'OA返回的完整formConfig JSON字符串',
  `account_set_id` bigint unsigned NOT NULL DEFAULT 0 COMMENT '账套ID',
  `synced_at` datetime DEFAULT NULL COMMENT '最近一次从OA同步配置的时间',
  `status` tinyint NOT NULL DEFAULT 1 COMMENT '状态：1启用 0停用',
  `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人',
  `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `idx_oa_ft_account_set_id` (`account_set_id`),
  KEY `idx_oa_ft_form_key` (`form_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='OA表单模板配置';

-- 2. 表单字段映射
CREATE TABLE IF NOT EXISTS `hspsi_oa_form_field_mapping` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `template_id` bigint NOT NULL DEFAULT 0 COMMENT '关联 hspsi_oa_form_template.id',
  `business_type` varchar(50) NOT NULL DEFAULT '' COMMENT '业务类型（如 purchase_order）',
  `unique_name` varchar(50) NOT NULL DEFAULT '' COMMENT 'OA控件uniqueName',
  `field_label` varchar(100) NOT NULL DEFAULT '' COMMENT 'OA控件label',
  `component_type` varchar(50) NOT NULL DEFAULT '' COMMENT 'OA控件类型（如 FinInput）',
  `local_field` varchar(100) NOT NULL DEFAULT '' COMMENT '本地业务字段名',
  `required` tinyint NOT NULL DEFAULT 0 COMMENT '是否必填：1是 0否',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '排序序号',
  `account_set_id` bigint unsigned NOT NULL DEFAULT 0 COMMENT '账套ID',
  `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人',
  `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `idx_oa_ffm_template_id` (`template_id`),
  KEY `idx_oa_ffm_business_type` (`business_type`),
  KEY `idx_oa_ffm_account_set_id` (`account_set_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='OA表单字段映射';

-- 3. 审批实例
CREATE TABLE IF NOT EXISTS `hspsi_oa_approval_instance` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `business_type` varchar(50) NOT NULL DEFAULT '' COMMENT '业务类型',
  `business_id` bigint NOT NULL DEFAULT 0 COMMENT '业务单据ID',
  `form_key` varchar(100) NOT NULL DEFAULT '' COMMENT '提交时使用的OA表单Key',
  `bus_key` varchar(100) NOT NULL DEFAULT '' COMMENT 'OA返回的业务编号',
  `proc_inst_id` varchar(50) NOT NULL DEFAULT '' COMMENT 'OA审批实例ID',
  `proc_key` varchar(100) NOT NULL DEFAULT '' COMMENT 'OA流程Key',
  `proc_status` varchar(20) NOT NULL DEFAULT '' COMMENT '流程状态：RUNNING/PASSED/REJECTED/CANCELED/DELETED',
  `submitted_by` bigint NOT NULL DEFAULT 0 COMMENT '提交人（hspsi_basic_staff.id）',
  `submitted_at` datetime DEFAULT NULL COMMENT '提交时间',
  `callback_count` int NOT NULL DEFAULT 0 COMMENT '回调接收次数',
  `last_callback_at` datetime DEFAULT NULL COMMENT '最近一次回调时间',
  `account_set_id` bigint unsigned NOT NULL DEFAULT 0 COMMENT '账套ID',
  `created_by` bigint NOT NULL DEFAULT 0 COMMENT '创建人',
  `updated_by` bigint NOT NULL DEFAULT 0 COMMENT '更新人',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted_at` datetime DEFAULT NULL COMMENT '删除时间',
  PRIMARY KEY (`id`),
  KEY `idx_oa_ai_business` (`business_type`, `business_id`),
  KEY `idx_oa_ai_proc_inst_id` (`proc_inst_id`),
  KEY `idx_oa_ai_account_set_id` (`account_set_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='OA审批实例';

-- 4. 回调日志
CREATE TABLE IF NOT EXISTS `hspsi_oa_approval_callback_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `instance_id` bigint NOT NULL DEFAULT 0 COMMENT '关联 hspsi_oa_approval_instance.id',
  `event_code` varchar(30) NOT NULL DEFAULT '' COMMENT '事件编号（XFTOAFPS）',
  `prj_cod` varchar(50) NOT NULL DEFAULT '' COMMENT '企业号',
  `proc_status` varchar(20) NOT NULL DEFAULT '' COMMENT '回调流程状态',
  `bus_key` varchar(100) NOT NULL DEFAULT '' COMMENT '业务编号',
  `proc_inst_id` varchar(50) NOT NULL DEFAULT '' COMMENT '审批编号',
  `proc_key` varchar(100) NOT NULL DEFAULT '' COMMENT '流程Key',
  `raw_payload` mediumtext NOT NULL COMMENT '原始回调JSON',
  `processed` tinyint NOT NULL DEFAULT 0 COMMENT '是否已处理：1是 0否',
  `process_result` varchar(500) NOT NULL DEFAULT '' COMMENT '处理结果或错误信息',
  `account_set_id` bigint unsigned NOT NULL DEFAULT 0 COMMENT '账套ID',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '接收时间',
  PRIMARY KEY (`id`),
  KEY `idx_oa_acl_instance_id` (`instance_id`),
  KEY `idx_oa_acl_dedup` (`proc_inst_id`, `proc_status`),
  KEY `idx_oa_acl_account_set_id` (`account_set_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='OA审批回调日志';