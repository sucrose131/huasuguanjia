import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { HuasuHomeController } from './huasu-home.controller';
import { HuasuHomeService } from './huasu-home.service';
import { HuasuHomeProductSyncService } from './sync/product-sync.service';

@Module({
  imports: [AuthModule],
  controllers: [HuasuHomeController],
  providers: [HuasuHomeService, HuasuHomeProductSyncService],
  exports: [HuasuHomeService, HuasuHomeProductSyncService],
})
export class HuasuHomeModule {}
