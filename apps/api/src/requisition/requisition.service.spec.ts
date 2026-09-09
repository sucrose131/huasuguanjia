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
  tx.hspsi_inventory_total ??= {
    findMany: vi.fn(async ({ where }: Record<string, any>) =>
      (where.OR ?? []).map((line: Record<string, bigint>) => ({
        goods_id: line.goods_id,
        sku_id: line.sku_id,
        inventory_qty: 1,
      })),
    ),
  };
  tx.hspsi_inventory_batch_total ??= {
    findMany: vi.fn(async ({ where }: Record<string, any>) =>
      (where.OR ?? []).map((line: Record<string, bigint | string>) => ({
        goods_id: line.goods_id,
        sku_id: line.sku_id,
        batch_no: line.batch_no,
        inventory_qty: 1,
      })),
    ),
  };
  tx.hspsi_goods_info ??= {
    findMany: vi.fn(async ({ where }: Record<string, any>) =>
      (where.goods_id?.in ?? []).map((goodsId: bigint) => ({
        goods_id: goodsId,
        goods_name: `商品${goodsId}`,
      })),
    ),
  };
  tx.hspsi_goods_info_sku ??= {
    findMany: vi.fn(async ({ where }: Record<string, any>) =>
      (where.sku_id?.in ?? []).map((skuId: bigint) => ({
        sku_id: skuId,
        spec_models: `规格${skuId}`,
      })),
    ),
  };
  const prisma = {
    hspsi_inventory_total: tx.hspsi_inventory_total,
    hspsi_inventory_batch_total: tx.hspsi_inventory_batch_total,
    hspsi_goods_info: tx.hspsi_goods_info,
    hspsi_goods_info_sku: tx.hspsi_goods_info_sku,
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
  const todoService = {
    create: vi.fn().mockResolvedValue({ created: true }),
    completeByBusiness: vi.fn().mockResolvedValue(0),
    resolveRecipients: vi.fn().mockResolvedValue([]),
  };
  const oaApproval = { submit: vi.fn(), cancelRemoteProcess: vi.fn().mockResolvedValue(undefined) };
  const references = {
    enrich: vi.fn(async (rows: unknown) => rows),
    enrichGoods: vi.fn(async (rows: unknown) => rows),
  };
  return {
    service: new RequisitionService(
      prisma as never,
      posting as never,
      references as never,
      documentTrace as never,
      { generate: vi.fn(async (prefix: string) => `${prefix}20260804000001`) } as never,
      oaApproval as never,
      attachmentsService as never,
      { assertGoodsLines: vi.fn(), goodsOptionsByOrg: vi.fn().mockResolvedValue([]) } as never,
      todoService as never,
    ),
    prisma,
    posting,
    documentTrace,
    attachmentsService,
    todoService,
    oaApproval,
    references,
  };
}

function expectLockBeforeRead(lock: ReturnType<typeof vi.fn>, read: ReturnType<typeof vi.fn>) {
  expect(lock).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), expect.any(BigInt));
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
    read.mock.invocationCallOrder[0] ?? Infinity,
  );
}

/** 供 saveOutput 等接口使用的超管会话（跳过组织授权校验） */
function adminUser(id: string) {
  return {
    id,
    username: 'admin',
    orgId: '9',
    orgName: '测试组织',
    deptId: null,
    staffId: null,
    positionId: null,
    positionName: null,
    roleName: '管理员',
    currentOrgId: '9',
    currentOrgName: '测试组织',
    authorizedOrganizations: [{ id: '9', name: '测试组织' }],
    isSuperAdmin: true,
    permissions: ['*'],
  };
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

describe('RequisitionService application submission stock validation', () => {
  it('rejects a selected SKU with zero or missing stock and reports the exact item', async () => {
    const { service, prisma } = serviceWithTransaction({});
    prisma.hspsi_inventory_total.findMany.mockResolvedValue([]);
    prisma.hspsi_goods_info.findMany.mockResolvedValue([
      { goods_id: 101n, goods_name: 'A4纸' },
    ]);
    prisma.hspsi_goods_info_sku.findMany.mockResolvedValue([
      { sku_id: 201n, spec_models: '80g/包' },
    ]);

    await expect(
      (service as any).assertApplicationStockAvailable(prisma, 9n, 49n, [
        { goodsId: 101n, skuId: 201n, batchNo: null },
      ]),
    ).rejects.toThrow('所选仓库中A4纸（80g/包）暂无库存，不能提交领用申请');
  });

  it('checks the intended batch when one is entered even if the SKU total has stock', async () => {
    const { service, prisma } = serviceWithTransaction({});
    prisma.hspsi_inventory_total.findMany.mockResolvedValue([
      { goods_id: 101n, sku_id: 201n, inventory_qty: 8 },
    ]);
    prisma.hspsi_inventory_batch_total.findMany.mockResolvedValue([]);
    prisma.hspsi_goods_info.findMany.mockResolvedValue([
      { goods_id: 101n, goods_name: 'A4纸' },
    ]);
    prisma.hspsi_goods_info_sku.findMany.mockResolvedValue([
      { sku_id: 201n, spec_models: '80g/包' },
    ]);

    await expect(
      (service as any).assertApplicationStockAvailable(prisma, 9n, 49n, [
        { goodsId: 101n, skuId: 201n, batchNo: 'B-EMPTY' },
      ]),
    ).rejects.toThrow('A4纸（80g/包，批号 B-EMPTY）暂无库存');
  });

  it('allows submission when current stock is positive without enforcing requested quantity', async () => {
    const { service, prisma } = serviceWithTransaction({});

    await expect(
      (service as any).assertApplicationStockAvailable(prisma, 9n, 49n, [
        { goodsId: 101n, skuId: 201n, batchNo: null },
      ]),
    ).resolves.toBeUndefined();
  });
});

describe('RequisitionService output detail quantities', () => {
  it('keeps output allowance separate from return allowance for non-returnable items', async () => {
    const output = {
      draw_output_id: 12n,
      draw_output_no: 'DRO12',
      draw_id: 7n,
      receiver_id: 3n,
      comfirm_status: 0,
      auto_created: 1,
    };
    const root = {
      hspsi_draw_approve_output: {
        findFirst: vi.fn().mockResolvedValue(output),
        findMany: vi.fn().mockResolvedValue([]),
      },
      hspsi_draw_approve_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            output_detail_id: 120n,
            draw_output_id: 12n,
            draw_detail_id: 70n,
            goods_id: 1n,
            sku_id: 2n,
            batch_no: '',
            unit_type: 1,
            draw_qty: 3,
            fact_draw_qty: 3,
            is_returnable: 0,
            remark: '',
          },
        ]),
      },
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue({
          draw_id: 7n,
          draw_no: 'DR7',
          applicant_id: 3n,
        }),
      },
      hspsi_draw_approve_detail: {
        findMany: vi.fn().mockResolvedValue([{ draw_detail_id: 70n, draw_qty: 3 }]),
      },
      hspsi_draw_approve_output_exit: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_basic_staff: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_sys_user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { service } = serviceWithTransaction({}, root);

    const detail = await service.output('12');

    expect(detail.details).toEqual([
      expect.objectContaining({
        applicationQty: 3,
        historicalQty: 0,
        remainingQty: 3,
        quantity: 3,
        returnedQty: 0,
        returnableRemainingQty: 0,
      }),
    ]);
  });
});

