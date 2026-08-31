import { describe, expect, it, vi } from 'vitest';
import { MessageService } from './message.service';

function serviceWith(prisma: Record<string, any>) {
  return new MessageService(prisma as never);
}

describe('MessageService.sendApprovalNotification', () => {
  it('creates notice + message when an approval passes', async () => {
    const noticeCreate = vi.fn().mockResolvedValue({ id: 11 });
    const messageCreate = vi.fn().mockResolvedValue({ id: 22 });
    const prisma = {
      hspsi_purchase_approve: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ pur_no: 'PA202608130001', created_by: 9n, org_id: 3n }),
      },
      hspsi_sys_notice: { create: noticeCreate },
      hspsi_sys_message: { create: messageCreate },
    };
    const service = serviceWith(prisma);

    await service.sendApprovalNotification({
      businessType: 'purchase_application',
      businessId: 1n,
      procStatus: 'PASSED',
    });

    expect(prisma.hspsi_purchase_approve.findFirst).toHaveBeenCalledWith({
      where: { pur_id: 1n, deleted_at: null },
      select: { pur_no: true, created_by: true, org_id: true },
    });
    expect(noticeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organization_id: 3,
        title: '采购申请审批通过',
        content: '您提交的采购申请 PA202608130001 已通过OA审批。',
        source_type: 2,
        level: 1,
        status: 1,
        created_by: 0,
      }),
    });
    expect(messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 9, notice_id: 11, is_read: 0, created_by: 0 }),
    });
  });

  it('creates a rejected message with the rejected wording', async () => {
    const noticeCreate = vi.fn().mockResolvedValue({ id: 12 });
    const prisma = {
      hspsi_draw_approve: {
        findFirst: vi.fn().mockResolvedValue({ draw_no: 'LX202608170001', created_by: 4n, org_id: 1n }),
      },
      hspsi_sys_notice: { create: noticeCreate },
      hspsi_sys_message: { create: vi.fn() },
    };
    const service = serviceWith(prisma);

    await service.sendApprovalNotification({
      businessType: 'requisition_application',
      businessId: 2n,
      procStatus: 'REJECTED',
    });

    expect(prisma.hspsi_draw_approve.findFirst).toHaveBeenCalledWith({
      where: { draw_id: 2n, deleted_at: null },
      select: { draw_no: true, created_by: true, org_id: true },
    });
    expect(noticeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: '领用申请审批驳回',
        content: '您提交的领用申请 LX202608170001 已被OA审批驳回。',
        source_type: 2,
      }),
    });
  });

  it.each(['CANCELED', 'DELETED'] as const)(
    'skips non-passed/rejected status %s',
    async (procStatus) => {
      const prisma = {
        hspsi_purchase_approve: { findFirst: vi.fn() },
        hspsi_sys_notice: { create: vi.fn() },
        hspsi_sys_message: { create: vi.fn() },
      };
      const service = serviceWith(prisma);

      await service.sendApprovalNotification({
        businessType: 'purchase_application',
        businessId: 1n,
        procStatus,
      });

      expect(prisma.hspsi_purchase_approve.findFirst).not.toHaveBeenCalled();
      expect(prisma.hspsi_sys_notice.create).not.toHaveBeenCalled();
      expect(prisma.hspsi_sys_message.create).not.toHaveBeenCalled();
    },
  );

  it('skips unknown business types', async () => {
    const prisma = {
      hspsi_sys_notice: { create: vi.fn() },
      hspsi_sys_message: { create: vi.fn() },
    };
    const service = serviceWith(prisma);

    await service.sendApprovalNotification({
      businessType: 'unknown_document',
      businessId: 1n,
      procStatus: 'PASSED',
    });

    expect(prisma.hspsi_sys_notice.create).not.toHaveBeenCalled();
  });

  it('skips when businessId is missing', async () => {
    const prisma = {
      hspsi_purchase_approve: { findFirst: vi.fn() },
      hspsi_sys_notice: { create: vi.fn() },
      hspsi_sys_message: { create: vi.fn() },
    };
    const service = serviceWith(prisma);

    await service.sendApprovalNotification({
      businessType: 'purchase_application',
      businessId: null,
      procStatus: 'PASSED',
    });

    expect(prisma.hspsi_purchase_approve.findFirst).not.toHaveBeenCalled();
    expect(prisma.hspsi_sys_notice.create).not.toHaveBeenCalled();
  });

  it('skips when the business document is missing', async () => {
    const prisma = {
      hspsi_production_plan: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_sys_notice: { create: vi.fn() },
      hspsi_sys_message: { create: vi.fn() },
    };
    const service = serviceWith(prisma);

    await service.sendApprovalNotification({
      businessType: 'production_plan',
      businessId: 3n,
      procStatus: 'PASSED',
    });

    expect(prisma.hspsi_sys_notice.create).not.toHaveBeenCalled();
  });

  it('skips when the creator is zero or missing', async () => {
    const prisma = {
      hspsi_inventory_check: {
        findFirst: vi.fn().mockResolvedValue({ check_no: 'PD001', created_by: 0n, org_id: 1n }),
      },
      hspsi_sys_notice: { create: vi.fn() },
      hspsi_sys_message: { create: vi.fn() },
    };
    const service = serviceWith(prisma);

    await service.sendApprovalNotification({
      businessType: 'inventory_check',
      businessId: 4n,
      procStatus: 'REJECTED',
    });

    expect(prisma.hspsi_sys_notice.create).not.toHaveBeenCalled();
  });

  it('uses organization 0 for business tables without an org column', async () => {
    const noticeCreate = vi.fn().mockResolvedValue({ id: 13 });
    const prisma = {
      hspsi_purchase_order_input_exit: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ po_exit_no: 'CGTH001', created_by: 6n }),
      },
      hspsi_sys_notice: { create: noticeCreate },
      hspsi_sys_message: { create: vi.fn() },
    };
    const service = serviceWith(prisma);

    await service.sendApprovalNotification({
      businessType: 'purchase_return',
      businessId: 5n,
      procStatus: 'PASSED',
    });

    expect(prisma.hspsi_purchase_order_input_exit.findFirst).toHaveBeenCalledWith({
      where: { po_exit_id: 5n, deleted_at: null },
      select: { po_exit_no: true, created_by: true },
    });
    expect(noticeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ organization_id: 0, title: '采购退货审批通过' }),
    });
  });
});

