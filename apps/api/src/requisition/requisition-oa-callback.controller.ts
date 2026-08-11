import { Body, Controller, Inject, Post } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { XinfutongOaApprovalCallbackService } from '../integrations/xinfutong-oa/approval/approval-callback.service';
import { RequisitionService } from './requisition.service';

@Controller('integrations/xinfutong-oa')
export class RequisitionOaCallbackController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(XinfutongOaApprovalCallbackService)
    private readonly callback: XinfutongOaApprovalCallbackService,
    @Inject(RequisitionService) private readonly requisition: RequisitionService,
  ) {}

  private text(value: unknown, maxLength: number) {
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
  }

  @Post('events/XFTOAFPS')
  async processFinished(@Body() body: unknown) {
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const log = await this.prisma.hspsi_oa_approval_callback_log.create({
      data: {
        instance_id: 0n,
        event_code: this.callback.getEventCode(),
        prj_cod: this.text(fields.prjCod, 50),
        proc_status: this.text(fields.procStatus, 20),
        bus_key: this.text(fields.busKey, 100),
        proc_inst_id: this.text(fields.procInstId, 50),
        proc_key: this.text(fields.procKey, 100),
        raw_payload: JSON.stringify(body ?? null),
        processed: 0,
        process_result: '已接收，待处理',
        account_set_id: 0n,
      },
    });
    try {
      const payload = this.callback.handleProcessFinishEvent(body);
      const result = await this.requisition.handleOaApprovalResult(payload, body, log.id);
      return { eventCode: this.callback.getEventCode(), ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.hspsi_oa_approval_callback_log.update({
        where: { id: log.id },
        data: { processed: 0, process_result: message.slice(0, 500) },
      });
      throw error;
    }
  }
}
