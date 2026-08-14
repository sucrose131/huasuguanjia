import { describe, expect, it, vi } from 'vitest';
import { PurchaseOaApprovalService } from './purchase-oa-approval.service';

function fixture(existingStatus?: string) {
  const application = {
    pur_id: 7n,
    pur_no: 'PA202608120001',
    org_id: 2n,
    dept_id: 6n,
    warehouse_id: 3n,
    pur_reson: '补充办公耗材',
    source_type: '',
    source_id: 0n,
    remark: '尽快采购',
    status: 1,
    approve_status: 0,
    deleted_at: null,
  };
  const existing = existingStatus
    ? {
        id: 21n,
        business_type: 'purchase_application',
        business_id: 7n,
        form_key: 'AAC15400_NFORM_380054577920868353',
        bus_key: 'purchase_application:7',
        proc_inst_id: 'PROC-7',
        proc_status: existingStatus,
        account_set_id: 1n,
      }
    : null;
  const created = {
    id: 21n,
    business_type: 'purchase_application',
    business_id: 7n,
    form_key: 'AAC15400_NFORM_380054577920868353',
    bus_key: 'purchase_application:7',
    proc_inst_id: '',
    proc_status: 'PENDING_PUSH',
    account_set_id: 1n,
  };
  const tx = {
    $queryRawUnsafe: vi.fn(),
    hspsi_purchase_approve: {
      findFirst: vi.fn().mockResolvedValue({ status: 1, approve_status: 0 }),
    },
    hspsi_oa_approval_instance: {
      findFirst: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue(created),
      update: vi.fn().mockResolvedValue(created),
    },
  };
  const prisma = {
    hspsi_purchase_approve: { findFirst: vi.fn().mockResolvedValue(application) },
    hspsi_purchase_approve_detail: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 70n,
          pur_id: 7n,
          goods_id: 101n,
          sku_id: 201n,
          qty: 5,
          unit_type: 1,
          remark: 'A4纸',
        },
      ]),
    },
    hspsi_basic_warehouse: { findFirst: vi.fn().mockResolvedValue({ name: '办公用品仓' }) },
    hspsi_sys_user: { findFirst: vi.fn().mockResolvedValue({ username: '13800000000' }) },
    hspsi_basic_organization: {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce({ account_set_id: 1n })
        .mockResolvedValue({ outer_ref_id: 'ORG-2' }),
    },
    hspsi_production_plan: { findFirst: vi.fn() },
    hspsi_basic_staff: {
      findFirst: vi.fn().mockResolvedValue({ id: 9n, outer_ref_id: 'MEMBER-9' }),
    },
    hspsi_basic_staff_organizations: {
      findFirst: vi.fn().mockResolvedValue({ id: 1n, org_id: 6n, org_type: 2 }),
    },
    hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ outer_ref_id: 'DEPT-6' }) },
    hspsi_goods_info: {
      findMany: vi.fn().mockResolvedValue([{ goods_id: 101n, goods_name: '复印纸' }]),
    },
    hspsi_goods_info_sku: {
      findMany: vi.fn().mockResolvedValue([{ sku_id: 201n, spec_models: 'A4/80g' }]),
    },
    hspsi_basic_unit: {
      findMany: vi.fn().mockResolvedValue([{ id: 1n, name: '箱' }]),
    },
    hspsi_oa_approval_instance: {
      update: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...created, ...data }),
        ),
    },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const credentials = {
    getById: vi.fn().mockResolvedValue({ id: 1n, name: '华溯集团' }),
  };
  const approval = {
    uploadFile: vi.fn(),
    startFormProcess: vi.fn().mockResolvedValue({
      body: {
        formKey: 'AAC15400_NFORM_380054577920868353',
        busKey: 'purchase_application:7',
        procInstId: 'PROC-7',
        procStatus: 'RUNNING',
      },
    }),
  };
  const attachments = { listForIntegration: vi.fn().mockResolvedValue([]) };
  return {
    service: new PurchaseOaApprovalService(
      prisma as never,
      credentials as never,
      approval as never,
      attachments as never,
    ),
    approval,
  };
}

describe('PurchaseOaApprovalService', () => {
  it('maps and starts a purchase application OA process', async () => {
    const { service, approval } = fixture();

    const result = await service.submit(7n, '5');

    expect(result).toMatchObject({ procStatus: 'RUNNING', procInstId: 'PROC-7' });
    const params = approval.startFormProcess.mock.calls[0]![1];
    expect(params).toMatchObject({
      formKey: 'AAC15400_NFORM_380054577920868353',
      busKey: 'purchase_application:7',
      starterId: 'MEMBER-9',
      starterOrgId: 'DEPT-6',
    });
    expect(JSON.parse(params.formData)).toEqual({
      dhi6d3c7oecn: '补充办公耗材',
      iluym6g473ox: '办公用品仓',
      jg2zwug75y3c: '',
      tp1teg5kd21y: '尽快采购',
      vdd3e94g4ho9: [
        {
          qotb3suzfb82: '复印纸',
          '4a0wvks0vr2o': 'A4/80g',
          fzc9rr3c5a6e: 5,
          '2kq65w37r24o': '箱',
          '8avk96xhktxy': 'A4纸',
        },
      ],
    });
  });

  it('does not start a duplicate active OA process', async () => {
    const { service, approval } = fixture('RUNNING');

    const result = await service.submit(7n, '5');

    expect(result.procStatus).toBe('RUNNING');
    expect(approval.startFormProcess).not.toHaveBeenCalled();
  });
});
