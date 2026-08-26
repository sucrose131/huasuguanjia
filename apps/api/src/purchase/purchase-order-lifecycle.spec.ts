import { describe, expect, it } from 'vitest';
import { calculatePurchaseOrderLifecycle } from './purchase-order-lifecycle';

const base = {
  started: true,
  orderedQuantity: 100,
  cancelledQuantity: 0,
  confirmedNormalReceiptQuantity: 0,
  pendingNormalReceiptQuantity: 0,
  purchaseReturnQuantity: 0,
  exchangeReturnQuantity: 0,
  confirmedExchangeReceiptQuantity: 0,
  pendingExchangeReceiptQuantity: 0,
  pendingReturnCount: 0,
  remainingPayable: 0,
  openRefundTaskCount: 0,
  unallocatedRefundAmount: 0,
  closedRefundOutstandingAmount: 0,
};

describe('calculatePurchaseOrderLifecycle', () => {
  it('ends a fully cancelled unpaid order and blocks receipt generation', () => {
    const result = calculatePurchaseOrderLifecycle({ ...base, cancelledQuantity: 100 });
    expect(result).toMatchObject({
      status: 6,
      handlingProgress: 100,
      originalArrivalProgress: 0,
      normalAvailableQuantity: 0,
      canGenerateNormalReceipt: false,
      statusProgress: '已结束（全部未到退回）',
    });
  });

  it('ends a partly received order after the remainder is cancelled and money is settled', () => {
    const result = calculatePurchaseOrderLifecycle({
      ...base,
      confirmedNormalReceiptQuantity: 60,
      cancelledQuantity: 40,
    });
    expect(result).toMatchObject({
      status: 6,
      originalArrivalProgress: 60,
      handlingProgress: 100,
      normalRemainingQuantity: 0,
      statusProgress: '已结束（入库 60，未到退回 40）',
    });
  });

  it('keeps a returned order in processing while a refund is open', () => {
    const result = calculatePurchaseOrderLifecycle({
      ...base,
      cancelledQuantity: 100,
      openRefundTaskCount: 1,
      unallocatedRefundAmount: 100,
    });
    expect(result).toMatchObject({ status: 5, financialPending: true });
  });

  it('allows remaining normal receipt after a partial unarrived return', () => {
    const result = calculatePurchaseOrderLifecycle({ ...base, cancelledQuantity: 20 });
    expect(result).toMatchObject({
      status: 5,
      normalAvailableQuantity: 80,
      canGenerateNormalReceipt: true,
      canCancelUnarrived: true,
    });
  });

  it('opens replacement receipt capacity for an approved exchange return', () => {
    const result = calculatePurchaseOrderLifecycle({
      ...base,
      confirmedNormalReceiptQuantity: 100,
      exchangeReturnQuantity: 30,
      confirmedExchangeReceiptQuantity: 10,
    });
    expect(result).toMatchObject({
      status: 5,
      exchangeRemainingQuantity: 20,
      canGenerateNormalReceipt: false,
      canGenerateExchangeReceipt: true,
    });
  });

  it('uses received and financial completion as separate milestones', () => {
    const received = calculatePurchaseOrderLifecycle({
      ...base,
      confirmedNormalReceiptQuantity: 100,
      remainingPayable: 50,
    });
    const complete = calculatePurchaseOrderLifecycle({
      ...base,
      confirmedNormalReceiptQuantity: 100,
    });
    expect(received.status).toBe(4);
    expect(complete.status).toBe(6);
  });

  it('reopens an ended return chain when a refund flow is voided', () => {
    const result = calculatePurchaseOrderLifecycle({
      ...base,
      confirmedNormalReceiptQuantity: 60,
      cancelledQuantity: 40,
      openRefundTaskCount: 1,
      unallocatedRefundAmount: 10,
    });
    expect(result.status).toBe(5);
  });

  it('allows an administratively closed refund to end with an exception label', () => {
    const result = calculatePurchaseOrderLifecycle({
      ...base,
      cancelledQuantity: 100,
      closedRefundOutstandingAmount: 20,
    });
    expect(result).toMatchObject({
      status: 6,
      abnormalRefundClosed: true,
      statusProgress: '已结束（退款任务关闭）',
    });
  });
});
