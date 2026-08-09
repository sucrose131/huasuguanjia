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
  it('allows a global goods master when posting inventory for an organization', async () => {
    const goodsFindFirst = vi.fn().mockResolvedValue({
      goods_id: 101n,
      goods_catg_id: 27n,
      goods_name: '全局商品',
      org_id: 0n,
    });
    const db = {
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ warehouse_id: 15n, warehouse_type: 2 }),
      },
      hspsi_goods_info: { findFirst: goodsFindFirst },
      hspsi_goods_info_sku: {
        findFirst: vi.fn().mockResolvedValue({ sku_id: 202n, good_id: 101n }),
      },
      hspsi_goods_info_category: {
        findFirst: vi.fn().mockResolvedValue({ goods_catg_id: 27n, warehouse_type: 2 }),
      },
    };
    const service = new InventoryPostingService({} as never);

    await expect((service as any).validateMaster(db, posting())).resolves.toBeUndefined();
    expect(goodsFindFirst).toHaveBeenCalledWith({
      where: {
        goods_id: 101n,
        org_id: { in: [0n, 9n] },
        status: 1,
        deleted_at: null,
      },
    });
  });

  it('continues rejecting goods outside the global or current-organization scope', async () => {
    const db = {
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ warehouse_id: 15n, warehouse_type: 2 }),
      },
      hspsi_goods_info: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_goods_info_sku: { findFirst: vi.fn().mockResolvedValue({ sku_id: 202n }) },
    };
    const service = new InventoryPostingService({} as never);

    await expect((service as any).validateMaster(db, posting())).rejects.toThrow(
      '商品或 SKU 无效，或未启用',
    );
  });
});
