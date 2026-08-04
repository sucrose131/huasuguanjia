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
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    // 先加载 .env 作为基础，再加载 .env.{NODE_ENV} 做环境覆盖（不存在则忽略）
    // NODE_ENV 未设置时默认 development
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', `.env.${process.env.NODE_ENV ?? 'development'}`],
    }),
    DatabaseModule,
    RedisModule,
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
    IntegrationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
