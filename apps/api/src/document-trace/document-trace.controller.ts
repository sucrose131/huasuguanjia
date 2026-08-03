import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { DocumentTraceService } from './document-trace.service';

@UseGuards(AuthGuard)
@Controller('document-trace')
export class DocumentTraceController {
  constructor(@Inject(DocumentTraceService) private readonly service: DocumentTraceService) {}

  @Get('types')
  types() {
    return this.service.labels();
  }

  @Get(':type/:id')
  trace(
    @Param('type') type: string,
    @Param('id') id: string,
    @Query('maxDepth') maxDepth?: string,
  ) {
    return this.service.trace(type, id, maxDepth ? Number(maxDepth) : undefined);
  }
}
