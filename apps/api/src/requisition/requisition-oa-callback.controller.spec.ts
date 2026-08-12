import { describe, expect, it, vi } from 'vitest';
import { RequisitionOaCallbackController } from './requisition-oa-callback.controller';

function fixture() {
  const payload = {
    prjCod: 'AAC15400',
    procStatus: 'PASSED',
    busKey: 'NFORM_1',
    procInstId: 'PROC_1',
    procKey: 'KEY_1',
  } as const;
  const callback = {
    handleProcessFinishEvent: vi.fn().mockReturnValue(payload),
    getEventCode: vi.fn().mockReturnValue('XFTOAFPS'),
  };
  const requisition = {
    handleOaApprovalResult: vi
      .fn()
      .mockResolvedValue({ processed: true, duplicate: false, procStatus: 'PASSED' }),
  };
  const prisma = {
    hspsi_oa_approval_callback_log: {
      create: vi.fn().mockResolvedValue({ id: 9n }),
      update: vi.fn(),
    },
  };
  return {
    controller: new RequisitionOaCallbackController(
      prisma as never,
      callback as never,
      requisition as never,
    ),
    payload,
    callback,
    requisition,
    prisma,
  };
}

describe('RequisitionOaCallbackController', () => {
  it('accepts and dispatches a process-finish event without authentication', async () => {
    const { controller, payload, requisition } = fixture();
    const result = await controller.processFinished(payload);
    expect(requisition.handleOaApprovalResult).toHaveBeenCalledWith(payload, payload, 9n);
    expect(result).toMatchObject({ eventCode: 'XFTOAFPS', processed: true });
  });

  it('keeps the raw callback log when validation fails', async () => {
    const { controller, callback, prisma } = fixture();
    callback.handleProcessFinishEvent.mockImplementationOnce(() => {
      throw new Error('回调载荷缺少必填字段：procInstId');
    });
    const raw = { anything: 'OA原始内容' };

    await expect(controller.processFinished(raw)).rejects.toThrow('缺少必填字段');

    expect(prisma.hspsi_oa_approval_callback_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ raw_payload: JSON.stringify(raw), processed: 0 }),
    });
    expect(prisma.hspsi_oa_approval_callback_log.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ processed: 0 }),
    });
  });
});
