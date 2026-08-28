import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { productionPlanConfig } from './production-plan';
import { productionShortageConfig } from './production-shortage';

describe('production chain row actions', () => {
  it('shows recheck only for a replenished, unapproved and unexecuted shortage plan', () => {
    const action = (productionPlanConfig.rowActions ?? []).find((item) => item.key === 'recheck');
    expect(
      action?.show?.({
        approveStatus: 0,
        planStatus: 7,
        outboundStatus: 0,
        materialStatus: 4,
      }),
    ).toBe(true);
    expect(
      action?.show?.({
        approveStatus: 0,
        planStatus: 7,
        outboundStatus: 0,
        materialStatus: 3,
      }),
    ).toBe(false);
    expect(
      action?.show?.({
        approveStatus: 1,
        planStatus: 7,
        outboundStatus: 0,
        materialStatus: 4,
      }),
    ).toBe(false);
    expect(
      action?.show?.({
        approveStatus: 0,
        planStatus: 7,
        outboundStatus: 0,
        materialStatus: 4,
        deliveredQty: 1,
      }),
    ).toBe(false);
  });

  it('reuses existing pages to open the linked production plan and purchase application', async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const ctx = { navigate } as never;
    const actions = productionShortageConfig.rowActions ?? [];
    const viewPlan = actions.find((item) => item.key === 'view-plan');
    const viewPurchase = actions.find((item) => item.key === 'view-purchase-application');

    expect(viewPlan?.show?.({ planId: 12 })).toBe(true);
    expect(viewPurchase?.show?.({ purchaseId: 0 })).toBe(false);
    await viewPlan?.handler({ planId: 12 }, ctx);
    await viewPurchase?.handler({ purchaseId: 35 }, ctx);

    expect(navigate).toHaveBeenNthCalledWith(1, '/production/plans', {
      documentId: '12',
      view: '1',
    });
    expect(navigate).toHaveBeenNthCalledWith(2, '/purchase/applications', {
      documentId: '35',
      view: '1',
    });
  });

  it('opens the existing production input form only after material output is completed', async () => {
    const action = (productionPlanConfig.rowActions ?? []).find(
      (item) => item.key === 'create-input',
    );
    const navigate = vi.fn().mockResolvedValue(undefined);

    expect(
      action?.show?.({
        outboundStatus: 2,
        planStatus: 3,
        deliveredQty: 0,
        planQty: 10,
      }),
    ).toBe(true);
    expect(
      action?.show?.({
        outboundStatus: 1,
        planStatus: 3,
        deliveredQty: 0,
        planQty: 10,
      }),
    ).toBe(false);
    expect(
      action?.show?.({
        outboundStatus: 2,
        planStatus: 5,
        deliveredQty: 10,
        planQty: 10,
      }),
    ).toBe(false);

    await action?.handler({ id: 28 }, { navigate } as never);
    expect(navigate).toHaveBeenCalledWith('/production/inputs', {
      create: '1',
      planId: '28',
    });
  });

  it('opens the existing BOM output page only for an approved and stock-ready plan', async () => {
    const action = (productionPlanConfig.rowActions ?? []).find(
      (item) => item.key === 'create-output',
    );
    const navigate = vi.fn().mockResolvedValue(undefined);

    expect(
      action?.show?.({
        approveStatus: 1,
        planStatus: 3,
        stockCheckStatus: 1,
        materialStatus: 4,
        outboundStatus: 0,
      }),
    ).toBe(true);
    expect(
      action?.show?.({
        approveStatus: 1,
        planStatus: 3,
        stockCheckStatus: 0,
        materialStatus: 4,
        outboundStatus: 0,
      }),
    ).toBe(false);

    await action?.handler({ id: 27 }, { navigate } as never);
    expect(navigate).toHaveBeenCalledWith('/production/outputs', {
      planId: '27',
      outType: '1',
    });
  });

  it('keeps BOM batch execution in the existing production output page and dialog', () => {
    const page = readFileSync(new URL('../ProductionOutputPage.vue', import.meta.url), 'utf8');

    expect(page).toContain("key: 'execute-out'");
    expect(page).toContain('Number(row.outType) === 1');
    expect(page).toContain('<ExecuteOutDialog');
  });

  it('keeps production plan status, warehouses and shortage details in the existing form', () => {
    const form = readFileSync(new URL('../forms/ProductionPlanForm.vue', import.meta.url), 'utf8');
    for (const text of [
      '成品仓库',
      '原料仓库',
      '计划状态',
      '物料状态',
      '库存校验',
      '出库状态',
      '审批状态',
      '关联缺料明细',
      'production_shortage_status',
    ]) {
      expect(form).toContain(text);
    }
    const inputForm = readFileSync(
      new URL('../forms/ProductionInputForm.vue', import.meta.url),
      'utf8',
    );
    expect(inputForm).toContain('const initialPlanId = form.value.planId');
    expect(inputForm).toContain('if (form.value.planId) await planChanged()');
  });
});
