import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { FinalProcStatus } from '../integrations/xinfutong-oa/approval/approval.types';

/** 审批业务单据定位：OA 回调按 business_type 找到单据表、主键列、单号列和展示名。 */
type ApprovalDocSource = {
  table: string;
  idField: string;
  noField: string;
  label: string;
  orgField?: string;
};

const APPROVAL_DOC_SOURCES: Record<string, ApprovalDocSource> = {
  purchase_application: {
    table: 'hspsi_purchase_approve',
    idField: 'pur_id',
    noField: 'pur_no',
    label: '采购申请',
    orgField: 'org_id',
  },
  purchase_return: {
    table: 'hspsi_purchase_order_input_exit',
    idField: 'po_exit_id',
    noField: 'po_exit_no',
    label: '采购退货',
  },
  production_plan: {
    table: 'hspsi_production_plan',
    idField: 'plan_id',
    noField: 'plan_no',
    label: '生产计划',
    orgField: 'org_id',
  },
  sales_order: {
    table: 'hspsi_sale_order',
    idField: 'so_id',
    noField: 'so_no',
    label: '销售订单',
    orgField: 'org_id',
  },
  requisition_application: {
    table: 'hspsi_draw_approve',
    idField: 'draw_id',
    noField: 'draw_no',
    label: '领用申请',
    orgField: 'org_id',
  },
  inventory_transfer: {
    table: 'hspsi_inventory_transfer',
    idField: 'transfer_id',
    noField: 'transfer_no',
    label: '库存调拨',
    orgField: 'org_id',
  },
  inventory_adjust: {
    table: 'hspsi_inventory_adjust',
    idField: 'adjust_id',
    noField: 'adjust_no',
    label: '库存调整',
  },
  inventory_check: {
    table: 'hspsi_inventory_check',
    idField: 'check_id',
    noField: 'check_no',
    label: '库存盘点',
    orgField: 'org_id',
  },
  inventory_loss: {
    table: 'hspsi_inventory_loss',
    idField: 'loss_id',
    noField: 'loss_no',
    label: '报损出库',
    orgField: 'org_id',
  },
  inventory_loss_output: {
    table: 'hspsi_inventory_loss_output',
    idField: 'loss_id',
    noField: 'loss_no',
    label: '报亏出库',
    orgField: 'org_id',
  },
  inventory_overflow: {
    table: 'hspsi_inventory_overflow',
    idField: 'overflow_id',
    noField: 'overflow_no',
    label: '报盈入库',
    orgField: 'org_id',
  },
};

type ApprovalDocRow = Record<string, any> & { created_by: bigint | number };

@Injectable()
export class MessageService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * OA 审批通过/驳回时，向业务单据创建人发送审批结果消息。
   * 仅处理 PASSED/REJECTED；重复回调、单据缺失或创建人无效时静默跳过。
   */
  async sendApprovalNotification(input: {
    businessType: string;
    businessId?: bigint | null;
    procStatus: FinalProcStatus;
  }): Promise<void> {
    if (!['PASSED', 'REJECTED'].includes(input.procStatus)) return;
    if (!input.businessId) return;
    const source = APPROVAL_DOC_SOURCES[input.businessType];
    if (!source) return;
    const doc = await this.findApprovalDoc(source, input.businessId);
    if (!doc || Number(doc.created_by) <= 0) return;
    const passed = input.procStatus === 'PASSED';
    const docNo = String(doc[source.noField] ?? '');
    await this.createNoticeAndMessage({
      userId: Number(doc.created_by),
      organizationId: source.orgField ? BigInt(doc[source.orgField] ?? 0) : 0n,
      sourceType: 2,
      level: 1,
      title: `${source.label}${passed ? '审批通过' : '审批驳回'}`,
      content: `您提交的${source.label} ${docNo} 已${passed ? '通过OA审批' : '被OA审批驳回'}。`,
    });
  }

  /**
   * 采购入库单确认入库后，向来源采购订单的创建人发送入库通知。
   * 每次不同的入库单确认成功各发一条；订单缺失或创建人无效时静默跳过。
   */
  async sendPurchaseReceiptNotification(input: {
    poId: bigint;
    receiptNo: string;
    orderNo: string;
    quantity: number;
  }): Promise<void> {
    const order = await this.prisma.hspsi_purchase_order.findFirst({
      where: { po_id: input.poId, deleted_at: null },
      select: { created_by: true, org_id: true },
    });
    if (!order || Number(order.created_by) <= 0) return;
    await this.createNoticeAndMessage({
      userId: Number(order.created_by),
      organizationId: order.org_id,
      sourceType: 1,
      level: 1,
      title: '采购入库通知',
      content: `采购订单 ${input.orderNo} 已完成入库，入库单 ${input.receiptNo}，入库数量 ${input.quantity} 件。`,
    });
  }

  private async findApprovalDoc(
    source: ApprovalDocSource,
    businessId: bigint,
  ): Promise<ApprovalDocRow | null> {
    const model = (this.prisma as any)[source.table];
    if (!model?.findFirst) return null;
    return model.findFirst({
      where: { [source.idField]: businessId, deleted_at: null },
      select: {
        [source.noField]: true,
        created_by: true,
        ...(source.orgField ? { [source.orgField]: true } : {}),
      },
    });
  }

  private async createNoticeAndMessage(input: {
    userId: number;
    organizationId: bigint;
    sourceType: number;
    level: number;
    title: string;
    content: string;
  }): Promise<void> {
    const notice = await this.prisma.hspsi_sys_notice.create({
      data: {
        organization_id: Number(input.organizationId),
        title: input.title.slice(0, 100),
        content: input.content,
        source_type: input.sourceType,
        level: input.level,
        status: 1,
        publish_time: new Date(),
        created_by: 0,
      },
    });
    await this.prisma.hspsi_sys_message.create({
      data: {
        user_id: input.userId,
        notice_id: notice.id,
        is_read: 0,
        created_by: 0,
      },
    });
  }
}
