import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { BusinessMasterDataService } from './business-master-data.service';

function fixture(overrides: Record<string, any> = {}) {
  const prisma = {
    hspsi_basic_warehouse: {
      findFirst: vi.fn().mockResolvedValue({ warehouse_id: 15n, org_id: 9n, warehouse_type: 2 }),
    },
    hspsi_goods_info: {
      findMany: vi.fn().mockResolvedValue([
        { goods_id: 101n, org_id: 0n, goods_catg_id: 27n, goods_name: '全局商品' },
      ]),
    },
    hspsi_goods_info_category: {
      findMany: vi.fn().mockResolvedValue([
        { goods_catg_id: 27n, warehouse_type: 2, status: 1 },
      ]),
    },
    hspsi_goods_info_sku: {
      findMany: vi.fn().mockResolvedValue([{ sku_id: 202n, good_id: 101n, status: 1 }]),
    },
    ...overrides,
  };
  return { prisma, service: new BusinessMasterDataService(prisma as never) };
}

describe('BusinessMasterDataService', () => {
  it('accepts global goods with an enabled matching category and SKU', async () => {
    const { service, prisma } = fixture();

    await expect(
      service.assertGoodsLines(9, 15, [{ goodsId: 101, skuId: 202 }]),
    ).resolves.toMatchObject({ warehouse: { warehouse_type: 2 } });
    expect(prisma.hspsi_goods_info.findMany).toHaveBeenCalledWith({
      where: {
        goods_id: { in: [101n] },
        org_id: { in: [0n, 9n] },
        status: 1,
        deleted_at: null,
      },
    });
  });

  it('rejects a warehouse outside the document organization', async () => {
    const { service } = fixture({
      hspsi_basic_warehouse: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.assertGoodsLines(9, 15, [{ goodsId: 101, skuId: 202 }])).rejects.toThrow(
      '所选仓库不属于当前单据组织或仓库已停用',
    );
  });

  it('rejects a disabled category before a document can be saved as draft', async () => {
    const { service } = fixture({
      hspsi_goods_info_category: { findMany: vi.fn().mockResolvedValue([]) },
    });

    await expect(service.assertGoodsLines(9, 15, [{ goodsId: 101, skuId: 202 }])).rejects.toThrow(
      '商品“全局商品”的分类不存在或已停用',
    );
  });

  it('rejects a category whose warehouse type differs from the selected warehouse', async () => {
    const { service } = fixture({
      hspsi_goods_info_category: {
        findMany: vi.fn().mockResolvedValue([{ goods_catg_id: 27n, warehouse_type: 1 }]),
      },
    });

    await expect(service.assertGoodsLines(9, 15, [{ goodsId: 101, skuId: 202 }])).rejects.toThrow(
      '商品“全局商品”的分类与所选仓库类型不匹配',
    );
  });

  it('rejects a SKU that does not belong to its goods', async () => {
    const { service } = fixture({
      hspsi_goods_info_sku: {
        findMany: vi.fn().mockResolvedValue([{ sku_id: 202n, good_id: 999n }]),
      },
    });

    await expect(service.assertGoodsLines(9, 15, [{ goodsId: 101, skuId: 202 }])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects goods with different warehouse types and asks to split the document', async () => {
    const { service } = fixture({
      hspsi_goods_info: {
        findMany: vi.fn().mockResolvedValue([
          { goods_id: 101n, org_id: 0n, goods_catg_id: 27n, goods_name: '商品A' },
          { goods_id: 102n, org_id: 0n, goods_catg_id: 28n, goods_name: '商品B' },
        ]),
      },
      hspsi_goods_info_category: {
        findMany: vi.fn().mockResolvedValue([
          { goods_catg_id: 27n, warehouse_type: 1, status: 1 },
          { goods_catg_id: 28n, warehouse_type: 2, status: 1 },
        ]),
      },
    });

    await expect(
      service.assertGoodsLines(9, 15, [{ goodsId: 101 }, { goodsId: 102 }]),
    ).rejects.toThrow('同一单据只能包含相同仓库类型的商品，请拆分单据');
  });

  it('goodsOptions includes categoryWarehouseType for frontend linkage', async () => {
    const { service } = fixture();

    const result = await service.goodsOptions(9, 15);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ categoryWarehouseType: 2 });
  });
});
