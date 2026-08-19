import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildQueryCodeFromName } from '../../../common/query-code';
import { PrismaService } from '../../../database/prisma.service';
import {
  SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
  SHIFANG_QINGYUAN_DATA_SOURCE_NAME,
  SHIFANG_QINGYUAN_GOODS_CATEGORY_ID,
  SHIFANG_QINGYUAN_MAPPING_STATUS,
  SHIFANG_QINGYUAN_RULE_STATUS,
  SHIFANG_QINGYUAN_RULE_TYPE,
  SHIFANG_QINGYUAN_SOURCE_TYPE,
} from '../shifang-qingyuan.constants';
import { ShifangQingyuanService } from '../shifang-qingyuan.service';
import type {
  GiveGoodsNum,
  ShifangQingyuanCloudStockGiftPlan,
  ShifangQingyuanCloudStockUpgradeBag,
  ShifangQingyuanGoodsAttr,
  ShifangQingyuanGoodsItem,
} from '../shifang-qingyuan.types';
import type { ShifangQingyuanGoodsSyncStats, SyncedGoodsRef } from './goods-sync.types';

type Tx = Prisma.TransactionClient;

/** 分页拉取每页条数（接口最大 100） */
const PAGE_LIMIT = 100;

/**
 * 将 PHP/接口侧“数组字段”规范成记录数组。
 * 空数组常被编成 `{}`；单条可能是对象；带数字键时是 `{ "0": record }`。
 */
export function asRecordArray<T extends object>(value: unknown): T[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((item): item is T => item != null && typeof item === 'object');
  }
  if (typeof value !== 'object') return [];
  const values = Object.values(value as Record<string, unknown>);
  if (values.length === 0) return [];
  if (values.every((item) => item != null && typeof item === 'object' && !Array.isArray(item))) {
    return values as T[];
  }
  return [value as T];
}

/**
 * 十方清源商品同步服务
 *
 * 流程：
 * 1. 分页拉取全部商品（limit=100，空页/末页退出，循环至拉完）
 * 2. 第一轮：同步所有商品 SPU + SKU + source_mapping
 * 3. 第二轮：处理 gift_plan 和 upgrade_bag 的转换规则（依赖第一轮已同步的商品映射；
 *    方案清空时停用全部旧规则）
 * 4. 第三轮：源端本次未返回的商品仅告警，不停用 mapping / 转换规则，也不下架平台商品
 *
 * source_type 区分：
 * - STANDARD：gift_plan 和 upgrade_bag 均为空，自身出库
 * - MAPPED：有 gift_plan 或 upgrade_bag，按转换规则出库
 *
 * 源端下架/删除：保留平台商品与 mapping，供历史订单解析；不下架、不停用。
 */
