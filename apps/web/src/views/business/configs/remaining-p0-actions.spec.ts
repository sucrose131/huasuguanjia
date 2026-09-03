import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessDocumentContext } from '../business-document-config';

const { apiPost, messageSuccess, messageBoxConfirm } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  messageSuccess: vi.fn(),
  messageBoxConfirm: vi.fn(),
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
    confirm: messageBoxConfirm,
    prompt: vi.fn(),
    alert: vi.fn(),
  },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { id: '9' },
    amountAccess: { canViewAmount: true, canEditAmount: true },
  }),
}));

import {
  confirmPendingSupplement,
  supplementHistoryAction,
} from '@/components/production/supplement-history-actions';
import { productionOutputConfig } from './production-output';
import { purchaseApplicationConfig } from './purchase-application';
import { purchaseOrderConfig } from './purchase-order';
import { requisitionApplicationConfig } from './requisition-application';
import { salesOrderConfig } from './sales-order';

function context(): BusinessDocumentContext {
  return {
    refresh: vi.fn(),
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    openView: vi.fn(),
    navigate: vi.fn(),
  };
}

describe('remaining P0 frontend actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiPost.mockResolvedValue({ message: '操作成功' });
    messageBoxConfirm.mockResolvedValue('confirm');
  });

  it('disables the generic production output create form in favor of the lab dialog entry', () => {
    expect(productionOutputConfig.creatable).toBe(false);
  });

  it('confirms pending supplements and switches confirmed supplements to BOM return', async () => {
    const pending = { id: '31', confirmStatus: 0, remark: '', details: [{ goodsId: '8' }] };

    expect(supplementHistoryAction(pending)).toBe('confirm');
    expect(supplementHistoryAction({ confirmStatus: 1 })).toBe('bom-return');
    await confirmPendingSupplement(pending);

    expect(messageBoxConfirm).toHaveBeenCalledWith(
      '确认后将按补料明细立即扣减库存，是否继续？',
      '确认补料出库',
      { type: 'warning' },
    );
    expect(apiPost).toHaveBeenCalledWith('/production/outputs/31/confirm', {
      comment: '',
      details: pending.details,
    });
    expect(messageSuccess).toHaveBeenCalledWith('临时补料已确认出库');
  });

  it('restores requisition pass and reject states including reverse-generated rejection', async () => {
    const approve = requisitionApplicationConfig.rowActions?.find((item) => item.key === 'approve');
    const reject = requisitionApplicationConfig.rowActions?.find((item) => item.key === 'reject');

    expect(approve?.show?.({ status: 1, approveStatus: 0, oaStatus: '' })).toBe(true);
    expect(approve?.show?.({ status: 1, approveStatus: 0, oaStatus: 'RUNNING' })).toBe(false);
    expect(reject?.show?.({ status: 1, approveStatus: 1, reverseGenerated: true })).toBe(true);

    await approve!.handler({ id: '41' }, context());
    await reject!.handler({ id: '42' }, context());
    expect(apiPost).toHaveBeenNthCalledWith(1, '/requisitions/applications/41/approve', {
      approved: true,
      comment: '',
    });
    expect(apiPost).toHaveBeenNthCalledWith(2, '/requisitions/applications/42/approve', {
      approved: false,
      comment: '',
    });
  });

  it('restores the sales order edit entry with the old status conditions', async () => {
    const edit = salesOrderConfig.rowActions?.find((item) => item.key === 'edit');
    const ctx = context();

    expect(edit?.show?.({ approveStatus: 0, confirmStatus: 0, oaStatus: '' })).toBe(true);
    expect(edit?.show?.({ approveStatus: 1, confirmStatus: 0, oaStatus: '' })).toBe(false);
    expect(edit?.show?.({ approveStatus: 0, confirmStatus: 0, oaStatus: 'RUNNING' })).toBe(false);
    await edit!.handler({ id: '51' }, ctx);
    expect(ctx.openEdit).toHaveBeenCalledWith({ id: '51' });
  });

  it('only exposes the purchase payment entry after the draft order has started', () => {
    const payment = purchaseOrderConfig.rowActions?.find((item) => item.key === 'payment');

    expect(payment?.show?.({ orderStatus: 1, vendorId: 3, remainingPayable: 100 })).toBe(false);
    expect(payment?.show?.({ orderStatus: 2, vendorId: 3, remainingPayable: 100 })).toBe(true);
  });

  it('locks purchase application editing permanently after submission', () => {
    const edit = purchaseApplicationConfig.rowActions?.find((item) => item.key === 'edit');
    const submit = purchaseApplicationConfig.rowActions?.find((item) => item.key === 'submit');
    const withdraw = purchaseApplicationConfig.rowActions?.find((item) => item.key === 'withdraw');
    const terminate = purchaseApplicationConfig.rowActions?.find((item) => item.key === 'terminate');

    expect(edit?.show?.({ status: 0, approveStatus: 0, createdBy: '9' })).toBe(true);
    expect(submit?.show?.({ status: 0, approveStatus: 0, createdBy: '9' })).toBe(true);
    expect(withdraw?.show?.({ status: 0, approveStatus: 0, createdBy: '9' })).toBe(false);
    expect(terminate?.show?.({ status: 0, approveStatus: 0, createdBy: '9' })).toBe(false);
    expect(edit?.show?.({ status: 0, approveStatus: 0, createdBy: '8' })).toBe(false);
    expect(edit?.show?.({ status: 1, approveStatus: 0, createdBy: '9' })).toBe(false);
    expect(edit?.show?.({ status: 1, approveStatus: 2, createdBy: '9' })).toBe(false);
    expect(withdraw?.show?.({ status: 1, approveStatus: 0, createdBy: '9' })).toBe(true);
    expect(withdraw?.show?.({ status: 1, approveStatus: 0, createdBy: '8' })).toBe(false);
    expect(
      withdraw?.show?.({ status: 1, approveStatus: 0, createdBy: '9', sourceType: 'production_plan' }),
    ).toBe(false);
    expect(terminate?.show?.({ status: 1, approveStatus: 0, createdBy: '9' })).toBe(true);
    expect(terminate?.show?.({ status: 1, approveStatus: 0, createdBy: '8' })).toBe(false);
    expect(terminate?.show?.({ status: 1, approveStatus: 1, createdBy: '9' })).toBe(false);
    expect(terminate?.show?.({ status: 1, approveStatus: 3, createdBy: '9' })).toBe(false);
    expect(withdraw?.confirm).toBe('撤回后单据将回到草稿，可修改后重新提交，是否继续？');
    expect(terminate?.confirm).toBe('终止后审批将结束，且不能再编辑提交，是否继续？');
  });
});
