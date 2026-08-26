export type CancelPendingLine = Record<string, any> & {
  remainingQuantity?: number;
  cancelQuantity?: number;
};

export function prepareCancelPendingLines(details: CancelPendingLine[]) {
  return details
    .filter((line) => Number(line.remainingQuantity ?? 0) > 0)
    .map((line) => ({ ...line, cancelQuantity: 0 }));
}

export function selectedCancelPendingLines(details: CancelPendingLine[]) {
  return details.filter((line) => Number(line.cancelQuantity) > 0);
}

export function cancelPendingValidationMessage(selected: CancelPendingLine[]) {
  if (!selected.length) return '请至少填写一条退回数量';
  const exceeded = selected.find(
    (line) => Number(line.cancelQuantity) > Number(line.remainingQuantity),
  );
  return exceeded ? `商品 ${exceeded.goodsName} 退回数量超过可退数量` : '';
}

export function cancelPendingPayload(selected: CancelPendingLine[]) {
  return selected.map((line) => ({
    goodsId: line.goodsId,
    skuId: line.skuId,
    cancelQuantity: Number(line.cancelQuantity),
  }));
}
