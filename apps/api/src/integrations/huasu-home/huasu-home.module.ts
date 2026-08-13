import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { BusinessNumberModule } from '../../business-number/business-number.module';
import { HuasuHomeController } from './huasu-home.controller';
import { HuasuHomeService } from './huasu-home.service';
import { ExternalInventoryPostingService } from '../common/external-inventory-posting.service';
import { HuasuHomeOrderSyncService } from './sync/order-sync.service';
import { HuasuHomeProductSyncService } from './sync/product-sync.service';
import { HuasuHomeUserSyncScheduler } from './sync/user-sync.scheduler';
import { HuasuHomeUserSyncService } from './sync/user-sync.service';

@Module({
  imports: [AuthModule, BusinessNumberModule],
  controllers: [HuasuHomeController],
  providers: [
    HuasuHomeService,
    HuasuHomeProductSyncService,
    ExternalInventoryPostingService,
    HuasuHomeOrderSyncService,
    HuasuHomeUserSyncService,
    HuasuHomeUserSyncScheduler,
  ],
  exports: [
    HuasuHomeService,
    HuasuHomeProductSyncService,
    HuasuHomeOrderSyncService,
    HuasuHomeUserSyncService,
  ],
})
export class HuasuHomeModule {}
