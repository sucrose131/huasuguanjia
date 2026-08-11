import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RequisitionOaCallbackController } from './requisition-oa-callback.controller';

function fixture(token = 'callback-secret') {
  const config = { get: vi.fn().mockReturnValue(token) };
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
    controller: new RequisitionOaCallbackController(
      config as never,
      callback as never,
      requisition as never,
    ),
    payload,
    callback,
    requisition,
  };
}

describe('RequisitionOaCallbackController', () => {
  it('validates the token and dispatches a process-finish event', async () => {
    const { controller, payload, requisition } = fixture();
    const result = await controller.processFinished(
      { 'x-hspsi-webhook-token': 'callback-secret' },
      payload,
    );
    expect(requisition.handleOaApprovalResult).toHaveBeenCalledWith(payload, payload);
    expect(result).toMatchObject({ eventCode: 'XFTOAFPS', processed: true });
  });

  it('rejects an invalid token', async () => {
    const { controller, payload } = fixture();
    await expect(
      controller.processFinished({ authorization: 'Bearer wrong' }, payload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('stays unavailable until a callback token is configured', async () => {
    const { controller, payload } = fixture('');
    await expect(controller.processFinished({}, payload)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
