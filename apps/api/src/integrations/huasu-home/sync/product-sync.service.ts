import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildQueryCodeFromName } from '../../../common/query-code';
import { PrismaService } from '../../../database/prisma.service';
import {
  HUASU_HOME_COMBO_UNIT_NAME,
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_DATA_SOURCE_NAME,
  HUASU_HOME_GOODS_CATEGORY_ID,
  HUASU_HOME_MAPPING_STATUS,
  HUASU_HOME_RULE_STATUS,
  HUASU_HOME_RULE_TYPE,
  HUASU_HOME_SOURCE_TYPE,
} from '../huasu-home.constants';
import { HuasuHomeService } from '../huasu-home.service';
import type {
  HuasuHomePackage,
  HuasuHomePackageSingle,
  HuasuHomeProduct,
  HuasuHomeProductSku,
} from '../huasu-home.types';
import type { HuasuHomeProductSyncStats, SyncedProductRef } from './product-sync.types';

type Tx = Prisma.TransactionClient;

/**
 * 华溯之家商品同步服务
 *
 * 流程：
 * 1. 拉取商品列表（products + packages）
 * 2. 先同步全部单品（含 mapping 双方）与 STANDARD 映射
 * 3. 写入带 mapping 单品的一对一转换规则（rule_type=1）
 * 4. 同步套餐（COMBO 映射 + 唯一 SKU）
 * 5. 写入套餐拆解规则（rule_type=2）
 *
 * 源端停用/删除：仅将 mapping_status 置为已停用，不改平台商品。
 */
