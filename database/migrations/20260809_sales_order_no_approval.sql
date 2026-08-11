-- 普通销售订单来源于线上已完成订单，不再经过本系统或OA审批。
-- 仅迁移历史待审批普通销售订单；已驳回记录保留原历史状态，重新编辑保存后按新规则生效。

UPDATE hspsi_sale_order
SET approve_status = 1,
    approve_comment = '销售订单无需审批',
    approve_by = updated_by,
    approve_date = COALESCE(approve_date, updated_at)
WHERE so_property_type = 1
  AND approve_status = 0
  AND deleted_at IS NULL;
