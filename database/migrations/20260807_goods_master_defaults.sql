-- 商品主档不再在建档时绑定组织、供应商或具体仓库。
-- 旧字段暂时保留以兼容历史数据，待功能验收后再物理删除。
--
-- 执行前置检查：
-- SELECT TRIM(goods_name), COUNT(*) FROM hspsi_goods_info
-- GROUP BY TRIM(goods_name) HAVING COUNT(*) > 1;
-- SELECT good_id, TRIM(spec_models), COUNT(*) FROM hspsi_goods_info_sku
-- GROUP BY good_id, TRIM(spec_models) HAVING COUNT(*) > 1;

ALTER TABLE hspsi_goods_info
  ADD UNIQUE KEY uk_goods_name (goods_name);

ALTER TABLE hspsi_goods_info_sku
  ADD UNIQUE KEY uk_goods_sku_spec (good_id, spec_models);
