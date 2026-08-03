import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryController } from './inventory.controller';
import { InventoryAlertService } from './inventory-alert.service';
import { InventoryPostingService } from './inventory-posting.service';
import { InventoryService } from './inventory.service';

@Module({
  imports: [AuthModule],
  controllers: [InventoryController],
  providers: [InventoryAlertService, InventoryPostingService, InventoryService],
  exports: [InventoryAlertService, InventoryPostingService],
})
export class InventoryModule {}
