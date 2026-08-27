import { describe, expect, it, vi } from 'vitest';
import { OaEventVerifyError } from '../integrations/xinfutong-oa/approval/event-envelope';
import { RequisitionOaCallbackController } from './requisition-oa-callback.controller';

function fixture() {
  const inner = {
    prjCod: 'AAC15400',
    procStatus: 'PASSED',
    busKey: 'NFORM_1',
    procInstId: 'PROC_1',
    procKey: 'FORM_AAC15400_NFORM_380014832305831937',
    formKey: 'AAC15400_NFORM_380014832305831937',
  } as const;
  const envelope = {
    eventId: 'XFTOAFPS',
    eventRcdInf: 'encrypted',
    prjCod: 'AAC15400',
    eventTime: '2021-08-27T12:00:00',
    eventCd: 9999,
    businessKey: 'NFORM_1',
    appId: 'APP_1',
    signature: 'a'.repeat(128),
  };
  const callback = {
    handleProcessFinishEvent: vi.fn().mockReturnValue(inner),
    getEventCode: vi.fn().mockReturnValue('XFTOAFPS'),
    verifyAndDecryptEvent: vi.fn().mockResolvedValue({ inner, accountSetId: 1n }),
  };
  const requisition = {
    handleOaApprovalResult: vi
      .fn()
      .mockResolvedValue({ processed: true, duplicate: false, procStatus: 'PASSED' }),
  };
  const purchase = {
    handleApplicationOaApprovalResult: vi
      .fn()
      .mockResolvedValue({ processed: true, duplicate: false, procStatus: 'PASSED' }),
  };
  const inventory = { handleOaApprovalResult: vi.fn().mockResolvedValue({ processed: true }) };
  const inventoryOa = { submitInventoryDocument: vi.fn() };
  const production = { handleOaApprovalResult: vi.fn() };
  const sales = { handleOaApprovalResult: vi.fn() };
  const salesOa = { submitDiscountOrder: vi.fn() };
  const message = { sendApprovalNotification: vi.fn().mockResolvedValue(undefined) };
  const prisma = {
    hspsi_oa_approval_callback_log: {
      create: vi.fn().mockResolvedValue({ id: 9n }),
      update: vi.fn(),
    },
    hspsi_oa_approval_instance: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ business_type: 'requisition_application', business_id: 7n }),
    },
    hspsi_oa_form_template: {
      findFirst: vi.fn().mockResolvedValue({ id: 1n }),
    },
  };
  return {
    controller: new RequisitionOaCallbackController(
      prisma as never,
      callback as never,
      requisition as never,
      purchase as never,
      inventory as never,
      inventoryOa as never,
      production as never,
      sales as never,
      salesOa as never,
      message as never,
    ),
    inner,
    envelope,
    callback,
    requisition,
    purchase,
    inventory,
    inventoryOa,
    production,
    sales,
    salesOa,
    message,
    prisma,
  };
}

