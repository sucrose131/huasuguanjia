import { describe, expect, it, vi } from 'vitest';
import type { InventoryLine } from '../inventory/inventory-posting.service';
import { RequisitionService } from './requisition.service';

type AggregatePostingLines = (
  orgId: bigint | string | number,
  warehouseId: bigint | string | number,
  lines: InventoryLine[],
) => InventoryLine[];

function aggregatePostingLines(lines: InventoryLine[]) {
  const service = new RequisitionService(
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
  );
  return (
    service as unknown as { aggregatePostingLines: AggregatePostingLines }
  ).aggregatePostingLines(9n, 3n, lines);
}

function serviceWithTransaction(tx: Record<string, any>, root: Record<string, any> = {}) {
  tx.hspsi_oa_approval_instance ??= { findFirst: vi.fn().mockResolvedValue(null) };
  const prisma = {
    ...root,
    $transaction: vi.fn(async (callback: (client: Record<string, any>) => unknown) => callback(tx)),
  };
  const posting = { post: vi.fn() };
  const documentTrace = {
    link: vi.fn(),
    removeForDocument: vi.fn(),
  };
  const attachmentsService = {
    uploadSignatureDataUrlForIntegration: vi.fn(),
    discardUncommittedObjectForIntegration: vi.fn(),
  };
  const todoService = { create: vi.fn().mockResolvedValue({ created: true }) };
  const oaApproval = { submit: vi.fn() };
  return {
    service: new RequisitionService(
      prisma as never,
      posting as never,
      { enrich: vi.fn() } as never,
      documentTrace as never,
      { generate: vi.fn(async (prefix: string) => `${prefix}20260804000001`) } as never,
      oaApproval as never,
      attachmentsService as never,
      { assertGoodsLines: vi.fn() } as never,
      todoService as never,
    ),
    prisma,
    posting,
    documentTrace,
    attachmentsService,
    todoService,
    oaApproval,
  };
}

function expectLockBeforeRead(lock: ReturnType<typeof vi.fn>, read: ReturnType<typeof vi.fn>) {
  expect(lock).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), expect.any(BigInt));
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
    read.mock.invocationCallOrder[0] ?? Infinity,
  );
}

describe('RequisitionService inventory posting line aggregation', () => {
  it('aggregates duplicate goods/SKU/batch/unit integer quantities', () => {
    const lines: InventoryLine[] = [
      { goodsId: 101n, skuId: 201n, batchNo: ' BATCH-01 ', unitType: 1, quantity: '1' },
      { goodsId: 101n, skuId: 201n, batchNo: 'BATCH-01', unitType: 1, quantity: '3' },
    ];

    expect(aggregatePostingLines(lines)).toEqual([
      { goodsId: 101n, skuId: 201n, batchNo: 'BATCH-01', unitType: 1, quantity: 4 },
    ]);
    expect(lines[0]?.batchNo).toBe(' BATCH-01 ');
  });

  it('keeps different batches, units and SKUs as separate posting lines', () => {
    expect(
      aggregatePostingLines([
        { goodsId: 101n, skuId: 201n, batchNo: 'BATCH-01', unitType: 1, quantity: '1' },
        { goodsId: 101n, skuId: 201n, batchNo: 'BATCH-02', unitType: 1, quantity: '2' },
        { goodsId: 101n, skuId: 201n, batchNo: 'BATCH-01', unitType: 2, quantity: '3' },
        { goodsId: 101n, skuId: 202n, batchNo: 'BATCH-01', unitType: 1, quantity: '4' },
      ]),
    ).toHaveLength(4);
  });
});

