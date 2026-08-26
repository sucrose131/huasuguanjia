export type PurchaseOrderLifecycleInput = {
  started: boolean;
  orderedQuantity: number;
  cancelledQuantity: number;
  confirmedNormalReceiptQuantity: number;
  pendingNormalReceiptQuantity: number;
  purchaseReturnQuantity: number;
  exchangeReturnQuantity: number;
  confirmedExchangeReceiptQuantity: number;
  pendingExchangeReceiptQuantity: number;
  pendingReturnCount: number;
  remainingPayable: number;
  openRefundTaskCount: number;
  unallocatedRefundAmount: number;
  closedRefundOutstandingAmount: number;
};

export type PurchaseOrderLifecycle = {
  status: 1 | 2 | 3 | 4 | 5 | 6;
  statusProgress: string;
  orderedQuantity: number;
  cancelledQuantity: number;
  confirmedNormalReceiptQuantity: number;
  normalRemainingQuantity: number;
  normalAvailableQuantity: number;
  purchaseReturnQuantity: number;
  exchangeReturnQuantity: number;
  confirmedExchangeReceiptQuantity: number;
  exchangeRemainingQuantity: number;
  exchangeAvailableQuantity: number;
  netRetainedQuantity: number;
  originalArrivalProgress: number;
  handlingProgress: number;
  canGenerateNormalReceipt: boolean;
  canGenerateExchangeReceipt: boolean;
  canCancelUnarrived: boolean;
  financialPending: boolean;
  abnormalRefundClosed: boolean;
};

const quantity = (value: number) => Math.max(0, Number(value) || 0);
const percentage = (part: number, total: number) =>
  total > 0 ? Math.min(100, Math.max(0, Math.round((part / total) * 100))) : 0;

export function calculatePurchaseOrderLifecycle(
  raw: PurchaseOrderLifecycleInput,
): PurchaseOrderLifecycle {
  const orderedQuantity = quantity(raw.orderedQuantity);
  const cancelledQuantity = Math.min(orderedQuantity, quantity(raw.cancelledQuantity));
  const confirmedNormalReceiptQuantity = quantity(raw.confirmedNormalReceiptQuantity);
  const pendingNormalReceiptQuantity = quantity(raw.pendingNormalReceiptQuantity);
  const purchaseReturnQuantity = quantity(raw.purchaseReturnQuantity);
  const exchangeReturnQuantity = quantity(raw.exchangeReturnQuantity);
  const confirmedExchangeReceiptQuantity = quantity(raw.confirmedExchangeReceiptQuantity);
  const pendingExchangeReceiptQuantity = quantity(raw.pendingExchangeReceiptQuantity);
  const normalRemainingQuantity = Math.max(
    0,
    orderedQuantity - cancelledQuantity - confirmedNormalReceiptQuantity,
  );
  const normalAvailableQuantity = Math.max(
    0,
    normalRemainingQuantity - pendingNormalReceiptQuantity,
  );
  const exchangeRemainingQuantity = Math.max(
    0,
    exchangeReturnQuantity - confirmedExchangeReceiptQuantity,
  );
  const exchangeAvailableQuantity = Math.max(
    0,
    exchangeRemainingQuantity - pendingExchangeReceiptQuantity,
  );
  const hasReturnActivity =
    cancelledQuantity > 0 ||
    purchaseReturnQuantity > 0 ||
    exchangeReturnQuantity > 0 ||
    raw.pendingReturnCount > 0;
  const abnormalRefundClosed = quantity(raw.closedRefundOutstandingAmount) > 0;
  const financialPending =
    quantity(raw.remainingPayable) > 0 ||
    raw.openRefundTaskCount > 0 ||
    quantity(raw.unallocatedRefundAmount) > 0;

  let status: PurchaseOrderLifecycle['status'];
  if (!raw.started) status = 1;
  else if (normalRemainingQuantity > 0) {
    if (hasReturnActivity) status = 5;
    else status = confirmedNormalReceiptQuantity > 0 ? 3 : 2;
  } else if (exchangeRemainingQuantity > 0 || raw.pendingReturnCount > 0) status = 5;
  else if (hasReturnActivity && financialPending) status = 5;
  else if (!hasReturnActivity && financialPending) status = 4;
  else status = 6;

  const originalArrivalProgress = percentage(confirmedNormalReceiptQuantity, orderedQuantity);
  const handlingProgress = percentage(
    Math.min(orderedQuantity, confirmedNormalReceiptQuantity + cancelledQuantity),
    orderedQuantity,
  );
  const netRetainedQuantity = Math.max(
    0,
    confirmedNormalReceiptQuantity +
      confirmedExchangeReceiptQuantity -
      purchaseReturnQuantity -
      exchangeReturnQuantity,
  );
  const statusProgress = (() => {
    if (status === 1) return '待开始采购';
    if (exchangeRemainingQuantity > 0) return `换货待入库 ${exchangeRemainingQuantity}`;
    if (normalRemainingQuantity > 0 && cancelledQuantity > 0)
      return `已取消 ${cancelledQuantity}，待入库 ${normalRemainingQuantity}`;
    if (normalRemainingQuantity > 0 && confirmedNormalReceiptQuantity > 0)
      return `已入库 ${confirmedNormalReceiptQuantity}，待入库 ${normalRemainingQuantity}`;
    if (normalRemainingQuantity > 0) return `待入库 ${normalRemainingQuantity}`;
    if (raw.openRefundTaskCount > 0 || quantity(raw.unallocatedRefundAmount) > 0)
      return '数量已处理，退款处理中';
    if (quantity(raw.remainingPayable) > 0) return '数量已处理，待付款';
    if (abnormalRefundClosed) return '已结束（退款任务关闭）';
    if (cancelledQuantity > 0 && confirmedNormalReceiptQuantity > 0)
      return `已结束（入库 ${confirmedNormalReceiptQuantity}，未到退回 ${cancelledQuantity}）`;
    if (cancelledQuantity >= orderedQuantity && orderedQuantity > 0) return '已结束（全部未到退回）';
    if (purchaseReturnQuantity > 0) return `已结束（实物退货 ${purchaseReturnQuantity}）`;
    if (exchangeReturnQuantity > 0) return '已结束（换货完成）';
    return status === 6 ? '已结束' : '已入库';
  })();

  return {
    status,
    statusProgress,
    orderedQuantity,
    cancelledQuantity,
    confirmedNormalReceiptQuantity,
    normalRemainingQuantity,
    normalAvailableQuantity,
    purchaseReturnQuantity,
    exchangeReturnQuantity,
    confirmedExchangeReceiptQuantity,
    exchangeRemainingQuantity,
    exchangeAvailableQuantity,
    netRetainedQuantity,
    originalArrivalProgress,
    handlingProgress,
    canGenerateNormalReceipt: raw.started && status !== 6 && normalAvailableQuantity > 0,
    canGenerateExchangeReceipt: raw.started && status !== 6 && exchangeAvailableQuantity > 0,
    canCancelUnarrived: raw.started && status !== 6 && normalAvailableQuantity > 0,
    financialPending,
    abnormalRefundClosed,
  };
}
