import { describe, expect, it, vi } from 'vitest';
import { InventoryPostingService } from './inventory-posting.service';

function posting() {
  return {
    orgId: 9,
    warehouseId: 15,
    direction: 1 as const,
    operationType: 1,
    inventoryMode: 1,
    sourceId: 501,
    sourceType: 'purchase_receipt',
    sourceNo: 'GA202608090001',
    operationBy: 1,
    idempotencyKey: 'purchase-receipt:501:confirm:1',
    remark: '采购入库',
    lines: [{ goodsId: 101, skuId: 202, quantity: 3, unitType: 33 }],
  };
}

describe('InventoryPostingService master validation', () => {
  it('delegates organization, warehouse, goods and SKU checks to the common validator', async () => {
    const db = {};
    const assertGoodsLines = vi.fn().mockResolvedValue(undefined);
    const service = new InventoryPostingService({} as never, { assertGoodsLines } as never);

    await expect((service as any).validateMaster(db, posting())).resolves.toBeUndefined();
    expect(assertGoodsLines).toHaveBeenCalledWith(9, 15, posting().lines, db);
  });

  it('propagates common master-data validation failures', async () => {
    const assertGoodsLines = vi.fn().mockRejectedValue(new Error('商品分类与仓库类型不匹配'));
    const service = new InventoryPostingService({} as never, { assertGoodsLines } as never);

    await expect((service as any).validateMaster({}, posting())).rejects.toThrow(
      '商品分类与仓库类型不匹配',
    );
  });
});
