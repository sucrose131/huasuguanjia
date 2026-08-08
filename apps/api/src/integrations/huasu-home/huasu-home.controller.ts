import { Controller, Inject, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth.types';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { HuasuHomeProductSyncService } from './sync/product-sync.service';

/**
 * 华溯之家对接接口
 *
 * POST /integrations/huasu-home/sync/products — 手动同步商品
 */
@UseGuards(AuthGuard, PermissionGuard)
@Controller('integrations/huasu-home')
export class HuasuHomeController {
  constructor(
    @Inject(HuasuHomeProductSyncService)
    private readonly productSync: HuasuHomeProductSyncService,
  ) {}

  @RequirePermissions('goods')
  @Post('sync/products')
  syncProducts(@CurrentUser() user: AuthUser) {
    return this.productSync.syncProducts(user.id);
  }
}