describe('RequisitionService locked requisition mutations', () => {
  it('stores a new handwritten signature as OSS attachment metadata without database base64', async () => {
    const tx = {
      hspsi_draw_approve: {
        create: vi.fn().mockResolvedValue({ draw_id: 7n }),
      },
      hspsi_draw_approve_detail: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      // 后端兜底：按单据组织解析登录用户OA身份（orgId=1 → 账套1 → staff=9）
      hspsi_basic_organization: {
        findFirst: vi.fn().mockResolvedValue({ account_set_id: 1n }),
      },
      hspsi_sys_user_oa_staff: {
        findFirst: vi.fn().mockResolvedValue({ staff_id: 9n }),
      },
      hspsi_basic_staff: {
        findFirst: vi.fn().mockResolvedValue({ id: 9n, account_set_id: 1n, outer_ref_id: 'M-9', out_staff_id: 'S-9' }),
      },
      hspsi_basic_staff_organizations: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 3n, org_type: 2 }),
      },
    };
    const { service, attachmentsService } = serviceWithTransaction(tx);
    vi.spyOn(service as any, 'validateApplicationReferences').mockResolvedValue(undefined);
    const signature = {
      id: 'signature-1',
      objectKey: 'documents/requisition_application/signatures/signature-1.png',
      fileName: '领用人签名-signature-1.png',
      contentType: 'image/png',
      size: 3,
      uploadedBy: '3',
      uploadedAt: '2026-08-11T00:00:00.000Z',
      category: 'signature',
    };
    attachmentsService.uploadSignatureDataUrlForIntegration.mockResolvedValue(signature);

    await service.saveApplication(
      null,
      {
        orgId: 1,
        warehouseId: 2,
        deptId: 3,
        applicantId: 3,
        drawType: 2,
        reason: '借用测试',
        signatureContent: 'data:image/png;base64,YWJj',
        signedBy: 9,
        details: [{ goodsId: 4, skuId: 5, quantity: 1, returnable: true }],
      },
      '3',
      false,
      '1',
    );

    expect(tx.hspsi_draw_approve.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          signature_content: null,
          signature_attachment: 'signature-1',
          attachments: [signature],
          org_id: 1n,
          applicant_id: 9n,
        }),
      }),
    );
  });

  it('rechecks the application approval state after acquiring the row lock', async () => {
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue({ draw_id: 7n, approve_status: 1 }),
        update: vi.fn(),
      },
    };
    const { service } = serviceWithTransaction(tx);

    await expect(
      service.saveApplication(
        '7',
        {
          details: [{ goodsId: 1, skuId: 2, quantity: 1, returnable: true }],
        },
        '3',
        false,
      ),
    ).rejects.toThrow('已审批申请不可修改');

    expectLockBeforeRead(tx.$queryRawUnsafe, tx.hspsi_draw_approve.findFirst);
    expect(tx.hspsi_draw_approve.update).not.toHaveBeenCalled();
  });

  it('rechecks the locked application before deletion so concurrent approval wins', async () => {
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue({ draw_id: 7n, approve_status: 1 }),
        update: vi.fn(),
      },
      hspsi_draw_approve_output: { count: vi.fn().mockResolvedValue(0) },
      hspsi_draw_approve_output_exit: { count: vi.fn().mockResolvedValue(0) },
    };
    const { service } = serviceWithTransaction(tx);

    await expect(service.deleteApplication('7', '3')).rejects.toThrow('已审批申请不可删除');

    expectLockBeforeRead(tx.$queryRawUnsafe, tx.hspsi_draw_approve.findFirst);
    expect(tx.hspsi_draw_approve.update).not.toHaveBeenCalled();
  });

  it('does not edit an output that became confirmed before the locked recheck', async () => {
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve_output: {
        findFirst: vi.fn().mockResolvedValue({
          draw_output_id: 12n,
          draw_id: 7n,
          comfirm_status: 1,
        }),
        update: vi.fn(),
      },
    };
    const { service } = serviceWithTransaction(tx);

    await expect(
      service.saveOutput(
        '12',
        {
          applicationId: 7,
          details: [{ applicationDetailId: 70, quantity: 1 }],
        },
        '3',
      ),
    ).rejects.toThrow('已确认领用出库单不可编辑');

    expectLockBeforeRead(tx.$queryRawUnsafe, tx.hspsi_draw_approve_output.findFirst);
    expect(tx.hspsi_draw_approve_output.update).not.toHaveBeenCalled();
  });

  it('blocks output editing and deletion when even a draft return exists', async () => {
    const output = {
      draw_output_id: 12n,
      draw_id: 7n,
      comfirm_status: 0,
      auto_created: 0,
    };
    const editTx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve_output: {
        findFirst: vi.fn().mockResolvedValue(output),
        update: vi.fn(),
      },
      hspsi_draw_approve_output_exit: { count: vi.fn().mockResolvedValue(1) },
    };
    const edit = serviceWithTransaction(editTx);

    await expect(
      edit.service.saveOutput(
        '12',
        {
          applicationId: 7,
          details: [{ applicationDetailId: 70, quantity: 1 }],
        },
        '3',
      ),
    ).rejects.toThrow('领用出库单已有退回单，不可编辑');
    expect(editTx.hspsi_draw_approve_output.update).not.toHaveBeenCalled();

    const deleteTx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve_output: {
        findFirst: vi.fn().mockResolvedValue(output),
        update: vi.fn(),
      },
      hspsi_draw_approve_output_exit: { count: vi.fn().mockResolvedValue(1) },
    };
    const deletion = serviceWithTransaction(deleteTx);

    await expect(deletion.service.removeDocument('output', '12', '3')).rejects.toThrow(
      '领用出库单已有退回单，不可删除',
    );
    expect(deleteTx.hspsi_draw_approve_output.update).not.toHaveBeenCalled();
    expect(deletion.documentTrace.removeForDocument).not.toHaveBeenCalled();
  });

  it('blocks output undo when a draft return exists and never reverses inventory', async () => {
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve_output: {
        findFirst: vi.fn().mockResolvedValue({
          draw_output_id: 12n,
          draw_id: 7n,
          comfirm_status: 1,
          posting_version: 1,
        }),
      },
      hspsi_draw_approve_output_exit: { count: vi.fn().mockResolvedValue(1) },
    };
    const { service, posting } = serviceWithTransaction(tx);

    await expect(service.undoConfirmOutput('12', '3')).rejects.toThrow('已有领用退回单，不可撤销');

    expect(tx.hspsi_draw_approve_output_exit.count).toHaveBeenCalledWith({
      where: { draw_output_id: 12n, deleted_at: null },
    });
    expect(posting.post).not.toHaveBeenCalled();
  });

  it('uses locked transactional usage when enforcing output quantity', async () => {
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue({
          draw_id: 7n,
          approve_status: 1,
          applicant_id: 3n,
        }),
      },
      hspsi_draw_approve_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            draw_detail_id: 70n,
            goods_id: 1n,
            sku_id: 2n,
            draw_qty: '5',
            batch_no: '',
            unit_type: 1,
            is_returnable: 1,
            remark: '',
          },
        ]),
      },
      hspsi_draw_approve_output: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{ draw_output_id: 11n }]),
        create: vi.fn(),
      },
      hspsi_draw_approve_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            draw_detail_id: 70n,
            goods_id: 1n,
            sku_id: 2n,
            fact_draw_qty: '4',
          },
        ]),
      },
    };
    const root = {
      hspsi_draw_approve_output: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const { service } = serviceWithTransaction(tx, root);

    await expect(
      service.saveOutput(
        null,
        {
          applicationId: 7,
          details: [{ applicationDetailId: 70, quantity: 2 }],
        },
        '3',
      ),
    ).rejects.toThrow('本次领用超过申请剩余数量');

    expect(tx.hspsi_draw_approve_output.findMany).toHaveBeenCalled();
    expect(tx.hspsi_draw_approve_output.create).not.toHaveBeenCalled();
  });

  it('rechecks the locked source output and transactional usage when saving a return', async () => {
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve_output: {
        findFirst: vi.fn().mockResolvedValue({
          draw_output_id: 12n,
          draw_id: 7n,
          comfirm_status: 1,
        }),
      },
      hspsi_draw_approve_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            output_detail_id: 120n,
            goods_id: 1n,
            sku_id: 2n,
            batch_no: 'B1',
            unit_type: 1,
            fact_draw_qty: '5',
            is_returnable: 1,
          },
        ]),
      },
      hspsi_draw_approve_output_exit: {
        findMany: vi.fn().mockResolvedValue([{ draw_exit_id: 20n }]),
        create: vi.fn(),
      },
      hspsi_draw_approve_output_exit_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            draw_output_detail_id: 120n,
            exit_qty: '4',
          },
        ]),
      },
    };
    const { service } = serviceWithTransaction(tx);

    await expect(
      service.saveReturn(
        null,
        {
          outputId: 12,
          reason: '归还',
          details: [{ outputDetailId: 120, quantity: 2 }],
        },
        '3',
      ),
    ).rejects.toThrow('退回数量超过来源出库单可退数量');

    expectLockBeforeRead(tx.$queryRawUnsafe, tx.hspsi_draw_approve_output.findFirst);
    expect(tx.hspsi_draw_approve_output_exit.create).not.toHaveBeenCalled();
  });
});

