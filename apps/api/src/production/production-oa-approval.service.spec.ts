import { describe, expect, it, vi } from 'vitest';
import { OA_FORM_MAPPINGS } from '../integrations/xinfutong-oa/form/form-mapping.constants';
import { ProductionOaApprovalService } from './production-oa-approval.service';

describe('ProductionOaApprovalService', () => {
  it('maps a pending production plan and its material table to OA', async () => {
    const production = {
      plan: vi.fn().mockResolvedValue({
        id: 5n,
        orgId: 1n,
        planStatus: 1,
        approveStatus: 0,
        planDate: new Date('2026-08-12'),
        productWarehouseId: 3n,
        warehouseId: 2n,
        bomId: 4n,
        skuId: 8n,
        goodsName: '成品A',
        planQty: 10,
        sourceOrderNo: 'SO1',
        remark: '测试',
        details: [
          {
            goodsName: '原料A',
            skuSpec: '规格A',
            bomUnitQty: 2,
            standardQty: 20,
            quantity: 20,
            planOutQty: 20,
            unitName: '件',
            remark: '',
          },
        ],
      }),
    };
    const prisma = {
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ name: '华溯' }) },
      hspsi_basic_warehouse: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ name: '原料仓' })
          .mockResolvedValueOnce({ name: '成品仓' }),
      },
      hspsi_production_bom: { findFirst: vi.fn().mockResolvedValue({ bom_name: 'BOM-A' }) },
      hspsi_goods_info_sku: { findFirst: vi.fn().mockResolvedValue({ spec_models: '成品规格' }) },
    };
    const starters = {
      resolve: vi.fn().mockResolvedValue({ accountSetId: 1n, starterId: 'U1', starterOrgId: 'O1' }),
    };
    const submissions = { submit: vi.fn().mockResolvedValue({ procStatus: 'RUNNING' }) };
    const mappings = {
      getMapping: vi.fn().mockResolvedValue(OA_FORM_MAPPINGS.production_plan),
    };
    const service = new ProductionOaApprovalService(
      prisma as never,
      production as never,
      starters as never,
      submissions as never,
      mappings as never,
    );

    await service.submitPlan(5n, '9');

    expect(submissions.submit).toHaveBeenCalledOnce();
    const input = submissions.submit.mock.calls[0]![0];
    const fields = OA_FORM_MAPPINGS.production_plan.fields;
    expect(input.businessType).toBe('production_plan');
    expect(input.formData[fields.product.uniqueName]).toBe('成品A');
    expect(input.formData[fields.details.uniqueName][0][fields.materialName.uniqueName]).toBe(
      '原料A',
    );
  });
});
