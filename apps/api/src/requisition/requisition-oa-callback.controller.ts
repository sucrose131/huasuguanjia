import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service';
import { XinfutongOaApprovalCallbackService } from '../integrations/xinfutong-oa/approval/approval-callback.service';
import {
  EVENT_CODE_OA_PROCESS_FINISH,
  formKeyFromProcKey,
} from '../integrations/xinfutong-oa/approval/approval.types';
import {
  EVENT_CODE_CONNECTIVITY_TEST,
  OaEventVerifyError,
  oaEventAck,
  readEventId,
} from '../integrations/xinfutong-oa/approval/event-envelope';
import { RequisitionService } from './requisition.service';
import { PurchaseService } from '../purchase/purchase.service';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryOaApprovalService } from '../inventory/inventory-oa-approval.service';
import { ProductionService } from '../production/production.service';
import { SalesService } from '../sales/sales.service';
import { SalesOaApprovalService } from '../sales/sales-oa-approval.service';

@Controller('integrations/xinfutong-oa')
export class RequisitionOaCallbackController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(XinfutongOaApprovalCallbackService)
    private readonly callback: XinfutongOaApprovalCallbackService,
    @Inject(RequisitionService) private readonly requisition: RequisitionService,
    @Inject(PurchaseService) private readonly purchase: PurchaseService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(InventoryOaApprovalService) private readonly inventoryOa: InventoryOaApprovalService,
    @Inject(ProductionService) private readonly production: ProductionService,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(SalesOaApprovalService) private readonly salesOa: SalesOaApprovalService,
  ) {}

  private text(value: unknown, maxLength: number) {
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
  }

  private rawBodyText(req?: RawBodyRequest<Request>) {
    if (!req?.rawBody) return undefined;
    return Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : String(req.rawBody);
  }

  /**
   * 薪福通事件订阅统一入口。
   * 旧路径 events/XFTOAFPS 保留兼容，新配置请使用 events。
   */
  @Post(['events', 'events/XFTOAFPS'])
  @HttpCode(200)
  async receiveEvent(@Body() body: unknown, @Req() req?: RawBodyRequest<Request>) {
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const eventId = readEventId(body);

    if (eventId === EVENT_CODE_CONNECTIVITY_TEST) {
      return oaEventAck();
    }

    const log = await this.prisma.hspsi_oa_approval_callback_log.create({
      data: {
        instance_id: 0n,
        event_code: this.text(eventId, 30),
        prj_cod: this.text(fields.prjCod, 50),
        proc_status: '',
        bus_key: this.text(fields.businessKey, 100),
        proc_inst_id: '',
        proc_key: '',
        raw_payload: JSON.stringify(body ?? null),
        processed: 0,
        process_result: '已接收，待处理',
        account_set_id: 0n,
      },
    });

    try {
      const verified = await this.callback.verifyAndDecryptEvent(body, this.rawBodyText(req));
      if (eventId !== EVENT_CODE_OA_PROCESS_FINISH) {
        await this.prisma.hspsi_oa_approval_callback_log.update({
          where: { id: log.id },
          data: {
            account_set_id: verified.accountSetId,
            processed: 1,
            process_result: `已接收未处理的事件：${eventId || '未知'}`.slice(0, 500),
          },
        });
        return oaEventAck();
      }

      const payload = this.callback.handleProcessFinishEvent(verified.inner);
      const formKey = formKeyFromProcKey(payload.procKey);
      const template = await this.prisma.hspsi_oa_form_template.findFirst({
        where: {
          form_key: formKey,
          account_set_id: verified.accountSetId,
          status: 1,
          deleted_at: null,
        },
        select: { id: true },
      });
      if (!template) {
        await this.prisma.hspsi_oa_approval_callback_log.update({
          where: { id: log.id },
          data: {
            account_set_id: verified.accountSetId,
            proc_status: payload.procStatus,
            bus_key: payload.busKey,
            proc_inst_id: payload.procInstId,
            proc_key: payload.procKey,
            processed: 1,
            process_result: `非本系统表单，已忽略：${formKey}`.slice(0, 500),
          },
        });
        return oaEventAck();
      }

      const instance = await this.prisma.hspsi_oa_approval_instance.findFirst({
        where: {
          bus_key: payload.busKey,
          proc_inst_id: payload.procInstId,
          deleted_at: null,
        },
        orderBy: { id: 'desc' },
        select: { business_type: true },
      });
      if (instance?.business_type === 'purchase_application') {
        await this.purchase.handleApplicationOaApprovalResult(payload, body, log.id);
      } else if (instance?.business_type === 'purchase_return') {
        await this.purchase.handleReturnOaApprovalResult(payload, body, log.id);
      } else if (instance?.business_type === 'production_plan') {
        await this.production.handleOaApprovalResult(payload, body, log.id);
      } else if (instance?.business_type === 'sales_order') {
        await this.sales.handleOaApprovalResult(payload, body, log.id);
      } else if ((instance?.business_type ?? '').startsWith('inventory_')) {
        await this.handleInventory(payload, body, log.id, instance!.business_type);
      } else {
        await this.requisition.handleOaApprovalResult(payload, body, log.id);
      }
      return oaEventAck();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const accountSetId = error instanceof OaEventVerifyError ? error.accountSetId : undefined;
      await this.prisma.hspsi_oa_approval_callback_log.update({
        where: { id: log.id },
        data: {
          processed: 0,
          process_result: message.slice(0, 500),
          ...(accountSetId ? { account_set_id: accountSetId } : {}),
        },
      });
      if (error instanceof OaEventVerifyError) {
        return oaEventAck(error.rtnCod, message.slice(0, 200));
      }
      throw error;
    }
  }

  private async handleInventory(payload: any, body: unknown, logId: bigint, businessType: string) {
    const result: any = await this.inventory.handleOaApprovalResult(payload, body, logId);
    if (
      payload.procStatus === 'PASSED' &&
      businessType === 'inventory_check' &&
      Array.isArray(result.generated)
    ) {
      const actor = String(
        (
          await this.prisma.hspsi_inventory_check.findUnique({
            where: { check_id: result.businessId },
            select: { created_by: true },
          })
        )?.created_by ?? 0,
      );
      const childOaResults: Array<Record<string, unknown>> = [];
      for (const child of result.generated) {
        try {
          if (String(child.type).includes('报亏出库'))
            childOaResults.push({
              id: child.id,
              oa: await this.inventoryOa.submitInventoryDocument('loss-output', child.id, actor),
            });
          if (String(child.type).includes('报盈入库'))
            childOaResults.push({
              id: child.id,
              oa: await this.inventoryOa.submitInventoryDocument('overflow', child.id, actor),
            });
        } catch (error) {
          childOaResults.push({
            id: child.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      result.childOaResults = childOaResults;
    }
    if (
      payload.procStatus === 'PASSED' &&
      businessType === 'inventory_loss' &&
      result.discountOrderId
    ) {
      const actor = String(
        (
          await this.prisma.hspsi_inventory_loss.findUnique({
            where: { loss_id: result.businessId },
            select: { created_by: true },
          })
        )?.created_by ?? 0,
      );
      try {
        result.discountOrderOa = await this.salesOa.submitDiscountOrder(
          BigInt(result.discountOrderId),
          actor,
        );
      } catch (error) {
        result.discountOrderOaError = error instanceof Error ? error.message : String(error);
      }
    }
    return result;
  }
}