describe('RequisitionService direct output reverse workflow', () => {
  it('posts inventory and creates an approved reverse application atomically', async () => {
    const tx = {
      hspsi_draw_approve_output: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ draw_output_id: 12n }),
        update: vi.fn(),
      },
      hspsi_draw_approve: {
        create: vi.fn().mockResolvedValue({ draw_id: 7n }),
      },
      hspsi_draw_approve_detail: {
        create: vi.fn().mockResolvedValue({ draw_detail_id: 70n }),
      },
      hspsi_draw_approve_output_detail: { createMany: vi.fn() },
    };
    const { service, posting, documentTrace } = serviceWithTransaction(tx);
    vi.spyOn(service as any, 'validateApplicationReferences').mockResolvedValue(undefined);

    const result = await service.saveOutput(
      null,
      {
        directOutput: true,
        requestKey: 'direct-test-0001',
        orgId: 1,
        warehouseId: 2,
        deptId: 3,
        receiverId: 4,
        details: [{ goodsId: 5, skuId: 6, batchNo: 'PH20260807', unitType: 1, quantity: 2 }],
      },
      '9',
    );

    expect(result).toMatchObject({ id: 12n, applicationId: 7n });
    expect(tx.hspsi_draw_approve.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approve_status: 1, fact_draw_qty: 2, draw_type: 2 }),
      }),
    );
    expect(posting.post).toHaveBeenCalledWith(
      expect.objectContaining({ direction: -1, sourceType: 'requisition_output' }),
      tx,
    );
    expect(documentTrace.link).toHaveBeenCalledWith(
      expect.objectContaining({ relationKind: 'reverse_generated' }),
      tx,
    );
  });

  it('rejects only the reverse application and idempotently creates a draft return', async () => {
    const application = { draw_id: 7n, draw_no: 'RA1', approve_status: 1, status: 1 };
    const output = {
      draw_output_id: 12n,
      draw_output_no: 'RO1',
      draw_id: 7n,
      org_id: 1n,
      warehouse_id: 2n,
      dept_id: 3n,
      receiver_id: 4n,
      comfirm_status: 1,
    };
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue(application),
        update: vi.fn(),
      },
      hspsi_draw_approve_output: { findFirst: vi.fn().mockResolvedValue(output) },
      hspsi_draw_approve_output_exit: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ draw_exit_id: 20n }),
      },
      hspsi_draw_approve_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            output_detail_id: 120n,
            goods_id: 5n,
            sku_id: 6n,
            batch_no: 'PH20260807',
            unit_type: 1,
            fact_draw_qty: 2,
            is_returnable: 1,
          },
        ]),
      },
      hspsi_draw_approve_output_exit_detail: { createMany: vi.fn() },
    };
    const { service, posting } = serviceWithTransaction(tx);

    const result = await service.approve('7', false, 'OA否决', '9');

    expect(result).toMatchObject({ outputId: 12n, returnId: 20n });
    expect(tx.hspsi_draw_approve.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ approve_status: 2, status: 0 }) }),
    );
    expect(tx.hspsi_draw_approve_output_exit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ comfirm_status: 0, exit_qty: 2 }),
      }),
    );
    expect(posting.post).not.toHaveBeenCalled();
  });
});

