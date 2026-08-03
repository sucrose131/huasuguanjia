import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [PurchaseController],
  providers: [PurchaseService],
})
export class PurchaseModule {}
