import { BadRequestException } from '@nestjs/common';

export const SALES_ORDER_TYPE = {
  PHYSICAL: 1,
  VIRTUAL: 2,
  MIXED: 3,
  NO_OUTPUT: 4,
} as const;

type Body = Record<string, any>;

export function salesOrderOutputBlockedMessage(soType: number): string | null {
  if (soType === SALES_ORDER_TYPE.VIRTUAL) return '虚拟订单不能创建实物出库';
  if (soType === SALES_ORDER_TYPE.NO_OUTPUT) return '无需出库订单不能创建销售出库';
  return null;
}

export type DiscountSourceLine = {
  goodsId: bigint;
  skuId: bigint;
  batchNo: string;
  unitType: number;
  quantity: number;
};

const discountEntityId = (value: unknown) => {
  try {
    return BigInt(String(value));
  } catch {
    throw new BadRequestException('折价处置商品或SKU无效');
  }
};

const discountBatchKey = (line: Body) =>
  `${discountEntityId(line.goodsId ?? line.goods_id)}:${discountEntityId(line.skuId ?? line.sku_id)}:${String(line.batchNo ?? line.batch_no ?? '')}`;

export const discountGoodsKey = (line: Body) =>
  `${discountEntityId(line.goodsId ?? line.goods_id)}:${discountEntityId(line.skuId ?? line.sku_id)}`;

const sumDiscountLines = (
  lines: Body[],
  keyOf: (line: Body) => string,
  quantityOf: (line: Body) => number,
) => {
  const result = new Map<string, number>();
  for (const line of lines) {
    const quantity = quantityOf(line);
    if (!Number.isSafeInteger(quantity) || quantity <= 0)
      throw new BadRequestException('折价处置数量必须为正整数');
    const key = keyOf(line);
    result.set(key, (result.get(key) ?? 0) + quantity);
  }
  return result;
};

export function assertDiscountOrderMatchesSource(
  sourceLines: DiscountSourceLine[],
  orderLines: Body[],
) {
  const source = sumDiscountLines(sourceLines, discountGoodsKey, (line) => Number(line.quantity));
  const order = sumDiscountLines(orderLines, discountGoodsKey, (line) => Number(line.quantity));
  if (source.size !== order.size)
    throw new BadRequestException('折价销售商品和SKU必须与来源处置单一致');
  for (const [key, quantity] of source) {
    if (!order.has(key)) throw new BadRequestException('折价销售商品和SKU必须与来源处置单一致');
    if (Math.abs(order.get(key)! - quantity) > 0.000001)
      throw new BadRequestException('折价销售数量必须等于来源可处置数量');
  }
}

export function assertDiscountOutputWithinSource(
  sourceLines: DiscountSourceLine[],
  confirmedLines: Body[],
  currentLines: Body[],
) {
  const source = sumDiscountLines(sourceLines, discountBatchKey, (line) => Number(line.quantity));
  const confirmed = sumDiscountLines(confirmedLines, discountBatchKey, (line) =>
    Number(line.quantity ?? line.output_qty),
  );
  const current = sumDiscountLines(currentLines, discountBatchKey, (line) =>
    Number(line.quantity ?? line.output_qty),
  );
  for (const [key, quantity] of current) {
    const allowed = source.get(key);
    if (allowed === undefined)
      throw new BadRequestException('折价销售出库必须使用来源处置单的商品、SKU和批次');
    if ((confirmed.get(key) ?? 0) + quantity > allowed + 0.000001)
      throw new BadRequestException('折价销售出库超过来源批次剩余可处置数量');
  }
}

export function calculateDiscountSourceRemaining(
  sourceLines: DiscountSourceLine[],
  confirmedLines: Body[],
) {
  const aggregated = new Map<string, DiscountSourceLine>();
  for (const line of sourceLines) {
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0)
      throw new BadRequestException('折价处置数量必须为正整数');
    const key = discountBatchKey(line),
      old = aggregated.get(key);
    if (old) old.quantity += quantity;
    else aggregated.set(key, { ...line, quantity });
  }
  const confirmed = sumDiscountLines(confirmedLines, discountBatchKey, (line) =>
    Number(line.quantity ?? line.output_qty),
  );
  return [...aggregated.values()].map((line) => {
    const confirmedQuantity = confirmed.get(discountBatchKey(line)) ?? 0;
    return {
      ...line,
      confirmedQuantity,
      remainingQuantity: Math.max(0, line.quantity - confirmedQuantity),
    };
  });
}
