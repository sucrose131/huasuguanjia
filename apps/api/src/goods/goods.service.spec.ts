import { describe, expect, it, vi } from 'vitest';
import { GoodsService } from './goods.service';

const amountAccess = {
  forUser: vi.fn().mockResolvedValue({ canViewAmount: true, canEditAmount: true }),
  maskFields: vi.fn((value: unknown) => value),
};

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
    const service = new GoodsService(prisma as never, amountAccess as never);

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

  it('limits ordinary users to category warehouse types enabled for their organization', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      hspsi_basic_warehouse: {
        findMany: vi.fn().mockResolvedValue([{ warehouse_type: 2 }, { warehouse_type: 2 }]),
      },
      hspsi_goods_info_category: {
        findMany,
        count: vi.fn().mockResolvedValue(0),
        groupBy: vi.fn().mockResolvedValue([]),
      },
      hspsi_goods_info_category_property: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_goods_property: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_goods_info: { groupBy: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = new GoodsService(prisma as never, amountAccess as never);

    await service.categories(
      { status: '1' },
      { id: '9', username: 'buyer', orgId: '6', deptId: '8', permissions: ['goods'] },
    );

    expect(prisma.hspsi_basic_warehouse.findMany).toHaveBeenCalledWith({
      where: { org_id: { in: [6n] }, status: 1, deleted_at: null },
      distinct: ['warehouse_type'],
      select: { warehouse_type: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        deleted_at: null,
        status: 1,
        AND: [{ warehouse_type: { in: [2] } }],
      },
      orderBy: [{ sort: 'asc' }, { goods_catg_id: 'desc' }],
    });
  });
});

describe('GoodsService organization visibility', () => {
  it('keeps administrators on the global goods scope', async () => {
    const warehouseFindMany = vi.fn();
    const service = new GoodsService({
      hspsi_basic_warehouse: { findMany: warehouseFindMany },
    } as never, amountAccess as never);

    await expect(
      (service as any).visibleWarehouseTypes({
        id: '1',
        username: 'admin',
        orgId: '6',
        deptId: null,
        permissions: ['*'],
      }),
    ).resolves.toBeNull();
    expect(warehouseFindMany).not.toHaveBeenCalled();
  });

  it('returns no visible warehouse type when an ordinary user has no organization', async () => {
    const warehouseFindMany = vi.fn();
    const service = new GoodsService({
      hspsi_basic_warehouse: { findMany: warehouseFindMany },
    } as never, amountAccess as never);

    await expect(
      (service as any).visibleWarehouseTypes({
        id: '9',
        username: 'buyer',
        orgId: null,
        deptId: null,
        permissions: ['goods'],
      }),
    ).resolves.toEqual([]);
    expect(warehouseFindMany).not.toHaveBeenCalled();
  });

  it('uses the union of primary and additional authorized organizations', async () => {
    const warehouseFindMany = vi
      .fn()
      .mockResolvedValue([{ warehouse_type: 1 }, { warehouse_type: 2 }]);
    const service = new GoodsService({
      hspsi_basic_warehouse: { findMany: warehouseFindMany },
    } as never, amountAccess as never);

    await expect(
      (service as any).visibleWarehouseTypes({
        id: '9',
        username: 'buyer',
        orgId: '6',
        deptId: null,
        permissions: ['goods'],
        authorizedOrganizations: [
          { id: '6', name: '本组织' },
          { id: '9', name: '额外组织' },
        ],
      }),
    ).resolves.toEqual([1, 2]);
    expect(warehouseFindMany).toHaveBeenCalledWith({
      where: { org_id: { in: [6n, 9n] }, status: 1, deleted_at: null },
      distinct: ['warehouse_type'],
      select: { warehouse_type: true },
    });
  });

  it('rejects direct detail access when the goods category is outside the user organization scope', async () => {
    const skuFindMany = vi.fn();
    const service = new GoodsService({
      hspsi_basic_warehouse: { findMany: vi.fn().mockResolvedValue([{ warehouse_type: 2 }]) },
      hspsi_goods_info: {
        findFirst: vi.fn().mockResolvedValue({ goods_id: 11n, goods_catg_id: 30n }),
      },
      hspsi_goods_info_category: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_goods_info_sku: { findMany: skuFindMany },
    } as never, amountAccess as never);

    await expect(
      service.detail('11', {
        id: '9',
        username: 'buyer',
        orgId: '6',
        deptId: '8',
        permissions: ['goods'],
      }),
    ).rejects.toThrow('商品不存在或不在当前组织可用范围内');
    expect(skuFindMany).not.toHaveBeenCalled();
  });
});

