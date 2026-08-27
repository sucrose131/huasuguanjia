import { describe, expect, it } from 'vitest';
import {
  SALES_ORDER_TYPE,
  assertDiscountOrderMatchesSource,
  assertDiscountOutputWithinSource,
  calculateDiscountSourceRemaining,
  salesOrderOutputBlockedMessage,
} from './sales-helpers';

describe('discount source matching', () => {
  const makeSource = (goodsId: bigint, skuId: bigint, batchNo: string, quantity: number) => ({
    goodsId,
    skuId,
    batchNo,
    unitType: 1,
    quantity,
  });

  it('accepts order lines that exactly match source', () => {
    const source = [makeSource(1n, 10n, 'B001', 5)];
    const order = [{ goodsId: '1', skuId: '10', unitType: 1, quantity: 5 }];
    expect(() => assertDiscountOrderMatchesSource(source, order)).not.toThrow();
  });

  it('rejects when order has extra goods not in source', () => {
    const source = [makeSource(1n, 10n, 'B001', 5)];
    const order = [
      { goodsId: '1', skuId: '10', unitType: 1, quantity: 5 },
      { goodsId: '2', skuId: '20', unitType: 1, quantity: 1 },
    ];
    expect(() => assertDiscountOrderMatchesSource(source, order)).toThrow(
      '折价销售商品和SKU必须与来源处置单一致',
    );
  });

  it('rejects when order quantity exceeds source', () => {
    const source = [makeSource(1n, 10n, 'B001', 5)];
    const order = [{ goodsId: '1', skuId: '10', unitType: 1, quantity: 6 }];
    expect(() => assertDiscountOrderMatchesSource(source, order)).toThrow(
      '折价销售数量必须等于来源可处置数量',
    );
  });

  it('aggregates quantities across same goods+sku lines in source', () => {
    const source = [makeSource(1n, 10n, 'B001', 3), makeSource(1n, 10n, 'B002', 4)];
    const order = [{ goodsId: '1', skuId: '10', unitType: 1, quantity: 7 }];
    expect(() => assertDiscountOrderMatchesSource(source, order)).not.toThrow();
  });
});

describe('discount output within source', () => {
  const makeSource = (goodsId: bigint, skuId: bigint, batchNo: string, quantity: number) => ({
    goodsId,
    skuId,
    batchNo,
    unitType: 1,
    quantity,
  });

  it('allows output within source batch limits', () => {
    const source = [makeSource(1n, 10n, 'B001', 10)];
    expect(() =>
      assertDiscountOutputWithinSource(
        source,
        [],
        [{ goodsId: 1n, skuId: 10n, batchNo: 'B001', quantity: 5 }],
      ),
    ).not.toThrow();
  });

  it('rejects output exceeding batch remaining after confirmed', () => {
    const source = [makeSource(1n, 10n, 'B001', 10)];
    expect(() =>
      assertDiscountOutputWithinSource(
        source,
        [{ goodsId: 1n, skuId: 10n, batchNo: 'B001', output_qty: 8 }],
        [{ goodsId: 1n, skuId: 10n, batchNo: 'B001', quantity: 5 }],
      ),
    ).toThrow('折价销售出库超过来源批次剩余可处置数量');
  });

  it('rejects output using non-source batch', () => {
    const source = [makeSource(1n, 10n, 'B001', 10)];
    expect(() =>
      assertDiscountOutputWithinSource(
        source,
        [],
        [{ goodsId: 1n, skuId: 10n, batchNo: 'B999', quantity: 1 }],
      ),
    ).toThrow('折价销售出库必须使用来源处置单的商品、SKU和批次');
  });
});

describe('discount source remaining', () => {
  const makeSource = (goodsId: bigint, skuId: bigint, batchNo: string, quantity: number) => ({
    goodsId,
    skuId,
    batchNo,
    unitType: 1,
    quantity,
  });

  it('calculates remaining after partial fulfillment', () => {
    const source = [makeSource(1n, 10n, 'B001', 10)];
    const confirmed = [{ goodsId: 1n, skuId: 10n, batchNo: 'B001', output_qty: 6 }];
    const result = calculateDiscountSourceRemaining(source, confirmed);
    expect(result[0]).toMatchObject({
      batchNo: 'B001',
      quantity: 10,
      confirmedQuantity: 6,
      remainingQuantity: 4,
    });
  });

  it('returns zero remaining when fully fulfilled', () => {
    const source = [makeSource(1n, 10n, 'B001', 10)];
    const confirmed = [
      { goodsId: 1n, skuId: 10n, batchNo: 'B001', output_qty: 5 },
      { goodsId: 1n, skuId: 10n, batchNo: 'B001', output_qty: 5 },
    ];
    const result = calculateDiscountSourceRemaining(source, confirmed);
    expect(result[0]!.remainingQuantity).toBe(0);
  });

  it('handles multiple batches independently', () => {
    const source = [makeSource(1n, 10n, 'B001', 5), makeSource(1n, 10n, 'B002', 5)];
    const confirmed = [{ goodsId: 1n, skuId: 10n, batchNo: 'B001', output_qty: 5 }];
    const result = calculateDiscountSourceRemaining(source, confirmed);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.batchNo === 'B001')!.remainingQuantity).toBe(0);
    expect(result.find((r) => r.batchNo === 'B002')!.remainingQuantity).toBe(5);
  });
});

describe('salesOrderOutputBlockedMessage', () => {
  it('blocks virtual and no-output orders with distinct messages', () => {
    expect(salesOrderOutputBlockedMessage(SALES_ORDER_TYPE.VIRTUAL)).toBe(
      '虚拟订单不能创建实物出库',
    );
    expect(salesOrderOutputBlockedMessage(SALES_ORDER_TYPE.NO_OUTPUT)).toBe(
      '无需出库订单不能创建销售出库',
    );
    expect(salesOrderOutputBlockedMessage(SALES_ORDER_TYPE.PHYSICAL)).toBeNull();
    expect(salesOrderOutputBlockedMessage(SALES_ORDER_TYPE.MIXED)).toBeNull();
  });
});
