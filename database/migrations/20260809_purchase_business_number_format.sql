-- 采购管理业务单号统一为：原前缀 + YYYYMMDD + 4位日流水。
--
-- 说明：
-- 1. 只调整业务单号，不修改任何数据库主键或上下游外键；
-- 2. 原单号开头的英文字母前缀原样保留；
-- 3. 同一采购单据类型每天从 0001 开始，按创建时间和主键稳定排序；
-- 4. 依赖 MySQL 8.0 的 REGEXP_SUBSTR 和窗口函数。

START TRANSACTION;

CREATE TEMPORARY TABLE tmp_purchase_application_no AS
SELECT
  pur_id AS document_id,
  pur_no AS old_no,
  CONCAT(
    COALESCE(NULLIF(REGEXP_SUBSTR(pur_no, '^[A-Za-z]+'), ''), 'PA'),
    DATE_FORMAT(COALESCE(created_at, updated_at, CURRENT_TIMESTAMP), '%Y%m%d'),
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY DATE(COALESCE(created_at, updated_at, CURRENT_TIMESTAMP))
        ORDER BY COALESCE(created_at, updated_at, CURRENT_TIMESTAMP), pur_id
      ),
      4,
      '0'
    )
  ) AS new_no
FROM hspsi_purchase_approve;

CREATE TEMPORARY TABLE tmp_purchase_order_no AS
SELECT
  po_id AS document_id,
  po_no AS old_no,
  CONCAT(
    COALESCE(NULLIF(REGEXP_SUBSTR(po_no, '^[A-Za-z]+'), ''), 'PO'),
    DATE_FORMAT(COALESCE(created_at, updated_at, CURRENT_TIMESTAMP), '%Y%m%d'),
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY DATE(COALESCE(created_at, updated_at, CURRENT_TIMESTAMP))
        ORDER BY COALESCE(created_at, updated_at, CURRENT_TIMESTAMP), po_id
      ),
      4,
      '0'
    )
  ) AS new_no
FROM hspsi_purchase_order;

CREATE TEMPORARY TABLE tmp_purchase_receipt_no AS
SELECT
  po_input_id AS document_id,
  po_input_no AS old_no,
  CONCAT(
    COALESCE(NULLIF(REGEXP_SUBSTR(po_input_no, '^[A-Za-z]+'), ''), 'GA'),
    DATE_FORMAT(COALESCE(created_at, updated_at, CURRENT_TIMESTAMP), '%Y%m%d'),
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY DATE(COALESCE(created_at, updated_at, CURRENT_TIMESTAMP))
        ORDER BY COALESCE(created_at, updated_at, CURRENT_TIMESTAMP), po_input_id
      ),
      4,
      '0'
    )
  ) AS new_no
FROM hspsi_purchase_order_input;

CREATE TEMPORARY TABLE tmp_purchase_return_no AS
SELECT
  po_exit_id AS document_id,
  po_exit_no AS old_no,
  CONCAT(
    COALESCE(NULLIF(REGEXP_SUBSTR(po_exit_no, '^[A-Za-z]+'), ''), 'PRT'),
    DATE_FORMAT(COALESCE(created_at, updated_at, CURRENT_TIMESTAMP), '%Y%m%d'),
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY DATE(COALESCE(created_at, updated_at, CURRENT_TIMESTAMP))
        ORDER BY COALESCE(created_at, updated_at, CURRENT_TIMESTAMP), po_exit_id
      ),
      4,
      '0'
    )
  ) AS new_no
FROM hspsi_purchase_order_input_exit;

CREATE TEMPORARY TABLE tmp_purchase_payment_no AS
SELECT
  pay_id AS document_id,
  pay_no AS old_no,
  CONCAT(
    COALESCE(NULLIF(REGEXP_SUBSTR(pay_no, '^[A-Za-z]+'), ''), 'PPY'),
    DATE_FORMAT(COALESCE(created_at, updated_at, CURRENT_TIMESTAMP), '%Y%m%d'),
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY DATE(COALESCE(created_at, updated_at, CURRENT_TIMESTAMP))
        ORDER BY COALESCE(created_at, updated_at, CURRENT_TIMESTAMP), pay_id
      ),
      4,
      '0'
    )
  ) AS new_no
