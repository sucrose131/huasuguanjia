import { PrismaClient } from '@prisma/client';

process.loadEnvFile?.('.env');
const prisma = new PrismaClient();

type Issue = {
  type: string;
  goodsId: string;
  skuId?: string;
  currentValue: number;
  message: string;
};

async function main() {
  const [goods, skus, totals, batches, ledgerCount] = await Promise.all([
    prisma.hspsi_goods_info.findMany({
      where: { deleted_at: null },
      select: { goods_id: true, goods_name: true, unit_type: true },
    }),
    prisma.hspsi_goods_info_sku.findMany({
      where: { deleted_at: null },
      select: { sku_id: true, good_id: true, spec_models: true, unit_type: true, pcs_qty: true },
    }),
    prisma.hspsi_inventory_total.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        goods_id: true,
        sku_id: true,
        unit_type: true,
        inventory_qty: true,
      },
    }),
    prisma.hspsi_inventory_batch_total.findMany({
      select: {
        goods_id: true,
        sku_id: true,
        warehouse_id: true,
        batch_no: true,
        unit_type: true,
        inventory_qty: true,
      },
    }),
    prisma.hspsi_inventory_total_detail.count(),
  ]);
  const issues: Issue[] = [];
  const goodsById = new Map(goods.map((item) => [String(item.goods_id), item]));
  const skuById = new Map(skus.map((item) => [String(item.sku_id), item]));

  for (const item of goods) {
    if (!Number.isSafeInteger(item.unit_type) || item.unit_type <= 0)
      issues.push({
        type: 'missing_pieces_unit',
        goodsId: String(item.goods_id),
        currentValue: item.unit_type,
        message: `${item.goods_name} 未维护基础 pieces 单位`,
      });
  }
  for (const sku of skus) {
    if (!Number.isSafeInteger(sku.pcs_qty) || sku.pcs_qty <= 0)
      issues.push({
        type: 'invalid_conversion_rate',
        goodsId: String(sku.good_id),
        skuId: String(sku.sku_id),
        currentValue: sku.pcs_qty,
        message: `${sku.spec_models || '默认规格'} 的换算系数不是正整数`,
      });
    if (!Number.isSafeInteger(sku.unit_type) || sku.unit_type <= 0)
      issues.push({
        type: 'missing_document_unit',
        goodsId: String(sku.good_id),
        skuId: String(sku.sku_id),
        currentValue: sku.unit_type,
        message: `${sku.spec_models || '默认规格'} 未维护业务单位`,
      });
  }
  for (const total of totals) {
    const goodsItem = goodsById.get(String(total.goods_id));
    const sku = skuById.get(String(total.sku_id));
    if (!goodsItem || !sku || sku.good_id !== total.goods_id)
      issues.push({
        type: 'orphan_inventory_total',
        goodsId: String(total.goods_id),
        skuId: String(total.sku_id),
        currentValue: total.inventory_qty,
        message: '库存汇总关联不到有效商品或 SKU',
      });
    else if (total.unit_type !== goodsItem.unit_type)
      issues.push({
        type: 'legacy_inventory_unit',
        goodsId: String(total.goods_id),
        skuId: String(total.sku_id),
        currentValue: total.unit_type,
        message: `库存单位 ${total.unit_type} 与基础 pieces 单位 ${goodsItem.unit_type} 不一致`,
      });
  }
  for (const batch of batches) {
    const goodsItem = goodsById.get(String(batch.goods_id));
    const sku = skuById.get(String(batch.sku_id));
    if (!goodsItem || !sku || sku.good_id !== batch.goods_id)
      issues.push({
        type: 'orphan_inventory_batch',
        goodsId: String(batch.goods_id),
        skuId: String(batch.sku_id),
        currentValue: batch.inventory_qty,
        message: `仓库 ${batch.warehouse_id} 批次 ${batch.batch_no || '无批次'} 关联不到有效商品或 SKU`,
      });
    else if (batch.unit_type !== goodsItem.unit_type)
      issues.push({
        type: 'legacy_inventory_batch_unit',
        goodsId: String(batch.goods_id),
        skuId: String(batch.sku_id),
        currentValue: batch.unit_type,
        message: `仓库 ${batch.warehouse_id} 批次 ${batch.batch_no || '无批次'} 的库存单位 ${batch.unit_type} 与基础 pieces 单位 ${goodsItem.unit_type} 不一致`,
      });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      goods: goods.length,
      skus: skus.length,
      inventoryTotals: totals.length,
      inventoryBatches: batches.length,
      inventoryLedgerRows: ledgerCount,
      issueCount: issues.length,
      legacyRowsRequiringMigration: issues.filter((item) =>
        ['legacy_inventory_unit', 'legacy_inventory_batch_unit'].includes(item.type),
      ).length,
    },
    issues,
    note:
      issues.length > 0
        ? '请先补齐单位和换算系数，并确认历史库存单位口径；本脚本不会修改数据。'
        : '基础资料未发现阻断项；仍需在执行历史库存迁移前完成人工抽样确认。',
  };
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
