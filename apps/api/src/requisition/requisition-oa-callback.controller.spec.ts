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
  return {
    controller: new RequisitionOaCallbackController(callback as never, requisition as never),
    payload,
    callback,
    requisition,
  };
}

describe('RequisitionOaCallbackController', () => {
  it('accepts and dispatches a process-finish event without authentication', async () => {
    const { controller, payload, requisition } = fixture();
    const result = await controller.processFinished(payload);
    expect(requisition.handleOaApprovalResult).toHaveBeenCalledWith(payload, payload);
    expect(result).toMatchObject({ eventCode: 'XFTOAFPS', processed: true });
  });
});