describe('RequisitionService return-source staff and department enrichment', () => {
  function outputRoot() {
    return {
      hspsi_draw_approve_output: {
        findFirst: vi.fn().mockResolvedValue({
          draw_output_id: 12n,
          draw_output_no: 'DRO12',
          draw_id: 7n,
          org_id: 9n,
          warehouse_id: 3n,
          dept_id: 70n,
          receiver_id: 3n,
          output_date: new Date('2026-08-28'),
          auto_created: 0,
          comfirm_status: 1,
          comfirm_comment: '',
          comfirm_by: 0n,
          comfirm_date: null,
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      hspsi_draw_approve_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            output_detail_id: 120n,
            draw_output_id: 12n,
            draw_detail_id: 70n,
            goods_id: 1n,
            sku_id: 2n,
            batch_no: '',
            unit_type: 1,
            draw_qty: 3,
            fact_draw_qty: 3,
            is_returnable: 1,
            remark: '',
          },
        ]),
      },
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue({
          draw_id: 7n,
          draw_no: 'DR7',
          applicant_id: 3n,
        }),
      },
      hspsi_draw_approve_detail: {
        findMany: vi.fn().mockResolvedValue([{ draw_detail_id: 70n, draw_qty: 3 }]),
      },
      hspsi_draw_approve_output_exit: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_basic_staff: {
        findMany: vi.fn().mockResolvedValue([
          { id: 3n, name: '张三', staff_code: 'S3' },
        ]),
      },
      hspsi_sys_user: { findMany: vi.fn().mockResolvedValue([]) },
    };
  }

  it('output detail runs references.enrich so deptName is returned and staff name fills receiver', async () => {
    const root = outputRoot();
    const { service, references } = serviceWithTransaction({}, root);

    const detail: any = await service.output('12');

    expect(references.enrich).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ deptId: 70n, receiverId: 3n, applicantId: 3n }),
      ]),
      { confirmStatus: 'requisition_confirm_status' },
    );
    expect(detail.receiverIdName).toBe('张三');
    expect(detail.applicantIdName).toBe('张三');
  });

  it('return detail runs references.enrich with status dictionaries so deptName is returned', async () => {
    const root = {
      hspsi_draw_approve_output_exit: {
        findFirst: vi.fn().mockResolvedValue({
          draw_exit_id: 22n,
          draw_exit_no: 'DRR22',
          draw_id: 7n,
          draw_output_id: 12n,
          exit_reson: '退回测试',
          exit_qty: 1,
          org_id: 9n,
          warehouse_id: 3n,
          dept_id: 70n,
          receiver_id: 3n,
          return_date: new Date('2026-08-28'),
          status: 1,
          comfirm_status: 1,
          comfirm_comment: '',
          comfirm_by: 0n,
          comfirm_date: null,
        }),
      },
      hspsi_draw_approve_output_exit_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            exit_detail_id: 220n,
            draw_exit_id: 22n,
            draw_output_detail_id: 120n,
            goods_id: 1n,
            sku_id: 2n,
            batch_no: '',
            unit_type: 1,
            so_qty: 3,
            exit_qty: 1,
            storage_location: '',
            remark: '',
          },
        ]),
      },
      hspsi_draw_approve_output: {
        findFirst: vi.fn().mockResolvedValue({
          draw_output_id: 12n,
          draw_output_no: 'DRO12',
          draw_id: 7n,
        }),
      },
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue({
          draw_id: 7n,
          draw_no: 'DR7',
          applicant_id: 3n,
        }),
      },
      hspsi_draw_approve_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            output_detail_id: 120n,
            draw_output_id: 12n,
            is_returnable: 1,
          },
        ]),
      },
      hspsi_basic_staff: {
        findMany: vi.fn().mockResolvedValue([
          { id: 3n, name: '张三', staff_code: 'S3' },
        ]),
      },
      hspsi_sys_user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { service, references } = serviceWithTransaction({}, root);

    const detail: any = await service.returnOne('22');

    expect(references.enrich).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ deptId: 70n, receiverId: 3n }),
      ]),
      {
        status: 'requisition_status',
        confirmStatus: 'requisition_confirm_status',
      },
    );
    expect(detail.receiverIdName).toBe('张三');
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
        findFirst: vi
          .fn()
          .mockResolvedValue({
            id: 9n,
            account_set_id: 1n,
            outer_ref_id: 'M-9',
            out_staff_id: 'S-9',
          }),
      },
      hspsi_basic_staff_organizations: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 3n, org_type: 2 }),
      },
    };
    const { service, attachmentsService } = serviceWithTransaction(tx);
    vi.spyOn(service as any, 'validateApplicationReferences').mockResolvedValue(undefined);
    const stockValidation = vi.spyOn(service as any, 'assertApplicationStockAvailable');
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
    expect(stockValidation).not.toHaveBeenCalled();
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
        adminUser('3'),
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
        adminUser('3'),
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
        adminUser('3'),
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
  it('posts inventory and creates an approved reverse application atomically (直接领用)', async () => {
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
    const { service, posting, documentTrace, attachmentsService, oaApproval } =
      serviceWithTransaction(tx);
    attachmentsService.uploadSignatureDataUrlForIntegration.mockResolvedValue({
      id: 'sig-1',
      objectKey: 'documents/requisition_application/signatures/sig-1.png',
      fileName: '领用人签名-sig-1.png',
      contentType: 'image/png',
      size: 1,
      uploadedBy: '9',
      uploadedAt: '2026-08-28T00:00:00.000Z',
      category: 'signature',
    });
    vi.spyOn(service as any, 'validateApplicationReferences').mockResolvedValue(undefined);

    const result = await service.saveOutput(
      null,
      {
        directOutput: true,
        requestKey: 'direct-test-0001',
        drawType: 1,
        orgId: 1,
        warehouseId: 2,
        deptId: 3,
        receiverId: 4,
        signatureContent: 'data:image/png;base64,AAAA',
        details: [
          {
            goodsId: 5,
            skuId: 6,
            batchNo: 'PH20260807',
            unitType: 1,
            drawQty: 3,
            quantity: 2,
            returnable: false,
          },
        ],
      },
      adminUser('9'),
    );

    expect(result).toMatchObject({ id: 12n, applicationId: 7n });
    expect(attachmentsService.uploadSignatureDataUrlForIntegration).toHaveBeenCalledWith(
      'requisition_application',
      'data:image/png;base64,AAAA',
      '9',
    );
    expect(tx.hspsi_draw_approve.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approve_status: 1,
          draw_type: 1,
          draw_qty: 3,
          fact_draw_qty: 2,
          signature_attachment: 'sig-1',
          signed_by: 4n,
        }),
      }),
    );
    expect(tx.hspsi_draw_approve_detail.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ draw_qty: 3, is_returnable: 0 }),
      }),
    );
    expect(tx.hspsi_draw_approve_output_detail.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ draw_qty: 3, fact_draw_qty: 2, is_returnable: 0 }),
      ],
    });
    expect(posting.post).toHaveBeenCalledWith(
      expect.objectContaining({ direction: -1, sourceType: 'requisition_output' }),
      tx,
    );
    expect(documentTrace.link).toHaveBeenCalledWith(
      expect.objectContaining({ relationKind: 'reverse_generated' }),
      tx,
    );
    // 直接领用不走 OA
    expect(oaApproval.submit).not.toHaveBeenCalled();
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

  it('borrow direct output creates a pending application and submits OA', async () => {
    const tx = {
      hspsi_draw_approve_output: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ draw_output_id: 12n }),
        update: vi.fn(),
      },
      hspsi_draw_approve: { create: vi.fn().mockResolvedValue({ draw_id: 7n }) },
      hspsi_draw_approve_detail: { create: vi.fn().mockResolvedValue({ draw_detail_id: 70n }) },
      hspsi_draw_approve_output_detail: { createMany: vi.fn() },
    };
    const { service, attachmentsService, oaApproval } = serviceWithTransaction(tx);
    attachmentsService.uploadSignatureDataUrlForIntegration.mockResolvedValue({
      id: 'sig-2',
      objectKey: 'k',
      fileName: 'f.png',
      contentType: 'image/png',
      size: 1,
      uploadedBy: '9',
      uploadedAt: '2026-08-28T00:00:00.000Z',
      category: 'signature',
    });
    oaApproval.submit.mockResolvedValue({
      instanceId: 1n,
      procInstId: 'P-1',
      procStatus: 'RUNNING',
      busKey: 'requisition_application:7',
      errorMessage: '',
    });
    vi.spyOn(service as any, 'validateApplicationReferences').mockResolvedValue(undefined);

    const result = await service.saveOutput(
      null,
      {
        directOutput: true,
        requestKey: 'direct-borrow-0001',
        drawType: 2,
        orgId: 1,
        warehouseId: 2,
        deptId: 3,
        receiverId: 4,
        signatureContent: 'data:image/png;base64,AAAA',
        details: [
          {
            goodsId: 5,
            skuId: 6,
            batchNo: 'PH20260807',
            unitType: 1,
            drawQty: 2,
            quantity: 2,
            returnable: true,
          },
        ],
      },
      adminUser('9'),
    );

    expect(result).toMatchObject({ id: 12n, applicationId: 7n, oaStatus: 'RUNNING' });
    expect(tx.hspsi_draw_approve.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approve_status: 0, draw_type: 2, status: 1 }),
      }),
    );
    expect(oaApproval.submit).toHaveBeenCalledWith(7n, '9');
  });

  it('rejects direct output without the applicant signature', async () => {
    const { service } = serviceWithTransaction({});
    await expect(
      service.saveOutput(
        null,
        {
          directOutput: true,
          requestKey: 'direct-nosig-0001',
          drawType: 1,
          orgId: 1,
          warehouseId: 2,
          deptId: 3,
          receiverId: 4,
          details: [
            {
              goodsId: 5,
              skuId: 6,
              batchNo: 'PH01',
              unitType: 1,
              drawQty: 1,
              quantity: 1,
              returnable: false,
            },
          ],
        },
        adminUser('9'),
      ),
    ).rejects.toThrow('直接领用出库必须完成领用人签字确认');
  });

  it('rejects direct output when output quantity exceeds application quantity', async () => {
    const { service } = serviceWithTransaction({});
    await expect(
      service.saveOutput(
        null,
        {
          directOutput: true,
          requestKey: 'direct-qty-0001',
          drawType: 1,
          orgId: 1,
          warehouseId: 2,
          deptId: 3,
          receiverId: 4,
          details: [
            {
              goodsId: 5,
              skuId: 6,
              batchNo: 'PH01',
              unitType: 1,
              drawQty: 1,
              quantity: 2,
              returnable: false,
            },
          ],
        },
        adminUser('9'),
      ),
    ).rejects.toThrow('出库数量不能超过申请数量');
  });

  it('ensureAutomaticOutput reuses the existing direct output instead of creating a duplicate', async () => {
    const tx = {
      hspsi_draw_approve: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ draw_id: 7n, draw_no: 'RA1' }),
      },
      hspsi_draw_approve_output: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ draw_output_id: 12n, draw_output_no: 'RO1', draw_id: 7n }),
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };
    const { service } = serviceWithTransaction(tx);

    const output = await (service as any).ensureAutomaticOutput(tx, 7n, '0');

    expect(output.draw_output_id).toBe(12n);
    expect(tx.hspsi_draw_approve_output.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          generation_key: { startsWith: 'direct-requisition-output:' },
        }),
      }),
    );
    expect(tx.hspsi_draw_approve_output.create).not.toHaveBeenCalled();
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
      hspsi_draw_approve_output: { findFirst: vi.fn().mockResolvedValue(null) },
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

  it('creates a pending return draft when OA rejects a borrow direct output', async () => {
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
    const directOutput = {
      draw_output_id: 12n,
      draw_output_no: 'RO1',
      draw_id: 7n,
      org_id: 1n,
      warehouse_id: 2n,
      dept_id: 3n,
      receiver_id: 4n,
    };
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
      hspsi_draw_approve_output: { findFirst: vi.fn().mockResolvedValue(directOutput) },
      hspsi_draw_approve_output_exit: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ draw_exit_id: 20n }),
      },
      hspsi_draw_approve_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          { output_detail_id: 120n, is_returnable: 1, fact_draw_qty: 2 },
        ]),
      },
      hspsi_draw_approve_output_exit_detail: { createMany: vi.fn() },
      hspsi_business_document_relation: { upsert: vi.fn() },
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

    expect(result).toMatchObject({ processed: true, procStatus: 'REJECTED' });
    expect(tx.hspsi_draw_approve_output_exit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ comfirm_status: 0, exit_qty: 2 }),
      }),
    );
  });
});