@Injectable()
export class ShifangQingyuanGoodsSyncService {
  private static readonly logger = new Logger(ShifangQingyuanGoodsSyncService.name);
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShifangQingyuanService) private readonly shifangQingyuan: ShifangQingyuanService,
  ) {}

  /**
   * 手动触发全量商品同步
   */
  async syncGoods(userId = '0'): Promise<ShifangQingyuanGoodsSyncStats> {
    if (this.running) {
      throw new BadRequestException('十方清源商品同步仍在进行，请稍后再试');
    }
    this.running = true;
    try {
      return await this.syncGoodsUnlocked(userId);
    } finally {
      this.running = false;
    }
  }

  private async syncGoodsUnlocked(userId: string): Promise<ShifangQingyuanGoodsSyncStats> {
    const stats = this.emptyStats();

    // 1. 分页拉取全部商品（空页或不足一页则结束，避免 total 偏大时死循环）
    const allItems: ShifangQingyuanGoodsItem[] = [];
    let page = 1;
    let total = 0;
    for (;;) {
      const data = await this.shifangQingyuan.getGoodsList({ page, limit: PAGE_LIMIT });
      const list = asRecordArray<ShifangQingyuanGoodsItem>(data.list).map((item) =>
        this.normalizeGoodsItem(item),
      );
      allItems.push(...list);
      total = data.pagination?.total ?? 0;
      page++;
      if (!list.length || list.length < PAGE_LIMIT || allItems.length >= total) {
        break;
      }
    }

    ShifangQingyuanGoodsSyncService.logger.log(
      `[shifang-qingyuan] 拉取商品 ${allItems.length} 条（接口 total=${total}）`,
    );

    // 2. 准备同步上下文
    const sourceId = await this.ensureDataSource(userId);
    const unitByName = await this.loadUnitMap();
    const syncedGoods = new Map<number, SyncedGoodsRef>();
    const operatorId = BigInt(userId);
    const now = new Date();

    // 3. 事务内同步
    await this.prisma.$transaction(
      async (tx) => {
        // 第一轮：同步 SPU + SKU + mapping
        for (const item of allItems) {
          await this.syncOneGoods({
            tx,
            item,
            sourceId,
            unitByName,
            operatorId,
            now,
            stats,
            syncedGoods,
          });
        }

        // 第二轮：处理 gift_plan / upgrade_bag 转换规则
        for (const item of allItems) {
          await this.syncConversionRules({
            tx,
            item,
            syncedGoods,
            operatorId,
            now,
            stats,
          });
        }

        // 第三轮：源端本次未返回的商品仅告警（保留平台商品与 mapping，供历史订单使用）
        await this.warnAbsentSourceGoods({
          tx,
          sourceId,
          presentSourceGoodsIds: new Set([...syncedGoods.keys()].map(String)),
          stats,
        });
      },
      { timeout: 120_000 },
    );

    ShifangQingyuanGoodsSyncService.logger.log(
      `[shifang-qingyuan] goods sync done: ${JSON.stringify({ ...stats, warnings: stats.warnings.length })}`,
    );
    return stats;
  }

  private emptyStats(): ShifangQingyuanGoodsSyncStats {
    return {
      goods: { created: 0, updated: 0, mappingOnly: 0, skipped: 0 },
      skus: { created: 0, updated: 0 },
      mappings: { upserted: 0, disabled: 0 },
      conversionRules: { upserted: 0 },
      warnings: [],
    };
  }

  private async ensureDataSource(userId: string): Promise<bigint> {
    const existing = await this.prisma.hspsi_sys_data_source.findUnique({
      where: { code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE },
    });
    if (existing) {
      if (existing.deleted_at || existing.status !== 1) {
        throw new BadRequestException('十方清源数据源已停用或删除，请先在系统中启用');
      }
      return existing.id;
    }
    const created = await this.prisma.hspsi_sys_data_source.create({
      data: {
        code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
        name: SHIFANG_QINGYUAN_DATA_SOURCE_NAME,
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

  /** 同步单个商品 SPU + SKU + mapping */
  private async syncOneGoods(input: {
    tx: Tx;
    item: ShifangQingyuanGoodsItem;
    sourceId: bigint;
    unitByName: Map<string, number>;
    operatorId: bigint;
    now: Date;
    stats: ShifangQingyuanGoodsSyncStats;
    syncedGoods: Map<number, SyncedGoodsRef>;
  }): Promise<void> {
    const { tx, item, sourceId, unitByName, operatorId, now, stats, syncedGoods } = input;
    const goods = item.goods;
    const sourceGoodsId = String(goods.id);

    const inactive = this.isSourceInactive(goods);

    const attrs = asRecordArray<ShifangQingyuanGoodsAttr>(item.qimall_goods_attr);
    if (!attrs.length) {
      stats.goods.skipped += 1;
      stats.warnings.push(`商品 ${goods.id} 无 SKU，已跳过`);
      return;
    }

    const unitType = this.resolveUnitType(goods.unit, unitByName);
    const defaultAttr = this.pickDefaultAttr(attrs);
    const salePrice = this.yuanToDecimal(goods.price);
    const defaultSpecModels = this.resolveSpecName(defaultAttr.name);

    // 判断 source_type
    const hasMapping = this.hasGiftPlan(item) || this.hasUpgradeBag(item);
    const sourceType = hasMapping
      ? SHIFANG_QINGYUAN_SOURCE_TYPE.MAPPED
      : SHIFANG_QINGYUAN_SOURCE_TYPE.STANDARD;

    // 查找已有映射（不区分 source_type，因为可能从 STANDARD 变为 MAPPED）
    let goodsId = await this.findMappedGoodsId({ tx, sourceId, sourceGoodsId });

    const goodsData = {
      org_id: 0n,
      query_code: buildQueryCodeFromName(goods.goods_name),
      goods_name: this.clip(goods.goods_name, 100),
      goods_image: this.clip(goods.cover_pic ?? '', 255),
      spec_models: defaultSpecModels,
      unit_type: unitType,
      goods_catg_id: SHIFANG_QINGYUAN_GOODS_CATEGORY_ID,
      supply_type: 1,
      goods_type: goods.goods_type === 2 ? 2 : 1,
      sale_price: salePrice,
      warehouse_id: 0n,
      vendor_id: 0n,
      // 源端下架不影响平台商品可用性；历史订单仍需能查到商品
      status: 1,
      sort: goods.sort ?? 0,
      remark: this.clip(goods.subtitle ?? '', 255),
      updated_by: operatorId,
      updated_at: now,
    };

    if (goodsId) {
      await tx.hspsi_goods_info.update({
        where: { goods_id: goodsId },
        data: { ...goodsData, deleted_at: null },
      });
      stats.goods.updated += 1;
    } else {
      const created = await tx.hspsi_goods_info.create({
        data: { ...goodsData, created_by: operatorId, created_at: now },
      });
      goodsId = created.goods_id;
      stats.goods.created += 1;
    }

    // 同步 SKU（源端下架仍保持 mapping 可用，供订单解析）
    const skuIds = new Map<number, bigint>();
    for (const attr of attrs) {
      const platformSkuId = await this.upsertGoodsSku({
        tx,
        sourceId,
        sourceType,
        sourceGoodsId,
        goodsId,
        attr,
        unitType,
        isDefault: attr.id === defaultAttr.id,
        mappingStatus: SHIFANG_QINGYUAN_MAPPING_STATUS.MAPPED,
        operatorId,
        now,
        stats,
      });
      skuIds.set(attr.id, platformSkuId);
    }

    const defaultSkuId = skuIds.get(defaultAttr.id);
    if (!defaultSkuId) {
      stats.warnings.push(`商品 ${goods.id} 默认规格写入失败`);
      return;
    }

    // 清理历史冗余的商品级默认映射（source_sku_id='0'）；订单按真实 goods_attr_id 查 SKU 映射
    await this.disableLegacyDefaultMappings({
      tx,
      sourceId,
      sourceGoodsId,
      operatorId,
      now,
      stats,
    });

    // 下架商品：mapping 已创建/更新，但标记为"仅映射"以便统计区分
    if (inactive) {
      stats.goods.mappingOnly += 1;
    }

    syncedGoods.set(goods.id, {
      sourceGoodsId: goods.id,
      goodsId,
      skuIds,
      defaultSkuId,
    });
  }

  /** 同步 gift_plan / upgrade_bag 转换规则 */
  private async syncConversionRules(input: {
    tx: Tx;
    item: ShifangQingyuanGoodsItem;
    syncedGoods: Map<number, SyncedGoodsRef>;
    operatorId: bigint;
    now: Date;
    stats: ShifangQingyuanGoodsSyncStats;
  }): Promise<void> {
    const { tx, item, syncedGoods, operatorId, now, stats } = input;
    const sourceRef = syncedGoods.get(item.goods.id);
    if (!sourceRef) return;

    // 收集所有 give_goods_num 条目；为空时也要清理旧规则（方案删除/全停用）
    const entries = this.collectGiveGoodsNumEntries(item);
    const resolved: Array<{
      targetGoodsId: bigint;
      targetSkuId: bigint;
      quantityRatio: number;
    }> = [];

    for (const { goodsId: targetSourceGoodsId, num } of entries) {
      const targetRef = syncedGoods.get(targetSourceGoodsId);
      if (!targetRef) {
        stats.warnings.push(
          `商品 ${item.goods.id} 的转换目标商品 ${targetSourceGoodsId} 未同步，跳过 conversion_rule`,
        );
        continue;
      }
      resolved.push({
        targetGoodsId: targetRef.goodsId,
        targetSkuId: targetRef.defaultSkuId,
        quantityRatio: Math.max(1, num),
      });
    }

    // 1 个目标 → REPLACE；多个目标 → COMBO_SPLIT（与华溯 rule_type 约定一致）
    const ruleType =
      resolved.length > 1
        ? SHIFANG_QINGYUAN_RULE_TYPE.COMBO_SPLIT
        : SHIFANG_QINGYUAN_RULE_TYPE.REPLACE;
    const activeTargets = new Set<string>();

    for (const row of resolved) {
      activeTargets.add(`${row.targetGoodsId}:${row.targetSkuId}`);
      await this.upsertConversionRule({
        tx,
        sourceGoodsId: sourceRef.goodsId,
        sourceSkuId: sourceRef.defaultSkuId,
        targetGoodsId: row.targetGoodsId,
        targetSkuId: row.targetSkuId,
        quantityRatio: row.quantityRatio,
        ruleType,
        operatorId,
        now,
        stats,
      });
    }

    // 停用已移除的规则（含 entries 为空 → 停用全部旧规则；含 REPLACE↔COMBO_SPLIT 迁移）
    await this.disableStaleRules({
      tx,
      sourceGoodsId: sourceRef.goodsId,
      sourceSkuId: sourceRef.defaultSkuId,
      activeTargets,
      operatorId,
      now,
    });
  }

  /** 从 gift_plan 和 upgrade_bag 中收集所有 {goods_id, num} 条目 */
  private collectGiveGoodsNumEntries(
    item: ShifangQingyuanGoodsItem,
  ): Array<{ goodsId: number; num: number }> {
    const entries: Array<{ goodsId: number; num: number }> = [];

    for (const plan of asRecordArray<ShifangQingyuanCloudStockGiftPlan>(item.cloud_stock_gift_plan)) {
      if (plan.status !== 1) continue;
      entries.push(...this.parseGiveGoodsNum(plan.give_goods_num));
    }

    for (const bag of asRecordArray<ShifangQingyuanCloudStockUpgradeBag>(
      item.cloud_stock_upgrade_bag,
    )) {
      if (bag.status !== 1 || bag.is_enable !== 1) continue;
      entries.push(...this.parseGiveGoodsNum(bag.give_goods_num));
    }

    return entries;
  }

  /**
   * 解析 give_goods_num，兼容两种格式：
   * - 对象格式：{ "商品id": 数量 }
   * - 数组格式：[{ goods_id, num }]
   */
  private parseGiveGoodsNum(data: GiveGoodsNum): Array<{ goodsId: number; num: number }> {
    if (!data) return [];
    if (Array.isArray(data)) {
      return data.map((item) => ({
        goodsId: Number(item.goods_id),
        num: Number(item.num) || 0,
      }));
    }
    // 对象格式：key=商品id, value=数量
    return Object.entries(data).map(([key, value]) => ({
      goodsId: Number(key),
      num: Number(value) || 0,
    }));
  }

  private async upsertGoodsSku(input: {
    tx: Tx;
    sourceId: bigint;
    sourceType: string;
    sourceGoodsId: string;
    goodsId: bigint;
    attr: ShifangQingyuanGoodsAttr;
    unitType: number;
    isDefault: boolean;
    mappingStatus: number;
    operatorId: bigint;
    now: Date;
    stats: ShifangQingyuanGoodsSyncStats;
  }): Promise<bigint> {
    const { tx, sourceId, sourceType, sourceGoodsId, goodsId, attr, unitType, isDefault, mappingStatus, operatorId, now, stats } = input;
    const sourceSkuId = String(attr.id);

    // 查找已有映射（不区分 source_type）
    const existing = await tx.hspsi_goods_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_goods_id: sourceGoodsId,
        source_sku_id: sourceSkuId,
        deleted_at: null,
      },
    });

    const skuData = {
      good_id: goodsId,
      spec_models: this.resolveSpecName(attr.name),
      image: this.clip(attr.pic_url ?? '', 255),
      pcs_qty: 1, // 库存不同步，固定为1
      const_price: this.yuanToDecimal(attr.cost_price),
      sale_price: this.yuanToDecimal(attr.price),
      unit_type: unitType,
      is_default: isDefault ? 1 : 0,
      sort: attr.sort ?? 0,
      status: attr.status === 1 ? 1 : 0,
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

    // 每个 SKU 独立写入 SKU 级 source_mapping（幂等，不区分 source_type）
    await this.upsertSourceMapping({
      tx,
      sourceId,
      sourceType,
      sourceGoodsId,
      sourceSkuId,
      goodsId,
      skuId: platformSkuId,
      mappingStatus,
      operatorId,
      now,
      stats,
    });

    return platformSkuId;
  }

  /** 查找已映射的平台商品ID（不区分 source_type） */
  private async findMappedGoodsId(input: {
    tx: Tx;
    sourceId: bigint;
    sourceGoodsId: string;
  }): Promise<bigint | null> {
    const row = await input.tx.hspsi_goods_source_mapping.findFirst({
      where: {
        source_id: input.sourceId,
        source_goods_id: input.sourceGoodsId,
        deleted_at: null,
        goods_id: { gt: 0 },
      },
      select: { goods_id: true },
      orderBy: { id: 'asc' },
    });
    return row?.goods_id ?? null;
  }

  /** upsert source_mapping（source_type 可能从 STANDARD 变为 MAPPED） */
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
    stats: ShifangQingyuanGoodsSyncStats;
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

    // 查找时不含 source_type（兼容 STANDARD ↔ MAPPED 变更）
    const existing = await tx.hspsi_goods_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_goods_id: sourceGoodsId,
        source_sku_id: sourceSkuId,
      },
    });

    if (existing) {
      await tx.hspsi_goods_source_mapping.update({
        where: { id: existing.id },
        data: {
          source_type: sourceType,
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

  /** 停用历史 source_sku_id='0' 商品级默认映射（已废弃，仅保留真实 attr.id 映射） */
  private async disableLegacyDefaultMappings(input: {
    tx: Tx;
    sourceId: bigint;
    sourceGoodsId: string;
    operatorId: bigint;
    now: Date;
    stats: ShifangQingyuanGoodsSyncStats;
  }): Promise<void> {
    const { tx, sourceId, sourceGoodsId, operatorId, now, stats } = input;
    const result = await tx.hspsi_goods_source_mapping.updateMany({
      where: {
        source_id: sourceId,
        source_goods_id: sourceGoodsId,
        source_sku_id: '0',
        deleted_at: null,
        mapping_status: { not: SHIFANG_QINGYUAN_MAPPING_STATUS.DISABLED },
      },
      data: {
        mapping_status: SHIFANG_QINGYUAN_MAPPING_STATUS.DISABLED,
        last_sync_at: now,
        updated_by: operatorId,
        updated_at: now,
        deleted_at: now,
      },
    });
    stats.mappings.disabled += result.count;
  }

  /**
   * 全量同步收尾：源端本次未出现在成功同步集合中的商品仅告警。
   * 不停用 mapping / 转换规则，也不下架平台商品，避免历史订单找不到商品。
   */
  private async warnAbsentSourceGoods(input: {
    tx: Tx;
    sourceId: bigint;
    presentSourceGoodsIds: Set<string>;
    stats: ShifangQingyuanGoodsSyncStats;
  }): Promise<void> {
    const { tx, sourceId, presentSourceGoodsIds, stats } = input;

    const activeMappings = await tx.hspsi_goods_source_mapping.findMany({
      where: {
        source_id: sourceId,
        deleted_at: null,
        mapping_status: { not: SHIFANG_QINGYUAN_MAPPING_STATUS.DISABLED },
      },
      select: {
        source_goods_id: true,
      },
    });

    const absentSourceIds = [
      ...new Set(
        activeMappings
          .map((row) => row.source_goods_id)
          .filter((sourceGoodsId) => !presentSourceGoodsIds.has(sourceGoodsId)),
      ),
    ];
    if (!absentSourceIds.length) return;

    stats.warnings.push(
      `源端未返回/未同步成功的商品 ${absentSourceIds.length} 个，已保留平台商品与 mapping（供历史订单使用）`,
    );
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
    stats: ShifangQingyuanGoodsSyncStats;
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
          status: SHIFANG_QINGYUAN_RULE_STATUS.ENABLED,
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
          status: SHIFANG_QINGYUAN_RULE_STATUS.ENABLED,
          created_by: operatorId,
          updated_by: operatorId,
          created_at: now,
          updated_at: now,
        },
      });
    }
    stats.conversionRules.upserted += 1;
  }

  /** 停用本轮已移除的转换规则 */
  private async disableStaleRules(input: {
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
        rule_type: {
          in: [
            SHIFANG_QINGYUAN_RULE_TYPE.REPLACE,
            SHIFANG_QINGYUAN_RULE_TYPE.COMBO_SPLIT,
          ],
        },
        deleted_at: null,
        status: SHIFANG_QINGYUAN_RULE_STATUS.ENABLED,
      },
      select: { id: true, target_goods_id: true, target_sku_id: true },
    });

    const staleIds = existing
      .filter((row) => !input.activeTargets.has(`${row.target_goods_id}:${row.target_sku_id}`))
      .map((row) => row.id);
    if (!staleIds.length) return;

    await input.tx.hspsi_goods_sku_conversion_rule.updateMany({
      where: { id: { in: staleIds } },
      data: {
        status: SHIFANG_QINGYUAN_RULE_STATUS.DISABLED,
        deleted_at: input.now,
        updated_by: input.operatorId,
        updated_at: input.now,
      },
    });
  }

  /** 选取默认规格：优先 sort 最小；若都一样取第一个 */
  private pickDefaultAttr(attrs: ShifangQingyuanGoodsAttr[]): ShifangQingyuanGoodsAttr {
    const sorted = [...attrs].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    return sorted[0]!;
  }

  private normalizeGoodsItem(item: ShifangQingyuanGoodsItem): ShifangQingyuanGoodsItem {
    return {
      ...item,
      goods_cate: asRecordArray(item.goods_cate),
      qimall_goods_attr: asRecordArray(item.qimall_goods_attr),
      cloud_stock_gift_plan: asRecordArray(item.cloud_stock_gift_plan),
      cloud_stock_upgrade_bag: asRecordArray(item.cloud_stock_upgrade_bag),
    };
  }

  private hasGiftPlan(item: ShifangQingyuanGoodsItem): boolean {
    return asRecordArray<ShifangQingyuanCloudStockGiftPlan>(item.cloud_stock_gift_plan).some(
      (p) => p.status === 1,
    );
  }

  private hasUpgradeBag(item: ShifangQingyuanGoodsItem): boolean {
    return asRecordArray<ShifangQingyuanCloudStockUpgradeBag>(item.cloud_stock_upgrade_bag).some(
      (b) => b.status === 1 && b.is_enable === 1,
    );
  }

  private resolveUnitType(unitStr: string | undefined, unitByName: Map<string, number>): number {
    const name = (unitStr ?? '').trim();
    if (!name) return 0;
    return unitByName.get(name) ?? 0;
  }

  /** 源端是否下架：is_on_sale=0 或 status!=1 */
  private isSourceInactive(goods: { is_on_sale: number; status: number }): boolean {
    return Number(goods.is_on_sale) !== 1 || Number(goods.status) !== 1;
  }

  /** 元 → Decimal（接口金额已是元，不做 ÷100） */
  private yuanToDecimal(yuan: number | null | undefined): Prisma.Decimal {
    if (yuan == null || isNaN(yuan)) return new Prisma.Decimal(0);
    return new Prisma.Decimal(yuan);
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
