-- 采购退款链路迁移回滚脚本。
-- 警告：执行后会删除采购退款任务及流水数据，只允许在迁移验收失败且尚未正式使用时执行。

START TRANSACTION;

SET @purchase_refund_menu_id=(
  SELECT id FROM hspsi_sys_menu
  WHERE code='purchase:refunds' AND deleted_at IS NULL
  ORDER BY id LIMIT 1
);

DELETE FROM hspsi_sys_role_menu WHERE menu_id=@purchase_refund_menu_id;
DELETE FROM hspsi_sys_menu WHERE id=@purchase_refund_menu_id;

SET @purchase_refund_status_catg_id=(
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code='purchase_refund_status'
  ORDER BY dict_catg_id LIMIT 1
);

DELETE FROM hspsi_sys_dictionary WHERE dict_catg_id=@purchase_refund_status_catg_id;
DELETE FROM hspsi_sys_dictionary_category WHERE dict_catg_id=@purchase_refund_status_catg_id;

SET @purchase_refund_source_catg_id=(
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code='purchase_refund_source'
  ORDER BY dict_catg_id LIMIT 1
);

DELETE FROM hspsi_sys_dictionary WHERE dict_catg_id=@purchase_refund_source_catg_id;
DELETE FROM hspsi_sys_dictionary_category WHERE dict_catg_id=@purchase_refund_source_catg_id;

DROP TABLE IF EXISTS hspsi_purchase_refund_flow;
DROP TABLE IF EXISTS hspsi_purchase_refund;

COMMIT;
