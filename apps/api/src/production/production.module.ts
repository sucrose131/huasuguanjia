import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionController } from './production.controller';
import { ProductionService } from './production.service';
import { ProductionOaApprovalService } from './production-oa-approval.service';
import { XinfutongOaModule } from '../integrations/xinfutong-oa/xinfutong-oa.module';

@Module({
  imports: [AuthModule, InventoryModule, XinfutongOaModule],
  controllers: [ProductionController],
  providers: [ProductionService, ProductionOaApprovalService],
  exports: [ProductionService, ProductionOaApprovalService],
})
export class ProductionModule {}
