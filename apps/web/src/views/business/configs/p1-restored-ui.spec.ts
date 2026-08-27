import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api', () => ({ api: { get: vi.fn(), delete: vi.fn() } }));
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn() } }));

import { productionInputConfig } from './production-input';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('P1 restored frontend UI contract', () => {
  it('restores the purchase dialogs and their old actions', () => {
    const order = [
      source('../forms/PurchaseOrderForm.vue'),
      source('../../../components/purchase/PurchaseOrderBasicInfo.vue'),
      source('../../../components/purchase/PurchaseOrderPaymentSummary.vue'),
      source('../../../components/purchase/PurchaseOrderDetailsSection.vue'),
      source('../../../components/purchase/PurchaseQuickCatalogDialog.vue'),
    ].join('\n');
    expect(order).toContain('快捷新增商品');
    expect(order).toContain('补充 SKU');
    expect(order).toContain('运输方式');
    expect(order).toContain('物流单号');
    expect(order).toContain('金额与付款');

    const application = source('../forms/PurchaseApplicationForm.vue');
    expect(application).toContain('申请人');
    expect(application).toContain('保存草稿');
    expect(application).toContain('提交审批');

    const purchaseReturn = source('../forms/PurchaseReturnForm.vue');
    expect(purchaseReturn).toContain('供应商');
    expect(purchaseReturn).toContain('退货人');
    expect(purchaseReturn).toContain('保存并提交');

    const payment = source('../forms/PurchasePaymentForm.vue');
    for (const label of ['订单总金额', '累计付款', '累计退款', '净已付款', '付款后剩余', '付款后进度', '付款人']) {
      expect(payment).toContain(label);
    }
  });

  it('restores inventory, requisition and sales dialog fields', () => {
    expect(source('../forms/InventoryAdjustmentForm.vue')).toContain('保存并提交审核');
    const inventoryLoss = source('../forms/InventoryLossForm.vue');
    for (const label of [
      '业务类别',
      '报损类型',
      '报损去向',
      '商品 / SKU / 批次',
      '单位',
      '当前库存',
      '报损数量',
      '单价',
      '金额',
      '批号',
      '合计数量',
      '合计金额',
      '保存草稿',
      '保存并提交审核',
    ]) expect(inventoryLoss).toContain(label);
    expect(source('../configs/inventory-loss.ts')).toContain("title: '报损出库单'");
    expect(source('../configs/inventory-loss-output.ts')).toContain("title: '报亏出库单'");

    const ledger = source('../../../components/inventory/InventoryLedgerDialog.vue');
    for (const label of ['业务模式/单据类型', '批号', '备注']) expect(ledger).toContain(label);
    const stockLedger = source('../InventoryStockPage.vue');
    for (const label of ['业务模式/单据类型', '批号', '备注']) expect(stockLedger).toContain(label);

    const application = source('../forms/RequisitionApplicationForm.vue');
    for (const label of ['单据状态', '审批状态', '审批人', '审批时间', '审批意见']) expect(application).toContain(label);

    const requisitionReturn = source('../forms/RequisitionReturnForm.vue');
    for (const label of ['部门', '退回人', '确认状态', '确认人', '确认时间', '确认意见']) expect(requisitionReturn).toContain(label);

    const service = source('../forms/SalesServiceForm.vue');
    expect(service).toContain('接收时间');
    expect(service).toContain('外部原始申请（只读）');
  });

  it('shows production input deletion only for unconfirmed documents', () => {
    const remove = productionInputConfig.rowActions?.find((item) => item.key === 'delete');
    expect(remove?.show?.({ confirmStatus: 0 })).toBe(true);
    expect(remove?.show?.({ confirmStatus: 1 })).toBe(false);
  });
});
