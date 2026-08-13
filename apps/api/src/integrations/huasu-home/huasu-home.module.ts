import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { BusinessNumberModule } from '../../business-number/business-number.module';
import { HuasuHomeController } from './huasu-home.controller';
import { HuasuHomeService } from './huasu-home.service';
import { ExternalInventoryPostingService } from '../common/external-inventory-posting.service';
import { HuasuHomeConferenceOrderSyncService } from './sync/conference-order-sync.service';
import { HuasuHomeInstallmentOrderSyncService } from './sync/installment-order-sync.service';
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
    HuasuHomeConferenceOrderSyncService,
    HuasuHomeInstallmentOrderSyncService,
    HuasuHomeUserSyncService,
    HuasuHomeUserSyncScheduler,
  ],
  exports: [
    HuasuHomeService,
    HuasuHomeProductSyncService,
    HuasuHomeOrderSyncService,
    HuasuHomeConferenceOrderSyncService,
    HuasuHomeInstallmentOrderSyncService,
    HuasuHomeUserSyncService,
  ],
})
export class HuasuHomeModule {}
