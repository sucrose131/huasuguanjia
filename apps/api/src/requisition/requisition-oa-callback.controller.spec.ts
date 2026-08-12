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
  const prisma = {
    hspsi_oa_approval_callback_log: {
      create: vi.fn().mockResolvedValue({ id: 9n }),
      update: vi.fn(),
    },
    hspsi_oa_approval_instance: {
      findFirst: vi.fn().mockResolvedValue({ business_type: 'requisition_application' }),
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
    ),
    payload,
    callback,
    requisition,
    purchase,
    inventory,
    inventoryOa,
    production,
    sales,
    salesOa,
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

  it('dispatches a purchase application callback by the recorded business type', async () => {
    const { controller, payload, prisma, purchase, requisition } = fixture();
    prisma.hspsi_oa_approval_instance.findFirst.mockResolvedValueOnce({
      business_type: 'purchase_application',
    });

    await controller.processFinished(payload);

    expect(purchase.handleApplicationOaApprovalResult).toHaveBeenCalledWith(payload, payload, 9n);
    expect(requisition.handleOaApprovalResult).not.toHaveBeenCalled();
  });

  it.each([
    ['production_plan', 'production'],
    ['sales_order', 'sales'],
  ])('dispatches %s callbacks to the corresponding service', async (businessType, target) => {
    const context = fixture();
    context.prisma.hspsi_oa_approval_instance.findFirst.mockResolvedValueOnce({
      business_type: businessType,
    });
    const service = target === 'production' ? context.production : context.sales;
    service.handleOaApprovalResult.mockResolvedValueOnce({ processed: true });

    await context.controller.processFinished(context.payload);

    expect(service.handleOaApprovalResult).toHaveBeenCalledWith(
      context.payload,
      context.payload,
      9n,
    );
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
