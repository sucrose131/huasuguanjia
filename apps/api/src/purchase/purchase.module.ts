import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseOaApprovalService } from './purchase-oa-approval.service';
import { PurchaseReturnOaApprovalService } from './purchase-return-oa-approval.service';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
import { XinfutongOaModule } from '../integrations/xinfutong-oa/xinfutong-oa.module';
import { AmountAccessModule } from '../amount-access/amount-access.module';
import { MessageModule } from '../message/message.module';
@Module({
  imports: [
    AuthModule,
    AttachmentsModule,
    InventoryModule,
    XinfutongOaModule,
    AmountAccessModule,
    MessageModule,
  ],
  controllers: [PurchaseController],
  providers: [PurchaseService, PurchaseOaApprovalService, PurchaseReturnOaApprovalService],
  exports: [PurchaseService, PurchaseReturnOaApprovalService],
})
export class PurchaseModule {}
