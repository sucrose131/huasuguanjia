-- 生产计划主键为 BIGINT，生产出库来源字段必须使用相同类型，
-- 否则真实计划 ID 超过 INT 上限后无法生成 BOM 出库单。
ALTER TABLE hspsi_production_material_out
  MODIFY COLUMN plan_id BIGINT NULL;