FROM hspsi_purchase_order_payment;

CREATE TEMPORARY TABLE tmp_purchase_refund_no AS
SELECT
  refund_id AS document_id,
  refund_no AS old_no,
  CONCAT(
    COALESCE(NULLIF(REGEXP_SUBSTR(refund_no, '^[A-Za-z]+'), ''), 'PRF'),
    DATE_FORMAT(created_at, '%Y%m%d'),
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY DATE(created_at)
        ORDER BY created_at, refund_id
      ),
      4,
      '0'
    )
  ) AS new_no
FROM hspsi_purchase_refund;

CREATE TEMPORARY TABLE tmp_purchase_refund_flow_no AS
SELECT
  flow_id AS document_id,
  flow_no AS old_no,
  CONCAT(
    COALESCE(NULLIF(REGEXP_SUBSTR(flow_no, '^[A-Za-z]+'), ''), 'PRFL'),
    DATE_FORMAT(created_at, '%Y%m%d'),
    LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY DATE(created_at)
        ORDER BY created_at, flow_id
      ),
      4,
      '0'
    )
  ) AS new_no
FROM hspsi_purchase_refund_flow;

-- 先使用临时唯一值释放原唯一索引，再写入正式编号。
UPDATE hspsi_purchase_approve SET pur_no = CONCAT('TMP-PA-', pur_id);
UPDATE hspsi_purchase_order SET po_no = CONCAT('TMP-PO-', po_id);
UPDATE hspsi_purchase_order_input SET po_input_no = CONCAT('TMP-GA-', po_input_id);
UPDATE hspsi_purchase_order_input_exit SET po_exit_no = CONCAT('TMP-PRT-', po_exit_id);
UPDATE hspsi_purchase_order_payment SET pay_no = CONCAT('TMP-PPY-', pay_id);
UPDATE hspsi_purchase_refund SET refund_no = CONCAT('TMP-PRF-', refund_id);
UPDATE hspsi_purchase_refund_flow SET flow_no = CONCAT('TMP-PRFL-', flow_id);

UPDATE hspsi_purchase_approve target
JOIN tmp_purchase_application_no mapping ON mapping.document_id = target.pur_id
SET target.pur_no = mapping.new_no;

UPDATE hspsi_purchase_order target
JOIN tmp_purchase_order_no mapping ON mapping.document_id = target.po_id
SET target.po_no = mapping.new_no;

UPDATE hspsi_purchase_order_input target
JOIN tmp_purchase_receipt_no mapping ON mapping.document_id = target.po_input_id
SET target.po_input_no = mapping.new_no;

UPDATE hspsi_purchase_order_input_exit target
JOIN tmp_purchase_return_no mapping ON mapping.document_id = target.po_exit_id
SET target.po_exit_no = mapping.new_no;

UPDATE hspsi_purchase_order_payment target
JOIN tmp_purchase_payment_no mapping ON mapping.document_id = target.pay_id
SET target.pay_no = mapping.new_no;

UPDATE hspsi_purchase_refund target
JOIN tmp_purchase_refund_no mapping ON mapping.document_id = target.refund_id
SET target.refund_no = mapping.new_no;

UPDATE hspsi_purchase_refund_flow target
JOIN tmp_purchase_refund_flow_no mapping ON mapping.document_id = target.flow_id
SET target.flow_no = mapping.new_no;

COMMIT;

DROP TEMPORARY TABLE IF EXISTS tmp_purchase_application_no;
DROP TEMPORARY TABLE IF EXISTS tmp_purchase_order_no;
DROP TEMPORARY TABLE IF EXISTS tmp_purchase_receipt_no;
DROP TEMPORARY TABLE IF EXISTS tmp_purchase_return_no;
DROP TEMPORARY TABLE IF EXISTS tmp_purchase_payment_no;
DROP TEMPORARY TABLE IF EXISTS tmp_purchase_refund_no;
DROP TEMPORARY TABLE IF EXISTS tmp_purchase_refund_flow_no;
