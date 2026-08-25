import { describe, expect, it } from 'vitest';
import { filterGoodsByWarehouseType, warehouseTypeOf } from './goods-warehouse';

const goods = [
  { id: 1, goodsName: '原料A', categoryWarehouseType: 1 },
  { id: 2, goodsName: '成品B', categoryWarehouseType: 2 },
  { id: 3, goodsName: '无类型商品', categoryWarehouseType: 0 },
];

describe('filterGoodsByWarehouseType', () => {
  it('未选仓库（类型 0）时返回全量商品', () => {
    expect(filterGoodsByWarehouseType(goods, 0)).toHaveLength(3);
    expect(filterGoodsByWarehouseType(goods, undefined)).toHaveLength(3);
  });

  it('选了仓库后只保留匹配类型与无类型商品', () => {
    const result = filterGoodsByWarehouseType(goods, 1);
    expect(result.map((g) => g.id)).toEqual([1, 3]);
  });

  it('空列表安全返回', () => {
    expect(filterGoodsByWarehouseType([], 1)).toEqual([]);
  });
});

describe('warehouseTypeOf', () => {
  it('从 raw.warehouseType 或顶层 warehouseType 解析仓库类型', () => {
    const warehouses = [
      { value: '1', raw: { warehouseType: 2 } },
      { value: '2', warehouseType: 3 },
    ];
    expect(warehouseTypeOf(warehouses, '1')).toBe(2);
    expect(warehouseTypeOf(warehouses, '2')).toBe(3);
    expect(warehouseTypeOf(warehouses, '999')).toBe(0);
    expect(warehouseTypeOf([], '1')).toBe(0);
  });
});
