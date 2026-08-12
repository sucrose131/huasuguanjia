import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RequisitionController } from './requisition.controller';
import { RequisitionOaCallbackController } from './requisition-oa-callback.controller';
import { RequisitionOaApprovalService } from './requisition-oa-approval.service';
import { RequisitionService } from './requisition.service';
@Module({
  imports: [AuthModule, AttachmentsModule, InventoryModule],
  controllers: [RequisitionController, RequisitionOaCallbackController],
  providers: [RequisitionService, RequisitionOaApprovalService],
})
export class RequisitionModule {}
