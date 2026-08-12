import { describe, expect, it, vi } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { RequisitionOaApprovalService } from './requisition-oa-approval.service';

function createFixture(options: { existingStatus?: string; startError?: Error } = {}) {
  const application = {
    draw_id: 7n,
    org_id: 2n,
    dept_id: 6n,
    warehouse_id: 3n,
    applicant_id: 9n,
    draw_type: 2,
    draw_date: new Date(2026, 7, 11),
    draw_reason: '项目借用',
    approve_status: 0,
    status: 1,
    deleted_at: null,
  };
  const existing = options.existingStatus
    ? {
        id: 20n,
        business_type: 'requisition_application',
        business_id: 7n,
        form_key: 'form-key',
        bus_key: 'requisition_application:7',
        proc_inst_id: 'PROC-1',
        proc_key: '',
        proc_status: options.existingStatus,
        submitted_by: 5n,
        submitted_at: new Date(),
        callback_count: 0,
        last_callback_at: null,
        account_set_id: 1n,
        created_by: 5n,
        updated_by: 5n,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      }
    : null;
  const created = {
    ...(existing ?? {}),
    id: 21n,
    business_type: 'requisition_application',
    business_id: 7n,
    form_key: 'AAC15400_NFORM_380014832305831937',
    bus_key: 'requisition_application:7',
    proc_inst_id: '',
    proc_key: '',
    proc_status: 'PENDING_PUSH',
    account_set_id: 1n,
  };
  const tx = {
    $queryRawUnsafe: vi.fn(),
    hspsi_draw_approve: { findFirst: vi.fn().mockResolvedValue(application) },
    hspsi_oa_approval_instance: {
      findFirst: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue(created),
      update: vi.fn().mockResolvedValue({ ...created, proc_status: 'PENDING_PUSH' }),
    },
  };
  const prisma = {
    hspsi_draw_approve: { findFirst: vi.fn().mockResolvedValue(application) },
    hspsi_draw_approve_detail: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ draw_detail_id: 70n, draw_id: 7n, goods_id: 101n, draw_qty: 3 }]),
    },
    hspsi_basic_organization: {
      findFirst: vi.fn().mockResolvedValue({ name: '华溯科技', outer_ref_id: 'ORG-2' }),
    },
    hspsi_basic_dept: {
      findFirst: vi.fn().mockResolvedValue({ name: '研发部', outer_ref_id: 'DEPT-6' }),
    },
    hspsi_basic_warehouse: { findFirst: vi.fn().mockResolvedValue({ name: '行政耗材仓' }) },
    hspsi_basic_staff: {
      findFirst: vi.fn().mockResolvedValue({
        id: 9n,
        name: '张三',
        account_set_id: 1n,
        outer_ref_id: 'MEMBER-9',
        out_staff_id: 'STAFF-9',
      }),
    },
    hspsi_sys_dictionary_category: {
      findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 8n }),
    },
    hspsi_basic_staff_organizations: {
      findFirst: vi.fn().mockResolvedValue({ id: 1n, org_id: 6n, org_type: 2, type: 1 }),
    },
    hspsi_sys_dictionary: { findFirst: vi.fn().mockResolvedValue({ dict_name: '借用' }) },
    hspsi_goods_info: {
      findMany: vi.fn().mockResolvedValue([{ goods_id: 101n, goods_name: '办公电脑' }]),
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
  const credentialService = {
    getById: vi
      .fn()
      .mockResolvedValue({ id: 1n, name: '华溯集团', appId: 'app', appSecret: 'secret' }),
  };
  const approvalService = {
    uploadFile: vi.fn(),
    startFormProcess: options.startError
      ? vi.fn().mockRejectedValue(options.startError)
      : vi.fn().mockResolvedValue({
          returnCode: 'SUC0000',
          body: {
            formKey: 'AAC15400_NFORM_380014832305831937',
            busKey: 'requisition_application:7',
            procInstId: 'PROC-7',
            procStatus: 'RUNNING',
          },
        }),
  };
  const attachmentsService = {
    listForIntegration: vi.fn().mockResolvedValue([]),
    downloadToFileForIntegration: vi.fn(),
    cacheOaUpload: vi.fn(),
  };
  return {
    service: new RequisitionOaApprovalService(
      prisma as never,
      credentialService as never,
      approvalService as never,
      attachmentsService as never,
    ),
    prisma,
    tx,
    approvalService,
    attachmentsService,
  };
}

