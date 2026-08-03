-- 仅适用于 hspsi-dev-ai-02。
-- 售后退货/换货按来源销售出库单、商品、SKU、批号记录本次处理数量。

CREATE TABLE IF NOT EXISTS `hspsi_sale_order_service_detail` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '售后明细ID',
  `service_id` bigint NOT NULL DEFAULT '0' COMMENT '售后服务记录ID',
  `source_output_id` bigint NOT NULL DEFAULT '0' COMMENT '来源已确认销售出库单ID',
  `goods_id` bigint NOT NULL DEFAULT '0' COMMENT '商品ID',
  `sku_id` bigint NOT NULL DEFAULT '0' COMMENT 'SKU ID',
  `batch_no` varchar(50) NOT NULL DEFAULT '' COMMENT '来源出库批号',
  `unit_type` int NOT NULL DEFAULT '0' COMMENT '计量单位字典值',
  `service_qty` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '本次售后退换数量',
  `remark` varchar(255) NOT NULL DEFAULT '' COMMENT '明细备注',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sale_service_detail_batch` (`service_id`,`source_output_id`,`goods_id`,`sku_id`,`batch_no`),
  KEY `idx_sale_service_detail_service` (`service_id`),
  KEY `idx_sale_service_detail_output` (`source_output_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='销售售后退换货批次明细';

-- 历史销售订单按“累计收款－累计退款”重新同步订单完成状态；换货出库不计入订单履约数量。
UPDATE `hspsi_sale_order` o
LEFT JOIN (
  SELECT h.so_id, SUM(d.output_qty) AS delivered_qty
  FROM `hspsi_sale_order_output` h
  JOIN `hspsi_sale_order_output_detail` d ON d.so_output_id=h.so_output_id
  WHERE h.comfirm_status=1 AND h.deleted_at IS NULL AND h.go_where<>3
  GROUP BY h.so_id
) out_sum ON out_sum.so_id=o.so_id
LEFT JOIN (
  SELECT so_id,
    SUM(CASE WHEN so_pay_type=1 THEN fact_pay_amount ELSE 0 END) AS received_amount,
    SUM(CASE WHEN so_pay_type=2 THEN fact_pay_amount ELSE 0 END) AS refunded_amount
  FROM `hspsi_sales_order_payment`
  WHERE deleted_at IS NULL
  GROUP BY so_id
) pay_sum ON pay_sum.so_id=o.so_id
SET
  o.delivery_status=CASE
    WHEN COALESCE(out_sum.delivered_qty,0)<=0 THEN 1
    WHEN COALESCE(out_sum.delivered_qty,0)>=o.so_qty THEN 3
    ELSE 2
  END,
  o.order_status=CASE
    WHEN o.approve_status=2 THEN 3
    WHEN o.approve_status=1
      AND COALESCE(out_sum.delivered_qty,0)>=o.so_qty
      AND (o.fact_amount<=0 OR COALESCE(pay_sum.received_amount,0)-COALESCE(pay_sum.refunded_amount,0)>=o.fact_amount)
      THEN 2
    ELSE 1
  END
WHERE o.deleted_at IS NULL;
