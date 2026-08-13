import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { RequisitionService } from './requisition.service';
import { RequisitionOaApprovalService } from './requisition-oa-approval.service';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('requisitions')
export class RequisitionController {
  constructor(
    @Inject(RequisitionService) private readonly service: RequisitionService,
    @Inject(RequisitionOaApprovalService) private readonly oaApproval: RequisitionOaApprovalService,
  ) {}

  @RequirePermissions('requisitions')
  @Get('applications')
  applications(@Query() query: any) {
    return this.service.applications(query);
  }

  @RequirePermissions('requisitions')
  @Get('application-form-options')
  applicationFormOptions(@Query('orgId') orgId: string) {
    return this.service.applicationFormOptions(orgId);
  }
  @RequirePermissions('requisitions')
  @Get('product-options')
  productOptions(@Query('orgId') orgId?: string, @Query('warehouseId') warehouseId?: string) {
    return this.service.productOptions(orgId, warehouseId);
  }

  @RequirePermissions('requisitions')
  @Get('applications/:id')
  application(@Param('id') id: string) {
    return this.service.application(id);
  }

  @RequirePermissions('requisitions')
  @Post('applications')
  createApplication(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.saveApplication(null, body, user.id, Boolean(body.submit));
  }

  @RequirePermissions('requisitions')
  @Patch('applications/:id')
  updateApplication(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.saveApplication(id, body, user.id, Boolean(body.submit));
  }

  @RequirePermissions('requisitions')
  @Post('applications/:id/submit-oa')
  async submitApplicationToOa(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const result = await this.oaApproval.submit(BigInt(id), user.id);
    return {
      ...result,
      message:
        result.procStatus === 'PUSH_FAILED'
          ? `提交OA失败：${result.errorMessage ?? '请稍后重试'}`
          : '已提交OA审批',
    };
  }

  @RequirePermissions('requisitions')
  @Post('applications/:id/approve')
  approve(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, Boolean(body.approved), String(body.comment ?? ''), user.id);
  }

  @RequirePermissions('requisitions')
  @Delete('applications/:id')
  deleteApplication(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deleteApplication(id, user.id);
  }

  @RequirePermissions('requisitions')
  @Get('application-options')
  applicationOptions() {
    return this.service.applicationOptions();
  }

  @RequirePermissions('requisitions')
  @Get('outputs')
  outputs(@Query() query: any) {
    return this.service.outputs(query);
  }

  @RequirePermissions('requisitions')
  @Get('outputs/:id')
  output(@Param('id') id: string) {
    return this.service.output(id);
  }

  @RequirePermissions('requisitions')
  @Post('outputs')
  createOutput(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.saveOutput(null, body, user.id);
  }

  @RequirePermissions('requisitions')
  @Patch('outputs/:id')
  updateOutput(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.saveOutput(id, body, user.id);
  }

  @RequirePermissions('requisitions')
  @Delete('outputs/:id')
  deleteOutput(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeDocument('output', id, user.id);
  }

  @RequirePermissions('requisitions')
  @Post('outputs/:id/confirm')
  confirmOutput(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.confirmOutput(id, String(body.comment ?? ''), user.id);
  }

  @RequirePermissions('requisitions')
  @Post('outputs/:id/undo-confirm')
  undoConfirmOutput(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.undoConfirmOutput(id, user.id);
  }

  @RequirePermissions('requisitions')
  @Get('output-options')
  outputOptions() {
    return this.service.outputOptions();
  }

  @RequirePermissions('requisitions')
  @Get('returns')
  returns(@Query() query: any) {
    return this.service.returns(query);
  }

  @RequirePermissions('requisitions')
  @Get('returns/:id')
  returnOne(@Param('id') id: string) {
    return this.service.returnOne(id);
  }

  @RequirePermissions('requisitions')
  @Post('returns')
  createReturn(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.saveReturn(null, body, user.id);
  }

  @RequirePermissions('requisitions')
  @Patch('returns/:id')
  updateReturn(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.saveReturn(id, body, user.id);
  }

  @RequirePermissions('requisitions')
  @Delete('returns/:id')
  deleteReturn(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeDocument('return', id, user.id);
  }

  @RequirePermissions('requisitions')
  @Post('returns/:id/confirm')
  confirmReturn(@Param('id') id: string, @Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.confirmReturn(id, String(body.comment ?? ''), user.id);
  }

  @RequirePermissions('requisitions')
  @Post('returns/:id/undo-confirm')
  undoConfirmReturn(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.undoConfirmReturn(id, user.id);
  }
}
