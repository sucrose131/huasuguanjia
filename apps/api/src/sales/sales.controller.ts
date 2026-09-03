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
import { SalesService } from './sales.service';
import { SalesOaApprovalService } from './sales-oa-approval.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ApproveOrderDto } from './dto/approve-order.dto';
import { RequireAmountEdit } from '../amount-access/amount-access.decorator';
import { AmountAccessService } from '../amount-access/amount-access.service';
@UseGuards(AuthGuard, PermissionGuard)
@Controller('sales')
export class SalesController {
  constructor(
    @Inject(SalesService) private readonly s: SalesService,
    @Inject(SalesOaApprovalService) private readonly oa: SalesOaApprovalService,
    @Inject(AmountAccessService) private readonly amountAccess: AmountAccessService,
  ) {}
  @RequirePermissions('sales')
  @Get('product-options')
  productOptions(@Query('orgId') orgId?: string, @Query('warehouseId') warehouseId?: string) {
    return this.s.productOptions(orgId, warehouseId);
  }
  @RequirePermissions('sales')
  @Get('orders')
  orders(@Query() q: any) {
    return this.s.orders(q);
  }
  @RequirePermissions('sales')
  @Get('order-options')
  orderOptions(@Query() q: any) {
    return this.s.orderOptions(q);
  }
  @RequirePermissions('sales')
  @Get('money-order-options')
  moneyOrderOptions(@Query() q: any) {
    return this.s.moneyOrderOptions(q);
  }
  @RequirePermissions('sales')
  @Get('output-options')
  outputOptions(@Query('orderId') orderId?: string) {
    return this.s.outputOptions(orderId);
  }
  @RequirePermissions('sales')
  @Get('orders/search')
  searchOrders(@Query() q: any) {
    return this.s.orderOptions(q);
  }
  @RequirePermissions('sales')
  @Get('orders/:id/payment-summary')
  paymentSummary(@Param('id') id: string) {
    return this.s.paymentSummary(id);
  }
  @RequirePermissions('sales')
  @Get('orders/:id')
  order(@Param('id') id: string) {
    return this.s.order(id);
  }
  @RequirePermissions('sales')
  @RequireAmountEdit()
  @Post('orders')
  createOrder(@Body() dto: CreateOrderDto, @CurrentUser() u: AuthUser) {
    return this.s.saveOrder(null, dto as any, u.id, 1);
  }
  @RequirePermissions('sales')
  @RequireAmountEdit()
  @Patch('orders/:id')
  async updateOrder(@Param('id') id: string, @Body() dto: CreateOrderDto, @CurrentUser() u: AuthUser) {
    await this.amountAccess.assertCanEditRecord(u.id, await this.s.saleOrderCreatedBy(id));
    return this.s.saveOrder(id, dto as any, u.id, 1);
  }
  @RequirePermissions('sales')
  @Post('orders/:id/approve')
  approveOrder(@Param('id') id: string, @Body() dto: ApproveOrderDto, @CurrentUser() u: AuthUser) {
    return this.s.approveOrder(id, dto.approved, dto.comment ?? '', u.id);
  }
  @RequirePermissions('sales')
  @Delete('orders/:id')
  deleteOrder(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.deleteOrder(id, u.id);
  }
  @RequirePermissions('sales')
  @Post('orders/:id/analyze')
  analyze(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.analyze(id, u.id);
  }
  @RequirePermissions('sales')
  @Get('outputs')
  outputs(@Query() q: any) {
    return this.s.outputs(q);
  }
  @RequirePermissions('sales')
  @Get('outputs/:id')
  output(@Param('id') id: string) {
    return this.s.output(id);
  }
  @RequirePermissions('sales')
  @Post('outputs')
  createOutput(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveOutput(null, b, u.id);
  }
  @RequirePermissions('sales')
  @Patch('outputs/:id')
  updateOutput(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveOutput(id, b, u.id);
  }
  @RequirePermissions('sales')
  @Delete('outputs/:id')
  deleteOutput(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.removeDocument('output', id, u.id);
  }
  @RequirePermissions('sales')
  @Post('outputs/:id/confirm')
  confirmOutput(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.confirmOutput(id, String(b.comment ?? ''), u.id);
  }
  @RequirePermissions('sales')
  @Post('outputs/:id/undo-confirm')
  undoOutput(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.undoOutput(id, String(b.comment ?? ''), u.id);
  }
  @RequirePermissions('sales')
  @Get('returns')
  returns(@Query() q: any) {
    return this.s.returns(q);
  }
  @RequirePermissions('sales')
  @Get('returns/:id')
  returnOne(@Param('id') id: string) {
    return this.s.returnOne(id);
  }
  @RequirePermissions('sales')
  @Post('returns')
  createReturn(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveReturn(null, b, u.id);
  }
  @RequirePermissions('sales')
  @Patch('returns/:id')
  updateReturn(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveReturn(id, b, u.id);
  }
  @RequirePermissions('sales')
  @Delete('returns/:id')
  deleteReturn(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.removeDocument('return', id, u.id);
  }
  @RequirePermissions('sales')
  @Post('returns/:id/confirm')
  confirmReturn(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.confirmReturn(id, String(b.comment ?? ''), u.id);
  }
  @RequirePermissions('sales')
  @Post('returns/:id/undo-confirm')
  undoReturn(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.undoReturn(id, String(b.comment ?? ''), u.id);
  }
  @RequirePermissions('sales')
  @Get('payments')
  payments(@Query() q: any) {
    return this.s.payments(q, 1);
  }
  @RequirePermissions('sales')
  @Get('payments/:id')
  paymentDetail(@Param('id') id: string) {
    return this.s.payment(id, 1);
  }
  @RequirePermissions('sales')
  @RequireAmountEdit()
  @Post('payments')
  payment(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.createPayment(b, 1, u.id);
  }
  @RequirePermissions('sales')
  @Delete('payments/:id')
  voidPayment(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.voidPayment(id, 1, u.id);
  }
  @RequirePermissions('sales')
  @Get('refunds')
  refunds(@Query() q: any) {
    return this.s.payments(q, 2);
  }
  @RequirePermissions('sales')
  @Get('refunds/:id')
  refundDetail(@Param('id') id: string) {
    return this.s.payment(id, 2);
  }
  @RequirePermissions('sales')
  @RequireAmountEdit()
  @Post('refunds')
  refund(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.createPayment(b, 2, u.id);
  }
  @RequirePermissions('sales')
  @Delete('refunds/:id')
  voidRefund(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.voidPayment(id, 2, u.id);
  }
  @RequirePermissions('sales')
  @Get('discount-orders')
  discounts(@Query() q: any) {
    return this.s.orders(q, 2);
  }
  @RequirePermissions('sales')
  @RequireAmountEdit()
  @Post('discount-orders')
  async createDiscount(@Body() dto: CreateOrderDto, @CurrentUser() u: AuthUser) {
    const result = await this.s.saveOrder(null, dto as any, u.id, 2);
    return { ...result, oa: await this.oa.submitDiscountOrder(BigInt(result.id), u.id) };
  }
  @RequirePermissions('sales')
  @RequireAmountEdit()
  @Patch('discount-orders/:id')
  async updateDiscount(
    @Param('id') id: string,
    @Body() dto: CreateOrderDto,
    @CurrentUser() u: AuthUser,
  ) {
    await this.amountAccess.assertCanEditRecord(u.id, await this.s.saleOrderCreatedBy(id));
    const result = await this.s.saveOrder(id, dto as any, u.id, 2);
    return { ...result, oa: await this.oa.submitDiscountOrder(BigInt(result.id), u.id) };
  }
  @RequirePermissions('sales')
  @Delete('discount-orders/:id')
  deleteDiscount(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.deleteOrder(id, u.id);
  }
  @RequirePermissions('sales')
  @Post('discount-orders/:id/approve')
  approveDiscount(
    @Param('id') id: string,
    @Body() dto: ApproveOrderDto,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.approveOrder(id, dto.approved, dto.comment ?? '', u.id);
  }
  @RequirePermissions('sales')
  @Get('services')
  services(@Query() q: any) {
    return this.s.services(q);
  }
  @RequirePermissions('sales')
  @Get('services/source-options')
  serviceSourceOptions(@Query() q: any) {
    return this.s.serviceSourceOptions(q);
  }
  @RequirePermissions('sales')
  @Get('services/:id')
  service(@Param('id') id: string) {
    return this.s.service(id);
  }
  @RequirePermissions('sales')
  @Get('services/:id/progress')
  serviceProgresses(@Param('id') id: string) {
    return this.s.serviceProgresses(id);
  }
  @RequirePermissions('sales')
  @Post('services/:id/progress')
  createServiceProgress(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveServiceProgress(id, null, b, u.id);
  }
  @RequirePermissions('sales')
  @Patch('services/:id/progress/:progressId')
  updateServiceProgress(
    @Param('id') id: string,
    @Param('progressId') progressId: string,
    @Body() b: any,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.saveServiceProgress(id, progressId, b, u.id);
  }
  @RequirePermissions('sales')
  @Delete('services/:id/progress/:progressId')
  deleteServiceProgress(
    @Param('id') id: string,
    @Param('progressId') progressId: string,
    @CurrentUser() u: AuthUser,
  ) {
    return this.s.deleteServiceProgress(id, progressId, u.id);
  }
  @RequirePermissions('sales')
  @Post('services')
  createService(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveService(null, b, u.id);
  }
  @RequirePermissions('sales')
  @Patch('services/:id')
  updateService(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveService(id, b, u.id);
  }
  @RequirePermissions('sales')
  @Delete('services/:id')
  deleteService(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.deleteService(id, u.id);
  }
  @RequirePermissions('sales')
  @Post('services/:id/process')
  processService(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.processService(id, u.id);
  }
}
