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
import { InventoryService } from './inventory.service';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('inventory')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly service: InventoryService) {}

  @Get('users/options')
  @RequirePermissions('inventory')
  users() {
    return this.service.userOptions();
  }

  @Get('warehouses/tabs')
  @RequirePermissions('inventory')
  warehouseTabs(@Query('orgId') orgId?: string) {
    return this.service.warehouseTabs(orgId);
  }

  @Get('losses/approved-options')
  @RequirePermissions('inventory')
  approvedLosses() {
    return this.service.approvedLossOptions();
  }

  @Get('losses/purchase-source-options')
  @RequirePermissions('inventory')
  lossPurchaseSourceOptions(@Query() query: any) {
    return this.service.lossPurchaseSourceOptions(query);
  }

  // ── stocks ──
  @Get('stocks')
  @RequirePermissions('inventory')
  stocks(@Query() q: any) {
    return this.service.stocks(q);
  }

  @Get('requisition-history')
  @RequirePermissions('inventory')
  requisitionHistory(@Query() q: any) {
    return this.service.requisitionHistory(q);
  }

  @Get('ledger')
  @RequirePermissions('inventory')
  ledger(@Query() q: any) {
    return this.service.ledger(q);
  }

  @Get('stock-options')
  @RequirePermissions('inventory')
  stockOptions(@Query() q: any) {
    return this.service.stockOptions(q);
  }

  // ── transfers ──
  @Get('transfers')
  @RequirePermissions('inventory')
  transfers(@Query() q: any) {
    return this.service.transfers(q);
  }

  @Get('transfers/:id')
  @RequirePermissions('inventory')
  transfer(@Param('id') id: string) {
    return this.service.transfer(id);
  }

  @Post('transfers')
  @RequirePermissions('inventory')
  createTransfer(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveTransfer(null, b, u.id, !!b.submit);
  }

  @Patch('transfers/:id')
  @RequirePermissions('inventory')
  updateTransfer(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveTransfer(id, b, u.id, !!b.submit);
  }

  @Post('transfers/:id/submit')
  @RequirePermissions('inventory')
  submitTransfer(@Param('id') id: string) {
    return this.service.submitTransfer(id);
  }

  @Post('transfers/:id/approve')
  @RequirePermissions('inventory')
  approveTransfer(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.approveTransfer(id, !!b.approved, String(b.comment ?? ''), u.id);
  }

  @Delete('transfers/:id')
  @RequirePermissions('inventory')
  removeTransfer(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeTransfer(id, u.id);
  }

  // ── adjustments ──
  @Get('adjustments')
  @RequirePermissions('inventory')
  adjustments(@Query() q: any) {
    return this.service.adjustments(q);
  }

  @Get('adjustments/:id')
  @RequirePermissions('inventory')
  adjustment(@Param('id') id: string) {
    return this.service.adjustment(id);
  }

  @Post('adjustments')
  @RequirePermissions('inventory')
  createAdjustment(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveAdjustment(null, b, u.id, !!b.submit);
  }

  @Patch('adjustments/:id')
  @RequirePermissions('inventory')
  updateAdjustment(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveAdjustment(id, b, u.id, !!b.submit);
  }

  @Post('adjustments/:id/submit')
  @RequirePermissions('inventory')
  submitAdjustment(@Param('id') id: string) {
    return this.service.submitAdjustment(id);
  }

  @Delete('adjustments/:id')
  @RequirePermissions('inventory')
  removeAdjustment(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeAdjustment(id, u.id);
  }

  @Post('adjustments/:id/approve')
  @RequirePermissions('inventory')
  approveAdjustment(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.approveAdjustment(id, !!b.approved, String(b.comment ?? ''), u.id);
  }

  // ── checks ──
  @Get('checks')
  @RequirePermissions('inventory')
  checks(@Query() q: any) {
    return this.service.checks(q);
  }

  @Get('checks/:id')
  @RequirePermissions('inventory')
  check(@Param('id') id: string) {
    return this.service.check(id);
  }

  @Post('checks')
  @RequirePermissions('inventory')
  createCheck(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.createCheck(b, u.id);
  }

  @Patch('checks/:id')
  @RequirePermissions('inventory')
  saveCheck(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveCheck(id, b, u.id, !!b.submit);
  }

  @Delete('checks/:id')
  @RequirePermissions('inventory')
  removeCheck(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeCheck(id, u.id);
  }

  @Post('checks/:id/approve')
  @RequirePermissions('inventory')
  approveCheck(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.approveCheck(id, !!b.approved, String(b.comment ?? ''), u.id);
  }

  // ── losses ──
  @Get('losses')
  @RequirePermissions('inventory')
  losses(@Query() q: any) {
    return this.service.losses(q);
  }

  @Get('losses/:id')
  @RequirePermissions('inventory')
  loss(@Param('id') id: string) {
    return this.service.loss(id);
  }

  @Post('losses')
  @RequirePermissions('inventory')
  createLoss(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveDocument('loss', null, b, u.id, !!b.submit);
  }

  @Patch('losses/:id')
  @RequirePermissions('inventory')
  updateLoss(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveDocument('loss', id, b, u.id, !!b.submit);
  }

  @Post('losses/:id/submit')
  @RequirePermissions('inventory')
  submitLoss(@Param('id') id: string) {
    return this.service.submitDocument('loss', id);
  }

  @Delete('losses/:id')
  @RequirePermissions('inventory')
  removeLoss(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeDocument('loss', id, u.id);
  }

  @Post('losses/:id/approve')
  @RequirePermissions('inventory')
  approveLoss(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.approveDocument('loss', id, !!b.approved, String(b.comment ?? ''), u.id);
  }

  // ── loss-outputs ──
  @Get('loss-outputs')
  @RequirePermissions('inventory')
  lossOutputs(@Query() q: any) {
    return this.service.lossOutputs(q);
  }

  @Get('loss-outputs/:id')
  @RequirePermissions('inventory')
  lossOutput(@Param('id') id: string) {
    return this.service.lossOutput(id);
  }

  @Post('loss-outputs')
  @RequirePermissions('inventory')
  createLossOutput(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveLossOutput(null, b, u.id);
  }

  @Patch('loss-outputs/:id')
  @RequirePermissions('inventory')
  updateLossOutput(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveLossOutput(id, b, u.id);
  }

  @Delete('loss-outputs/:id')
  @RequirePermissions('inventory')
  removeLossOutput(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeDocument('loss-output', id, u.id);
  }

  @Post('loss-outputs/:id/approve')
  @RequirePermissions('inventory')
  approveLossOutput(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.approveLossOutput(id, !!b.approved, String(b.comment ?? ''), u.id);
  }

  @Post('loss-outputs/:id/confirm')
  @RequirePermissions('inventory')
  confirmLossOutput(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.confirmLossOutput(id, String(b.comment ?? ''), u.id);
  }

  // ── overflow-inputs ──
  @Get('overflow-inputs')
  @RequirePermissions('inventory')
  overflowInputs(@Query() q: any) {
    return this.service.overflowInputs(q);
  }

  @Get('overflow-inputs/:id')
  @RequirePermissions('inventory')
  overflowInput(@Param('id') id: string) {
    return this.service.overflowInput(id);
  }

  @Post('overflow-inputs/:id/confirm')
  @RequirePermissions('inventory')
  confirmOverflowInput(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.confirmOverflowInput(id, String(b.comment ?? ''), u.id);
  }

  // ── overflows ──
  @Get('overflows')
  @RequirePermissions('inventory')
  overflows(@Query() q: any) {
    return this.service.overflows(q);
  }

  @Get('overflows/:id')
  @RequirePermissions('inventory')
  overflow(@Param('id') id: string) {
    return this.service.overflow(id);
  }

  @Post('overflows')
  @RequirePermissions('inventory')
  createOverflow(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveDocument('overflow', null, b, u.id, !!b.submit);
  }

  @Patch('overflows/:id')
  @RequirePermissions('inventory')
  updateOverflow(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.saveDocument('overflow', id, b, u.id, !!b.submit);
  }

  @Post('overflows/:id/submit')
  @RequirePermissions('inventory')
  submitOverflow(@Param('id') id: string) {
    return this.service.submitDocument('overflow', id);
  }

  @Delete('overflows/:id')
  @RequirePermissions('inventory')
  removeOverflow(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeDocument('overflow', id, u.id);
  }

  @Post('overflows/:id/approve')
  @RequirePermissions('inventory')
  approveOverflow(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.service.approveDocument(
      'overflow',
      id,
      !!b.approved,
      String(b.comment ?? ''),
      u.id,
    );
  }

  // ── alerts ──
  @Get('quantity-alerts')
  @RequirePermissions('inventory')
  quantityAlerts(@Query() q: any) {
    return this.service.quantityAlerts(q);
  }

  @Post('quantity-alerts')
  @RequirePermissions('inventory')
  saveQuantityAlert(@Body() b: any) {
    return this.service.saveQuantityAlert(b);
  }

  @Get('expiry-alerts')
  @RequirePermissions('inventory')
  expiryAlerts(@Query() q: any) {
    return this.service.expiryAlerts(q);
  }
}
