import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessDocumentContext } from '../business-document-config';

const { apiPost, messageSuccess } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  messageSuccess: vi.fn(),
}));

vi.mock('@/api', () => ({
  api: {
    get: vi.fn(),
    post: apiPost,
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('element-plus', () => ({
  ElMessage: {
    success: messageSuccess,
    warning: vi.fn(),
    error: vi.fn(),
  },
  ElMessageBox: {
    alert: vi.fn(),
    confirm: vi.fn(),
    prompt: vi.fn(),
  },
}));

import { purchaseOrderConfig } from './purchase-order';
import { purchaseReceiptConfig } from './purchase-receipt';

function context(): BusinessDocumentContext {
  return {
    refresh: vi.fn(),
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    openView: vi.fn(),
    navigate: vi.fn(),
  };
}

describe('purchase order receipt flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the generated receipt in the purchase receipt page', async () => {
    apiPost.mockResolvedValue({ id: '901', message: '采购入库单已生成' });
    const ctx = context();
    const action = purchaseOrderConfig.rowActions?.find(
      (item) => item.key === 'generate-receipt',
    );

    expect(action).toBeDefined();
    await action!.handler(
      { id: '123', canGenerateNormalReceipt: true, normalAvailableQuantity: 3 },
      ctx,
    );

    expect(apiPost).toHaveBeenCalledWith('/purchase/orders/123/generate-receipt', {
      inputType: 1,
    });
    expect(ctx.navigate).toHaveBeenCalledWith('/purchase/receipts', { receiptId: '901' });
    expect(messageSuccess).toHaveBeenCalledWith('采购入库单已生成');
  });

  it('generates an exchange receipt only from effective exchange-return quantity', async () => {
    apiPost.mockResolvedValue({ id: '902', message: '采购换货入库单已生成' });
    const ctx = context();
    const action = purchaseOrderConfig.rowActions?.find(
      (item) => item.key === 'generate-exchange-receipt',
    );

    expect(action?.show?.({ canGenerateExchangeReceipt: true, exchangeAvailableQuantity: 2 })).toBe(
      true,
    );
    expect(action?.show?.({ canGenerateExchangeReceipt: false, exchangeAvailableQuantity: 2 })).toBe(
      false,
    );
    await action!.handler({ id: '123' }, ctx);

    expect(apiPost).toHaveBeenCalledWith('/purchase/orders/123/generate-receipt', {
      inputType: 2,
    });
    expect(ctx.navigate).toHaveBeenCalledWith('/purchase/receipts', { receiptId: '902' });
  });

  it('requires pending receipts to enter the form instead of confirming from the list', () => {
    const actions = purchaseReceiptConfig.rowActions ?? [];
    const edit = actions.find((item) => item.key === 'edit');

    expect(actions.some((item) => item.key === 'confirm')).toBe(false);
    expect(edit).toBeDefined();
    expect(typeof edit!.label === 'function' ? edit!.label({ confirmStatus: 0 }) : edit!.label).toBe(
      '办理入库',
    );
  });

  it('does not auto-submit all unarrived quantities from the purchase order config', () => {
    expect(purchaseOrderConfig.rowActions?.some((item) => item.key === 'cancel-pending')).toBe(
      false,
    );
  });
});
