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
@UseGuards(AuthGuard, PermissionGuard)
@Controller('purchase')
export class PurchaseController {
  constructor(@Inject(PurchaseService) private service: PurchaseService) {}
  @RequirePermissions('purchase')
  @Get('applications')
  applications(@Query() q: Record<string, string>) {
    return this.service.applications(q);
  }
  @RequirePermissions('purchase')
  @Get('applications/:id')
  application(@Param('id') id: string) {
    return this.service.application(id);
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
  submitApplication(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.submitApplication(id, u.id);
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
  @Delete('applications/:id')
  removeApplication(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.removeApplication(id, u.id);
  }
  @RequirePermissions('purchase')
  @Get('orders')
  orders(@Query() q: Record<string, string>) {
    return this.service.orders(q);
  }
  @RequirePermissions('purchase')
  @Get('orders/:id')
  order(@Param('id') id: string) {
    return this.service.order(id);
  }
  @RequirePermissions('purchase')
  @Post('orders')
  createOrder(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.service.saveOrder(null, b, u.id);
  }
  @RequirePermissions('purchase')
  @Patch('orders/:id')
  updateOrder(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
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
  createReceipt(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.service.saveReceipt(null, b, u.id);
  }
  @RequirePermissions('purchase')
  @Patch('receipts/:id')
  updateReceipt(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
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
  executeReceiptReturn(
    @Param('id') id: string,
    @Body() b: Record<string, unknown>,
    @CurrentUser() u: AuthUser,
  ) {
    return this.service.saveReturn(null, { ...b, receiptId: id }, u.id, true, true);
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
  submitReturn(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.service.submitReturn(id, u.id);
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
  @Post('payments')
  createPayment(@Body() b: Record<string, unknown>, @CurrentUser() u: AuthUser) {
    return this.service.savePayment(null, b, u.id);
  }
  @RequirePermissions('purchase')
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