describe('RequisitionService non-borrow applications auto-approve without OA', () => {
  it('auto-approves non-borrow (draw_type != 2) submissions via the approve flow, without OA', async () => {
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
        findFirst: vi
          .fn()
          .mockResolvedValue({
            id: 9n,
            account_set_id: 1n,
            outer_ref_id: 'M-9',
            out_staff_id: 'S-9',
          }),
      },
      hspsi_basic_staff_organizations: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 3n, org_type: 2 }),
      },
    };
    const root = {
      hspsi_draw_approve: {
        // 事务外的提交后查询：非借用 → 直接审批通过（不再写待审批待办）
        findFirst: vi.fn().mockResolvedValue({ draw_type: 1 }),
      },
    };
    const { service, todoService, oaApproval, attachmentsService } = serviceWithTransaction(
      tx,
      root,
    );
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
    // 自动通过复用审批「通过」流程（置已通过 + 自动生成领用出库草稿 + 通知领用人/出库执行人）
    const approveSpy = vi
      .spyOn(service, 'approve')
      .mockResolvedValue({
        id: '77',
        outputId: 99n,
        returnId: null,
        alreadyApproved: false,
        rejectedDirectOutput: false,
      } as any);

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

    expect(approveSpy).toHaveBeenCalledWith(
      '77',
      true,
      expect.stringContaining('系统直接审批通过'),
      '3',
    );
    expect(result).toMatchObject({
      id: 77n,
      outputId: 99n,
      message: expect.stringContaining('已直接审批通过'),
    });
    expect(oaApproval.submit).not.toHaveBeenCalled();
    // 非借用不再给审批人写「待审批」待办
    expect(todoService.create).not.toHaveBeenCalled();
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
      // 提交 OA 成功后触发 B2：释放撤回时自动生成的待确认退回单（本用例无退回单，早退）
      hspsi_draw_approve_output: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ account_set_id: 1n }) },
      hspsi_sys_user_oa_staff: { findFirst: vi.fn().mockResolvedValue({ staff_id: 9n }) },
      hspsi_basic_staff: {
        findFirst: vi
          .fn()
          .mockResolvedValue({
            id: 9n,
            account_set_id: 1n,
            outer_ref_id: 'M-9',
            out_staff_id: 'S-9',
          }),
      },
      hspsi_basic_staff_organizations: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 3n, org_type: 2 }),
      },
    };
    const root = {
      hspsi_draw_approve: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ draw_type: 2, draw_no: 'LY202608260002', org_id: 9n }),
      },
    };
    const { service, todoService, oaApproval, attachmentsService } = serviceWithTransaction(
      tx,
      root,
    );
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

  it('审批通过后关闭「待审批」待办，并给领用人+出库执行人下发待办', async () => {
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_oa_approval_instance: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_sys_user: { findFirst: vi.fn().mockResolvedValue({ id: 3n }) },
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue({
          draw_id: 7n,
          draw_no: 'LY202608260001',
          org_id: 9n,
          applicant_id: 3n,
          status: 1,
          approve_status: 0,
          draw_type: 1,
          signature_content: 'data:image/png;base64,YWJj',
          signature_attachment: null,
          signed_by: 3n,
          signed_at: new Date(),
        }),
        update: vi.fn(),
      },
    };
    const { service, todoService } = serviceWithTransaction(tx);
    vi.spyOn(service as any, 'ensureAutomaticOutput').mockResolvedValue({ draw_output_id: 100n });
    (todoService.resolveRecipients as ReturnType<typeof vi.fn>).mockResolvedValue([8]);

    await service.approve('7', true, '', '9');

    // 关闭原「待审批」待办（写给审批人的）
    expect(todoService.completeByBusiness).toHaveBeenCalledWith('draw_approve', 7, tx);
    // 出库执行人按权限码配置化解析
    expect(todoService.resolveRecipients).toHaveBeenCalledWith('requisitions:outputs:confirm', 9, tx);
    // 领用人 + 出库执行人各一条，写入事务内
    const createCalls = todoService.create.mock.calls as any[];
    expect(createCalls).toHaveLength(2);
    const byUser = Object.fromEntries(createCalls.map((call) => [call[0].userId, call[0]]));
    expect(byUser[3]).toMatchObject({
      organizationId: 9,
      title: 'LY202608260001',
      content: '领用申请已审批通过，可前往仓库办理领用',
      businessType: 'draw_approve_output',
      businessId: 7,
    });
    expect(byUser[8]).toMatchObject({
      organizationId: 9,
      title: 'LY202608260001',
      content: '领用申请已审批通过，请办理领用出库',
      businessType: 'draw_approve_output',
      businessId: 7,
    });
    expect(createCalls.every((call) => call[1] === tx)).toBe(true);
  });
});

