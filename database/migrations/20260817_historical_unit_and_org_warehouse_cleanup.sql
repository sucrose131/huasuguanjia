-- 历史测试数据治理：单位口径、换算系数、组织—仓库关联
-- 适用数据库：hspsi-dev；全部操作可重复执行。

START TRANSACTION;

-- 无效换算系数按“1 业务单位 = 1 基础单位”修复。
UPDATE hspsi_goods_info_sku
SET pcs_qty = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE deleted_at IS NULL
  AND pcs_qty <= 0;

-- SKU 未维护业务单位时，回归商品基础单位。
UPDATE hspsi_goods_info_sku sku
JOIN hspsi_goods_info goods ON goods.goods_id = sku.good_id
SET sku.unit_type = goods.unit_type,
    sku.updated_at = CURRENT_TIMESTAMP
WHERE sku.deleted_at IS NULL
  AND goods.deleted_at IS NULL
  AND sku.unit_type <= 0
  AND goods.unit_type > 0;

-- 库存始终以商品基础单位记账。
UPDATE hspsi_inventory_total total
JOIN hspsi_goods_info goods ON goods.goods_id = total.goods_id
SET total.unit_type = goods.unit_type,
    total.updated_at = CURRENT_TIMESTAMP
WHERE total.deleted_at IS NULL
  AND goods.deleted_at IS NULL
  AND goods.unit_type > 0
  AND total.unit_type <> goods.unit_type;

UPDATE hspsi_inventory_batch_total batch
JOIN hspsi_goods_info goods ON goods.goods_id = batch.goods_id
SET batch.unit_type = goods.unit_type
WHERE goods.deleted_at IS NULL
  AND goods.unit_type > 0
  AND batch.unit_type <> goods.unit_type;

-- 历史销售测试单：组织 6 的成品销售改绑组织 6 的启用成品仓。
UPDATE hspsi_sale_order
SET warehouse_id = 30,
    updated_at = CURRENT_TIMESTAMP
WHERE so_no = 'SO20260812000001'
  AND org_id = 6
  AND warehouse_id = 1
  AND deleted_at IS NULL;

-- 历史领用测试单：组织 9、成品分类商品改绑组织 9 的启用成品仓。
UPDATE hspsi_draw_approve
SET warehouse_id = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE draw_no = 'DR202607311900850003'
  AND org_id = 9
  AND warehouse_id = 2
  AND deleted_at IS NULL;

COMMIT;
