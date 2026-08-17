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
import { PurchaseService } from './purchase.service';
import { PurchaseOaApprovalService } from './purchase-oa-approval.service';
import { PurchaseReturnOaApprovalService } from './purchase-return-oa-approval.service';
import { AmountAccessService } from '../amount-access/amount-access.service';
import { PURCHASE_ORDER_AMOUNT_FIELDS } from '../amount-access/amount-field-registry';
import { RequireAmountEdit } from '../amount-access/amount-access.decorator';
@UseGuards(AuthGuard, PermissionGuard)
@Controller('purchase')
export class PurchaseController {
  constructor(
    @Inject(PurchaseService) private service: PurchaseService,
    @Inject(PurchaseOaApprovalService) private oaApproval: PurchaseOaApprovalService,
    @Inject(PurchaseReturnOaApprovalService)
    private returnOaApproval: PurchaseReturnOaApprovalService,
    @Inject(AmountAccessService) private amountAccess: AmountAccessService,
  ) {}

  private async protectPurchaseAmounts<T>(value: T, userId: string): Promise<T> {
    const access = await this.amountAccess.forUser(userId);
    const protectedValue = access.canViewAmount
      ? value
      : this.amountAccess.maskFields(value, PURCHASE_ORDER_AMOUNT_FIELDS);
    if (!protectedValue || typeof protectedValue !== 'object' || Array.isArray(protectedValue))
      return protectedValue;
    return {
      ...protectedValue,
      amountAccess: access.level,
      amountMasked: !access.canViewAmount,
    } as T;
  }
  @RequirePermissions('purchase')
  @Get(':resource/:id/operation-history')
  operationHistory(@Param('resource') resource: string, @Param('id') id: string) {
    return this.service.operationHistory(resource, id);
  }
  @RequirePermissions('purchase')
  @Get('applications')
  applications(@Query() q: Record<string, string>) {
    return this.service.applications(q);
  }
  @RequirePermissions('purchase')
  @Get('applications/:id')
  async application(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.protectPurchaseAmounts(await this.service.application(id), u.id);
  }
  @RequirePermissions('purchase')
  @Post('applications')
  createApplication(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.service.saveApplication(null, b, u.id);
  }
  @RequirePermissions('purchase')
  @Patch('applications/:id')
  updateApplication(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.saveApplication(id, b, u.id);
  }
  @RequirePermissions('purchase')
  @Post('applications/:id/submit')
  async submitApplication(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    await this.service.submitApplication(id, u.id);
    const oa = await this.oaApproval.submit(BigInt(id), u.id);
    return {
      id,
      message:
        oa.procStatus === 'PUSH_FAILED'
          ? `采购申请已提交，但发送OA失败：${oa.errorMessage ?? '请稍后重试'}`
          : '采购申请已提交OA审批',
      oaStatus: oa.procStatus,
      oaProcessId: oa.procInstId,
    };
  }
  @RequirePermissions('purchase')
  @Post('applications/:id/approve')
  approveApplication(
    @Param('id') id: string,
    @Body() b: { approved: boolean; comment?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.approveApplication(id, b.approved, b.comment ?? '', u.id);
  }
  @RequirePermissions('purchase')
  @Post('applications/:id/generate-order')
  async generateApplicationOrder(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    await this.amountAccess.assertCanEdit(u.id);
    return this.service.generateApplicationOrder(id, b, u.id);
  }
  @RequirePermissions('purchase')
  @Delete('applications/:id')
  removeApplication(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeApplication(id, u.id);
  }
  @RequirePermissions('purchase')
  @Get('orders')
  async orders(@Query() q: Record<string, string>, @CurrentUser() u: AuthUser) {
    return this.protectPurchaseAmounts(await this.service.orders(q), u.id);
  }
  @RequirePermissions('purchase')
  @Get('orders/:id')
  async order(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.protectPurchaseAmounts(await this.service.order(id), u.id);
  }
  @RequirePermissions('purchase')
  @Post('orders')
  async createOrder(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    await this.amountAccess.assertCanEdit(u.id);
    return this.service.saveOrder(null, b, u.id);
  }
  @RequirePermissions('purchase')
  @Patch('orders/:id')
  async updateOrder(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    await this.amountAccess.assertCanEdit(u.id);
    return this.service.saveOrder(id, b, u.id);
  }
  @RequirePermissions('purchase')
  @Post('orders/:id/start')
  startOrder(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.startOrder(id, u.id);
  }
  @RequirePermissions('purchase')
  @Post('orders/:id/generate-receipt')
  generateReceipt(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.generateReceipt(id, u.id, b.warehouseId);
  }
  @RequirePermissions('purchase')
  @Delete('orders/:id')
  removeOrder(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeOrder(id, u.id);
  }
  @RequirePermissions('purchase')
  @Post('orders/:id/cancel-pending')
  cancelOrderPending(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.cancelOrderPending(id, b, u.id);
  }
  @RequirePermissions('purchase')
  @Get('receipts')
  receipts(@Query() q: Record<string, string>) {
    return this.service.receipts(q);
  }
  @RequirePermissions('purchase')
  @Get('receipts/:id')
  receipt(@Param('id') id: string) {
    return this.service.receipt(id);
  }
  @RequirePermissions('purchase')
  @Post('receipts')
  async createReceipt(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    if (b.directReceipt) await this.amountAccess.assertCanEdit(u.id);
    return this.service.saveReceipt(null, b, u.id);
  }
  @RequirePermissions('purchase')
  @Patch('receipts/:id')
  async updateReceipt(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    if (b.directReceipt) await this.amountAccess.assertCanEdit(u.id);
    return this.service.saveReceipt(id, b, u.id);
  }
  @RequirePermissions('purchase')
  @Post('receipts/:id/confirm')
  confirmReceipt(
    @Param('id') id: string,
    @Body() b: { confirmed: boolean; comment?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.confirmReceipt(id, b.confirmed, b.comment ?? '', u.id);
  }
  @RequirePermissions('purchase')
  @Post('receipts/:id/cancel')
  cancelReceipt(
    @Param('id') id: string,
    @Body() b: { comment?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.cancelReceipt(id, b.comment ?? '', u.id);
  }
  @RequirePermissions('purchase')
  @Post('receipts/:id/return')
  async executeReceiptReturn(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    // 兼容旧入口，但只创建并提交审批，不再允许绕过OA/审批直接扣减库存。
    const saved = await this.service.saveReturn(null, { ...b, receiptId: id }, u.id, true);
    const oa = await this.returnOaApproval.submit(saved.id, u.id);
    return {
      ...saved,
      message:
        oa.procStatus === 'PUSH_FAILED'
          ? `采购退货已提交，但发送OA失败：${oa.errorMessage ?? '请稍后重试'}`
          : '采购退货已提交OA审批',
      oaStatus: oa.procStatus,
      oaProcessId: oa.procInstId,
    };
  }
  @RequirePermissions('purchase')
  @Delete('receipts/:id')
  removeReceipt(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeReceipt(id, u.id);
  }
  @RequirePermissions('purchase')
  @Get('returns')
  returns(@Query() q: Record<string, string>) {
    return this.service.returns(q);
  }
  @RequirePermissions('purchase')
  @Get('returns/:id')
  returnDetail(@Param('id') id: string) {
    return this.service.returnDetail(id);
  }
  @RequirePermissions('purchase')
  @Post('returns')
  createReturn(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.service.saveReturn(null, b, u.id);
  }
  @RequirePermissions('purchase')
  @Patch('returns/:id')
  updateReturn(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.saveReturn(id, b, u.id);
  }
  @RequirePermissions('purchase')
  @Post('returns/:id/submit')
  async submitReturn(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    await this.service.submitReturn(id, u.id);
    const oa = await this.returnOaApproval.submit(BigInt(id), u.id);
    return {
      id,
      message:
        oa.procStatus === 'PUSH_FAILED'
          ? `采购退货已提交，但发送OA失败：${oa.errorMessage ?? '请稍后重试'}`
          : '采购退货已提交OA审批',
      oaStatus: oa.procStatus,
      oaProcessId: oa.procInstId,
    };
  }
  @RequirePermissions('purchase')
  @Post('returns/:id/approve')
  approveReturn(
    @Param('id') id: string,
    @Body() b: { approved: boolean; comment?: string },
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.approveReturn(id, b.approved, b.comment ?? '', u.id);
  }
  @RequirePermissions('purchase')
  @Delete('returns/:id')
  removeReturn(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeReturn(id, u.id);
  }
  @RequirePermissions('purchase')
  @Get('refunds')
  refunds(@Query() q: Record<string, string>) {
    return this.service.refunds(q);
  }
  @RequirePermissions('purchase')
  @Delete('refunds/flows/:id')
  voidRefundFlow(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.voidRefundFlow(id, u.id);
  }
  @RequirePermissions('purchase')
  @Get('refunds/:id')
  refund(@Param('id') id: string) {
    return this.service.refund(id);
  }
  @RequirePermissions('purchase')
  @RequireAmountEdit()
  @Post('refunds/:id/flows')
  createRefundFlow(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.createRefundFlow(id, b, u.id);
  }
  @RequirePermissions('purchase')
  @Post('refunds/:id/close')
  closeRefund(@Param('id') id: string, @Body() b: { reason?: string }, @CurrentUser() u: AuthUser) {
    return this.service.closeRefund(id, String(b.reason ?? ''), u.id);
  }
  @RequirePermissions('purchase')
  @Get('payments')
  payments(@Query() q: Record<string, string>) {
    return this.service.payments(q);
  }
  @RequirePermissions('purchase')
  @Get('payments/:id')
  payment(@Param('id') id: string) {
    return this.service.payment(id);
  }
  @RequirePermissions('purchase')
  @RequireAmountEdit()
  @Post('payments')
  createPayment(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.service.savePayment(null, b, u.id);
  }
  @RequirePermissions('purchase')
  @RequireAmountEdit()
  @Patch('payments/:id')
  updatePayment(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.savePayment(id, b, u.id);
  }
  @RequirePermissions('purchase')
  @Delete('payments/:id')
  removePayment(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removePayment(id, u.id);
  }
}
