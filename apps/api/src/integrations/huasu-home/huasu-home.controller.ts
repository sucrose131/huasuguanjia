import { Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth.types';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { HuasuHomeOrderSyncService } from './sync/order-sync.service';
import { HuasuHomeProductSyncService } from './sync/product-sync.service';
import type { HuasuHomeOrderSyncOptions } from './sync/order-sync.types';

/**
 * 华溯之家对接接口
 *
 * POST /integrations/huasu-home/sync/products — 手动同步商品
 * POST /integrations/huasu-home/sync/orders — 手动同步订单列表
 * POST /integrations/huasu-home/sync/orders/:orderSn — 按华溯订单编号单笔同步
 */
@UseGuards(AuthGuard, PermissionGuard)
@Controller('integrations/huasu-home')
export class HuasuHomeController {
  constructor(
    @Inject(HuasuHomeProductSyncService)
    private readonly productSync: HuasuHomeProductSyncService,
    @Inject(HuasuHomeOrderSyncService)
    private readonly orderSync: HuasuHomeOrderSyncService,
  ) {}

  @RequirePermissions('goods')
  @Post('sync/products')
  syncProducts(@CurrentUser() user: AuthUser) {
    return this.productSync.syncProducts(user.id);
  }

  @RequirePermissions('sales')
  @Post('sync/orders')
  syncOrders(@CurrentUser() user: AuthUser, @Body() body: HuasuHomeOrderSyncOptions = {}) {
    return this.orderSync.syncOrders(user.id, body ?? {});
  }

  @RequirePermissions('sales')
  @Post('sync/orders/:orderSn')
  syncOrderBySn(@CurrentUser() user: AuthUser, @Param('orderSn') orderSn: string) {
    return this.orderSync.syncOrderBySn(orderSn, user.id);
  }
}