@Injectable()
export class HuasuHomeProductSyncService {
  private static readonly logger = new Logger(HuasuHomeProductSyncService.name);
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HuasuHomeService) private readonly huasuHome: HuasuHomeService,
  ) {}

  /**
   * 手动触发全量商品同步
   */
  async syncProducts(userId = '0'): Promise<HuasuHomeProductSyncStats> {
    if (this.running) {
      throw new BadRequestException('华溯商品同步仍在进行，请稍后再试');
    }
    this.running = true;
    try {
      return await this.syncProductsUnlocked(userId);
    } finally {
      this.running = false;
    }
  }

  private async syncProductsUnlocked(userId: string): Promise<HuasuHomeProductSyncStats> {
    const stats = this.emptyStats();
    const data = await this.huasuHome.getProductList();
    const products = data.products ?? [];
    const packages = data.packages ?? [];

    const sourceId = await this.ensureDataSource(userId);
    const unitByName = await this.loadUnitMap();
    const comboUnitType = unitByName.get(HUASU_HOME_COMBO_UNIT_NAME) ?? 0;
    if (comboUnitType === 0) {
      stats.warnings.push(`平台未找到单位「${HUASU_HOME_COMBO_UNIT_NAME}」，套餐 unit_type 将写 0`);
    }

    const productById = new Map(products.map((item) => [item.id, item]));
    const syncedProducts = new Map<number, SyncedProductRef>();
    const operatorId = BigInt(userId);
    const now = new Date();

    await this.prisma.$transaction(
      async (tx) => {
        for (const product of products) {
          await this.syncOneProduct({
            tx,
            product,
            sourceId,
            unitByName,
            operatorId,
            now,
            stats,
            syncedProducts,
          });
        }

        for (const product of products) {
          if (this.isSourceInactive(product) || !product.mapping) continue;
          await this.syncProductMappingRules({
            tx,
            product,
            productById,
            syncedProducts,
            operatorId,
            now,
            stats,
          });
        }

        for (const pkg of packages) {
          await this.syncOnePackage({
            tx,
            pkg,
            syncedProducts,
            sourceId,
            comboUnitType,
            operatorId,
            now,
            stats,
          });
        }
      },
      { timeout: 120_000 },
    );

    HuasuHomeProductSyncService.logger.log(
      `[huasu-home] product sync done: ${JSON.stringify({ ...stats, warnings: stats.warnings.length })}`,
    );
    return stats;
  }

  private emptyStats(): HuasuHomeProductSyncStats {
    return {
      products: { created: 0, updated: 0, mappingOnly: 0, skipped: 0 },
      packages: { created: 0, updated: 0, mappingOnly: 0, skipped: 0 },
      skus: { created: 0, updated: 0 },
      mappings: { upserted: 0, disabled: 0 },
      conversionRules: { upserted: 0 },
      warnings: [],
    };
  }

  private async ensureDataSource(userId: string): Promise<bigint> {
    const existing = await this.prisma.hspsi_sys_data_source.findUnique({
      where: { code: HUASU_HOME_DATA_SOURCE_CODE },
    });
    if (existing) {
      if (existing.deleted_at || existing.status !== 1) {
        throw new BadRequestException('华溯之家数据源已停用或删除，请先在系统中启用');
      }
      return existing.id;
    }
    const created = await this.prisma.hspsi_sys_data_source.create({
      data: {
        code: HUASU_HOME_DATA_SOURCE_CODE,
        name: HUASU_HOME_DATA_SOURCE_NAME,
        status: 1,
        created_by: BigInt(userId),
        updated_by: BigInt(userId),
      },
    });
    return created.id;
  }

  private async loadUnitMap(): Promise<Map<string, number>> {
    const units = await this.prisma.hspsi_basic_unit.findMany({
      where: { deleted_at: null, status: 1 },
      select: { id: true, name: true },
    });
    const map = new Map<string, number>();
    for (const unit of units) {
      const name = unit.name.trim();
      if (!name || map.has(name)) continue;
      map.set(name, Number(unit.id));
    }
    return map;
  }

  private async syncOneProduct(input: {
    tx: Tx;
    product: HuasuHomeProduct;
    sourceId: bigint;
    unitByName: Map<string, number>;
    operatorId: bigint;
    now: Date;
    stats: HuasuHomeProductSyncStats;
    syncedProducts: Map<number, SyncedProductRef>;
  }): Promise<void> {
    const { tx, product, sourceId, unitByName, operatorId, now, stats, syncedProducts } = input;
    const sourceGoodsId = String(product.id);

    if (this.isSourceInactive(product)) {
      const disabled = await this.disableMappings({
        tx,
        sourceId,
        sourceType: HUASU_HOME_SOURCE_TYPE.STANDARD,
        sourceGoodsId,
        operatorId,
        now,
      });
      if (disabled > 0) {
        stats.mappings.disabled += disabled;
        stats.products.mappingOnly += 1;
      } else {
        stats.products.skipped += 1;
      }
      return;
    }

    if (!product.skus?.length) {
      stats.products.skipped += 1;
      stats.warnings.push(`单品 ${product.id} 无 sku，已跳过`);
      return;
    }

    const unitType = this.resolveUnitType(product.unit_str, unitByName);
    const defaultSku = this.pickDefaultSku(product.skus);
    const salePrice = this.toDecimal(defaultSku.discount_price);
    const defaultSpecModels = this.resolveSpecName(defaultSku.name);

    let goodsId = await this.findMappedGoodsId({
      tx,
      sourceId,
      sourceType: HUASU_HOME_SOURCE_TYPE.STANDARD,
      sourceGoodsId,
    });

    const goodsData = {
      org_id: 0n,
      query_code: buildQueryCodeFromName(product.name),
      goods_name: this.clip(product.name, 100),
      goods_image: this.clip(product.cover ?? '', 255),
      spec_models: defaultSpecModels,
      unit_type: unitType,
      goods_catg_id: HUASU_HOME_GOODS_CATEGORY_ID,
      supply_type: 1,
      goods_type: product.type === 1 ? 2 : 1,
      sale_price: salePrice,
      warehouse_id: 0n,
      vendor_id: 0n,
      status: product.status === 1 ? 1 : 0,
      sort: product.sort ?? 0,
      remark: this.clip(product.desc ?? '', 255),
      updated_by: operatorId,
      updated_at: now,
    };

    if (goodsId) {
      await tx.hspsi_goods_info.update({
        where: { goods_id: goodsId },
        data: { ...goodsData, deleted_at: null },
      });
      stats.products.updated += 1;
    } else {
      const goods = await tx.hspsi_goods_info.create({
        data: { ...goodsData, created_by: operatorId, created_at: now },
      });
      goodsId = goods.goods_id;
      stats.products.created += 1;
    }

    const skuIds = new Map<number, bigint>();
    for (const sku of product.skus) {
      const platformSkuId = await this.upsertProductSku({
        tx,
        sourceId,
        sourceGoodsId,
        goodsId,
        sku,
        unitType,
        isDefault: sku.id === defaultSku.id,
        operatorId,
        now,
        stats,
      });
      skuIds.set(sku.id, platformSkuId);
    }

    const defaultSkuId = skuIds.get(defaultSku.id);
    if (!defaultSkuId) {
      stats.warnings.push(`单品 ${product.id} 默认规格写入失败`);
      return;
    }

    syncedProducts.set(product.id, {
      sourceProductId: product.id,
      goodsId,
      skuIds,
      defaultSkuId,
    });
  }

  private async upsertProductSku(input: {
    tx: Tx;
    sourceId: bigint;
    sourceGoodsId: string;
    goodsId: bigint;
    sku: HuasuHomeProductSku;
    unitType: number;
    isDefault: boolean;
    operatorId: bigint;
    now: Date;
    stats: HuasuHomeProductSyncStats;
  }): Promise<bigint> {
    const {
      tx,
      sourceId,
      sourceGoodsId,
      goodsId,
      sku,
      unitType,
      isDefault,
      operatorId,
      now,
      stats,
    } = input;
    const sourceSkuId = String(sku.id);
    const existing = await tx.hspsi_goods_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_type: HUASU_HOME_SOURCE_TYPE.STANDARD,
        source_goods_id: sourceGoodsId,
        source_sku_id: sourceSkuId,
        deleted_at: null,
      },
    });

    const skuData = {
      good_id: goodsId,
      spec_models: this.resolveSpecName(sku.name),
      image: '',
      pcs_qty: Math.max(1, Number(sku.number) || 1),
      const_price: new Prisma.Decimal(0),
      sale_price: this.toDecimal(sku.discount_price),
      unit_type: unitType,
      is_default: isDefault ? 1 : 0,
      sort: sku.sort ?? 0,
      status: sku.status === 1 ? 1 : 0,
      remark: '',
      updated_by: operatorId,
      updated_at: now,
      deleted_at: null,
    };

    let platformSkuId: bigint;
    if (existing?.sku_id && existing.sku_id > 0n) {
      await tx.hspsi_goods_info_sku.update({
        where: { sku_id: existing.sku_id },
        data: skuData,
      });
      platformSkuId = existing.sku_id;
      stats.skus.updated += 1;
    } else {
      const created = await tx.hspsi_goods_info_sku.create({
        data: { ...skuData, created_by: operatorId, created_at: now },
      });
      platformSkuId = created.sku_id;
      stats.skus.created += 1;
    }

    await this.upsertSourceMapping({
      tx,
      sourceId,
      sourceType: HUASU_HOME_SOURCE_TYPE.STANDARD,
      sourceGoodsId,
      sourceSkuId,
      goodsId,
      skuId: platformSkuId,
      mappingStatus: HUASU_HOME_MAPPING_STATUS.MAPPED,
      operatorId,
      now,
      stats,
    });

    return platformSkuId;
  }

  private async syncProductMappingRules(input: {
    tx: Tx;
    product: HuasuHomeProduct;
    productById: Map<number, HuasuHomeProduct>;
    syncedProducts: Map<number, SyncedProductRef>;
    operatorId: bigint;
    now: Date;
    stats: HuasuHomeProductSyncStats;
  }): Promise<void> {
    const { tx, product, productById, syncedProducts, operatorId, now, stats } = input;
    const mapping = product.mapping!;
    const sourceRef = syncedProducts.get(product.id);
    if (!sourceRef) {
      stats.warnings.push(`单品 ${product.id} 未同步成功，跳过 conversion_rule`);
      return;
    }

    const targetProduct = productById.get(mapping.id);
    const targetRef = syncedProducts.get(mapping.id);
    if (!targetProduct || !targetRef) {
      stats.warnings.push(
        `单品 ${product.id} 的 mapping 目标 ${mapping.id} 未在 products 中同步，跳过 conversion_rule`,
      );
      return;
    }

    for (const sku of product.skus) {
      const sourceSkuId = sourceRef.skuIds.get(sku.id);
      if (!sourceSkuId) continue;
      await this.upsertConversionRule({
        tx,
        sourceGoodsId: sourceRef.goodsId,
        sourceSkuId,
        targetGoodsId: targetRef.goodsId,
        targetSkuId: targetRef.defaultSkuId,
        quantityRatio: Math.max(1, Number(sku.number) || 1),
        ruleType: HUASU_HOME_RULE_TYPE.REPLACE,
        operatorId,
        now,
        stats,
      });
    }
  }

  private async syncOnePackage(input: {
    tx: Tx;
    pkg: HuasuHomePackage;
    syncedProducts: Map<number, SyncedProductRef>;
    sourceId: bigint;
    comboUnitType: number;
    operatorId: bigint;
    now: Date;
    stats: HuasuHomeProductSyncStats;
  }): Promise<void> {
    const { tx, pkg, syncedProducts, sourceId, comboUnitType, operatorId, now, stats } = input;
    const sourceGoodsId = String(pkg.id);
    const sourceSkuId = '0';

    if (this.isSourceInactive(pkg)) {
      const disabled = await this.disableMappings({
        tx,
        sourceId,
        sourceType: HUASU_HOME_SOURCE_TYPE.COMBO,
        sourceGoodsId,
        operatorId,
        now,
      });
      if (disabled > 0) {
        stats.mappings.disabled += disabled;
        stats.packages.mappingOnly += 1;
      } else {
        stats.packages.skipped += 1;
      }
      return;
    }

    const salePrice = this.toDecimal(pkg.discount_price);
    const specModels = this.buildPackageSpecName(pkg.singles ?? []);

    let goodsId = await this.findMappedGoodsId({
      tx,
      sourceId,
      sourceType: HUASU_HOME_SOURCE_TYPE.COMBO,
      sourceGoodsId,
    });

    const goodsData = {
      org_id: 0n,
      query_code: buildQueryCodeFromName(pkg.name),
      goods_name: this.clip(pkg.name, 100),
      goods_image: this.clip(pkg.cover ?? '', 255),
      spec_models: specModels,
      unit_type: comboUnitType,
      goods_catg_id: HUASU_HOME_GOODS_CATEGORY_ID,
      supply_type: 1,
      goods_type: pkg.type === 1 ? 2 : 1,
      sale_price: salePrice,
      warehouse_id: 0n,
      vendor_id: 0n,
      status: pkg.status === 1 ? 1 : 0,
      sort: pkg.sort ?? 0,
      remark: this.clip(pkg.desc ?? '', 255),
      updated_by: operatorId,
      updated_at: now,
    };

    if (goodsId) {
      await tx.hspsi_goods_info.update({
        where: { goods_id: goodsId },
        data: { ...goodsData, deleted_at: null },
      });
      stats.packages.updated += 1;
    } else {
      const goods = await tx.hspsi_goods_info.create({
        data: { ...goodsData, created_by: operatorId, created_at: now },
      });
      goodsId = goods.goods_id;
      stats.packages.created += 1;
    }

    const existingMapping = await tx.hspsi_goods_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_type: HUASU_HOME_SOURCE_TYPE.COMBO,
        source_goods_id: sourceGoodsId,
        source_sku_id: sourceSkuId,
        deleted_at: null,
      },
    });

    const skuData = {
      good_id: goodsId,
      spec_models: specModels,
      image: this.clip(pkg.cover ?? '', 255),
      pcs_qty: 1,
      const_price: new Prisma.Decimal(0),
      sale_price: salePrice,
      unit_type: comboUnitType,
      is_default: 1,
      sort: 0,
      status: 1,
      remark: '',
      updated_by: operatorId,
      updated_at: now,
      deleted_at: null,
    };

    let platformSkuId: bigint;
    if (existingMapping?.sku_id && existingMapping.sku_id > 0n) {
      await tx.hspsi_goods_info_sku.update({
        where: { sku_id: existingMapping.sku_id },
        data: skuData,
      });
      platformSkuId = existingMapping.sku_id;
      stats.skus.updated += 1;
    } else {
      const created = await tx.hspsi_goods_info_sku.create({
        data: { ...skuData, created_by: operatorId, created_at: now },
      });
      platformSkuId = created.sku_id;
      stats.skus.created += 1;
    }

    await this.upsertSourceMapping({
      tx,
      sourceId,
      sourceType: HUASU_HOME_SOURCE_TYPE.COMBO,
      sourceGoodsId,
      sourceSkuId,
      goodsId,
      skuId: platformSkuId,
      mappingStatus: HUASU_HOME_MAPPING_STATUS.MAPPED,
      operatorId,
      now,
      stats,
    });

    /** 本轮有效拆解目标，用于清理已移除的 singles */
    const activeTargets = new Set<string>();
    for (const single of pkg.singles ?? []) {
      const target = syncedProducts.get(single.product_id);
      if (!target) {
        stats.warnings.push(
          `套餐 ${pkg.id} 的 singles.product_id=${single.product_id} 未同步，跳过拆解规则`,
        );
        continue;
      }
      const quantityRatio = Math.max(1, Number(single.number || 0) + Number(single.gift_number || 0));
      activeTargets.add(`${target.goodsId}:${target.defaultSkuId}`);
      await this.upsertConversionRule({
        tx,
        sourceGoodsId: goodsId,
        sourceSkuId: platformSkuId,
        targetGoodsId: target.goodsId,
        targetSkuId: target.defaultSkuId,
        quantityRatio,
        ruleType: HUASU_HOME_RULE_TYPE.COMBO_SPLIT,
        operatorId,
        now,
        stats,
      });
    }

    await this.disableStaleComboRules({
      tx,
      sourceGoodsId: goodsId,
      sourceSkuId: platformSkuId,
      activeTargets,
      operatorId,
      now,
    });
  }

  private async findMappedGoodsId(input: {
    tx: Tx;
    sourceId: bigint;
    sourceType: string;
    sourceGoodsId: string;
  }): Promise<bigint | null> {
    const row = await input.tx.hspsi_goods_source_mapping.findFirst({
      where: {
        source_id: input.sourceId,
        source_type: input.sourceType,
        source_goods_id: input.sourceGoodsId,
        deleted_at: null,
        goods_id: { gt: 0 },
      },
      select: { goods_id: true },
      orderBy: { id: 'asc' },
    });
    return row?.goods_id ?? null;
  }

  private async upsertSourceMapping(input: {
    tx: Tx;
    sourceId: bigint;
    sourceType: string;
    sourceGoodsId: string;
    sourceSkuId: string;
    goodsId: bigint;
    skuId: bigint;
    mappingStatus: number;
    operatorId: bigint;
    now: Date;
    stats: HuasuHomeProductSyncStats;
  }): Promise<void> {
    const {
      tx,
      sourceId,
      sourceType,
      sourceGoodsId,
      sourceSkuId,
      goodsId,
      skuId,
      mappingStatus,
      operatorId,
      now,
      stats,
    } = input;

    const existing = await tx.hspsi_goods_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_type: sourceType,
        source_goods_id: sourceGoodsId,
        source_sku_id: sourceSkuId,
      },
    });

    if (existing) {
      await tx.hspsi_goods_source_mapping.update({
        where: { id: existing.id },
        data: {
          goods_id: goodsId,
          sku_id: skuId,
          mapping_status: mappingStatus,
          last_sync_at: now,
          updated_by: operatorId,
          updated_at: now,
          deleted_at: null,
        },
      });
    } else {
      await tx.hspsi_goods_source_mapping.create({
        data: {
          source_id: sourceId,
          source_type: sourceType,
          source_goods_id: sourceGoodsId,
          source_sku_id: sourceSkuId,
          goods_id: goodsId,
          sku_id: skuId,
          mapping_status: mappingStatus,
          last_sync_at: now,
          created_by: operatorId,
          updated_by: operatorId,
          created_at: now,
          updated_at: now,
        },
      });
    }
    stats.mappings.upserted += 1;
  }

  private async disableMappings(input: {
    tx: Tx;
    sourceId: bigint;
    sourceType: string;
    sourceGoodsId: string;
    operatorId: bigint;
    now: Date;
  }): Promise<number> {
    const result = await input.tx.hspsi_goods_source_mapping.updateMany({
      where: {
        source_id: input.sourceId,
        source_type: input.sourceType,
        source_goods_id: input.sourceGoodsId,
        deleted_at: null,
        mapping_status: { not: HUASU_HOME_MAPPING_STATUS.DISABLED },
      },
      data: {
        mapping_status: HUASU_HOME_MAPPING_STATUS.DISABLED,
        last_sync_at: input.now,
        updated_by: input.operatorId,
        updated_at: input.now,
      },
    });
    return result.count;
  }

  /**
   * 停用套餐中已不存在的拆解规则（singles 删减/更换基础单品时）
   */
  private async disableStaleComboRules(input: {
    tx: Tx;
    sourceGoodsId: bigint;
    sourceSkuId: bigint;
    activeTargets: Set<string>;
    operatorId: bigint;
    now: Date;
  }): Promise<void> {
    const existing = await input.tx.hspsi_goods_sku_conversion_rule.findMany({
      where: {
        source_goods_id: input.sourceGoodsId,
        source_sku_id: input.sourceSkuId,
        rule_type: HUASU_HOME_RULE_TYPE.COMBO_SPLIT,
        deleted_at: null,
        status: HUASU_HOME_RULE_STATUS.ENABLED,
      },
      select: {
        id: true,
        target_goods_id: true,
        target_sku_id: true,
      },
    });

    const staleIds = existing
      .filter((row) => !input.activeTargets.has(`${row.target_goods_id}:${row.target_sku_id}`))
      .map((row) => row.id);
    if (!staleIds.length) return;

    await input.tx.hspsi_goods_sku_conversion_rule.updateMany({
      where: { id: { in: staleIds } },
      data: {
        status: HUASU_HOME_RULE_STATUS.DISABLED,
        deleted_at: input.now,
        updated_by: input.operatorId,
        updated_at: input.now,
      },
    });
  }

  private async upsertConversionRule(input: {
    tx: Tx;
    sourceGoodsId: bigint;
    sourceSkuId: bigint;
    targetGoodsId: bigint;
    targetSkuId: bigint;
    quantityRatio: number;
    ruleType: number;
    operatorId: bigint;
    now: Date;
    stats: HuasuHomeProductSyncStats;
  }): Promise<void> {
    const {
      tx,
      sourceGoodsId,
      sourceSkuId,
      targetGoodsId,
      targetSkuId,
      quantityRatio,
      ruleType,
      operatorId,
      now,
      stats,
    } = input;

    const existing = await tx.hspsi_goods_sku_conversion_rule.findFirst({
      where: {
        source_goods_id: sourceGoodsId,
        source_sku_id: sourceSkuId,
        target_goods_id: targetGoodsId,
        target_sku_id: targetSkuId,
      },
    });

    if (existing) {
      await tx.hspsi_goods_sku_conversion_rule.update({
        where: { id: existing.id },
        data: {
          quantity_ratio: quantityRatio,
          rule_type: ruleType,
          status: HUASU_HOME_RULE_STATUS.ENABLED,
          updated_by: operatorId,
          updated_at: now,
          deleted_at: null,
        },
      });
    } else {
      await tx.hspsi_goods_sku_conversion_rule.create({
        data: {
          source_goods_id: sourceGoodsId,
          source_sku_id: sourceSkuId,
          target_goods_id: targetGoodsId,
          target_sku_id: targetSkuId,
          quantity_ratio: quantityRatio,
          rule_type: ruleType,
          status: HUASU_HOME_RULE_STATUS.ENABLED,
          created_by: operatorId,
          updated_by: operatorId,
          created_at: now,
          updated_at: now,
        },
      });
    }
    stats.conversionRules.upserted += 1;
  }

  /** 套餐规格名：直接用 singles[].name 拼接，不查 products */
  private buildPackageSpecName(singles: HuasuHomePackageSingle[]): string {
    if (!singles.length) return '套餐';
    const parts = singles.map((single) => {
      const name = single.name?.trim() || '单品';
      let part = `${name}×${single.number}`;
      if (single.gift_number > 0) part += `+赠${single.gift_number}`;
      return part;
    });
    return this.clip(parts.join('+'), 200);
  }

  /**
   * 选取默认规格：优先 number === 1；若有多个，取列表中第一个；都没有则取列表第一个。
   */
  private pickDefaultSku(skus: HuasuHomeProductSku[]): HuasuHomeProductSku {
    const firstDefault = skus.find((sku) => sku.number === 1);
    // 调用方已保证 skus 非空
    return firstDefault ?? skus[0]!;
  }

  private resolveUnitType(unitStr: string | undefined, unitByName: Map<string, number>): number {
    const name = (unitStr ?? '').trim();
    if (!name) return 0;
    return unitByName.get(name) ?? 0;
  }

  private isSourceInactive(item: { status: number; deleted_at: string | null }): boolean {
    if (Number(item.status) === 0) return true;
    const deletedAt = item.deleted_at;
    if (deletedAt == null) return false;
    const text = String(deletedAt).trim();
    return text !== '' && text.toLowerCase() !== 'null';
  }

  private toDecimal(value: string | number | null | undefined): Prisma.Decimal {
    if (value == null || value === '') return new Prisma.Decimal(0);
    try {
      return new Prisma.Decimal(String(value));
    } catch {
      return new Prisma.Decimal(0);
    }
  }

  /** 规格名为空或仅空白时，与平台手工建档一致，写「默认规格」 */
  private resolveSpecName(name: string | undefined): string {
    return this.clip((name ?? '').trim() || '默认规格', 200);
  }

  private clip(value: string, max: number): string {
    if (!value) return '';
    return value.length <= max ? value : value.slice(0, max);
  }
}
