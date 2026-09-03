-- 采购申请支持按员工在 OA 中的多组织关系选择发起组织。
-- 本补丁只恢复数据字典规则，不改变任何业务表结构。

UPDATE hspsi_sys_dictionary_category
SET remark = 'OA同步自动授予员工主组织和兼任组织；本地人工增加的数据权限继续保留',
    updated_by = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE dict_catg_code = 'oa_org_authorization_rule'
  AND deleted_at IS NULL;

UPDATE hspsi_sys_dictionary dictionary_item
JOIN hspsi_sys_dictionary_category category
  ON category.dict_catg_id = dictionary_item.dict_catg_id
SET dictionary_item.remark = 'OA兼任组织或兼任部门所属公司自动成为用户数据权限组织',
    dictionary_item.updated_by = 0,
    dictionary_item.updated_at = CURRENT_TIMESTAMP,
    dictionary_item.deleted_at = NULL
WHERE category.dict_catg_code = 'oa_org_authorization_rule'
  AND category.deleted_at IS NULL
  AND dictionary_item.dict_value = 'SECONDARY_ORG';
