import { Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { AttachmentsService } from './attachments.service';

/** 未登录可访问的登录页操作指引，不使用 AuthGuard。对象键只来自字典。 */
@Controller('public')
export class PublicDocumentsController {
  constructor(@Inject(AttachmentsService) private readonly service: AttachmentsService) {}

  @Get('operation-guides')
  list() {
    return this.service.listPublicOperationGuides();
  }

  @Get('operation-guides/preview-url')
  preview(@Query('value') value: string) {
    return this.service.publicOperationGuidePreviewUrl(value);
  }

  @Get('operation-guides/file')
  async file(@Query('value') value: string, @Res() response: Response) {
    const file = await this.service.publicOperationGuideFile(value);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    await pipeline(file.stream as Readable, response);
  }
}
