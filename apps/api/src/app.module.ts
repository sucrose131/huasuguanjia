import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { BaseDataModule } from './base-data/base-data.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { GoodsModule } from './goods/goods.module';
import { RedisModule } from './redis/redis.module';
import { PurchaseModule } from './purchase/purchase.module';
import { SystemModule } from './system/system.module';
import { InventoryModule } from './inventory/inventory.module';
import { ProductionModule } from './production/production.module';
import { SalesModule } from './sales/sales.module';
import { RequisitionModule } from './requisition/requisition.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DocumentTraceModule } from './document-trace/document-trace.module';
import { BusinessNumberModule } from './business-number/business-number.module';
import { AttachmentsModule } from './attachments/attachments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RedisModule,
    BusinessNumberModule,
    AttachmentsModule,
    AuthModule,
    BaseDataModule,
    GoodsModule,
    InventoryModule,
    PurchaseModule,
    ProductionModule,
    SalesModule,
    RequisitionModule,
    SystemModule,
    DashboardModule,
    DocumentTraceModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
