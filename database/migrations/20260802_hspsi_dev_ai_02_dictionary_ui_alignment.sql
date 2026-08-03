-- 仅适用于 hspsi-dev-ai-02。
-- 补齐前端业务状态所需的数据字典；不修改任何业务表结构。

SET @operator := 1;

INSERT INTO hspsi_sys_dictionary_category
  (dict_catg_name, dict_catg_code, sort, remark, created_by, updated_by, created_at, updated_at)
SELECT source.name, source.code, source.sort, source.remark, @operator, @operator, NOW(), NOW()
FROM (
  SELECT '采购入库状态' name, 'purchase_input_status' code, 610 sort, '采购入库单处理状态' remark
  UNION ALL SELECT '采购退货状态', 'purchase_return_status', 611, '采购退货记录处理状态'
  UNION ALL SELECT '销售收款进度状态', 'sales_payment_progress_status', 612, '销售订单收款进度'
  UNION ALL SELECT '折价销售处置状态', 'sales_discount_disposal_status', 613, '折价销售单处置结果'
  UNION ALL SELECT '报盈处理状态', 'inventory_overflow_status', 614, '报盈入库处理状态'
  UNION ALL SELECT '库存健康状态', 'inventory_stock_health_status', 615, '安全库存计算结果'
  UNION ALL SELECT '销售业务来源类型', 'sales_business_source_type', 616, '折价销售等订单的业务来源'
  UNION ALL SELECT '库存损坏状态', 'inventory_damage_status', 617, '盘点批次损坏数量计算结果'
  UNION ALL SELECT '库存盘点状态', 'inventory_check_status', 618, '库存盘点录入阶段状态'
) source
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary_category target
  WHERE target.dict_catg_code = source.code AND target.deleted_at IS NULL
);

INSERT INTO hspsi_sys_dictionary
  (dict_catg_id, dict_name, dict_value, sort, remark, created_by, updated_by, created_at, updated_at)
SELECT category.dict_catg_id, source.name, source.value, source.sort, source.remark,
       @operator, @operator, NOW(), NOW()
FROM (
  SELECT 'purchase_input_status' code, '待入库' name, '0' value, 1 sort, '尚未执行入库' remark
  UNION ALL SELECT 'customer_source', '未指定', '0', 0, '历史或导入客户未指定来源'
  UNION ALL SELECT 'inventory_loss_disposal', '待确定', '-1', 0, '报损出库去向尚未编辑确定'
  UNION ALL SELECT 'purchase_input_status', '已入库', '1', 2, '已完成库存过账'
  UNION ALL SELECT 'purchase_input_status', '已撤销', '2', 3, '待入库单已撤销'
  UNION ALL SELECT 'purchase_return_status', '待处理', '0', 1, '退货记录待处理'
  UNION ALL SELECT 'purchase_return_status', '已完成', '1', 2, '退货处理已完成'
  UNION ALL SELECT 'purchase_return_status', '已驳回', '2', 3, '退货处理已驳回'
  UNION ALL SELECT 'sales_payment_progress_status', '未收款', '0', 1, '累计净收款为零'
  UNION ALL SELECT 'sales_payment_progress_status', '部分收款', '1', 2, '累计净收款小于订单金额'
  UNION ALL SELECT 'sales_payment_progress_status', '已收款', '2', 3, '累计净收款达到订单金额'
  UNION ALL SELECT 'sales_payment_progress_status', '已退款', '3', 4, '订单收款已全部退款'
  UNION ALL SELECT 'sales_discount_disposal_status', '待确认销售', '0', 1, '等待确认折价销售结果'
  UNION ALL SELECT 'sales_discount_disposal_status', '已售出出库', '1', 2, '已确认售出并完成出库'
  UNION ALL SELECT 'sales_discount_disposal_status', '未售出关闭', '2', 3, '未售出并关闭处置'
  UNION ALL SELECT 'inventory_overflow_status', '待审批', '0', 1, '报盈记录待审批'
  UNION ALL SELECT 'inventory_overflow_status', '已入库', '1', 2, '审批通过并完成入库'
  UNION ALL SELECT 'inventory_overflow_status', '已驳回', '2', 3, '审批未通过'
  UNION ALL SELECT 'inventory_stock_health_status', '库存正常', '0', 1, '实际库存达到安全库存'
  UNION ALL SELECT 'inventory_stock_health_status', '库存不足', '1', 2, '实际库存低于安全库存'
  UNION ALL SELECT 'sales_business_source_type', '手工新增', '', 1, '无上游业务来源'
  UNION ALL SELECT 'sales_business_source_type', '销售退货', 'sales_return', 2, '来源于销售退货处置'
  UNION ALL SELECT 'sales_business_source_type', '库存报损', 'inventory_loss', 3, '来源于库存报损折价处置'
  UNION ALL SELECT 'inventory_damage_status', '无损坏', '0', 1, '损坏数量为零'
  UNION ALL SELECT 'inventory_damage_status', '存在损坏', '1', 2, '损坏数量大于零'
  UNION ALL SELECT 'inventory_check_status', '盘点中', '0', 1, '盘点明细尚可继续录入'
  UNION ALL SELECT 'inventory_check_status', '盘点完成', '1', 2, '盘点明细已完成并提交审批'
) source
JOIN hspsi_sys_dictionary_category category
  ON category.dict_catg_code = source.code AND category.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM hspsi_sys_dictionary target
  WHERE target.dict_catg_id = category.dict_catg_id
    AND target.dict_value = source.value
    AND target.deleted_at IS NULL
);
