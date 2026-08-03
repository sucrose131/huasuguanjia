-- 03：领用业务链增量结构。
-- 必须在 01、02 之后执行。
-- 规则：
-- 1. 领用申请明细明确“可归还/无需归还”。
-- 2. 申请保存领用人签字信息。
-- 3. 审批通过幂等生成一张领用出库草稿。
-- 4. 出库、退回通过 posting_version 支持确认/撤销/再次确认。

ALTER TABLE hspsi_draw_approve
  ADD COLUMN signature_content LONGTEXT NULL AFTER draw_reason,
  ADD COLUMN signature_attachment VARCHAR(500) NOT NULL DEFAULT '' AFTER signature_content,
  ADD COLUMN signed_by BIGINT NOT NULL DEFAULT 0 AFTER signature_attachment,
  ADD COLUMN signed_at DATETIME NULL AFTER signed_by;

ALTER TABLE hspsi_draw_approve_detail
  ADD COLUMN is_returnable TINYINT NOT NULL DEFAULT 0 AFTER draw_qty;

ALTER TABLE hspsi_draw_approve_output
  ADD COLUMN generation_key VARCHAR(100) NULL AFTER draw_id,
  ADD COLUMN auto_created TINYINT NOT NULL DEFAULT 0 AFTER generation_key,
  ADD COLUMN posting_version INT NOT NULL DEFAULT 0 AFTER comfirm_date,
  ADD UNIQUE KEY uk_draw_output_generation_key (generation_key),
  ADD KEY idx_draw_output_draw (draw_id, deleted_at);

ALTER TABLE hspsi_draw_approve_output_detail
  ADD COLUMN draw_detail_id BIGINT NOT NULL DEFAULT 0 AFTER draw_output_id,
  ADD COLUMN is_returnable TINYINT NOT NULL DEFAULT 0 AFTER fact_draw_qty,
  ADD KEY idx_draw_output_source_detail (draw_detail_id);

ALTER TABLE hspsi_draw_approve_output_exit
  ADD COLUMN posting_version INT NOT NULL DEFAULT 0 AFTER comfirm_date,
  ADD KEY idx_draw_exit_output (draw_output_id, deleted_at);

ALTER TABLE hspsi_draw_approve_output_exit_detail
  ADD KEY idx_draw_exit_output_detail (draw_output_detail_id);

-- 历史测试数据按原“直接领用/借用”口径补默认：
-- draw_type=2（借用）视为可归还，draw_type=1（直接领用）视为无需归还。
UPDATE hspsi_draw_approve_detail d
JOIN hspsi_draw_approve h ON h.draw_id = d.draw_id
SET d.is_returnable = CASE WHEN h.draw_type = 2 THEN 1 ELSE 0 END;

-- 已提交或已审批的历史测试申请没有原始电子签名，明确标记为迁移数据，
-- 避免伪造签名内容，同时保留原申请人和原申请时间作为迁移审计信息。
UPDATE hspsi_draw_approve
SET signature_content = '历史测试数据迁移：原记录未采集电子签名',
    signed_by = applicant_id,
    signed_at = COALESCE(draw_date, created_at)
WHERE deleted_at IS NULL
  AND (status = 1 OR approve_status IN (1, 2))
  AND COALESCE(signature_content, '') = ''
  AND signature_attachment = '';

-- 既有出库明细尽量回填到原申请明细；同商品/SKU/批次重复时取最早明细。
UPDATE hspsi_draw_approve_output_detail od
JOIN hspsi_draw_approve_output oh ON oh.draw_output_id = od.draw_output_id
SET od.draw_detail_id = COALESCE((
      SELECT ad.draw_detail_id
      FROM hspsi_draw_approve_detail ad
      WHERE ad.draw_id = oh.draw_id
        AND ad.goods_id = od.goods_id
        AND ad.sku_id = od.sku_id
        AND COALESCE(ad.batch_no, '') = COALESCE(od.batch_no, '')
      ORDER BY ad.draw_detail_id
      LIMIT 1
    ), (
      SELECT ad2.draw_detail_id
      FROM hspsi_draw_approve_detail ad2
      WHERE ad2.draw_id = oh.draw_id
        AND ad2.goods_id = od.goods_id
        AND ad2.sku_id = od.sku_id
      ORDER BY ad2.draw_detail_id
      LIMIT 1
    ), 0);

UPDATE hspsi_draw_approve_output_detail od
LEFT JOIN hspsi_draw_approve_detail ad ON ad.draw_detail_id = od.draw_detail_id
JOIN hspsi_draw_approve_output oh ON oh.draw_output_id = od.draw_output_id
JOIN hspsi_draw_approve h ON h.draw_id = oh.draw_id
SET od.is_returnable = COALESCE(ad.is_returnable, CASE WHEN h.draw_type = 2 THEN 1 ELSE 0 END);

-- 已确认历史单据从第 1 个过账版本继续，草稿从第 0 个版本开始。
UPDATE hspsi_draw_approve_output
SET posting_version = CASE WHEN comfirm_status = 1 THEN 1 ELSE 0 END;

UPDATE hspsi_draw_approve_output_exit
SET posting_version = CASE WHEN comfirm_status = 1 THEN 1 ELSE 0 END;

-- 实际领用总数严格由“未删除且已确认”的领用出库明细重算。
UPDATE hspsi_draw_approve h
LEFT JOIN (
  SELECT oh.draw_id, SUM(od.fact_draw_qty) AS confirmed_qty
  FROM hspsi_draw_approve_output oh
  JOIN hspsi_draw_approve_output_detail od ON od.draw_output_id = oh.draw_output_id
  WHERE oh.deleted_at IS NULL
    AND oh.comfirm_status = 1
  GROUP BY oh.draw_id
) confirmed ON confirmed.draw_id = h.draw_id
SET h.fact_draw_qty = COALESCE(confirmed.confirmed_qty, 0);
