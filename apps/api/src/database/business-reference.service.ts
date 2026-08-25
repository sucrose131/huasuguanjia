import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

type Row = Record<string, any>;
type DictionaryBindings = Record<string, string>;

@Injectable()
export class BusinessReferenceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private ids(rows: Row[], keys: string[]) {
    const values = new Set<string>();
    for (const row of rows)
      for (const key of keys) {
        const value = row[key];
        if (value !== undefined && value !== null && String(value) !== '' && String(value) !== '0')
          values.add(String(value));
      }
    return [...values].map(BigInt);
  }

  private map<T extends Row>(rows: T[], id: keyof T, name: keyof T) {
    return new Map(rows.map((row) => [String(row[id]), String(row[name] ?? '')]));
  }

  async enrich<T extends Row>(rows: T[], dictionaries: DictionaryBindings = {}): Promise<T[]> {
    if (!rows.length) return rows;
    const goodsIds = this.ids(rows, ['goodsId', 'goods_id']);
    const skuIds = this.ids(rows, ['skuId', 'sku_id']);
    const warehouseIds = this.ids(rows, ['warehouseId', 'warehouse_id']);
    const orgIds = this.ids(rows, ['orgId', 'org_id']);
    const deptIds = this.ids(rows, ['deptId', 'dept_id']);
    const userKeys = [
      'createdBy',
      'created_by',
      'updatedBy',
      'updated_by',
      'approveBy',
      'approve_by',
      'receiverId',
      'receiver_id',
      'handlerId',
      'handler_id',
    ];
    const userIds = this.ids(rows, userKeys);
    const unitIds = this.ids(rows, ['unitType', 'unit_type']);

    const [goods, skus, warehouses, orgs, depts, users, units, categories] = await Promise.all([
      goodsIds.length
        ? this.prisma.hspsi_goods_info.findMany({ where: { goods_id: { in: goodsIds } } })
        : [],
      skuIds.length
        ? this.prisma.hspsi_goods_info_sku.findMany({ where: { sku_id: { in: skuIds } } })
        : [],
      warehouseIds.length
        ? this.prisma.hspsi_basic_warehouse.findMany({
            where: { warehouse_id: { in: warehouseIds } },
          })
        : [],
      orgIds.length
        ? this.prisma.hspsi_basic_organization.findMany({ where: { org_id: { in: orgIds } } })
        : [],
      deptIds.length
        ? this.prisma.hspsi_basic_dept.findMany({ where: { dept_id: { in: deptIds } } })
        : [],
      userIds.length ? this.prisma.hspsi_sys_user.findMany({ where: { id: { in: userIds } } }) : [],
      unitIds.length
        ? this.prisma.hspsi_basic_unit.findMany({ where: { id: { in: unitIds } } })
        : [],
      Object.keys(dictionaries).length
        ? this.prisma.hspsi_sys_dictionary_category.findMany({
            where: {
              dict_catg_code: { in: [...new Set(Object.values(dictionaries))] },
              deleted_at: null,
            },
          })
        : [],
    ]);
    const dictItems = categories.length
      ? await this.prisma.hspsi_sys_dictionary.findMany({
          where: {
            dict_catg_id: { in: categories.map((item) => item.dict_catg_id) },
            deleted_at: null,
          },
        })
      : [];
    const categoryCode = new Map(
      categories.map((item) => [String(item.dict_catg_id), item.dict_catg_code]),
    );
    const dictionaryMaps = new Map<string, Map<string, string>>();
    for (const item of dictItems) {
      const code = categoryCode.get(String(item.dict_catg_id));
      if (!code) continue;
      if (!dictionaryMaps.has(code)) dictionaryMaps.set(code, new Map());
      dictionaryMaps.get(code)!.set(String(item.dict_value), item.dict_name ?? '');
    }
    const goodsMap = new Map(goods.map((item) => [String(item.goods_id), item]));
    const skuMap = new Map(skus.map((item) => [String(item.sku_id), item]));
    const warehouseMap = this.map(warehouses, 'warehouse_id', 'name');
    const orgMap = this.map(orgs, 'org_id', 'name');
    const deptMap = this.map(depts, 'dept_id', 'name');
    const userMap = new Map(
      users.map((item) => [String(item.id), String(item.nickname || item.username)]),
    );
    const unitMap = this.map(units, 'id', 'name');

    return rows.map((row) => {
      const result: Row = { ...row };
      const goodsId = row.goodsId ?? row.goods_id;
      const skuId = row.skuId ?? row.sku_id;
      const goodsItem = goodsMap.get(String(goodsId ?? ''));
      const skuItem = skuMap.get(String(skuId ?? ''));
      if (goodsItem)
        Object.assign(result, {
          goodsCode: goodsItem.query_code,
          goodsName: goodsItem.goods_name,
          goodsSpec: skuItem?.spec_models || goodsItem.spec_models,
          categoryId: goodsItem.goods_catg_id,
          supplyType: goodsItem.supply_type,
          goodsType: goodsItem.goods_type,
        });
      if (skuItem)
        Object.assign(result, {
          skuSpec: skuItem.spec_models,
          skuName: skuItem.spec_models,
          skuUnitType: skuItem.unit_type,
        });
      const warehouseId = row.warehouseId ?? row.warehouse_id;
      const orgId = row.orgId ?? row.org_id;
      const deptId = row.deptId ?? row.dept_id;
      const unitType = row.unitType ?? row.unit_type;
      result.warehouseName = warehouseMap.get(String(warehouseId ?? '')) ?? '';
      result.orgName = orgMap.get(String(orgId ?? '')) ?? '';
      result.deptName = deptMap.get(String(deptId ?? '')) ?? '';
      result.unitName = unitMap.get(String(unitType ?? '')) ?? '';
      for (const key of userKeys)
        if (row[key] !== undefined) {
          const camel = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
          result[`${camel}Name`] = userMap.get(String(row[key] ?? '')) ?? '';
        }
      for (const [field, code] of Object.entries(dictionaries))
        result[`${field}Name`] = dictionaryMaps.get(code)?.get(String(row[field])) ?? '';
      return result as T;
    });
  }

  /**
   * 仅富化商品展示字段（goodsName/goodsCode/skuSpec），供详情明细行回显使用，
   * 避免前端全量加载商品列表反查。返回新数组，不修改入参。
   */
  async enrichGoods<T extends Row>(rows: T[]): Promise<T[]> {
    if (!rows.length) return rows;
    const goodsIds = this.ids(rows, ['goodsId', 'goods_id']);
    const skuIds = this.ids(rows, ['skuId', 'sku_id']);
    const [goods, skus] = await Promise.all([
      goodsIds.length
        ? this.prisma.hspsi_goods_info.findMany({ where: { goods_id: { in: goodsIds } } })
        : [],
      skuIds.length
        ? this.prisma.hspsi_goods_info_sku.findMany({ where: { sku_id: { in: skuIds } } })
        : [],
    ]);
    const goodsMap = new Map(goods.map((item) => [String(item.goods_id), item]));
    const skuMap = new Map(skus.map((item) => [String(item.sku_id), item]));
    return rows.map((row) => {
      const result: Row = { ...row };
      const goodsId = row.goodsId ?? row.goods_id;
      const skuId = row.skuId ?? row.sku_id;
      const goodsItem = goodsMap.get(String(goodsId ?? ''));
      const skuItem = skuMap.get(String(skuId ?? ''));
      if (goodsItem) {
        result.goodsName = goodsItem.goods_name;
        result.goodsCode = goodsItem.query_code;
        if (!skuItem) result.skuSpec = goodsItem.spec_models || '';
      }
      if (skuItem) result.skuSpec = skuItem.spec_models || '';
      return result as T;
    });
  }
}
