START TRANSACTION;

SET @purchase_payment_progress_catg_id=(
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code='purchase_payment_progress_status'
  ORDER BY dict_catg_id LIMIT 1
);

DELETE FROM hspsi_sys_dictionary
WHERE dict_catg_id=@purchase_payment_progress_catg_id;

DELETE FROM hspsi_sys_dictionary_category
WHERE dict_catg_id=@purchase_payment_progress_catg_id;

COMMIT;
