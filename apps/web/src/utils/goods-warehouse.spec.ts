import { describe, expect, it } from 'vitest';
import {
  filterGoodsByWarehouseType,
  filterMappedGoodsByKeyword,
  goodsStockQty,
  skuStockQty,
  warehouseTypeOf,
} from './goods-warehouse';

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

  it('选了仓库后只保留仓库类型完全匹配的商品', () => {
    const result = filterGoodsByWarehouseType(goods, 1);
    expect(result.map((g) => g.id)).toEqual([1]);
  });

  it('空列表安全返回', () => {
    expect(filterGoodsByWarehouseType([], 1)).toEqual([]);
  });
});

describe('filterMappedGoodsByKeyword', () => {
  const searchableGoods = [
    {
      id: 1,
      queryCode: 'KF-001',
      goodsName: '康复训练弹力带',
      shortName: '弹力带',
      brandName: '华溯',
    },
    { id: 2, queryCode: 'WATER-01', goodsName: '低氘水', shortName: '', brandName: '清源' },
  ];

  it('支持名称、编码、简称和品牌，并忽略首尾空格及大小写', () => {
    expect(filterMappedGoodsByKeyword(searchableGoods, ' 弹力带 ').map((item) => item.id)).toEqual([
      1,
    ]);
    expect(filterMappedGoodsByKeyword(searchableGoods, 'water').map((item) => item.id)).toEqual([
      2,
    ]);
    expect(filterMappedGoodsByKeyword(searchableGoods, '华溯').map((item) => item.id)).toEqual([1]);
  });

  it('清空关键字后恢复全部映射候选', () => {
    expect(filterMappedGoodsByKeyword(searchableGoods, '  ')).toEqual(searchableGoods);
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

describe('goodsStockQty', () => {
  const goods = { id: 1, stockByWarehouse: { '49': 5, '48': 2 } };

  it('未选仓库时返回领用可用仓库合计', () => {
    expect(goodsStockQty(goods, '', ['49', '48'])).toBe(7);
  });

  it('未选仓库时仅统计传入的可用仓库，传空则返回 0', () => {
    expect(goodsStockQty(goods, '', ['48'])).toBe(2);
    expect(goodsStockQty(goods, '', [])).toBe(0);
  });

  it('已选仓库时返回该仓库数量，不受其它仓库影响', () => {
    expect(goodsStockQty(goods, '49', ['49', '48'])).toBe(5);
    expect(goodsStockQty(goods, '48')).toBe(2);
    expect(goodsStockQty(goods, '999')).toBe(0);
  });

  it('无库存数据或零库存返回 0', () => {
    expect(goodsStockQty({}, '', ['49'])).toBe(0);
    expect(goodsStockQty({ id: 1, stockByWarehouse: { '49': 0 } }, '', ['49'])).toBe(0);
  });
});

describe('skuStockQty', () => {
  const goods = {
    id: 1,
    skuStockByWarehouse: {
      '201': { '49': 5, '48': 2 },
      '202': { '49': 3 },
    },
  };

  it('未选仓库时返回该规格在领用可用仓库的合计', () => {
    expect(skuStockQty(goods, '201', '', ['49', '48'])).toBe(7);
    expect(skuStockQty(goods, '202', '', ['49', '48'])).toBe(3);
  });

  it('已选仓库时只返回该规格在该仓库的数量', () => {
    expect(skuStockQty(goods, '201', '49', ['49', '48'])).toBe(5);
    expect(skuStockQty(goods, '202', '48', ['49', '48'])).toBe(0);
  });

  it('缺少规格或库存数据时返回 0', () => {
    expect(skuStockQty(goods, '', '49')).toBe(0);
    expect(skuStockQty(goods, '999', '49')).toBe(0);
    expect(skuStockQty({}, '201', '49', ['49'])).toBe(0);
  });
});
