import { describe, expect, it, vi } from 'vitest';
import { OA_FORM_MAPPINGS } from '../integrations/xinfutong-oa/form/form-mapping.constants';
import { SalesOaApprovalService } from './sales-oa-approval.service';

describe('SalesOaApprovalService', () => {
  it('only maps a discount order and resolves product names from master data', async () => {
    const sales = {
      order: vi.fn().mockResolvedValue({
        id: 6n,
        orgId: 1n,
        warehouseId: 2n,
        propertyType: 2,
        approve_status: 0,
        orderDate: new Date('2026-08-12'),
        customerName: '处置客户',
        salesName: '系统自动生成',
        so_qty: 2,
        so_amount: 20,
        fact_amount: 16,
        priceoff_amount: 4,
        businessSourceNo: 'LS1',
        remark: '',
        details: [
          {
            goodsId: 3n,
            skuId: 4n,
            unitType: 5,
            quantity: 2,
            price: 10,
            amount: 20,
            factAmount: 16,
          },
        ],
      }),
    };
    const prisma = {
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ name: '华溯' }) },
      hspsi_basic_warehouse: { findFirst: vi.fn().mockResolvedValue({ name: '深圳仓' }) },
      hspsi_goods_info: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 3n, goods_name: '商品A' }]),
      },
      hspsi_goods_info_sku: {
        findMany: vi.fn().mockResolvedValue([{ sku_id: 4n, spec_models: '规格A' }]),
      },
      hspsi_basic_unit: { findMany: vi.fn().mockResolvedValue([{ id: 5n, name: '件' }]) },
    };
    const starters = {
      resolve: vi.fn().mockResolvedValue({ accountSetId: 1n, starterId: 'U1', starterOrgId: 'O1' }),
    };
    const submissions = { submit: vi.fn().mockResolvedValue({ procStatus: 'RUNNING' }) };
    const service = new SalesOaApprovalService(
      prisma as never,
      sales as never,
      starters as never,
      submissions as never,
    );

    await service.submitDiscountOrder(6n, '9');

    expect(submissions.submit).toHaveBeenCalledOnce();
    const input = submissions.submit.mock.calls[0]![0];
    const fields = OA_FORM_MAPPINGS.sales_order.fields;
    expect(input.businessType).toBe('sales_order');
    expect(input.formData[fields.details.uniqueName][0]).toMatchObject({
      [fields.goodsName.uniqueName]: '商品A',
      [fields.skuName.uniqueName]: '规格A',
      [fields.transactionUnitPrice.uniqueName]: 8,
    });
  });
});