describe('RequisitionOaApprovalService', () => {
  it('maps a submitted requisition to the confirmed OA form controls', async () => {
    const { service, approvalService } = createFixture();

    const result = await service.submit(7n, '5');

    expect(result).toMatchObject({ procStatus: 'RUNNING', procInstId: 'PROC-7' });
    expect(approvalService.startFormProcess).toHaveBeenCalledOnce();
    const params = approvalService.startFormProcess.mock.calls[0]![1];
    expect(params).toMatchObject({
      formKey: 'AAC15400_NFORM_380014832305831937',
      busKey: 'requisition_application:7',
      procStartType: 'trialStart',
      starterId: 'MEMBER-9',
      starterOrgId: 'DEPT-6',
    });
    expect(JSON.parse(params.formData)).toEqual({
      vwzkeepgpoz8: '华溯科技',
      zewg1fv7smsj: '研发部',
      gnhh5hy450ko: '借用',
      '405ncqs7i1t1': '行政耗材仓',
      '51c0cg9xhbzv': [{ USRNAM: '张三', STFSEQ: 'STAFF-9', USRNBR: 'MEMBER-9', ORGSEQ: 'DEPT-6' }],
      ig65sy4c1pr2: '2026-08-11',
      nvm0e6c6sezz: '项目借用',
      '92c4it1x97yp': [{ '6a30y3q8ar2v': '办公电脑', xn9kyuz6yi46: 3 }],
    });
  });

  it('does not start a second OA process when an active instance already exists', async () => {
    const { service, approvalService } = createFixture({ existingStatus: 'RUNNING' });

    const result = await service.submit(7n, '5');

    expect(result).toMatchObject({ procStatus: 'RUNNING', procInstId: 'PROC-1' });
    expect(approvalService.startFormProcess).not.toHaveBeenCalled();
  });

  it('keeps the local application and marks the OA instance failed when push fails', async () => {
    const { service, prisma } = createFixture({ startError: new Error('OA timeout') });

    const result = await service.submit(7n, '5');

    expect(result).toMatchObject({ procStatus: 'PUSH_FAILED', errorMessage: 'OA timeout' });
    expect(prisma.hspsi_oa_approval_instance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ proc_status: 'PUSH_FAILED' }),
      }),
    );
  });

  it('downloads originals, uploads all files to the attachment control, caches OA ids, then clears temp files', async () => {
    const { service, approvalService, attachmentsService } = createFixture();
    const localPaths: string[] = [];
    attachmentsService.listForIntegration.mockResolvedValue([
      {
        id: 'image-1',
        objectKey: 'documents/requisition_application/7/photo.png',
        fileName: '现场.png',
        contentType: 'image/png',
        size: 3,
        uploadedBy: '5',
        uploadedAt: '2026-08-11T00:00:00.000Z',
      },
      {
        id: 'file-1',
        objectKey: 'documents/requisition_application/7/note.pdf',
        fileName: '说明.pdf',
        contentType: 'application/pdf',
        size: 3,
        uploadedBy: '5',
        uploadedAt: '2026-08-11T00:00:00.000Z',
      },
    ]);
    attachmentsService.downloadToFileForIntegration.mockImplementation(
      async (_objectKey: string, localPath: string) => {
        localPaths.push(localPath);
        await writeFile(localPath, Buffer.from('abc'));
      },
    );
    approvalService.uploadFile
      .mockResolvedValueOnce({ body: { fileId: 'OA-IMAGE', objectKey: 'OA-IMAGE-KEY' } })
      .mockResolvedValueOnce({ body: { fileId: 'OA-FILE', objectKey: 'OA-FILE-KEY' } });

    const result = await service.submit(7n, '5');

    expect(result.procStatus).toBe('RUNNING');
    const formData = JSON.parse(approvalService.startFormProcess.mock.calls[0]![1].formData);
    expect(formData['9d9x9fg3tmg4']).toEqual([
      { id: 'OA-IMAGE', objectKey: 'OA-IMAGE-KEY', name: '现场.png' },
      { id: 'OA-FILE', objectKey: 'OA-FILE-KEY', name: '说明.pdf' },
    ]);
    expect(attachmentsService.cacheOaUpload).toHaveBeenCalledTimes(2);
    await Promise.all(localPaths.map((path) => expect(readFile(path)).rejects.toThrow()));
  });
});
