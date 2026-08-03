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
import { ProductionService } from './production.service';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('production')
export class ProductionController {
  constructor(@Inject(ProductionService) private readonly s: ProductionService) {}
  @RequirePermissions('production')
  @Get('boms')
  boms(@Query() q: any) {
    return this.s.boms(q);
  }
  @RequirePermissions('production')
  @Get('boms/:id')
  bom(@Param('id') id: string) {
    return this.s.bom(id);
  }
  @RequirePermissions('production')
  @Post('boms')
  createBom(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveBomChecked(null, b, u.id);
  }
  @RequirePermissions('production')
  @Patch('boms/:id')
  updateBom(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveBomChecked(id, b, u.id);
  }
  @RequirePermissions('production')
  @Patch('boms/:id/status')
  bomStatus(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.bomStatus(id, Number(b.status), u.id);
  }
  @RequirePermissions('production')
  @Delete('boms/:id')
  deleteBom(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.deleteBom(id, u.id);
  }
  @RequirePermissions('production')
  @Get('plan-source-options')
  planSourceOptions(@Query() q: any) {
    return this.s.planSourceOptions(q);
  }
  @RequirePermissions('production')
  @Get('plans')
  plans(@Query() q: any) {
    return this.s.plans(q);
  }
  @RequirePermissions('production')
  @Get('plans/:id')
  plan(@Param('id') id: string) {
    return this.s.plan(id);
  }
  @RequirePermissions('production')
  @Post('plans')
  createPlan(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.savePlanChecked(null, b, u.id, !!b.submit);
  }
  @RequirePermissions('production')
  @Patch('plans/:id')
  updatePlan(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.savePlanChecked(id, b, u.id, !!b.submit);
  }
  @RequirePermissions('production')
  @Post('plans/:id/approve')
  approvePlan(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.approvePlan(id, !!b.approved, String(b.comment ?? ''), u.id);
  }
  @RequirePermissions('production')
  @Post('plans/:id/recheck')
  recheckPlan(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.recheckPlan(id, u.id);
  }
  @RequirePermissions('production')
  @Post('plans/:id/restart')
  restartPlan(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.restartPlan(id, u.id);
  }
  @RequirePermissions('production')
  @Post('plans/:id/terminate')
  terminatePlan(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.terminatePlan(id, u.id);
  }
  @RequirePermissions('production')
  @Delete('plans/:id')
  deletePlan(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.deletePlan(id, u.id);
  }
  @RequirePermissions('production')
  @Get('plans/export')
  exportPlans(@Query() q: any, @CurrentUser() u: AuthUser) {
    return this.s.exportPlans(q, u.id);
  }
  @RequirePermissions('production')
  @Get('shortages')
  shortages(@Query() q: any) {
    return this.s.shortages(q);
  }
  @RequirePermissions('production')
  @Post('shortages/plan/:id/approve')
  approveShortages(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.approveShortages(id, u.id);
  }
  @RequirePermissions('production')
  @Get('outputs')
  outputs(@Query() q: any) {
    return this.s.outputs(q);
  }
  @RequirePermissions('production')
  @Get('outputs/:id')
  output(@Param('id') id: string) {
    return this.s.output(id);
  }
  @RequirePermissions('production')
  @Post('outputs')
  createOutput(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveOutputChecked(null, b, u.id);
  }
  @RequirePermissions('production')
  @Patch('outputs/:id')
  updateOutput(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.saveOutputChecked(id, b, u.id);
  }
  @RequirePermissions('production')
  @Delete('outputs/:id')
  deleteOutput(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.deleteOutput(id, u.id);
  }
  @RequirePermissions('production')
  @Post('outputs/:id/confirm')
  confirmOutput(@Param('id') id: string, @Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.confirmOutput(id, b, u.id);
  }
  @RequirePermissions('production')
  @Get('inputs')
  inputs(@Query() q: any) {
    return this.s.inputs(q);
  }
  @RequirePermissions('production')
  @Get('inputs/:id')
  input(@Param('id') id: string) {
    return this.s.input(id);
  }
  @RequirePermissions('production')
  @Post('inputs')
  createInput(@Body() b: any, @CurrentUser() u: AuthUser) {
    return this.s.createInputChecked(b, u.id);
  }
  @RequirePermissions('production')
  @Delete('inputs/:id')
  deleteInput(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.s.deleteInput(id, u.id);
  }
}