describe('MessageService.sendPurchaseReceiptNotification', () => {
  it('creates notice + message to the purchase order creator', async () => {
    const noticeCreate = vi.fn().mockResolvedValue({ id: 21 });
    const messageCreate = vi.fn().mockResolvedValue({ id: 31 });
    const prisma = {
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({ created_by: 5n, org_id: 2n }),
      },
      hspsi_sys_notice: { create: noticeCreate },
      hspsi_sys_message: { create: messageCreate },
    };
    const service = serviceWith(prisma);

    await service.sendPurchaseReceiptNotification({
      poId: 401n,
      receiptNo: 'GA202608190001',
      orderNo: 'PO202608180001',
      quantity: 30,
    });

    expect(prisma.hspsi_purchase_order.findFirst).toHaveBeenCalledWith({
      where: { po_id: 401n, deleted_at: null },
      select: { created_by: true, org_id: true },
    });
    expect(noticeCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organization_id: 2,
        title: '采购入库通知',
        content: '采购订单 PO202608180001 已完成入库，入库单 GA202608190001，入库数量 30 件。',
        source_type: 1,
        level: 1,
        status: 1,
      }),
    });
    expect(messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 5, notice_id: 21, is_read: 0 }),
    });
  });

  it('skips when the purchase order is missing', async () => {
    const prisma = {
      hspsi_purchase_order: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_sys_notice: { create: vi.fn() },
      hspsi_sys_message: { create: vi.fn() },
    };
    const service = serviceWith(prisma);

    await service.sendPurchaseReceiptNotification({
      poId: 999n,
      receiptNo: 'GA001',
      orderNo: 'PO001',
      quantity: 1,
    });

    expect(prisma.hspsi_sys_notice.create).not.toHaveBeenCalled();
  });

  it('skips when the purchase order creator is zero', async () => {
    const prisma = {
      hspsi_purchase_order: { findFirst: vi.fn().mockResolvedValue({ created_by: 0n, org_id: 1n }) },
      hspsi_sys_notice: { create: vi.fn() },
      hspsi_sys_message: { create: vi.fn() },
    };
    const service = serviceWith(prisma);

    await service.sendPurchaseReceiptNotification({
      poId: 401n,
      receiptNo: 'GA001',
      orderNo: 'PO001',
      quantity: 1,
    });

    expect(prisma.hspsi_sys_notice.create).not.toHaveBeenCalled();
  });
});
