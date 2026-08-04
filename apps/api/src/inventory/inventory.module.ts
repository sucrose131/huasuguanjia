import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryController } from './inventory.controller';
import { InventoryAlertService } from './inventory-alert.service';
import { InventoryPostingService } from './inventory-posting.service';
import { InventoryService } from './inventory.service';
import { InventoryGeneralController } from './inventory-general.controller';
import { InventoryGeneralService } from './inventory-general.service';

@Module({
  imports: [AuthModule],
  controllers: [InventoryController, InventoryGeneralController],
  providers: [
    InventoryAlertService,
    InventoryPostingService,
    InventoryService,
    InventoryGeneralService,
  ],
  exports: [InventoryAlertService, InventoryPostingService],
})
export class InventoryModule {}
