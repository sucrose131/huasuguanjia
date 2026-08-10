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
import { SalesService } from './sales.service';

@Controller('integrations/aftersales')
export class AftersalesIntegrationController {
  constructor(
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  private authorize(headers: Record<string, string | string[] | undefined>) {
    const expected = this.config.get<string>('AFTERSALES_WEBHOOK_TOKEN') ?? '';
    if (!expected) throw new ServiceUnavailableException('外部售后回调尚未配置');
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
    )
      throw new UnauthorizedException('外部售后回调凭证无效');
  }

  @Post('huashu-home')
  receiveHuashuHome(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: Record<string, unknown>,
  ) {
    this.authorize(headers);
    return this.sales.receiveExternalAfterSales('huashu_home', body);
  }
}
