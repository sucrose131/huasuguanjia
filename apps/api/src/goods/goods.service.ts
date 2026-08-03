import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class GoodsService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  private page(query: Record<string, string | undefined>) {
    return {
      page: Math.max(1, Number(query.page ?? 1)),
      pageSize: Math.min(100, Math.max(1, Number(query.pageSize ?? 20))),
    };
  }
  async categories(query: Record<string, string | undefined>) {
    const { page, pageSize } = this.page(query);
    const where: Prisma.hspsi_goods_info_categoryWhereInput = { deleted_at: null };
    if (query.keyword) where.goods_name = { contains: query.keyword };
    if (query.parentId) where.parent_goods_catg_id = BigInt(query.parentId);
    if (query.warehouseType) where.warehouse_type = Number(query.warehouseType);
    if (query.status !== undefined) where.status = Number(query.status);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_goods_info_category.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ sort: 'asc' }, { goods_catg_id: 'desc' }],
      }),
      this.prisma.hspsi_goods_info_category.count({ where }),
    ]);
    const ids = items.map((item) => item.goods_catg_id);
    const links = ids.length
      ? await this.prisma.hspsi_goods_info_category_property.findMany({
          where: { category_id: { in: ids } },
        })
      : [];
    const propertyIds = [...new Set(links.map((link) => link.property_id))];
    const parentIds = [
      ...new Set(items.map((item) => item.parent_goods_catg_id).filter((id) => id > 0n)),
    ];
    const [properties, parents, goodsCounts, childCounts, allCount, activeCount, inactiveCount] =
      await Promise.all([
        propertyIds.length
          ? this.prisma.hspsi_goods_property.findMany({
              where: { property_id: { in: propertyIds } },
            })
          : [],
        parentIds.length
          ? this.prisma.hspsi_goods_info_category.findMany({
              where: { goods_catg_id: { in: parentIds } },
            })
          : [],
        this.prisma.hspsi_goods_info.groupBy({
          by: ['goods_catg_id'],
          where: { goods_catg_id: { in: ids }, deleted_at: null },
          _count: true,
        }),
        this.prisma.hspsi_goods_info_category.groupBy({
          by: ['parent_goods_catg_id'],
          where: { parent_goods_catg_id: { in: ids }, deleted_at: null },
          _count: true,
        }),
        this.prisma.hspsi_goods_info_category.count({ where: { deleted_at: null } }),
        this.prisma.hspsi_goods_info_category.count({ where: { deleted_at: null, status: 1 } }),
        this.prisma.hspsi_goods_info_category.count({
          where: { deleted_at: null, status: { not: 1 } },
        }),
      ]);
    return {
      items: items.map((item) => {
        const itemLinks = links.filter((link) => link.category_id === item.goods_catg_id);
        return {
          id: item.goods_catg_id,
          name: item.goods_name,
          parentId: item.parent_goods_catg_id,
          parentName:
            parents.find((parent) => parent.goods_catg_id === item.parent_goods_catg_id)
              ?.goods_name ?? null,
          warehouseType: item.warehouse_type,
          sort: item.sort,
          status: item.status,
          remark: item.remark,
          propertyIds: itemLinks.map((link) => link.property_id),
          propertyNames: itemLinks
            .map(
              (link) =>
                properties.find((property) => property.property_id === link.property_id)
                  ?.property_name,
            )
            .filter(Boolean),
          propertyCount: itemLinks.length,
          goodsCount:
            goodsCounts.find((count) => count.goods_catg_id === item.goods_catg_id)?._count ?? 0,
          childCount:
            childCounts.find((count) => count.parent_goods_catg_id === item.goods_catg_id)
              ?._count ?? 0,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        };
      }),
      total,
      page,
      pageSize,
      summary: { total: allCount, active: activeCount, inactive: inactiveCount },
    };
  }
  async saveCategory(id: string | null, body: Record<string, unknown>, userId: string) {
    if (!String(body.name ?? '').trim()) throw new BadRequestException('分类名称必填');
    if (id) {
      const existing = await this.prisma.hspsi_goods_info_category.findFirst({
        where: { goods_catg_id: BigInt(id), deleted_at: null },
        select: { warehouse_type: true },
      });
      if (!existing) throw new NotFoundException('商品分类不存在');
      if (existing.warehouse_type !== Number(body.warehouseType ?? 0)) {
        const goodsCount = await this.prisma.hspsi_goods_info.count({
          where: { goods_catg_id: BigInt(id), deleted_at: null },
        });
        if (goodsCount)
          throw new BadRequestException('分类已被商品使用，不能修改仓库类型；请先完成商品迁移');
      }
    }
    const data = {
      goods_name: String(body.name).trim(),
      parent_goods_catg_id: BigInt(String(body.parentId ?? 0)),
      warehouse_type: Number(body.warehouseType ?? 0),
      sort: Number(body.sort ?? 0),
      status: Number(body.status ?? 1),
      remark: String(body.remark ?? ''),
      updated_by: BigInt(userId),
      updated_at: new Date(),
    };
    const propertyIds = Array.isArray(body.propertyIds)
      ? body.propertyIds.map((value) => BigInt(String(value)))
      : [];
    return this.prisma.$transaction(async (tx) => {
      const category = id
        ? await tx.hspsi_goods_info_category.update({ where: { goods_catg_id: BigInt(id) }, data })
        : await tx.hspsi_goods_info_category.create({
            data: { ...data, created_by: BigInt(userId) },
          });
      await tx.hspsi_goods_info_category_property.deleteMany({
        where: { category_id: category.goods_catg_id },
      });
      if (propertyIds.length)
        await tx.hspsi_goods_info_category_property.createMany({
          data: propertyIds.map((propertyId) => ({
            category_id: category.goods_catg_id,
            property_id: propertyId,
          })),
        });
      return { id: category.goods_catg_id, message: id ? '更新成功' : '创建成功' };
    });
  }
  async removeCategory(id: string, userId: string) {
    if (
      await this.prisma.hspsi_goods_info.count({
        where: { goods_catg_id: BigInt(id), deleted_at: null },
      })
    )
      throw new BadRequestException('分类已被商品使用，不能删除');
    await this.prisma.hspsi_goods_info_category.update({
      where: { goods_catg_id: BigInt(id) },
      data: { deleted_at: new Date(), updated_by: BigInt(userId) },
    });
    return { id, message: '删除成功' };
  }
  async properties(query: Record<string, string | undefined>) {
    const { page, pageSize } = this.page(query);
    const where: Prisma.hspsi_goods_propertyWhereInput = { deleted_at: null };
    if (query.keyword)
      where.OR = [
        { property_name: { contains: query.keyword } },
        { property_desc: { contains: query.keyword } },
      ];
    if (query.status !== undefined) where.status = Number(query.status);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_goods_property.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ sort: 'asc' }, { property_id: 'desc' }],
      }),
      this.prisma.hspsi_goods_property.count({ where }),
    ]);
    const ids = items.map((item) => item.property_id);
    const links = ids.length
      ? await this.prisma.hspsi_goods_info_category_property.findMany({
          where: { property_id: { in: ids } },
        })
      : [];
    const categoryIds = [...new Set(links.map((link) => link.category_id))];
    const categories = categoryIds.length
      ? await this.prisma.hspsi_goods_info_category.findMany({
          where: { goods_catg_id: { in: categoryIds } },
        })
      : [];
    return {
      items: items.map((item) => {
        const itemLinks = links.filter((link) => link.property_id === item.property_id);
        return {
          id: item.property_id,
          name: item.property_name,
          description: item.property_desc,
          logic: item.property_logic,
          sort: item.sort,
          status: item.status,
          remark: item.remark,
          categoryNames: itemLinks
            .map(
              (link) =>
                categories.find((category) => category.goods_catg_id === link.category_id)
                  ?.goods_name,
            )
            .filter(Boolean),
          categoryCount: itemLinks.length,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        };
      }),
      total,
      page,
      pageSize,
    };
  }
  async list(query: Record<string, string | undefined>) {
    const { page, pageSize } = this.page(query);
    const where: Prisma.hspsi_goods_infoWhereInput = { deleted_at: null };
    if (query.keyword)
      where.OR = [
        { query_code: { contains: query.keyword } },
        { goods_name: { contains: query.keyword } },
        { short_name: { contains: query.keyword } },
        { brand_name: { contains: query.keyword } },
      ];
    if (query.orgId) where.org_id = BigInt(query.orgId);
    if (query.categoryId) where.goods_catg_id = BigInt(query.categoryId);
    if (query.status !== undefined) where.status = Number(query.status);
    if (query.supplyType) where.supply_type = Number(query.supplyType);
    if (query.goodsType) where.goods_type = Number(query.goodsType);
    if (query.vendorId) where.vendor_id = BigInt(query.vendorId);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_goods_info.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { goods_id: 'desc' },
      }),
      this.prisma.hspsi_goods_info.count({ where }),
    ]);
    const categoryIds = [...new Set(items.map((item) => item.goods_catg_id))];
    const vendorIds = [...new Set(items.map((item) => item.vendor_id).filter((id) => id > 0n))];
    const warehouseIds = [
      ...new Set(items.map((item) => item.warehouse_id).filter(Boolean) as bigint[]),
    ];
    const orgIds = [...new Set(items.map((item) => item.org_id))];
    const unitIds = [...new Set(items.map((item) => item.unit_type).filter(Boolean))];
    const ids = items.map((item) => item.goods_id);
    const userIds = [
      ...new Set(items.flatMap((item) => [item.updated_by, item.created_by]).map(String)),
    ].map(BigInt);
    const [
      categories,
      vendors,
      warehouses,
      organizations,
      units,
      skuCounts,
      users,
      allCount,
      activeCount,
      inactiveCount,
    ] = await Promise.all([
      this.prisma.hspsi_goods_info_category.findMany({
        where: { goods_catg_id: { in: categoryIds } },
      }),
      this.prisma.hspsi_basic_vendor.findMany({ where: { vendor_id: { in: vendorIds } } }),
      this.prisma.hspsi_basic_warehouse.findMany({ where: { warehouse_id: { in: warehouseIds } } }),
      this.prisma.hspsi_basic_organization.findMany({ where: { org_id: { in: orgIds } } }),
      this.prisma.hspsi_basic_unit.findMany({ where: { id: { in: unitIds.map(BigInt) } } }),
      this.prisma.hspsi_goods_info_sku.groupBy({
        by: ['good_id'],
        where: { good_id: { in: ids }, deleted_at: null },
        _count: true,
      }),
      this.prisma.hspsi_sys_user.findMany({ where: { id: { in: userIds } } }),
      this.prisma.hspsi_goods_info.count({ where: { deleted_at: null } }),
      this.prisma.hspsi_goods_info.count({ where: { deleted_at: null, status: 1 } }),
      this.prisma.hspsi_goods_info.count({ where: { deleted_at: null, status: { not: 1 } } }),
    ]);
    return {
      items: items.map((item) => {
        const category = categories.find((c) => c.goods_catg_id === item.goods_catg_id);
        return this.goodsOutput(item, {
          categoryName: category?.goods_name,
          categoryWarehouseType: category?.warehouse_type ?? 0,
          vendorName: vendors.find((v) => v.vendor_id === item.vendor_id)?.conpany_name,
          warehouseName: warehouses.find((w) => w.warehouse_id === item.warehouse_id)?.name,
          organizationName: organizations.find((o) => o.org_id === item.org_id)?.name,
          unitName: units.find((u) => u.id === BigInt(item.unit_type))?.name,
          skuCount: skuCounts.find((count) => count.good_id === item.goods_id)?._count ?? 0,
          operatorName: (() => {
            const user = users.find((u) => u.id === (item.updated_by || item.created_by));
            return user?.nickname || user?.username || String(item.updated_by || item.created_by);
          })(),
        });
      }),
      total,
      page,
      pageSize,
      summary: { total: allCount, active: activeCount, inactive: inactiveCount },
    };
  }
  private goodsOutput(item: any, extra: Record<string, unknown> = {}) {
    return {
      id: item.goods_id,
      orgId: item.org_id,
      queryCode: item.query_code,
      goodsName: item.goods_name,
      goodsImage: item.goods_image,
      shortName: item.short_name,
      brandName: item.brand_name,
      specModels: item.spec_models,
      unitType: item.unit_type,
      categoryId: item.goods_catg_id,
      supplyType: item.supply_type,
      goodsType: item.goods_type,
      costPrice: item.const_price,
      salePrice: item.sale_price,
      vendorId: item.vendor_id,
      warehouseId: item.warehouse_id,
      status: item.status,
      sort: item.sort,
      remark: item.remark,
      freeWarrantyPeriod: item.free_warranty_period,
      isAlertPeriod: item.is_alert_period,
      alertQty: item.alert_aty,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      ...extra,
    };
  }
  async detail(id: string) {
    const item = await this.prisma.hspsi_goods_info.findFirst({
      where: { goods_id: BigInt(id), deleted_at: null },
    });
    if (!item) throw new NotFoundException('商品不存在');
    const [skus, properties] = await Promise.all([
      this.prisma.hspsi_goods_info_sku.findMany({
        where: { good_id: item.goods_id, deleted_at: null },
        orderBy: { sort: 'asc' },
      }),
      this.prisma.hspsi_goods_info_property.findMany({ where: { goods_id: item.goods_id } }),
    ]);
    const [category, vendor, warehouse, organization, unit] = await Promise.all([
      this.prisma.hspsi_goods_info_category.findUnique({
        where: { goods_catg_id: item.goods_catg_id },
      }),
      item.vendor_id
        ? this.prisma.hspsi_basic_vendor.findUnique({ where: { vendor_id: item.vendor_id } })
        : null,
      item.warehouse_id
        ? this.prisma.hspsi_basic_warehouse.findUnique({
            where: { warehouse_id: item.warehouse_id },
          })
        : null,
      this.prisma.hspsi_basic_organization.findUnique({ where: { org_id: item.org_id } }),
      item.unit_type
        ? this.prisma.hspsi_basic_unit.findUnique({ where: { id: BigInt(item.unit_type) } })
        : null,
    ]);
    return {
      ...this.goodsOutput(item, {
        categoryName: category?.goods_name,
        categoryWarehouseType: category?.warehouse_type ?? 0,
        vendorName: vendor?.conpany_name,
        warehouseName: warehouse?.name,
        organizationName: organization?.name,
        unitName: unit?.name,
        skuCount: skus.length,
      }),
      propertyIds: properties.map((property) => property.property_id),
      skus: skus.map((sku) => ({
        id: sku.sku_id,
        specModels: sku.spec_models,
        image: sku.image,
        pcsQty: sku.pcs_qty,
        costPrice: sku.const_price,
        salePrice: sku.sale_price,
        unitType: sku.unit_type,
        isDefault: sku.is_default,
        sort: sku.sort,
        status: sku.status,
        remark: sku.remark,
        freeWarrantyPeriod: sku.free_warranty_period,
        isAlertPeriod: sku.is_alert_period,
        alertQty: sku.alert_aty,
      })),
    };
  }
  private async validate(body: Record<string, any>) {
    if (!String(body.goodsName ?? '').trim()) throw new BadRequestException('商品名称必填');
    const category = await this.prisma.hspsi_goods_info_category.findFirst({
      where: { goods_catg_id: BigInt(String(body.categoryId)), deleted_at: null, status: 1 },
    });
    if (!category) throw new BadRequestException('商品分类无效');
    const childCategoryCount = await this.prisma.hspsi_goods_info_category.count({
      where: { parent_goods_catg_id: category.goods_catg_id, deleted_at: null, status: 1 },
    });
    if (childCategoryCount)
      throw new BadRequestException('商品必须选择叶级分类，不能直接选择包含下级分类的父分类');
    const warehouse = await this.prisma.hspsi_basic_warehouse.findFirst({
      where: {
        warehouse_id: BigInt(String(body.warehouseId)),
        org_id: BigInt(String(body.orgId)),
        deleted_at: null,
        status: 1,
      },
    });
    if (!warehouse || warehouse.warehouse_type !== category.warehouse_type)
      throw new BadRequestException('默认仓库无效或仓库类型与商品分类不一致');
    if (Number(body.supplyType) === 2) {
      const vendor = await this.prisma.hspsi_basic_vendor.findFirst({
        where: { vendor_id: BigInt(String(body.vendorId ?? 0)), deleted_at: null },
      });
      if (!vendor) throw new BadRequestException('外购商品必须选择有效供应商');
    }
    if (Number(body.supplyType) !== 2) body.vendorId = 0;
    if (!Array.isArray(body.skus) || !body.skus.length)
      throw new BadRequestException('至少维护一个 SKU');
  }
  async save(id: string | null, body: Record<string, any>, userId: string) {
    await this.validate(body);
    const now = new Date();
    const data = {
      org_id: BigInt(String(body.orgId)),
      query_code: String(body.queryCode ?? ''),
      goods_name: String(body.goodsName).trim(),
      goods_image: String(body.goodsImage ?? ''),
      short_name: String(body.shortName ?? ''),
      brand_name: String(body.brandName ?? ''),
      spec_models: String(body.specModels ?? ''),
      unit_type: Number(body.unitType ?? 0),
      goods_catg_id: BigInt(String(body.categoryId)),
      supply_type: Number(body.supplyType),
      goods_type: Number(body.goodsType ?? 0),
      const_price: new Prisma.Decimal(String(body.costPrice ?? 0)),
      sale_price: new Prisma.Decimal(String(body.salePrice ?? 0)),
      vendor_id: BigInt(String(body.vendorId ?? 0)),
      warehouse_id: BigInt(String(body.warehouseId)),
      status: Number(body.status ?? 1),
      sort: Number(body.sort ?? 0),
      remark: String(body.remark ?? ''),
      free_warranty_period: Number(body.freeWarrantyPeriod ?? 0),
      is_alert_period: Number(body.isAlertPeriod ?? 0),
      alert_aty: Number(body.alertQty ?? 0),
      updated_by: BigInt(userId),
      updated_at: now,
    };
    return this.prisma.$transaction(async (tx) => {
      const goods = id
        ? await tx.hspsi_goods_info.update({ where: { goods_id: BigInt(id) }, data })
        : await tx.hspsi_goods_info.create({ data: { ...data, created_by: BigInt(userId) } });
      await tx.hspsi_goods_info_property.deleteMany({ where: { goods_id: goods.goods_id } });
      const propertyIds = Array.isArray(body.propertyIds)
        ? body.propertyIds.map((value: unknown) => BigInt(String(value)))
        : [];
      if (propertyIds.length)
        await tx.hspsi_goods_info_property.createMany({
          data: propertyIds.map((propertyId: bigint) => ({
            goods_id: goods.goods_id,
            property_id: propertyId,
          })),
        });
      const retained: bigint[] = [];
      for (const input of body.skus as Record<string, any>[]) {
        const skuData = {
          good_id: goods.goods_id,
          spec_models: String(input.specModels ?? ''),
          image: String(input.image ?? ''),
          pcs_qty: Number(input.pcsQty ?? 0),
          const_price: new Prisma.Decimal(String(input.costPrice ?? 0)),
          sale_price: new Prisma.Decimal(String(input.salePrice ?? 0)),
          unit_type: Number(input.unitType ?? body.unitType ?? 0),
          is_default: Number(input.isDefault ?? 0),
          sort: Number(input.sort ?? 0),
          status: Number(input.status ?? 1),
          remark: String(input.remark ?? ''),
          free_warranty_period: Number(input.freeWarrantyPeriod ?? 0),
          is_alert_period: Number(input.isAlertPeriod ?? 0),
          alert_aty: Number(input.alertQty ?? 0),
          updated_by: BigInt(userId),
          updated_at: now,
        };
        const sku = input.id
          ? await tx.hspsi_goods_info_sku.update({
              where: { sku_id: BigInt(String(input.id)) },
              data: skuData,
            })
          : await tx.hspsi_goods_info_sku.create({
              data: { ...skuData, created_by: BigInt(userId) },
            });
        retained.push(sku.sku_id);
      }
      await tx.hspsi_goods_info_sku.updateMany({
        where: { good_id: goods.goods_id, sku_id: { notIn: retained }, deleted_at: null },
        data: { deleted_at: now, updated_by: BigInt(userId) },
      });
      return { id: goods.goods_id, message: id ? '更新成功' : '创建成功' };
    });
  }
  async remove(id: string, userId: string) {
    const goodsId = BigInt(id);
    const referenced = await this.prisma.hspsi_inventory_total.count({
      where: { goods_id: goodsId, deleted_at: null },
    });
    if (referenced) throw new BadRequestException('商品已有库存记录，不能删除');
    await this.prisma.$transaction([
      this.prisma.hspsi_goods_info.update({
        where: { goods_id: goodsId },
        data: { deleted_at: new Date(), updated_by: BigInt(userId) },
      }),
      this.prisma.hspsi_goods_info_sku.updateMany({
        where: { good_id: goodsId },
        data: { deleted_at: new Date(), updated_by: BigInt(userId) },
      }),
    ]);
    return { id, message: '删除成功' };
  }
  async setStatus(id: string, status: number, userId: string) {
    await this.detail(id);
    await this.prisma.hspsi_goods_info.update({
      where: { goods_id: BigInt(id) },
      data: { status, updated_by: BigInt(userId), updated_at: new Date() },
    });
    return { id, message: status === 1 ? '商品已启用' : '商品已停用' };
  }
  async setCategoryStatus(id: string, status: number, userId: string) {
    await this.prisma.hspsi_goods_info_category.update({
      where: { goods_catg_id: BigInt(id) },
      data: { status, updated_by: BigInt(userId), updated_at: new Date() },
    });
    return { id, message: status === 1 ? '分类已启用' : '分类已停用' };
  }
}