describe('RequisitionService OA callback result handling', () => {
  it('updates a requisition from an OA rejection and records the callback', async () => {
    const instance = {
      id: 31n,
      business_type: 'requisition_application',
      business_id: 7n,
      bus_key: 'requisition_application:7',
      proc_inst_id: 'PROC-7',
      proc_status: 'RUNNING',
      account_set_id: 1n,
    };
    const application = { draw_id: 7n, approve_status: 0, status: 1 };
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_oa_approval_instance: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUniqueOrThrow: vi.fn().mockResolvedValue(instance),
        update: vi.fn(),
      },
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue(application),
        update: vi.fn(),
      },
      hspsi_oa_approval_callback_log: { update: vi.fn() },
    };
    const { service } = serviceWithTransaction(tx, {
      hspsi_oa_approval_instance: { findFirst: vi.fn().mockResolvedValue(instance) },
    });
    const payload = {
      prjCod: 'PRJ-1',
      procStatus: 'REJECTED' as const,
      busKey: 'requisition_application:7',
      procInstId: 'PROC-7',
      procKey: 'PROC-KEY',
      formKey: 'PROC-KEY',
    };

    const result = await service.handleOaApprovalResult(payload, payload, 99n);

    expect(result).toMatchObject({ processed: true, duplicate: false, procStatus: 'REJECTED' });
    expect(tx.hspsi_draw_approve.update).toHaveBeenCalledWith({
      where: { draw_id: 7n },
      data: expect.objectContaining({
        approve_status: 2,
        approve_comment: 'OA审批驳回',
        approve_by: 0n,
        status: 0,
      }),
    });
    expect(tx.hspsi_oa_approval_callback_log.update).toHaveBeenCalledWith({
      where: { id: 99n },
      data: expect.objectContaining({ processed: 1, proc_status: 'REJECTED' }),
    });
  });
});

