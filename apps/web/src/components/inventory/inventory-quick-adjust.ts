export type QuickAdjustmentBatchRow = Record<string, any>;

export interface QuickAdjustmentDetail {
  goodsId: unknown;
  skuId: unknown;
  warehouseId: unknown;
  batchNo: string;
  adjustType: 1 | 2;
  quantity: number;
  remark: string;
}

export function buildQuickAdjustmentDetails(
  rows: QuickAdjustmentBatchRow[],
): QuickAdjustmentDetail[] {
  return rows.flatMap((row) => {
    const beforeQty = Number(row.beforeQty ?? 0);
    const afterQty = Number(row.afterQty ?? 0);
    const difference = afterQty - beforeQty;
    if (!Number.isFinite(difference) || difference === 0) return [];
    return [
      {
        goodsId: row.goodsId,
        skuId: row.skuId,
        warehouseId: row.warehouseId,
        batchNo: String(row.batchNo ?? ''),
        adjustType: difference > 0 ? 1 : 2,
        quantity: Math.abs(difference),
        remark: String(row.remark ?? '').trim(),
      },
    ];
  });
}
