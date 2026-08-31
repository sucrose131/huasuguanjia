import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { salesOrderConfig } from './sales-order';

describe('sales order row actions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps only the frequent view and direct-output actions inline', () => {
    const actions = salesOrderConfig.rowActions ?? [];
    const primaryKeys = actions
      .filter((action) => action.primary !== false)
      .map((action) => action.key);
    const moreKeys = actions
      .filter((action) => action.primary === false)
      .map((action) => action.key);

    expect(primaryKeys).toEqual(['view', 'direct-output']);
    expect(moreKeys).toEqual([
      'edit',
      'analyze',
      'receive',
      'refund',
      'return',
      'service',
      'delete',
    ]);
  });

  it('reports production, shortage and purchase results from the existing analyze endpoint', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      message: '已生成 1 张生产计划',
      items: [{ id: 10, created: true, shortage: true, purchaseApplicationId: 20 }],
    } as never);
    const warning = vi.spyOn(ElMessage, 'warning').mockImplementation(() => undefined as never);
    const action = (salesOrderConfig.rowActions ?? []).find((item) => item.key === 'analyze');

    await action?.handler({ id: 8 }, {} as never);

    expect(api.post).toHaveBeenCalledWith('/sales/orders/8/analyze', {});
    expect(warning).toHaveBeenCalledWith(
      '已生成 1 张生产计划；其中 1 张存在原料缺料，已生成 1 张采购申请',
    );
  });

  it('opens the existing sales output form only while an order still has quantity to deliver', async () => {
    const action = (salesOrderConfig.rowActions ?? []).find((item) => item.key === 'direct-output');
    const navigate = vi.fn().mockResolvedValue(undefined);

    expect(action?.show?.({ orderType: 1, orderStatus: 1, quantity: 10, deliveryQty: 6 })).toBe(
      true,
    );
    expect(action?.show?.({ orderType: 1, orderStatus: 1, quantity: 10, deliveryQty: 10 })).toBe(
      false,
    );
    expect(action?.show?.({ orderType: 4, orderStatus: 1, quantity: 10, deliveryQty: 0 })).toBe(
      false,
    );

    await action?.handler({ id: 16 }, { navigate } as never);
    expect(navigate).toHaveBeenCalledWith('/sales/outputs', { orderId: '16' });
  });
});
