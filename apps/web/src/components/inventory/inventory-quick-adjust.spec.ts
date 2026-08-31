import { describe, expect, it } from 'vitest';
import { buildQuickAdjustmentDetails } from './inventory-quick-adjust';

describe('buildQuickAdjustmentDetails', () => {
  it('只提交发生变化的批次，并准确映射增减方向与数量', () => {
    expect(
      buildQuickAdjustmentDetails([
        {
          goodsId: 1,
          skuId: 11,
          warehouseId: 101,
          batchNo: 'A',
          beforeQty: 10,
          afterQty: 13,
          remark: ' 盘盈 ',
        },
        {
          goodsId: 1,
          skuId: 11,
          warehouseId: 101,
          batchNo: 'B',
          beforeQty: 8,
          afterQty: 5,
          remark: '盘亏',
        },
        {
          goodsId: 1,
          skuId: 11,
          warehouseId: 101,
          batchNo: 'C',
          beforeQty: 6,
          afterQty: 6,
        },
      ]),
    ).toEqual([
      {
        goodsId: 1,
        skuId: 11,
        warehouseId: 101,
        batchNo: 'A',
        adjustType: 1,
        quantity: 3,
        remark: '盘盈',
      },
      {
        goodsId: 1,
        skuId: 11,
        warehouseId: 101,
        batchNo: 'B',
        adjustType: 2,
        quantity: 3,
        remark: '盘亏',
      },
    ]);
  });
});
