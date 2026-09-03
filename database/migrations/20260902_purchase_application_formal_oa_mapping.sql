-- 采购申请「正式表单（华溯管家-采购申请）」OA 映射更新补丁（2026-09-02）
--
-- 背景：OA 侧正式表单已发布新结构（承办部门/成本承担组织/目标仓库/收货人/申请原因/备注/附件/采购明细），
-- 控件 uniqueName 与旧结构不同。
--
-- 适用：环境数据库中注册了正式表单 form_key（账套1/2）时生效；
--       若该环境当前把 purchase_application 映射为 Test 表单（form_key 不同）则整段为无操作。
-- 幂等：按 (account_set_id, form_key) 定位模板行；重复执行安全。
-- 说明：明细 FinTable 及子控件未变，模板 form_config 无需重写（childSet 推导不受影响），
--       仅更新 form_id 与 field_mapping；如需完整 form_config 可从
--       docs/integrations/xinfutong-oa/return-result/2026-09-02/ 归档 JSON 取回。
-- 运行：mysql -h <host> -u <user> -p <db> < 本文件

-- ============ 账套1（华溯集团）正式采购申请表单 ============
SET @tpl_acct1 := (
  SELECT id FROM hspsi_oa_form_template
  WHERE account_set_id = 1 AND form_key = 'AAC15400_NFORM_380054577920868353' AND deleted_at IS NULL
  LIMIT 1
);
UPDATE hspsi_oa_form_template
SET form_id = '384157596683534338', synced_at = NOW(), updated_at = NOW()
WHERE id = @tpl_acct1;

DELETE FROM hspsi_oa_form_field_mapping
WHERE template_id = @tpl_acct1 AND business_type = 'purchase_application' AND deleted_at IS NULL;

INSERT INTO hspsi_oa_form_field_mapping
  (template_id, business_type, unique_name, field_label, component_type, local_field, required, sort_order, account_set_id, created_by, updated_by)
SELECT template_id, business_type, unique_name, field_label, component_type, local_field,
       required, sort_order, account_set_id, created_by, updated_by
FROM (
  SELECT @tpl_acct1 AS template_id, 'purchase_application' AS business_type, 'np0kahtk2860' AS unique_name, '承办部门' AS field_label, 'FinInput' AS component_type, 'deptName' AS local_field, 0 AS required, 1 AS sort_order, 1 AS account_set_id, 0 AS created_by, 0 AS updated_by
  UNION ALL SELECT @tpl_acct1, 'purchase_application', 'dhi6d3c7oecn', '成本承担组织', 'FinInput', 'costOrgName', 0, 2, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', 'iluym6g473ox', '目标仓库', 'FinInput', 'warehouse', 0, 3, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', 'jg2zwug75y3c', '收货人', 'FinInput', 'receiver', 0, 4, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', 'zq6glso6x8co', '申请原因', 'FinTextArea', 'reason', 0, 5, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', 'tp1teg5kd21y', '备注', 'FinTextArea', 'remark', 0, 6, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', 'pc744eoan0wp', '附件', 'FinUpload', 'attachments', 0, 7, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', 'vdd3e94g4ho9', '采购明细', 'FinTable', 'details', 0, 8, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', 'qotb3suzfb82', '商品名称', 'FinInput', 'goodsName', 0, 9, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', '4a0wvks0vr2o', '规格型号', 'FinInput', 'skuName', 0, 10, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', 'fzc9rr3c5a6e', '申请数量', 'FinInputNumber', 'quantity', 0, 11, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', '2kq65w37r24o', '单位', 'FinInput', 'unit', 0, 12, 1, 0, 0
  UNION ALL SELECT @tpl_acct1, 'purchase_application', '8avk96xhktxy', '明细备注', 'FinInput', 'detailRemark', 0, 13, 1, 0, 0
) mapping_rows
WHERE @tpl_acct1 IS NOT NULL;

-- ============ 账套2（华溯生物科技）正式采购申请表单 ============
SET @tpl_acct2 := (
  SELECT id FROM hspsi_oa_form_template
  WHERE account_set_id = 2 AND form_key = 'AAC22502_NFORM_380419508420083713' AND deleted_at IS NULL
  LIMIT 1
);
UPDATE hspsi_oa_form_template
SET form_id = '384157835053301760', synced_at = NOW(), updated_at = NOW()
WHERE id = @tpl_acct2;

DELETE FROM hspsi_oa_form_field_mapping
WHERE template_id = @tpl_acct2 AND business_type = 'purchase_application' AND deleted_at IS NULL;

INSERT INTO hspsi_oa_form_field_mapping
  (template_id, business_type, unique_name, field_label, component_type, local_field, required, sort_order, account_set_id, created_by, updated_by)
SELECT template_id, business_type, unique_name, field_label, component_type, local_field,
       required, sort_order, account_set_id, created_by, updated_by
FROM (
  SELECT @tpl_acct2 AS template_id, 'purchase_application' AS business_type, 'ct24crko8qag' AS unique_name, '承办部门' AS field_label, 'FinInput' AS component_type, 'deptName' AS local_field, 0 AS required, 1 AS sort_order, 2 AS account_set_id, 0 AS created_by, 0 AS updated_by
  UNION ALL SELECT @tpl_acct2, 'purchase_application', 'ygqq3elmakfa', '成本承担组织', 'FinInput', 'costOrgName', 0, 2, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', 'qtbymr7l43t1', '目标仓库', 'FinInput', 'warehouse', 0, 3, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', 'tkd9yxhvm9ld', '收货人', 'FinInput', 'receiver', 0, 4, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', '0nln3flxoefu', '申请原因', 'FinTextArea', 'reason', 0, 5, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', 'sucqhgsr245d', '备注', 'FinTextArea', 'remark', 0, 6, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', '4lwxwfq390zx', '附件', 'FinUpload', 'attachments', 0, 7, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', 'j69e9ckwn54a', '采购明细', 'FinTable', 'details', 0, 8, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', 'w84xmeswcs9j', '商品名称', 'FinInput', 'goodsName', 0, 9, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', 'drfa2931wn6r', '规格型号', 'FinInput', 'skuName', 0, 10, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', 'jm439ry9u1ma', '申请数量', 'FinInputNumber', 'quantity', 0, 11, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', 'xafotn69h4ii', '单位', 'FinInput', 'unit', 0, 12, 2, 0, 0
  UNION ALL SELECT @tpl_acct2, 'purchase_application', '878gn8svpvji', '明细备注', 'FinInput', 'detailRemark', 0, 13, 2, 0, 0
) mapping_rows
WHERE @tpl_acct2 IS NOT NULL;
