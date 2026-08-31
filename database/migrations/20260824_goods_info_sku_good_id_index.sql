-- SKU 按商品 ID 查询补普通索引。
-- 商品详情、SKU 列表、同步回填均按 good_id 过滤；当前表仅有主键。

SET @idx_good_id_exists = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'hspsi_goods_info_sku'
    AND index_name = 'idx_good_id'
);
SET @idx_good_id_sql = IF(
  @idx_good_id_exists = 0,
  'ALTER TABLE `hspsi_goods_info_sku` ADD INDEX `idx_good_id` (`good_id`)',
  'SELECT 1'
);
PREPARE idx_good_id_stmt FROM @idx_good_id_sql;
EXECUTE idx_good_id_stmt;
DEALLOCATE PREPARE idx_good_id_stmt;
