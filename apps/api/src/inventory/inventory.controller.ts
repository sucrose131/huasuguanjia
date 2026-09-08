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
import { InventoryOaApprovalService } from './inventory-oa-approval.service';
import { AmountAllScopeOnly } from '../amount-access/amount-access.decorator';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly service: InventoryService,
    @Inject(InventoryOaApprovalService) private readonly oa: InventoryOaApprovalService,
  ) {}

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
  // 库存查询包含单位成本、库存金额及库存总值：金额仅“可查看 + 权限内全部”可见，
  // own 范围一律脱敏，避免通过库存存量反推库存价值。
  @AmountAllScopeOnly()
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
  async createTransfer(@Body() b: any, @CurrentUser() u: AuthUser) {
    const saved = await this.service.saveTransfer(null, b, u.id, !!b.submit);
    return b.submit ? this.withOa(saved, await this.oa.submitTransfer(saved.id, u.id)) : saved;
  }

  @Patch('transfers/:id')
  @RequirePermissions('inventory')
  async updateTransfer(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    const saved = await this.service.saveTransfer(id, b, u.id, !!b.submit);
    return b.submit ? this.withOa(saved, await this.oa.submitTransfer(saved.id, u.id)) : saved;
  }

  @Post('transfers/:id/submit')
  @RequirePermissions('inventory')
  async submitTransfer(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const saved = await this.service.submitTransfer(id);
    return this.withOa(saved, await this.oa.submitTransfer(BigInt(id), u.id));
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
  async createAdjustment(@Body() b: any, @CurrentUser() u: AuthUser) {
    const saved = await this.service.saveAdjustment(null, b, u.id, !!b.submit);
    return b.submit ? this.withOa(saved, await this.oa.submitAdjustment(saved.id, u.id)) : saved;
  }

  @Patch('adjustments/:id')
  @RequirePermissions('inventory')
  async updateAdjustment(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    const saved = await this.service.saveAdjustment(id, b, u.id, !!b.submit);
    return b.submit ? this.withOa(saved, await this.oa.submitAdjustment(saved.id, u.id)) : saved;
  }

  @Post('adjustments/:id/submit')
  @RequirePermissions('inventory')
  async submitAdjustment(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const saved = await this.service.submitAdjustment(id);
    return this.withOa(saved, await this.oa.submitAdjustment(BigInt(id), u.id));
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

  private withOa<T extends { id: bigint | string }>(saved: T, oa: any) {
    return {
      ...saved,
      message:
        oa.procStatus === 'PUSH_FAILED'
          ? `单据已提交，但发送OA失败：${oa.errorMessage ?? '请稍后重试'}`
          : '单据已提交OA审批',
      oaStatus: oa.procStatus,
      oaProcessId: oa.procInstId,
    };
  }

  // ── checks ──
  @Get('checks')
  @RequirePermissions('inventory')
  checks(@Query() q: any) {
    return this.service.checks(q);
  }

  // 盘点单详情含整仓库存的成本单价快照（details.unitPrice/all_value 等）：
  // 金额仅“可查看 + 权限内全部”可见，own 范围不因单据 created_by 归属而放行，
  // 防止通过新建/查看盘点单反推库存价值。
  @AmountAllScopeOnly()
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
  async saveCheck(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    const saved = await this.service.saveCheck(id, b, u.id, !!b.submit);
    return b.submit ? this.withOa(saved, await this.oa.submitCheck(BigInt(id), u.id)) : saved;
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
  async createLoss(@Body() b: any, @CurrentUser() u: AuthUser) {
    const saved = await this.service.saveDocument('loss', null, b, u.id, !!b.submit);
    return b.submit
      ? this.withOa(saved, await this.oa.submitInventoryDocument('loss', saved.id, u.id))
      : saved;
  }

  @Patch('losses/:id')
  @RequirePermissions('inventory')
  async updateLoss(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    const saved = await this.service.saveDocument('loss', id, b, u.id, !!b.submit);
    return b.submit
      ? this.withOa(saved, await this.oa.submitInventoryDocument('loss', saved.id, u.id))
      : saved;
  }

  @Post('losses/:id/submit')
  @RequirePermissions('inventory')
  async submitLoss(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const saved = await this.service.submitDocument('loss', id);
    return this.withOa(saved, await this.oa.submitInventoryDocument('loss', BigInt(id), u.id));
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

  // 报亏出库单（盘点盘亏链）详情含来源盘点的成本单价：金额仅“可查看 + 权限内全部”可见
  @AmountAllScopeOnly()
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

  // 报盈入库单（盘点盘盈链）详情含来源盘点的成本单价：金额仅“可查看 + 权限内全部”可见
  @AmountAllScopeOnly()
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
  async createOverflow(@Body() b: any, @CurrentUser() u: AuthUser) {
    const saved = await this.service.saveDocument('overflow', null, b, u.id, !!b.submit);
    return b.submit
      ? this.withOa(saved, await this.oa.submitInventoryDocument('overflow', saved.id, u.id))
      : saved;
  }

  @Patch('overflows/:id')
  @RequirePermissions('inventory')
  async updateOverflow(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    const saved = await this.service.saveDocument('overflow', id, b, u.id, !!b.submit);
    return b.submit
      ? this.withOa(saved, await this.oa.submitInventoryDocument('overflow', saved.id, u.id))
      : saved;
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
  // 库存预警/效期预警包含库存货值：与库存查询保持一致，金额仅“权限内全部”可见。
  @AmountAllScopeOnly()
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

  @AmountAllScopeOnly()
  @Get('expiry-alerts')
  @RequirePermissions('inventory')
  expiryAlerts(@Query() q: any) {
    return this.service.expiryAlerts(q);
  }
}
