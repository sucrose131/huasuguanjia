import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RequisitionController } from './requisition.controller';
import { RequisitionService } from './requisition.service';
@Module({
  imports: [AuthModule, InventoryModule],
  controllers: [RequisitionController],
  providers: [RequisitionService],
})
export class RequisitionModule {}