describe('RequisitionService direct output cross-org options and authorization', () => {
  it('returns requisition warehouses across authorized orgs with orgId/deptId', async () => {
    const root = {
      hspsi_basic_organization: {
        findMany: vi.fn().mockResolvedValue([
          { org_id: 9n, name: '组织九' },
          { org_id: 2n, name: '组织二' },
        ]),
      },
      hspsi_basic_warehouse: {
        findMany: vi.fn().mockResolvedValue([
          {
            warehouse_id: 91n,
            name: '行政-办公耗材仓',
            warehouse_type: 7,
            dept_id: 10n,
            org_id: 9n,
          },
          { warehouse_id: 21n, name: '办公用品库', warehouse_type: 7, dept_id: 0n, org_id: 2n },
        ]),
      },
    };
    const { service } = serviceWithTransaction({}, root);
    const user = {
      id: '1',
      orgId: '9',
      currentOrgId: '9',
      authorizedOrganizations: [
        { id: '9', name: '组织九' },
        { id: '2', name: '组织二' },
      ],
      isSuperAdmin: false,
      permissions: ['requisitions'],
    };

    const result = await service.directOutputOptions(user as never);

    expect(result).toEqual([
      {
        value: 91n,
        label: '行政-办公耗材仓（组织九）',
        raw: { warehouseType: 7, deptId: 10n, orgId: 9n },
      },
      {
        value: 21n,
        label: '办公用品库（组织二）',
        raw: { warehouseType: 7, deptId: 0n, orgId: 2n },
      },
    ]);
    expect(root.hspsi_basic_warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ org_id: { in: [9n, 2n] } }),
      }),
    );
  });

  it('filters employees by dept when deptId is provided in application-form-options', async () => {
    const root = {
      hspsi_basic_dept: {
        findMany: vi.fn().mockResolvedValue([
          { dept_id: 10n, name: '行政部' },
          { dept_id: 7n, name: '健服部' },
        ]),
      },
      hspsi_basic_staff_organizations: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ staff_id: 100n }, { staff_id: 101n }]),
      },
      hspsi_basic_warehouse: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_basic_staff: {
        findMany: vi.fn().mockResolvedValue([
          { id: 100n, name: '甲', staff_code: 'S1' },
          { id: 101n, name: '乙', staff_code: 'S2' },
        ]),
      },
    };
    const { service } = serviceWithTransaction({}, root);

    const result = await service.applicationFormOptions('9', '10');

    expect(root.hspsi_basic_staff_organizations.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { org_type: 2, org_id: 10n },
            { org_type: 1, org_id: 9n },
          ],
        }),
      }),
    );
    expect(result.employees.map((item: any) => item.label)).toEqual(['甲（S1）', '乙（S2）']);
  });

  it('rejects direct output when org is outside the user authorized range', async () => {
    const { service } = serviceWithTransaction({});
    const user = {
      id: '1',
      orgId: '9',
      currentOrgId: '9',
      authorizedOrganizations: [{ id: '9', name: '组织九' }],
      isSuperAdmin: false,
      permissions: ['requisitions'],
    };

    await expect(
      service.saveOutput(
        null,
        {
          directOutput: true,
          requestKey: 'direct-unauthorized-0001',
          drawType: 1,
          orgId: 2,
          warehouseId: 3,
          deptId: 4,
          receiverId: 5,
          details: [
            {
              goodsId: 1,
              skuId: 1,
              batchNo: 'PH01',
              unitType: 1,
              drawQty: 1,
              quantity: 1,
              returnable: false,
            },
          ],
        },
        user as never,
      ),
    ).rejects.toThrow('所属组织不在当前账号授权组织范围内');
  });

  it('application-form-options includes fixed-asset/low-value/storage warehouse types', async () => {
    const root = {
      hspsi_basic_dept: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_basic_staff_organizations: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_basic_warehouse: {
        findMany: vi.fn().mockResolvedValue([
          { warehouse_id: 51n, name: '固定资产库', warehouse_type: 14, dept_id: 0n },
          { warehouse_id: 48n, name: '低值易耗品库', warehouse_type: 15, dept_id: 0n },
          { warehouse_id: 47n, name: '仓储库', warehouse_type: 16, dept_id: 0n },
        ]),
      },
    };
    const { service } = serviceWithTransaction({}, root);

    const result = await service.applicationFormOptions('7');

    expect(root.hspsi_basic_warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 7n,
          warehouse_type: { in: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16] },
          status: 1,
          deleted_at: null,
        }),
      }),
    );
    expect(result.warehouses.map((item: any) => item.value)).toEqual([51n, 48n, 47n]);
    expect(result.warehouses.map((item: any) => item.raw.warehouseType)).toEqual([14, 15, 16]);
  });

  it('save validation accepts fixed-asset/low-value/storage warehouses', async () => {
    const tx = {
      hspsi_basic_organization: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 7n }),
      },
      hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ dept_id: 36n }) },
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ warehouse_id: 48n }),
      },
      hspsi_basic_staff: { findFirst: vi.fn().mockResolvedValue({ id: 165n }) },
      hspsi_sys_dictionary_category: {
        findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1n }),
      },
      hspsi_basic_staff_organizations: {
        findFirst: vi.fn().mockResolvedValue({ id: 1n }),
      },
      hspsi_sys_dictionary: {
        findFirst: vi.fn().mockResolvedValue({ dict_id: 1n }),
      },
    };
    const { service } = serviceWithTransaction(tx);

    await expect(
      (service as any).validateApplicationReferences(tx, {
        orgId: 7n,
        deptId: 36n,
        warehouseId: 48n,
        applicantId: 165n,
        drawType: 1,
      }),
    ).resolves.toBeUndefined();

    expect(tx.hspsi_basic_warehouse.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          warehouse_type: { in: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16] },
        }),
      }),
    );
  });

  it('save validation still rejects warehouse types outside the requisition scope', async () => {
    const tx = {
      hspsi_basic_organization: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 7n }),
      },
      hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ dept_id: 36n }) },
      // 生产材料(2) 不在领用白名单内，仓库查询返回空 → 拒绝
      hspsi_basic_warehouse: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_basic_staff: { findFirst: vi.fn().mockResolvedValue({ id: 165n }) },
      hspsi_sys_dictionary_category: {
        findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1n }),
      },
    };
    const { service } = serviceWithTransaction(tx);

    await expect(
      (service as any).validateApplicationReferences(tx, {
        orgId: 7n,
        deptId: 36n,
        warehouseId: 45n,
        applicantId: 165n,
        drawType: 1,
      }),
    ).rejects.toThrow(
      '领用仓库仅限所选组织下已启用的行政类、健服类、固定资产/低值易耗品/仓储类仓库',
    );
  });

  it('all-goods-options attaches per-warehouse stock without narrowing candidates', async () => {
    const root = {
      hspsi_basic_warehouse: {
        findMany: vi.fn().mockResolvedValue([
          { warehouse_id: 49n },
          { warehouse_id: 48n },
          { warehouse_id: 16n },
        ]),
      },
      hspsi_inventory_total: {
        groupBy: vi.fn().mockResolvedValue([
          { warehouse_id: 49n, goods_id: 100n, sku_id: 201n, _sum: { inventory_qty: 5 } },
          { warehouse_id: 48n, goods_id: 100n, sku_id: 201n, _sum: { inventory_qty: 2 } },
          { warehouse_id: 49n, goods_id: 101n, sku_id: 301n, _sum: { inventory_qty: 0 } },
          { warehouse_id: 16n, goods_id: 102n, sku_id: 401n, _sum: { inventory_qty: 8 } },
        ]),
      },
    };
    const { service } = serviceWithTransaction({}, root);
    (service as any).masterData.goodsOptionsByOrg.mockResolvedValue([
      { id: 100n, goodsId: 100n, goodsName: 'A4纸', categoryWarehouseType: 7 },
      { id: 101n, goodsId: 101n, goodsName: '零库存商品', categoryWarehouseType: 7 },
      { id: 103n, goodsId: 103n, goodsName: '无库存记录商品', categoryWarehouseType: 7 },
    ]);

    const result = await service.allGoodsOptions('7');

    expect(root.hspsi_basic_warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ org_id: 7n, status: 1 }) }),
    );
    expect(root.hspsi_inventory_total.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['warehouse_id', 'goods_id', 'sku_id'],
        where: expect.objectContaining({
          org_id: 7n,
          warehouse_id: { in: [49n, 48n, 16n] },
          deleted_at: null,
          inventory_qty: { not: 0 },
        }),
      }),
    );
    // 候选不被库存收窄：零库存与无库存记录商品仍返回
    expect(result.map((item: any) => item.id)).toEqual([100n, 101n, 103n]);
    expect(result[0]!.stockByWarehouse).toEqual({ '49': 5, '48': 2 });
    expect(result[0]!.skuStockByWarehouse).toEqual({ '201': { '49': 5, '48': 2 } });
    expect(result[1]!.stockByWarehouse).toEqual({});
    expect(result[1]!.skuStockByWarehouse).toEqual({});
    expect(result[2]!.stockByWarehouse).toEqual({});
    expect(result[2]!.skuStockByWarehouse).toEqual({});
  });

  it('all-goods-options stock query scopes inventory_total by document org_id', async () => {
    const root = {
      hspsi_basic_warehouse: {
        findMany: vi.fn().mockResolvedValue([{ warehouse_id: 49n }]),
      },
      hspsi_inventory_total: {
        groupBy: vi.fn().mockResolvedValue([
          { warehouse_id: 49n, goods_id: 100n, sku_id: 201n, _sum: { inventory_qty: 5 } },
        ]),
      },
    };
    const { service } = serviceWithTransaction({}, root);
    (service as any).masterData.goodsOptionsByOrg.mockResolvedValue([
      { id: 100n, goodsId: 100n, goodsName: 'A4纸', categoryWarehouseType: 7 },
    ]);

    const result = await service.allGoodsOptions('7');

    expect(root.hspsi_inventory_total.groupBy).toHaveBeenCalledTimes(1);
    const where = root.hspsi_inventory_total.groupBy.mock.calls[0]![0].where;
    expect(where.org_id).toBe(7n);
    expect(where.warehouse_id).toEqual({ in: [49n] });
    // 查询已按单据组织收口：同一仓库下其他组织库存行不会进入 groupBy 结果，因此不会写入 stockByWarehouse
    expect(result[0]!.stockByWarehouse).toEqual({ '49': 5 });
    expect(result[0]!.skuStockByWarehouse).toEqual({ '201': { '49': 5 } });
    expect(where.org_id).not.toBe(3n);
  });

  it('all-goods-options attaches per-sku stock without mixing specifications', async () => {
    const root = {
      hspsi_basic_warehouse: {
        findMany: vi.fn().mockResolvedValue([{ warehouse_id: 49n }]),
      },
      hspsi_inventory_total: {
        groupBy: vi.fn().mockResolvedValue([
          { warehouse_id: 49n, goods_id: 100n, sku_id: 201n, _sum: { inventory_qty: 5 } },
          { warehouse_id: 49n, goods_id: 100n, sku_id: 202n, _sum: { inventory_qty: 3 } },
        ]),
      },
    };
    const { service } = serviceWithTransaction({}, root);
    (service as any).masterData.goodsOptionsByOrg.mockResolvedValue([
      { id: 100n, goodsId: 100n, goodsName: 'A4纸', categoryWarehouseType: 7 },
    ]);

    const result = await service.allGoodsOptions('7');

    expect(root.hspsi_inventory_total.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['warehouse_id', 'goods_id', 'sku_id'] }),
    );
    expect(result[0]!.stockByWarehouse).toEqual({ '49': 8 });
    expect(result[0]!.skuStockByWarehouse).toEqual({
      '201': { '49': 5 },
      '202': { '49': 3 },
    });
  });
});

