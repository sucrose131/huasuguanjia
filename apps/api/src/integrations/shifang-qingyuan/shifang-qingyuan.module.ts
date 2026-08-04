import { Module } from '@nestjs/common';
import { ShifangQingyuanService } from './shifang-qingyuan.service';

@Module({
  providers: [ShifangQingyuanService],
  exports: [ShifangQingyuanService],
})
export class ShifangQingyuanModule {}
