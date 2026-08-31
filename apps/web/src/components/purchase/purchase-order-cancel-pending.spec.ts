import { describe, expect, it } from 'vitest';
import {
  cancelPendingPayload,
  cancelPendingValidationMessage,
  prepareCancelPendingLines,
  selectedCancelPendingLines,
} from './purchase-order-cancel-pending';

describe('purchase order cancel pending dialog', () => {
  it('only presents lines with a remaining unarrived quantity and starts from zero', () => {
    expect(
      prepareCancelPendingLines([
        { goodsId: '1', remainingQuantity: 3, cancelQuantity: 3 },
        { goodsId: '2', remainingQuantity: 0 },
      ]),
    ).toEqual([{ goodsId: '1', remainingQuantity: 3, cancelQuantity: 0 }]);
  });

  it('requires an explicit quantity instead of returning every remaining line', () => {
    const selected = selectedCancelPendingLines([
      { goodsId: '1', remainingQuantity: 3, cancelQuantity: 0 },
      { goodsId: '2', remainingQuantity: 4, cancelQuantity: 2 },
    ]);

    expect(selected).toHaveLength(1);
    expect(cancelPendingValidationMessage(selected)).toBe('');
    expect(cancelPendingPayload(selected)).toEqual([
      { goodsId: '2', skuId: undefined, cancelQuantity: 2 },
    ]);
  });

  it('blocks empty selection and quantities above the per-line maximum', () => {
    expect(cancelPendingValidationMessage([])).toBe('请至少填写一条退回数量');
    expect(
      cancelPendingValidationMessage([
        { goodsName: '测试商品', remainingQuantity: 2, cancelQuantity: 3 },
      ]),
    ).toBe('商品 测试商品 退回数量超过可退数量');
  });
});
