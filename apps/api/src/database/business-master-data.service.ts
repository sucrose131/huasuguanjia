import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';

type Db = Prisma.TransactionClient | PrismaClient;

export type BusinessGoodsLine = {
  goodsId: bigint | string | number;
  skuId?: bigint | string | number | null;
};

@Injectable()
export class BusinessMasterDataService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private id(value: bigint | string | number, label: string) {
    try {
      const result = BigInt(String(value));
      if (result <= 0n) throw new Error('out of range');
      return result;
    } catch {
      throw new BadRequestException(`${label}必填且必须有效`);
    }
  }

  async assertWarehouse(
    orgIdValue: bigint | string | number,
    warehouseIdValue: bigint | string | number,
    db: Db = this.prisma,
  ) {
    const orgId = this.id(orgIdValue, '组织');
    const warehouseId = this.id(warehouseIdValue, '仓库');
    const warehouse = await db.hspsi_basic_warehouse.findFirst({
      where: { warehouse_id: warehouseId, org_id: orgId, status: 1, deleted_at: null },
    });
    if (!warehouse) throw new BadRequestException('所选仓库不属于当前单据组织或仓库已停用');
    if (!Number.isSafeInteger(warehouse.warehouse_type) || warehouse.warehouse_type <= 0)
      throw new BadRequestException('所选仓库未配置有效的仓库类型');
    return warehouse;
  }

  private async organizationWarehouseTypes(orgId: bigint, db: Db) {
    const warehouses = await db.hspsi_basic_warehouse.findMany({
      where: { org_id: orgId, status: 1, deleted_at: null, warehouse_type: { gt: 0 } },
      distinct: ['warehouse_type'],
      select: { warehouse_type: true },
    });
    return [...new Set(warehouses.map((item) => item.warehouse_type))];
  }

  async goodsOptions(
    orgIdValue: bigint | string | number,
    warehouseIdValue: bigint | string | number,
    db: Db = this.prisma,
  ) {
    const orgId = this.id(orgIdValue, '组织');
    const warehouse = await this.assertWarehouse(orgId, warehouseIdValue, db);
    const categories = await db.hspsi_goods_info_category.findMany({
      where: { warehouse_type: warehouse.warehouse_type, status: 1, deleted_at: null },
      select: { goods_catg_id: true },
    });
    const items = await db.hspsi_goods_info.findMany({
      where: {
        goods_catg_id: { in: categories.map((item) => item.goods_catg_id) },
        status: 1,
        deleted_at: null,
      },
      orderBy: [{ sort: 'asc' }, { goods_id: 'asc' }],
    });
    return items.map((item) => ({
      id: item.goods_id,
      goodsId: item.goods_id,
      queryCode: item.query_code,
      goodsName: item.goods_name,
      shortName: item.short_name,
      brandName: item.brand_name,
      categoryId: item.goods_catg_id,
      categoryWarehouseType: warehouse.warehouse_type,
    }));
  }

  /** 按组织实际拥有的启用仓库类型返回商品，供“先选商品、后选仓库”表单使用。 */
  async goodsOptionsByOrg(
    orgIdValue: bigint | string | number,
    db: Db = this.prisma,
  ) {
    const orgId = this.id(orgIdValue, '组织');
    const warehouseTypes = await this.organizationWarehouseTypes(orgId, db);
    if (!warehouseTypes.length) return [];
    const categories = await db.hspsi_goods_info_category.findMany({
      where: {
        warehouse_type: { in: warehouseTypes },
        status: 1,
        deleted_at: null,
      },
      select: { goods_catg_id: true, warehouse_type: true },
    });
    if (!categories.length) return [];
    const items = await db.hspsi_goods_info.findMany({
      where: {
        goods_catg_id: { in: categories.map((item) => item.goods_catg_id) },
        status: 1,
        deleted_at: null,
      },
      orderBy: [{ sort: 'asc' }, { goods_id: 'asc' }],
    });
    const typeMap = new Map(categories.map((c) => [String(c.goods_catg_id), c.warehouse_type]));
    return items.map((item) => ({
      id: item.goods_id,
      goodsId: item.goods_id,
      queryCode: item.query_code,
      goodsName: item.goods_name,
      shortName: item.short_name,
      brandName: item.brand_name,
      categoryId: item.goods_catg_id,
      categoryWarehouseType: typeMap.get(String(item.goods_catg_id)) ?? 0,
    }));
  }

  async assertGoodsLines(
    orgIdValue: bigint | string | number,
    warehouseIdValue: bigint | string | number,
    lines: BusinessGoodsLine[],
    db: Db = this.prisma,
  ) {
    const orgId = this.id(orgIdValue, '组织');
    const warehouse = await this.assertWarehouse(orgId, warehouseIdValue, db);
    // 已有具体仓库时，由下方精确比较该仓库类型；无需先做组织仓库类型并集校验。
    const goods = await this.assertGoodsActive(orgId, lines, db, false);
    const categories = await db.hspsi_goods_info_category.findMany({
      where: {
        goods_catg_id: { in: [...new Set(goods.map((item) => item.goods_catg_id))] },
        status: 1,
        deleted_at: null,
      },
    });
    const categoryById = new Map(categories.map((item) => [String(item.goods_catg_id), item]));
    const types = [
      ...new Set(
        goods.map((item) => categoryById.get(String(item.goods_catg_id))!.warehouse_type),
      ),
    ];
    if (types.length > 1)
      throw new BadRequestException('同一单据只能包含相同仓库类型的商品，请拆分单据');
    for (const item of goods) {
      const category = categoryById.get(String(item.goods_catg_id))!;
      if (category.warehouse_type !== warehouse.warehouse_type)
        throw new BadRequestException(`商品“${item.goods_name}”的分类与所选仓库类型不匹配`);
    }
    return { warehouse, goods };
  }

  async assertGoodsActive(
    orgIdValue: bigint | string | number,
    lines: BusinessGoodsLine[],
    db: Db = this.prisma,
    requireOrganizationWarehouseType = true,
  ) {
    const orgId = this.id(orgIdValue, '组织');
    if (!lines.length) throw new BadRequestException('至少需要一条商品明细');

    const uniqueGoodsIds = [...new Set(lines.map((line) => String(this.id(line.goodsId, '商品'))))].map(
      BigInt,
    );
    const goods = await db.hspsi_goods_info.findMany({
      where: {
        goods_id: { in: uniqueGoodsIds },
        status: 1,
        deleted_at: null,
      },
    });
    const goodsById = new Map(goods.map((item) => [String(item.goods_id), item]));
    const categories = await db.hspsi_goods_info_category.findMany({
      where: {
        goods_catg_id: { in: [...new Set(goods.map((item) => item.goods_catg_id))] },
        status: 1,
        deleted_at: null,
      },
    });
    const categoryById = new Map(categories.map((item) => [String(item.goods_catg_id), item]));
    const allowedWarehouseTypes = requireOrganizationWarehouseType
      ? new Set(await this.organizationWarehouseTypes(orgId, db))
      : null;

    const skuLines = lines.filter((line) => line.skuId !== undefined && line.skuId !== null);
    const skus = skuLines.length
      ? await db.hspsi_goods_info_sku.findMany({
          where: {
            sku_id: { in: [...new Set(skuLines.map((line) => String(this.id(line.skuId!, 'SKU'))))].map(BigInt) },
            status: 1,
            deleted_at: null,
          },
        })
      : [];
    const skuById = new Map(skus.map((item) => [String(item.sku_id), item]));

    for (const line of lines) {
      const goodsId = this.id(line.goodsId, '商品');
      const item = goodsById.get(String(goodsId));
      if (!item) throw new BadRequestException('所选商品不存在或已停用');
      const category = categoryById.get(String(item.goods_catg_id));
      if (!category) throw new BadRequestException(`商品“${item.goods_name}”的分类不存在或已停用`);
      if (!Number.isSafeInteger(category.warehouse_type) || category.warehouse_type <= 0)
        throw new BadRequestException(`商品“${item.goods_name}”的分类未配置仓库类型`);
      if (allowedWarehouseTypes && !allowedWarehouseTypes.has(category.warehouse_type))
        throw new BadRequestException(
          `当前单据组织没有商品“${item.goods_name}”对应仓库类型的启用仓库`,
        );
      if (line.skuId !== undefined && line.skuId !== null) {
        const sku = skuById.get(String(this.id(line.skuId, 'SKU')));
        if (!sku || sku.good_id !== goodsId)
          throw new BadRequestException(`商品“${item.goods_name}”的SKU无效、不属于该商品或已停用`);
      }
    }
    return goods;
  }
}
