-- 采购退款任务与退款流水（无损增量迁移）
-- 执行前提示：本文件只新增表、字典和菜单，不改写现有采购付款、采购退货和库存数据。

START TRANSACTION;

CREATE TABLE IF NOT EXISTS hspsi_purchase_refund (
  refund_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '采购退款任务ID',
  refund_no VARCHAR(30) NOT NULL COMMENT '采购退款单号',
  po_exit_id BIGINT NOT NULL COMMENT '来源采购退货单ID',
  po_id BIGINT NOT NULL DEFAULT 0 COMMENT '采购订单ID',
  po_input_id BIGINT NOT NULL DEFAULT 0 COMMENT '来源采购入库单ID，未入库退回为0',
  org_id BIGINT NOT NULL DEFAULT 0 COMMENT '组织ID',
  dept_id BIGINT NOT NULL DEFAULT 0 COMMENT '部门ID',
  vendor_id BIGINT NOT NULL DEFAULT 0 COMMENT '供应商ID',
  source_type TINYINT NOT NULL COMMENT '退款来源，引用purchase_refund_source',
  return_type TINYINT NOT NULL COMMENT '采购退货类型，引用purchase_return_type',
  return_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '该退货单对应的退货金额快照',
  refundable_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '该任务应退款金额',
  refunded_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '该任务累计已退款金额',
  refund_status TINYINT NOT NULL COMMENT '退款状态，引用purchase_refund_status',
  remark VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (refund_id),
  UNIQUE KEY uk_purchase_refund_no (refund_no),
  UNIQUE KEY uk_purchase_refund_return (po_exit_id),
  KEY idx_purchase_refund_order_status (po_id, refund_status, deleted_at),
  KEY idx_purchase_refund_vendor_status (vendor_id, refund_status, deleted_at),
  KEY idx_purchase_refund_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='采购退款任务表';

CREATE TABLE IF NOT EXISTS hspsi_purchase_refund_flow (
  flow_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '采购退款流水ID',
  flow_no VARCHAR(30) NOT NULL COMMENT '采购退款流水号',
  refund_id BIGINT NOT NULL COMMENT '采购退款任务ID',
  refund_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '本次实际退款金额',
  refund_channel TINYINT NOT NULL COMMENT '退款渠道，引用payment_channel',
  refund_date DATETIME NOT NULL COMMENT '实际退款日期',
  supplier_serial_no VARCHAR(80) NOT NULL DEFAULT '' COMMENT '供应商退款流水号',
  receive_account VARCHAR(120) NOT NULL DEFAULT '' COMMENT '收款账户',
  request_key VARCHAR(80) NOT NULL COMMENT '幂等请求号',
  remark VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
  created_by BIGINT NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (flow_id),
  UNIQUE KEY uk_purchase_refund_flow_no (flow_no),
  UNIQUE KEY uk_purchase_refund_request (request_key),
  KEY idx_purchase_refund_flow_task (refund_id, deleted_at),
  KEY idx_purchase_refund_flow_date (refund_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='采购退款流水表';

INSERT INTO hspsi_sys_dictionary_category
  (dict_catg_name, dict_catg_code, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
VALUES
  ('采购退款状态', 'purchase_refund_status', 76, '采购退款任务状态', 1, 1, NOW(), NOW(), NULL)
ON DUPLICATE KEY UPDATE
  dict_catg_name=VALUES(dict_catg_name), sort=VALUES(sort), remark=VALUES(remark), updated_by=1, updated_at=NOW(), deleted_at=NULL;

INSERT INTO hspsi_sys_dictionary_category
  (dict_catg_name, dict_catg_code, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
VALUES
  ('采购退款来源', 'purchase_refund_source', 77, '采购退款任务来源类型', 1, 1, NOW(), NOW(), NULL)
ON DUPLICATE KEY UPDATE
  dict_catg_name=VALUES(dict_catg_name), sort=VALUES(sort), remark=VALUES(remark), updated_by=1, updated_at=NOW(), deleted_at=NULL;

SET @purchase_refund_status_catg_id=(
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code='purchase_refund_status' AND deleted_at IS NULL
  ORDER BY dict_catg_id LIMIT 1
);

UPDATE hspsi_sys_dictionary d
JOIN (
  SELECT '待退款' dict_name, '0' dict_value, 1 sort
  UNION ALL SELECT '部分退款', '1', 2
  UNION ALL SELECT '已退款', '2', 3
  UNION ALL SELECT '已关闭', '3', 4
) x ON x.dict_value=d.dict_value
SET d.dict_name=x.dict_name, d.sort=x.sort, d.remark='采购退款状态',
    d.updated_by=1, d.updated_at=NOW()
WHERE d.dict_catg_id=@purchase_refund_status_catg_id
  AND d.deleted_at IS NULL;

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @purchase_refund_status_catg_id, x.dict_name, x.dict_value, x.sort, '采购退款状态', 1, 1, NOW(), NOW(), NULL
FROM (
  SELECT '待退款' dict_name, '0' dict_value, 1 sort
  UNION ALL SELECT '部分退款', '1', 2
  UNION ALL SELECT '已退款', '2', 3
  UNION ALL SELECT '已关闭', '3', 4
) x
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary d
  WHERE d.dict_catg_id=@purchase_refund_status_catg_id
    AND d.dict_value=x.dict_value
    AND d.deleted_at IS NULL
);

SET @purchase_refund_source_catg_id=(
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code='purchase_refund_source' AND deleted_at IS NULL
  ORDER BY dict_catg_id LIMIT 1
);

UPDATE hspsi_sys_dictionary d
JOIN (
  SELECT '订单未到货退回' dict_name, '1' dict_value, 1 sort
  UNION ALL SELECT '已入库实物退货', '2', 2
) x ON x.dict_value=d.dict_value
SET d.dict_name=x.dict_name, d.sort=x.sort, d.remark='采购退款来源',
    d.updated_by=1, d.updated_at=NOW()
WHERE d.dict_catg_id=@purchase_refund_source_catg_id
  AND d.deleted_at IS NULL;

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @purchase_refund_source_catg_id, x.dict_name, x.dict_value, x.sort, '采购退款来源', 1, 1, NOW(), NOW(), NULL
FROM (
  SELECT '订单未到货退回' dict_name, '1' dict_value, 1 sort
  UNION ALL SELECT '已入库实物退货', '2', 2
) x
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary d
  WHERE d.dict_catg_id=@purchase_refund_source_catg_id
    AND d.dict_value=x.dict_value
    AND d.deleted_at IS NULL
);

SET @purchase_menu_id=(
  SELECT id FROM hspsi_sys_menu
  WHERE code='purchase' AND deleted_at IS NULL
  ORDER BY id LIMIT 1
);

INSERT INTO hspsi_sys_menu
  (parent_id, path, name, code, icon, route, component, redirect, type, status, sort, remark, created_by, updated_by, created_at, updated_at, deleted_at)
SELECT @purchase_menu_id, CONCAT('0,', @purchase_menu_id), '采购退款', 'purchase:refunds', NULL,
       '/purchase/refunds', NULL, NULL, 2, 1, 6, '采购退款任务与流水', 1, 1, NOW(), NOW(), NULL
WHERE @purchase_menu_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_menu
    WHERE code='purchase:refunds' AND deleted_at IS NULL
  );

SET @purchase_refund_menu_id=(
  SELECT id FROM hspsi_sys_menu
  WHERE code='purchase:refunds' AND deleted_at IS NULL
  ORDER BY id LIMIT 1
);

UPDATE hspsi_sys_menu
SET name='采购退款', route='/purchase/refunds', parent_id=@purchase_menu_id,
    path=CONCAT('0,', @purchase_menu_id), type=2, status=1, sort=6,
    remark='采购退款任务与流水', updated_by=1, updated_at=NOW()
WHERE id=@purchase_refund_menu_id;

-- 继承已有“采购付款”菜单的角色权限，确保现有财务用户可见。
INSERT IGNORE INTO hspsi_sys_role_menu(role_id, menu_id)
SELECT rm.role_id, @purchase_refund_menu_id
FROM hspsi_sys_role_menu rm
JOIN hspsi_sys_menu payment_menu
  ON payment_menu.id=rm.menu_id
 AND payment_menu.code='purchase:payments'
 AND payment_menu.deleted_at IS NULL
WHERE @purchase_refund_menu_id IS NOT NULL;

COMMIT;