describe('RequisitionOaCallbackController', () => {
  it('returns the documented ack for the connectivity test event without writing logs', async () => {
    const { controller, prisma } = fixture();
    await expect(controller.receiveEvent({ eventId: 'XFT00000' })).resolves.toEqual({
      rtnCod: '200',
      errMsg: '',
    });
    expect(prisma.hspsi_oa_approval_callback_log.create).not.toHaveBeenCalled();
  });

  it('verifies, decrypts and dispatches a process-finish event', async () => {
    const { controller, inner, envelope, requisition, callback, prisma } = fixture();
    const result = await controller.receiveEvent(envelope);
    expect(callback.verifyAndDecryptEvent).toHaveBeenCalledWith(envelope, undefined);
    expect(prisma.hspsi_oa_form_template.findFirst).toHaveBeenCalledWith({
      where: {
        form_key: 'AAC15400_NFORM_380014832305831937',
        account_set_id: 1n,
        status: 1,
        deleted_at: null,
      },
      select: { id: true },
    });
    expect(requisition.handleOaApprovalResult).toHaveBeenCalledWith(inner, envelope, 9n);
    expect(result).toEqual({ rtnCod: '200', errMsg: '' });
  });

  it('acks and skips business handling when the form is not in hspsi_oa_form_template', async () => {
    const { controller, envelope, prisma, requisition, purchase } = fixture();
    prisma.hspsi_oa_form_template.findFirst.mockResolvedValueOnce(null);

    await expect(controller.receiveEvent(envelope)).resolves.toEqual({
      rtnCod: '200',
      errMsg: '',
    });
    expect(requisition.handleOaApprovalResult).not.toHaveBeenCalled();
    expect(purchase.handleApplicationOaApprovalResult).not.toHaveBeenCalled();
    expect(prisma.hspsi_oa_approval_callback_log.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({
        processed: 1,
        process_result: '非本系统表单，已忽略：AAC15400_NFORM_380014832305831937',
        proc_key: 'FORM_AAC15400_NFORM_380014832305831937',
        account_set_id: 1n,
      }),
    });
  });

  it('dispatches a purchase application callback by the recorded business type', async () => {
    const { controller, inner, envelope, prisma, purchase, requisition } = fixture();
    prisma.hspsi_oa_approval_instance.findFirst.mockResolvedValueOnce({
      business_type: 'purchase_application',
      business_id: 7n,
    });

    await controller.receiveEvent(envelope);

    expect(purchase.handleApplicationOaApprovalResult).toHaveBeenCalledWith(inner, envelope, 9n);
    expect(requisition.handleOaApprovalResult).not.toHaveBeenCalled();
  });

  it.each([
    ['production_plan', 'production'],
    ['sales_order', 'sales'],
  ])('dispatches %s callbacks to the corresponding service', async (businessType, target) => {
    const context = fixture();
    context.prisma.hspsi_oa_approval_instance.findFirst.mockResolvedValueOnce({
      business_type: businessType,
      business_id: 7n,
    });
    const service = target === 'production' ? context.production : context.sales;
    service.handleOaApprovalResult.mockResolvedValueOnce({ processed: true });

    await context.controller.receiveEvent(context.envelope);

    expect(service.handleOaApprovalResult).toHaveBeenCalledWith(
      context.inner,
      context.envelope,
      9n,
    );
  });

  it('sends an approval notification to the creator when the approval passes', async () => {
    const { controller, envelope, message } = fixture();

    await controller.receiveEvent(envelope);

    expect(message.sendApprovalNotification).toHaveBeenCalledWith({
      businessType: 'requisition_application',
      businessId: 7n,
      procStatus: 'PASSED',
    });
  });

  it('does not send the notification again for a duplicate callback', async () => {
    const { controller, envelope, requisition, message } = fixture();
    requisition.handleOaApprovalResult.mockResolvedValueOnce({
      processed: true,
      duplicate: true,
      procStatus: 'PASSED',
    });

    await controller.receiveEvent(envelope);

    expect(message.sendApprovalNotification).not.toHaveBeenCalled();
  });

  it('sends an approval notification when the approval is rejected', async () => {
    const { controller, envelope, callback, inner, message } = fixture();
    callback.handleProcessFinishEvent.mockReturnValue({ ...inner, procStatus: 'REJECTED' });

    await controller.receiveEvent(envelope);

    expect(message.sendApprovalNotification).toHaveBeenCalledWith({
      businessType: 'requisition_application',
      businessId: 7n,
      procStatus: 'REJECTED',
    });
  });

  it('does not send an approval notification for a canceled process', async () => {
    const { controller, envelope, callback, inner, message } = fixture();
    callback.handleProcessFinishEvent.mockReturnValue({ ...inner, procStatus: 'CANCELED' });

    await controller.receiveEvent(envelope);

    expect(message.sendApprovalNotification).not.toHaveBeenCalled();
  });

  it('does not send an approval notification when the business id is missing', async () => {
    const { controller, envelope, prisma, message } = fixture();
    prisma.hspsi_oa_approval_instance.findFirst.mockResolvedValueOnce({
      business_type: 'requisition_application',
      business_id: null,
    });

    await controller.receiveEvent(envelope);

    expect(message.sendApprovalNotification).not.toHaveBeenCalled();
  });

  it('returns the documented failure ack when signature verification fails', async () => {
    const { controller, callback, envelope, prisma } = fixture();
    callback.verifyAndDecryptEvent.mockImplementationOnce(() => {
      throw new OaEventVerifyError('验签失败');
    });

    await expect(controller.receiveEvent(envelope)).resolves.toEqual({
      rtnCod: '001',
      errMsg: '验签失败',
    });
    expect(prisma.hspsi_oa_approval_callback_log.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ processed: 0, process_result: '验签失败' }),
    });
  });

  it('keeps the raw callback log when inner payload validation fails', async () => {
    const { controller, callback, prisma, envelope } = fixture();
    callback.handleProcessFinishEvent.mockImplementationOnce(() => {
      throw new Error('回调载荷缺少必填字段：procInstId');
    });

    await expect(controller.receiveEvent(envelope)).rejects.toThrow('缺少必填字段');

    expect(prisma.hspsi_oa_approval_callback_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ raw_payload: JSON.stringify(envelope), processed: 0 }),
    });
    expect(prisma.hspsi_oa_approval_callback_log.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ processed: 0 }),
    });
  });
});
