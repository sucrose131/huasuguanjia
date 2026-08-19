/**
 * 外部库存过账单元测试（mock，不打真实库）
 *
 * 覆盖：外部出库不判断商品/规格启用状态；仍拒绝不存在或已删除的商品/SKU。
 *
 * 运行：
 *   pnpm --filter @hspsi/api test external-inventory-posting.unit.spec
 */

import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExternalInventoryPostingService } from './external-inventory-posting.service';
import type { InventoryPosting } from '../../inventory/inventory-posting.service';

const VALIDATE_OK = 'VALIDATE_OK';

const posting: InventoryPosting = {
  orgId: 1,
  warehouseId: 2,
  direction: -1,
  operationType: 2,
  inventoryMode: 1,
  sourceId: 99,
  sourceType: 'sale_output',
  sourceNo: 'SO1',
  operationBy: 0,
  idempotencyKey: 'k1',
  remark: 'test',
  lines: [{ goodsId: 10, skuId: 20, quantity: 1, unitType: 1, batchNo: '' }],
};

function createTx(input?: {
  warehouse?: object | null;
  goods?: object | null;
  sku?: object | null;
  category?: object | null;
}) {
  const goodsWhere: unknown[] = [];
  const skuWhere: unknown[] = [];
  const tx = {
    goodsWhere,
    skuWhere,
    hspsi_basic_warehouse: {
      findFirst: vi.fn().mockResolvedValue(
        input && 'warehouse' in input
          ? input.warehouse
          : { warehouse_id: 2n, warehouse_type: 1, status: 1 },
      ),
    },
    hspsi_goods_info: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: unknown }) => {
        goodsWhere.push(where);
        if (input && 'goods' in input) return input.goods;
        return { goods_id: 10n, goods_name: '停用商品', goods_catg_id: 1n, status: 0 };
      }),
    },
    hspsi_goods_info_sku: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: unknown }) => {
        skuWhere.push(where);
        if (input && 'sku' in input) return input.sku;
        return { sku_id: 20n, good_id: 10n, spec_models: '默认', status: 0 };
      }),
    },
    hspsi_goods_info_category: {
      findFirst: vi.fn().mockResolvedValue(
        input && 'category' in input
          ? input.category
          : { goods_catg_id: 1n, warehouse_type: 1 },
      ),
    },
    $queryRaw: vi.fn().mockRejectedValue(new Error(VALIDATE_OK)),
  };
  return tx;
}

describe('ExternalInventoryPostingService 外部出库不校验商品规格状态', () => {
  let service: ExternalInventoryPostingService;

  beforeEach(() => {
    service = new ExternalInventoryPostingService({} as never);
  });

  it('商品与规格已停用仍通过主数据校验', async () => {
    const tx = createTx();
    await expect(service.post(posting, tx as never)).rejects.toThrow(VALIDATE_OK);
    expect(tx.goodsWhere[0]).toEqual({ goods_id: 10n, deleted_at: null });
    expect(tx.skuWhere[0]).toEqual({ sku_id: 20n, good_id: 10n, deleted_at: null });
    expect(tx.goodsWhere[0]).not.toHaveProperty('status');
    expect(tx.skuWhere[0]).not.toHaveProperty('status');
  });

  it('商品或规格不存在仍拒绝', async () => {
    const tx = createTx({ goods: null });
    await expect(service.post(posting, tx as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.post(posting, tx as never)).rejects.toThrow('商品或 SKU 无效');
  });
});
