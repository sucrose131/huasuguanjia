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
  );
  return (
    service as unknown as { aggregatePostingLines: AggregatePostingLines }
  ).aggregatePostingLines(9n, 3n, lines);
}

function serviceWithTransaction(tx: Record<string, any>, root: Record<string, any> = {}) {
  const prisma = {
    ...root,
    $transaction: vi.fn(async (callback: (client: Record<string, any>) => unknown) => callback(tx)),
  };
  const posting = { post: vi.fn() };
  const documentTrace = {
    link: vi.fn(),
    removeForDocument: vi.fn(),
  };
  return {
    service: new RequisitionService(
      prisma as never,
      posting as never,
      { enrich: vi.fn() } as never,
      documentTrace as never,
      { generate: vi.fn(async (prefix: string) => `${prefix}20260804000001`) } as never,
    ),
    prisma,
    posting,
    documentTrace,
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
