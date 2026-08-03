import { BadRequestException } from '@nestjs/common';

export type InventoryCheckQuantityResult = {
  inventory: number;
  actual: number;
  damaged: number;
  difference: number;
  quantityBranch: 'shortage' | 'overflow' | null;
  hasDamage: boolean;
};

export function classifyInventoryCheckQuantities(
  inventoryValue: unknown,
  actualValue: unknown,
  damagedValue: unknown,
  goodsName = '商品',
): InventoryCheckQuantityResult {
  const inventory = Number(inventoryValue);
  const actual = Number(actualValue);
  const damaged = Number(damagedValue ?? 0);
  if (!Number.isFinite(actual) || actual < 0)
    throw new BadRequestException(`${goodsName}实盘数量必须为非负数`);
  if (!Number.isFinite(damaged) || damaged < 0)
    throw new BadRequestException(`${goodsName}损坏数量必须为非负数`);
  if (damaged > actual) throw new BadRequestException(`${goodsName}损坏数量不能超过实盘总数`);
  const difference = actual - inventory;
  return {
    inventory,
    actual,
    damaged,
    difference,
    quantityBranch: difference < 0 ? 'shortage' : difference > 0 ? 'overflow' : null,
    hasDamage: damaged > 0,
  };
}

export function parseInventoryLossDisposal(value: unknown, required: boolean): -1 | 0 | 1 {
  const raw = value == null ? '' : String(value).trim();
  if (raw === '0') return 0;
  if (raw === '1') return 1;
  if (!required && (raw === '' || raw === '-1')) return -1;
  throw new BadRequestException('报损出库单提交前必须选择直接报废或折价出售');
}

export function partitionInventoryCheckDetails<T extends Record<string, any>>(details: T[]) {
  return {
    negative: details.filter((detail) => Number(detail.differentQty) < 0),
    positive: details.filter((detail) => Number(detail.differentQty) > 0),
    damaged: details.filter((detail) => Number(detail.damagedQty) > 0),
  };
}

export function splitInventoryDamageDetails<T extends Record<string, any>>(details: T[]): [T][] {
  return details.filter((detail) => Number(detail.damagedQty) > 0).map((detail): [T] => [detail]);
}

export type InventoryDamageLine = {
  goodsId: bigint;
  skuId: bigint;
  batchNo: string;
  unitType: number;
  quantity: number;
  amount: number;
};

export function assertGeneratedDamageLinesUnchanged(
  expected: InventoryDamageLine[],
  actual: InventoryDamageLine[],
) {
  const byKey = (lines: InventoryDamageLine[]) =>
    new Map(lines.map((line) => [`${line.goodsId}:${line.skuId}:${line.batchNo}`, line]));
  const expectedByKey = byKey(expected);
  const actualByKey = byKey(actual);
  if (
    expected.length !== actual.length ||
    expectedByKey.size !== expected.length ||
    actualByKey.size !== actual.length
  ) {
    throw new BadRequestException('盘点生成的报损明细不允许增删或重复');
  }
  for (const [key, source] of expectedByKey) {
    const submitted = actualByKey.get(key);
    if (!submitted) throw new BadRequestException('盘点生成的报损明细不允许更换商品、SKU或批次');
    if (
      submitted.unitType !== source.unitType ||
      Math.abs(submitted.quantity - source.quantity) > 0.000001 ||
      Math.round(submitted.amount * 100) !== Math.round(source.amount * 100)
    ) {
      throw new BadRequestException('盘点生成的报损明细单位、数量和金额不允许修改');
    }
  }
}

export function calculateInventoryCheckProgress(
  lessQty: number,
  overflowQty: number,
  damagedQty: number,
  processedLessQty: number,
  processedOverflowQty: number,
  processedDamageQty: number,
) {
  const total = Math.max(0, lessQty) + Math.max(0, overflowQty) + Math.max(0, damagedQty);
  const processed = Math.min(
    total,
    Math.max(0, processedLessQty) +
      Math.max(0, processedOverflowQty) +
      Math.max(0, processedDamageQty),
  );
  return {
    total,
    processed,
    progressPct: total > 0 ? Math.round((processed * 10000) / total) / 100 : 100,
  };
}
