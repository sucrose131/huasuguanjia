import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductionModule } from '../production/production.module';
import { SalesController } from './sales.controller';
import { AftersalesIntegrationController } from './aftersales-integration.controller';
import { SalesService } from './sales.service';
import { SalesOaApprovalService } from './sales-oa-approval.service';
import { XinfutongOaModule } from '../integrations/xinfutong-oa/xinfutong-oa.module';
@Module({
  imports: [AuthModule, InventoryModule, ProductionModule, XinfutongOaModule],
  controllers: [SalesController, AftersalesIntegrationController],
  providers: [SalesService, SalesOaApprovalService],
  exports: [SalesService, SalesOaApprovalService],
})
export class SalesModule {}
