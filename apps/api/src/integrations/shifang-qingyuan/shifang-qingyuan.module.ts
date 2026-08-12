import { Module } from '@nestjs/common';
import { ShifangQingyuanService } from './shifang-qingyuan.service';
import { ShifangQingyuanGoodsSyncService } from './sync/goods-sync.service';

@Module({
  providers: [ShifangQingyuanService, ShifangQingyuanGoodsSyncService],
  exports: [ShifangQingyuanService, ShifangQingyuanGoodsSyncService],
})
export class ShifangQingyuanModule {}