describe('GoodsService global name availability', () => {
  it('allows quick creation only when no global goods name exists', async () => {
    const service = new GoodsService({
      hspsi_goods_info: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never, amountAccess as never);

    await expect(
      service.nameAvailability('全局不存在商品', {
        id: '9',
        username: 'buyer',
        orgId: '6',
        deptId: '8',
        permissions: ['goods'],
      }),
    ).resolves.toEqual({ exists: false, usable: false, reason: 'not_found' });
  });

  it('reports an existing global name as unusable when its warehouse type is unavailable', async () => {
    const service = new GoodsService({
      hspsi_goods_info: {
        findFirst: vi.fn().mockResolvedValue({
          goods_id: 11n,
          goods_name: '全局已有商品',
          query_code: 'QJYY',
          short_name: '',
          unit_type: 1,
          goods_catg_id: 30n,
          const_price: 0,
          status: 1,
          deleted_at: null,
        }),
      },
      hspsi_goods_info_category: {
        findUnique: vi.fn().mockResolvedValue({
          goods_catg_id: 30n,
          goods_name: '特殊耗材',
          warehouse_type: 9,
          status: 1,
          deleted_at: null,
        }),
      },
      hspsi_basic_warehouse: { findMany: vi.fn().mockResolvedValue([{ warehouse_type: 2 }]) },
    } as never, amountAccess as never);

    const result = await service.nameAvailability('全局已有商品', {
      id: '9',
      username: 'buyer',
      orgId: '6',
      deptId: '8',
      permissions: ['goods'],
    });

    expect(result).toEqual(
      expect.objectContaining({
        exists: true,
        usable: false,
        reason: 'warehouse_type_unavailable',
        categoryName: '特殊耗材',
        warehouseType: 9,
        goods: null,
      }),
    );
  });
});

describe('GoodsService category selection', () => {
  it('allows an enabled parent category with a valid warehouse type', async () => {
    const childCount = vi.fn().mockResolvedValue(2);
    const service = new GoodsService({
      hspsi_goods_info_category: {
        findFirst: vi.fn().mockResolvedValue({
          goods_catg_id: 30n,
          warehouse_type: 2,
          status: 1,
          deleted_at: null,
        }),
        count: childCount,
      },
      hspsi_goods_info: { findFirst: vi.fn().mockResolvedValue(null) },
    } as never, amountAccess as never);

    await expect(
      (service as any).validate(
        null,
        {
          goodsName: '父分类商品',
          categoryId: '30',
          unitType: 1,
          skus: [
            {
              specModels: '默认规格',
              pcsQty: 1,
              unitType: 1,
              costPrice: 0,
              isDefault: 1,
            },
          ],
        },
        { id: '1', username: 'admin', orgId: null, deptId: null, permissions: ['*'] },
      ),
    ).resolves.toBeUndefined();
    expect(childCount).not.toHaveBeenCalled();
  });
});

describe('GoodsService default SKU preparation', () => {
  it('maps goods fields to a default SKU when no SKU was filled', () => {
    const service = new GoodsService({} as never, amountAccess as never);
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
    const service = new GoodsService({} as never, amountAccess as never);
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
    const service = new GoodsService({} as never, amountAccess as never);
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
