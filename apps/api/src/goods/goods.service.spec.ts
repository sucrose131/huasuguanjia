import { describe, expect, it, vi } from 'vitest';
import { GoodsService } from './goods.service';

describe('GoodsService categories', () => {
  it('returns every matching category without pagination fields', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const category = {
      findMany,
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    };
    const prisma = {
      hspsi_goods_info_category: category,
      hspsi_goods_info_category_property: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_goods_property: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_goods_info: { groupBy: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = new GoodsService(prisma as never);

    const result = await service.categories({
      page: '3',
      pageSize: '1',
      keyword: '办公',
      parentId: '12',
      warehouseType: '2',
      status: '1',
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        deleted_at: null,
        goods_name: { contains: '办公' },
        parent_goods_catg_id: 12n,
        warehouse_type: 2,
        status: 1,
      },
      orderBy: [{ sort: 'asc' }, { goods_catg_id: 'desc' }],
    });
    expect(result).toEqual({
      items: [],
      total: 0,
      summary: { total: 0, active: 0, inactive: 0 },
    });
    expect(result).not.toHaveProperty('page');
    expect(result).not.toHaveProperty('pageSize');
  });
});

describe('GoodsService default SKU preparation', () => {
  it('maps goods fields to a default SKU when no SKU was filled', () => {
    const service = new GoodsService({} as never);
    const body: Record<string, any> = {
      specModels: '整箱 12 件',
      unitType: 3,
      costPrice: 18.5,
      salePrice: 22,
      freeWarrantyPeriod: 30,
      isAlertPeriod: 1,
      alertQty: 5,
      skus: [{ specModels: '', pcsQty: 1, isDefault: 1 }],
    };

    (service as any).prepareSkus(body);

    expect(body.skus).toEqual([
      expect.objectContaining({
        specModels: '整箱 12 件',
        unitType: 3,
        pcsQty: 1,
        costPrice: 18.5,
        salePrice: 22,
        isDefault: 1,
        status: 1,
      }),
    ]);
  });

  it('uses 默认规格 when both goods and SKU specification are blank', () => {
    const service = new GoodsService({} as never);
    const body: Record<string, any> = {
      unitType: 1,
      costPrice: 0,
      salePrice: 0,
      skus: [],
    };

    (service as any).prepareSkus(body);

    expect(body.skus[0].specModels).toBe('默认规格');
    expect(body.skus[0].isDefault).toBe(1);
  });

  it('automatically selects the first explicit SKU when no default was selected', () => {
    const service = new GoodsService({} as never);
    const body: Record<string, any> = {
      skus: [
        { specModels: '小包', isDefault: 0 },
        { specModels: '大包', isDefault: 0 },
      ],
    };

    (service as any).prepareSkus(body);

    expect(body.skus.map((item: any) => item.isDefault)).toEqual([1, 0]);
  });
});
