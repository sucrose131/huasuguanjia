import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DictionaryController } from './dictionary.controller';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [AuthModule],
  controllers: [DictionaryController, SystemController],
  providers: [SystemService],
})
export class SystemModule {}
