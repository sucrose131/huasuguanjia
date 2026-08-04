import { Module } from '@nestjs/common';
import { HuasuHomeService } from './huasu-home.service';

@Module({
  providers: [HuasuHomeService],
  exports: [HuasuHomeService],
})
export class HuasuHomeModule {}