describe('RequisitionService non-borrow applications skip OA and write todos', () => {
  it('does not push OA for non-borrow (draw_type != 2) and writes todos to approvers', async () => {
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve: {
        create: vi.fn().mockResolvedValue({ draw_id: 77n }),
      },
      hspsi_draw_approve_detail: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ account_set_id: 1n }) },
      hspsi_sys_user_oa_staff: { findFirst: vi.fn().mockResolvedValue({ staff_id: 9n }) },
      hspsi_basic_staff: {
        findFirst: vi.fn().mockResolvedValue({ id: 9n, account_set_id: 1n, outer_ref_id: 'M-9', out_staff_id: 'S-9' }),
      },
      hspsi_basic_staff_organizations: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 3n, org_type: 2 }),
      },
    };
    const root = {
      hspsi_draw_approve: {
        // 事务外的提交后查询（非借用 → 写 todo）
        findFirst: vi.fn().mockResolvedValue({ draw_type: 1, draw_no: 'LY202608260001', org_id: 9n }),
      },
      hspsi_sys_user_authorized_org: {
        findMany: vi.fn().mockResolvedValue([{ user_id: 3n }, { user_id: 4n }, { user_id: 5n }]),
      },
      hspsi_sys_user_role: {
        findMany: vi.fn().mockResolvedValue([
          { user_id: 3, role_id: 11 }, // 有 approve 权限 → 应收到
          { user_id: 4, role_id: 12 }, // 仅有 requisitions 父权限 → 不应收到
        ]),
      },
      hspsi_sys_role: {
        findMany: vi.fn().mockResolvedValue([
          { id: 11n, code: 'requisition-approver' },
          { id: 12n, code: 'requisition-viewer' },
        ]),
      },
      hspsi_sys_role_menu: {
        findMany: vi.fn().mockResolvedValue([
          { role_id: 11n, menu_id: 265n }, // requisitions:applications:approve
          { role_id: 12n, menu_id: 49n }, // requisitions（父权限）
        ]),
      },
      hspsi_sys_menu: {
        findMany: vi.fn().mockResolvedValue([
          { id: 265, code: 'requisitions:applications:approve' },
          { id: 49, code: 'requisitions' },
        ]),
      },
    };
    const { service, todoService, oaApproval, attachmentsService } = serviceWithTransaction(tx, root);
    attachmentsService.uploadSignatureDataUrlForIntegration.mockResolvedValue({
      id: 'signature-77',
      objectKey: 'documents/requisition_application/signatures/signature-77.png',
      fileName: '领用人签名-signature-77.png',
      contentType: 'image/png',
      size: 3,
      uploadedBy: '3',
      uploadedAt: '2026-08-26T00:00:00.000Z',
      category: 'signature',
    });
    vi.spyOn(service as any, 'validateApplicationReferences').mockResolvedValue(undefined);

    const result = await service.saveApplication(
      null,
      {
        orgId: 1,
        warehouseId: 2,
        deptId: 3,
        applicantId: 3,
        drawType: 1,
        reason: '办公用品领用',
        signatureContent: 'data:image/png;base64,YWJj',
        signedBy: 9,
        details: [{ goodsId: 4, skuId: 5, quantity: 1, returnable: false }],
      },
      '3',
      true,
      '1',
    );

    expect(result).toMatchObject({ id: 77n, message: '申请已提交，等待系统内审批' });
    expect(oaApproval.submit).not.toHaveBeenCalled();
    // 授权组织覆盖 org 9 的候选：3/4/5；仅 user 3 的角色(11)拥有
    // requisitions:applications:approve 审批操作权限；user 4 仅父权限不通知
    expect(todoService.create).toHaveBeenCalledTimes(1);
    expect(todoService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 3,
        organizationId: 9,
        title: 'LY202608260001',
        content: '有新的领用申请待审批',
        businessType: 'draw_approve',
        businessId: 77,
      }),
    );
  });

  it('still pushes OA for borrow (draw_type = 2) applications', async () => {
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve: {
        create: vi.fn().mockResolvedValue({ draw_id: 78n }),
      },
      hspsi_draw_approve_detail: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ account_set_id: 1n }) },
      hspsi_sys_user_oa_staff: { findFirst: vi.fn().mockResolvedValue({ staff_id: 9n }) },
      hspsi_basic_staff: {
        findFirst: vi.fn().mockResolvedValue({ id: 9n, account_set_id: 1n, outer_ref_id: 'M-9', out_staff_id: 'S-9' }),
      },
      hspsi_basic_staff_organizations: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 3n, org_type: 2 }),
      },
    };
    const root = {
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue({ draw_type: 2, draw_no: 'LY202608260002', org_id: 9n }),
      },
    };
    const { service, todoService, oaApproval, attachmentsService } = serviceWithTransaction(tx, root);
    attachmentsService.uploadSignatureDataUrlForIntegration.mockResolvedValue({
      id: 'signature-78',
      objectKey: 'documents/requisition_application/signatures/signature-78.png',
      fileName: '领用人签名-signature-78.png',
      contentType: 'image/png',
      size: 3,
      uploadedBy: '3',
      uploadedAt: '2026-08-26T00:00:00.000Z',
      category: 'signature',
    });
    oaApproval.submit.mockResolvedValue({
      instanceId: 1n,
      procInstId: 'PROC-78',
      procStatus: 'RUNNING',
      busKey: 'requisition_application:78',
    });
    vi.spyOn(service as any, 'validateApplicationReferences').mockResolvedValue(undefined);

    const result = await service.saveApplication(
      null,
      {
        orgId: 1,
        warehouseId: 2,
        deptId: 3,
        applicantId: 3,
        drawType: 2,
        reason: '项目借用',
        signatureContent: 'data:image/png;base64,YWJj',
        signedBy: 9,
        details: [{ goodsId: 4, skuId: 5, quantity: 1, returnable: true }],
      },
      '3',
      true,
      '1',
    );

    expect(result).toMatchObject({ message: '申请已提交OA审批' });
    expect(oaApproval.submit).toHaveBeenCalledWith(78n, '3');
    expect(todoService.create).not.toHaveBeenCalled();
  });
});
