import { Module } from '@nestjs/common';
import { BusinessNumberModule } from '../../business-number/business-number.module';
import { ExternalInventoryPostingService } from '../common/external-inventory-posting.service';
import { ShifangQingyuanService } from './shifang-qingyuan.service';
import { ShifangQingyuanGoodsSyncService } from './sync/goods-sync.service';
import { ShifangQingyuanOrderSyncService } from './sync/order-sync.service';
import { ShifangQingyuanUserSyncScheduler } from './sync/user-sync.scheduler';
import { ShifangQingyuanUserSyncService } from './sync/user-sync.service';

/**
 * 十方清源对接模块。
 * 本期仅提供 Service 供内部调用 / 测试；HTTP 手动同步接口暂不挂载。
 * 用户同步通过进程内定时任务触发。
 */
@Module({
  imports: [BusinessNumberModule],
  providers: [
    ShifangQingyuanService,
    ShifangQingyuanGoodsSyncService,
    ExternalInventoryPostingService,
    ShifangQingyuanOrderSyncService,
    ShifangQingyuanUserSyncService,
    ShifangQingyuanUserSyncScheduler,
  ],
  exports: [
    ShifangQingyuanService,
    ShifangQingyuanGoodsSyncService,
    ShifangQingyuanOrderSyncService,
    ShifangQingyuanUserSyncService,
  ],
})
export class ShifangQingyuanModule {}
