import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AuthUser } from '../auth/auth.types';
import { InventoryGeneralService } from './inventory-general.service';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('inventory')
export class InventoryGeneralController {
  constructor(@Inject(InventoryGeneralService) private readonly service: InventoryGeneralService) {}

  @Get('general-orders/config')
  @RequirePermissions('inventory')
  config() {
    return this.service.featureConfig();
  }

  @Get('general-orders/product-options')
  @RequirePermissions('inventory')
  productOptions(@Query('orgId') orgId?: string, @Query('warehouseId') warehouseId?: string) {
    return this.service.productOptions(orgId, warehouseId);
  }

  @Patch('general-orders/config/initial-input')
  @RequirePermissions('system:update')
  setInitialInput(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.setInitialInputEnabled(Boolean(body.enabled), user.id);
  }

  @Get('general-inputs')
  @RequirePermissions('inventory')
  inputs(@Query() query: any) {
    return this.service.list(1, query);
  }

  @Get('general-inputs/:id')
  @RequirePermissions('inventory')
  input(@Param('id') id: string) {
    return this.service.detail(id, 1);
  }

  @Post('general-inputs')
  @RequirePermissions('inventory')
  createInput(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.create(1, body, user.id);
  }

  @Get('general-outputs')
  @RequirePermissions('inventory')
  outputs(@Query() query: any) {
    return this.service.list(-1, query);
  }

  @Get('general-outputs/:id')
  @RequirePermissions('inventory')
  output(@Param('id') id: string) {
    return this.service.detail(id, -1);
  }

  @Post('general-outputs')
  @RequirePermissions('inventory')
  createOutput(@Body() body: any, @CurrentUser() user: AuthUser) {
    return this.service.create(-1, body, user.id);
  }
}
