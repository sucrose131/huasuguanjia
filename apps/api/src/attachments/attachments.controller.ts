import { Body, Controller, Delete, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { AttachmentsService } from './attachments.service';

@UseGuards(AuthGuard)
@Controller('attachments')
export class AttachmentsController {
  constructor(@Inject(AttachmentsService) private readonly service: AttachmentsService) {}

  private auditContext(request: Request) {
    const forwarded = request.headers['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
    return { ip: String(raw || request.ip || request.socket.remoteAddress || '').trim() };
  }

  @Get(':documentType/:documentId')
  list(
    @Param('documentType') type: string,
    @Param('documentId') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.list(type, id, user);
  }

  @Post(':documentType/:documentId/upload-url')
  uploadUrl(
    @Param('documentType') type: string,
    @Param('documentId') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createUploadUrl(type, id, body, user);
  }

  @Post(':documentType/:documentId/complete')
  complete(
    @Param('documentType') type: string,
    @Param('documentId') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.service.complete(type, id, body, user, this.auditContext(request));
  }

  @Get(':documentType/:documentId/:attachmentId/preview-url')
  previewUrl(
    @Param('documentType') type: string,
    @Param('documentId') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.service.previewUrl(type, id, attachmentId, user, this.auditContext(request));
  }

  @Get(':documentType/:documentId/:attachmentId/download-url')
  downloadUrl(
    @Param('documentType') type: string,
    @Param('documentId') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.service.downloadUrl(type, id, attachmentId, user, this.auditContext(request));
  }

  @Delete(':documentType/:documentId/:attachmentId')
  remove(
    @Param('documentType') type: string,
    @Param('documentId') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.service.remove(type, id, attachmentId, user, this.auditContext(request));
  }
}
