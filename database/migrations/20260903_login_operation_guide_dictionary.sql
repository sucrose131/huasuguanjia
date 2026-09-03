-- 登录页操作指引。字典名称展示在登录按钮下方，字典值存放 OSS 对象键。
-- 不新增表或字段。更换手册时只改本字典项的值，不必改代码。
-- dict_value 最长 100 个字符。

INSERT INTO hspsi_sys_dictionary_category
  (dict_catg_name, dict_catg_code, sort, remark, created_by, updated_by)
SELECT '登录页操作指引', 'login_operation_guide', 0,
       '登录页公开预览文档；字典值存放 OSS 对象键，仅支持 PDF', 0, 0
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'login_operation_guide' AND deleted_at IS NULL
);

SET @login_guide_id = (
  SELECT dict_catg_id FROM hspsi_sys_dictionary_category
  WHERE dict_catg_code = 'login_operation_guide' AND deleted_at IS NULL
  ORDER BY dict_catg_id LIMIT 1
);

UPDATE hspsi_sys_dictionary_category
SET remark = '登录页公开预览文档；字典值存放 OSS 对象键，仅支持 PDF',
    updated_at = CURRENT_TIMESTAMP
WHERE dict_catg_id = @login_guide_id;

UPDATE hspsi_sys_dictionary
SET dict_name = '医护操作指引',
    dict_value = 'documents/华溯管家医院业务操作培训手册-20260903.pdf',
    remark = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE dict_catg_id = @login_guide_id
  AND deleted_at IS NULL
  AND dict_value = 'medical';

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by)
SELECT @login_guide_id, '医护操作指引',
       'documents/华溯管家医院业务操作培训手册-20260903.pdf', 1, NULL, 0, 0
WHERE @login_guide_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM hspsi_sys_dictionary
    WHERE dict_catg_id = @login_guide_id
      AND dict_value = 'documents/华溯管家医院业务操作培训手册-20260903.pdf'
      AND deleted_at IS NULL
  );
