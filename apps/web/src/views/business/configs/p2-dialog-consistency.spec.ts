import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('P2 business dialog interaction contract', () => {
  it('uses mode-prefixed titles while preserving explicitly customized titles', () => {
    const page = source('../BusinessDocumentPage.vue');
    expect(page).toContain("const prefix = { create: '新增', edit: '编辑', view: '查看' }");
    expect(page).toContain('if (props.config.dialogTitle)');
    expect(page).toContain('return `${prefix}${props.config.title}`');
    expect(page).toContain(':title="formDialogTitle"');
  });

  it('provides one explicit close action in view mode', () => {
    const page = source('../BusinessDocumentPage.vue');
    const contract = source('../business-document-config.ts');
    expect(page).toContain("formMode === 'view' && !config.viewCloseInForm");
    expect(page).toContain('<el-button @click="closeForm">关闭</el-button>');
    expect(contract).toContain('viewCloseInForm?: boolean');
  });

  it('uses the business action as the confirmation title and keeps confirm/cancel controls explicit', () => {
    const page = source('../BusinessDocumentPage.vue');
    expect(page).not.toContain("ElMessageBox.confirm(text, '提示'");
    expect(page).toContain("action.confirmTitle || actionLabel || '操作确认'");
    expect(page).toContain("confirmButtonText: action.confirmButtonText ?? '确认'");
    expect(page).toContain("cancelButtonText: action.cancelButtonText ?? '取消'");
  });

  it('retains the dedicated reason-input interactions from the old pages', () => {
    const expected: Array<[string, string]> = [
      ['./inventory-adjustment.ts', '驳回库存调整'],
      ['./inventory-check.ts', '请输入驳回原因'],
      ['./inventory-loss.ts', '请输入驳回原因'],
      ['./inventory-overflow.ts', '请输入驳回原因'],
      ['./inventory-transfer.ts', '请输入驳回原因'],
      ['./production-plan.ts', '驳回生产计划'],
      ['./purchase-application.ts', '驳回采购申请'],
      ['./purchase-return.ts', '请输入驳回原因'],
      ['./purchase-refund.ts', '关闭采购退款任务'],
      ['./sales-discount-order.ts', '驳回折价销售单'],
    ];
    for (const [file, wording] of expected) {
      const content = source(file);
      expect(content).toContain('ElMessageBox.prompt');
      expect(content).toContain(wording);
    }
  });

  it('retains the old purchase payment and refund amount confirmations', () => {
    const payment = source('../forms/PurchasePaymentForm.vue');
    expect(payment).toContain('确认登记本次付款');
    expect(payment).toContain('确认采购付款');
    expect(payment).toContain("confirmButtonText: '确认付款'");

    const refund = source('../forms/PurchaseRefundForm.vue');
    expect(refund).toContain('确认记录本次退款');
    expect(refund).toContain('确认采购退款');
    expect(refund).toContain("confirmButtonText: '确认退款'");
  });

  it('formats list datetime columns in the local timezone instead of slicing UTC ISO', () => {
    const page = source('../BusinessDocumentPage.vue');
    expect(page).toContain('dateTimeText(value)');
    expect(page).not.toContain("String(value).replace('T', ' ').slice(0, 16)");

    const preview = source('../../../components/purchase/PurchaseApplicationOrderPreviewDialog.vue');
    expect(preview).toContain('dateTimeText(scope.row.createdAt)');
  });
});