describe('RequisitionService creator withdraw/terminate (OA cancel)', () => {
  const application = (overrides: Record<string, unknown> = {}) => ({
    draw_id: 7n,
    draw_no: 'RA2026',
    org_id: 2n,
    warehouse_id: 3n,
    dept_id: 6n,
    applicant_id: 9n,
    draw_type: 2,
    status: 1,
    approve_status: 0,
    approve_comment: '',
    approve_by: 0n,
    approve_date: null,
    created_by: 5n,
    updated_by: 5n,
    deleted_at: null,
    ...overrides,
  });
  const instance = (overrides: Record<string, unknown> = {}) => ({
    id: 31n,
    business_type: 'requisition_application',
    business_id: 7n,
    bus_key: 'requisition_application:7',
    proc_inst_id: 'PROC-7',
    proc_status: 'RUNNING',
    account_set_id: 1n,
    ...overrides,
  });
  const identityRoot = {
    hspsi_basic_organization: {
      findFirst: vi.fn().mockResolvedValue({ org_id: 2n, account_set_id: 1n }),
    },
    hspsi_sys_user_oa_staff: {
      findFirst: vi.fn().mockResolvedValue({ staff_id: 9n }),
    },
    hspsi_basic_staff: {
      findFirst: vi.fn().mockResolvedValue({
        id: 9n,
        name: '张三',
        account_set_id: 1n,
        outer_ref_id: 'MEMBER-9',
        out_staff_id: 'STAFF-9',
      }),
    },
    hspsi_basic_staff_organizations: {
      findFirst: vi.fn().mockResolvedValue({ id: 1n, org_id: 6n, org_type: 2, type: 1 }),
    },
  };
  function txFor(
    app: Record<string, unknown> = application(),
    overrides: Record<string, any> = {},
  ): Record<string, any> {
    return {
      $queryRawUnsafe: vi.fn(),
      hspsi_oa_approval_instance: {
        findFirst: vi.fn().mockResolvedValue(instance()),
        update: vi.fn(),
      },
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue(app),
        update: vi.fn().mockResolvedValue(app),
      },
      hspsi_draw_approve_output: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_business_document_relation: {},
      ...identityRoot,
      ...overrides,
    };
  }
  function withRoot(app: Record<string, unknown>, overrides: Record<string, any> = {}) {
    return {
      hspsi_draw_approve: { findFirst: vi.fn().mockResolvedValue(app) },
      hspsi_oa_approval_instance: { findFirst: vi.fn().mockResolvedValue(instance()) },
      ...identityRoot,
      ...overrides,
    };
  }

  it('withdraws a running OA borrow application back to draft and marks the instance canceled', async () => {
    const app = application();
    const tx = txFor(app);
    const { service, oaApproval, todoService } = serviceWithTransaction(tx, withRoot(app));

    const result = await service.withdrawApplication('7', '9');

    expect(oaApproval.cancelRemoteProcess).toHaveBeenCalledWith(instance(), 9n, '创建人撤回审批');
    expect(tx.hspsi_draw_approve.update).toHaveBeenCalledWith({
      where: { draw_id: 7n },
      data: expect.objectContaining({
        status: 0,
        approve_status: 0,
        approve_comment: '创建人撤回审批',
        approve_by: 0n,
        approve_date: null,
      }),
    });
    expect(todoService.completeByBusiness).toHaveBeenCalledWith('draw_approve', 7, tx);
    expect(tx.hspsi_oa_approval_instance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ proc_status: 'CANCELED', updated_by: 9n }),
      }),
    );
    expect(result).toMatchObject({ message: '领用申请已撤回' });
  });

  it('terminates a running OA borrow application into the canceled state', async () => {
    const app = application();
    const tx = txFor(app);
    const { service, oaApproval } = serviceWithTransaction(tx, withRoot(app));

    const result = await service.terminateApplication('7', '9');

    expect(oaApproval.cancelRemoteProcess).toHaveBeenCalledWith(instance(), 9n, '创建人终止审批');
    expect(tx.hspsi_draw_approve.update).toHaveBeenCalledWith({
      where: { draw_id: 7n },
      data: expect.objectContaining({
        approve_status: 3,
        approve_comment: '创建人终止审批',
        approve_by: 9n,
        approve_date: expect.any(Date),
      }),
    });
    expect(result.message).toBe('领用申请已终止');
  });

  it('forbids a user who is not the applicant from withdrawing', async () => {
    const app = application();
    const tx = txFor(app);
    const { service } = serviceWithTransaction(
      tx,
      withRoot(app, {
        hspsi_basic_staff: {
          findFirst: vi.fn().mockResolvedValue({
            id: 8n,
            name: '李四',
            account_set_id: 1n,
            outer_ref_id: 'MEMBER-8',
            out_staff_id: 'STAFF-8',
          }),
        },
      }),
    );

    await expect(service.withdrawApplication('7', '9')).rejects.toThrow(
      '个人无权撤回他人发起的领用申请',
    );
  });

  it('rejects non-borrow applications which never go through OA', async () => {
    const app = application({ draw_type: 1 });
    const tx = txFor(app);
    const { service } = serviceWithTransaction(tx, withRoot(app));

    await expect(service.terminateApplication('7', '9')).rejects.toThrow(
      '非借用领用申请走系统内审批，不支持撤回/终止',
    );
  });

  it('blocks while the OA instance is still being pushed', async () => {
    const app = application();
    const tx = txFor(app);
    const { service } = serviceWithTransaction(
      tx,
      withRoot(app, {
        hspsi_oa_approval_instance: {
          findFirst: vi.fn().mockResolvedValue(instance({ proc_status: 'PENDING_PUSH' })),
        },
      }),
    );

    await expect(service.withdrawApplication('7', '9')).rejects.toThrow('正在推送OA，请稍后重试');
  });

  it('keeps the document in approval and rethrows when the OA cancel fails', async () => {
    const app = application();
    const tx = txFor(app);
    const { service, oaApproval } = serviceWithTransaction(tx, withRoot(app));
    oaApproval.cancelRemoteProcess.mockRejectedValue(new Error('撤销OA审批失败：网络超时'));

    await expect(service.withdrawApplication('7', '9')).rejects.toThrow('撤销OA审批失败：网络超时');
    expect(tx.hspsi_draw_approve.update).not.toHaveBeenCalled();
  });

  it('withdrawing an issued direct-output borrow auto-generates a pending withdraw return', async () => {
    const app = application();
    const directOutput = {
      draw_output_id: 12n,
      draw_output_no: 'RO1',
      draw_id: 7n,
      org_id: 2n,
      warehouse_id: 3n,
      dept_id: 6n,
      receiver_id: 9n,
      comfirm_status: 1,
      deleted_at: null,
    };
    const tx = txFor(app, {
      hspsi_draw_approve_output: { findFirst: vi.fn().mockResolvedValue(directOutput) },
      hspsi_draw_approve_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          { output_detail_id: 120n, draw_output_id: 12n, is_returnable: 1, fact_draw_qty: 2 },
        ]),
      },
      hspsi_draw_approve_output_exit: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ draw_exit_id: 20n }),
      },
      hspsi_draw_approve_output_exit_detail: { createMany: vi.fn() },
      hspsi_business_document_relation: { upsert: vi.fn() },
    });
    const { service, documentTrace } = serviceWithTransaction(tx, withRoot(app));

    const result = await service.withdrawApplication('7', '9');

    expect(tx.hspsi_draw_approve_output_exit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          exit_reson: '领用申请被撤回，待办理退回',
          comfirm_status: 0,
        }),
      }),
    );
    expect(documentTrace.link).toHaveBeenCalledWith(
      expect.objectContaining({ relationKind: 'withdraw_return' }),
      tx,
    );
    expect(result).toMatchObject({
      message: '领用申请已撤回，并已生成待确认退回单',
      returnId: 20n,
    });
  });

  it('does not withdraw before the direct output takes effect (mirrors the reject guard)', async () => {
    const app = application();
    const tx = txFor(app, {
      hspsi_draw_approve_output: {
        findFirst: vi.fn().mockResolvedValue({
          draw_output_id: 12n,
          comfirm_status: 0,
          deleted_at: null,
        }),
      },
    });
    const { service } = serviceWithTransaction(tx, withRoot(app));

    await expect(service.withdrawApplication('7', '9')).rejects.toThrow(
      '直接领用出库尚未生效，不能撤回',
    );
  });

  it('releases the auto-generated withdraw return when the same document re-enters OA', async () => {
    const app = application();
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_draw_approve_output: {
        findMany: vi.fn().mockResolvedValue([{ draw_output_id: 12n }]),
      },
      hspsi_business_document_relation: {
        findMany: vi.fn().mockResolvedValue([{ downstream_id: 20n }]),
      },
      hspsi_draw_approve_output_exit: {
        findMany: vi.fn().mockResolvedValue([{ draw_exit_id: 20n }]),
        update: vi.fn(),
      },
    };
    const { service, oaApproval, documentTrace } = serviceWithTransaction(
      tx,
      withRoot(app, {
        hspsi_draw_approve_detail: {
          findMany: vi.fn().mockResolvedValue([
            { goods_id: 101n, sku_id: 201n, batch_no: null },
          ]),
        },
      }),
    );
    oaApproval.submit.mockResolvedValue({
      instanceId: 1n,
      procInstId: 'P-1',
      procStatus: 'RUNNING',
      busKey: 'requisition_application:7',
      errorMessage: '',
    });

    const result = await service.submitApplicationToOa('7', '9');

    expect(oaApproval.submit).toHaveBeenCalledWith(7n, '9');
    expect(tx.hspsi_draw_approve_output_exit.update).toHaveBeenCalledWith({
      where: { draw_exit_id: 20n },
      data: expect.objectContaining({ deleted_at: expect.any(Date) }),
    });
    expect(documentTrace.removeForDocument).toHaveBeenCalledWith(
      'requisition_return',
      '20',
      tx,
    );
    expect(result.message).toBe('已提交OA审批');
  });

  it('blocks an OA retry when the selected SKU no longer has stock', async () => {
    const app = application();
    const { service, oaApproval, prisma } = serviceWithTransaction(
      {},
      withRoot(app, {
        hspsi_draw_approve_detail: {
          findMany: vi.fn().mockResolvedValue([
            { goods_id: 101n, sku_id: 201n, batch_no: null },
          ]),
        },
      }),
    );
    prisma.hspsi_inventory_total.findMany.mockResolvedValue([]);
    prisma.hspsi_goods_info.findMany.mockResolvedValue([
      { goods_id: 101n, goods_name: 'A4纸' },
    ]);
    prisma.hspsi_goods_info_sku.findMany.mockResolvedValue([
      { sku_id: 201n, spec_models: '80g/包' },
    ]);

    await expect(service.submitApplicationToOa('7', '9')).rejects.toThrow(
      '所选仓库中A4纸（80g/包）暂无库存，不能提交领用申请',
    );
    expect(oaApproval.submit).not.toHaveBeenCalled();
  });
});

