import { Body, Controller, Inject, Post } from '@nestjs/common';
import { XinfutongOaApprovalCallbackService } from '../integrations/xinfutong-oa/approval/approval-callback.service';
import { RequisitionService } from './requisition.service';

@Controller('integrations/xinfutong-oa')
export class RequisitionOaCallbackController {
  constructor(
    @Inject(XinfutongOaApprovalCallbackService)
    private readonly callback: XinfutongOaApprovalCallbackService,
    @Inject(RequisitionService) private readonly requisition: RequisitionService,
  ) {}

  @Post('events/XFTOAFPS')
  async processFinished(@Body() body: Record<string, unknown>) {
    const payload = this.callback.handleProcessFinishEvent(body);
    const result = await this.requisition.handleOaApprovalResult(payload, body);
    return { eventCode: this.callback.getEventCode(), ...result };
  }
}
