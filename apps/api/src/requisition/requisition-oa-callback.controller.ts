import {
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { XinfutongOaApprovalCallbackService } from '../integrations/xinfutong-oa/approval/approval-callback.service';
import { RequisitionService } from './requisition.service';

@Controller('integrations/xinfutong-oa')
export class RequisitionOaCallbackController {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(XinfutongOaApprovalCallbackService)
    private readonly callback: XinfutongOaApprovalCallbackService,
    @Inject(RequisitionService) private readonly requisition: RequisitionService,
  ) {}

  private authorize(headers: Record<string, string | string[] | undefined>) {
    const expected = this.config.get<string>('XINFUTONG_OA_CALLBACK_TOKEN') ?? '';
    if (!expected) throw new ServiceUnavailableException('OA回调凭证尚未配置');
    const authorization = Array.isArray(headers.authorization)
      ? headers.authorization[0]
      : headers.authorization;
    const supplied =
      (Array.isArray(headers['x-hspsi-webhook-token'])
        ? headers['x-hspsi-webhook-token'][0]
        : headers['x-hspsi-webhook-token']) ??
      (authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
    const actualBuffer = Buffer.from(supplied ?? '', 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('OA回调凭证无效');
    }
  }

  @Post('events/XFTOAFPS')
  async processFinished(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: Record<string, unknown>,
  ) {
    this.authorize(headers);
    const payload = this.callback.handleProcessFinishEvent(body);
    const result = await this.requisition.handleOaApprovalResult(payload, body);
    return { eventCode: this.callback.getEventCode(), ...result };
  }
}