describe('RequisitionService OA cancel callback alignment', () => {
  const instance = (overrides: Record<string, unknown> = {}) => ({
    id: 31n,
    business_type: 'requisition_application',
    business_id: 7n,
    bus_key: 'requisition_application:7',
    proc_inst_id: 'PROC-7',
    proc_status: 'RUNNING',
    account_set_id: 1n,
    ...overrides,
  });
  const payload = (procStatus: 'CANCELED' | 'REJECTED' | 'PASSED') => ({
    prjCod: 'PRJ-1',
    procStatus,
    busKey: 'requisition_application:7',
    procInstId: 'PROC-7',
    procKey: 'PROC-KEY',
    formKey: 'PROC-KEY',
  });

  it('maps an OA CANCELED callback to approve_status 3 and keeps the submitted status', async () => {
    const app = { draw_id: 7n, approve_status: 0, status: 1 };
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_oa_approval_instance: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUniqueOrThrow: vi.fn().mockResolvedValue(instance()),
        update: vi.fn(),
      },
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue(app),
        update: vi.fn(),
      },
      hspsi_draw_approve_output: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_oa_approval_callback_log: { update: vi.fn() },
    };
    const { service, todoService } = serviceWithTransaction(tx, {
      hspsi_oa_approval_instance: { findFirst: vi.fn().mockResolvedValue(instance()) },
    });

    const result = await service.handleOaApprovalResult(payload('CANCELED'), payload('CANCELED'), 99n);

    expect(result).toMatchObject({ processed: true, duplicate: false, procStatus: 'CANCELED' });
    expect(tx.hspsi_draw_approve.update).toHaveBeenCalledWith({
      where: { draw_id: 7n },
      data: expect.objectContaining({
        approve_status: 3,
        approve_comment: 'OA审批取消',
        approve_by: 0n,
        status: 1,
      }),
    });
    expect(todoService.completeByBusiness).toHaveBeenCalledWith('draw_approve', 7, tx);
  });

  it('does not overwrite a locally withdrawn draft when the OA CANCELED callback arrives later', async () => {
    // 创建人撤回成功（草稿 0/0）后 OA 取消回调晚到：视为重复，不覆盖草稿
    const app = { draw_id: 7n, approve_status: 0, status: 0 };
    const tx = {
      $queryRawUnsafe: vi.fn(),
      hspsi_oa_approval_instance: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUniqueOrThrow: vi.fn().mockResolvedValue(instance({ proc_status: 'CANCELED' })),
        update: vi.fn(),
      },
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue(app),
        update: vi.fn(),
      },
      hspsi_oa_approval_callback_log: { update: vi.fn() },
    };
    const { service } = serviceWithTransaction(tx, {
      hspsi_oa_approval_instance: {
        findFirst: vi.fn().mockResolvedValue(instance({ proc_status: 'CANCELED' })),
      },
    });

    const result = await service.handleOaApprovalResult(payload('CANCELED'), payload('CANCELED'), 99n);

    expect(result).toMatchObject({ processed: true, duplicate: true });
    expect(tx.hspsi_draw_approve.update).not.toHaveBeenCalled();
    expect(tx.hspsi_oa_approval_callback_log.update).toHaveBeenCalledWith({
      where: { id: 99n },
      data: expect.objectContaining({ process_result: '重复回调，已幂等确认' }),
    });
  });
});
