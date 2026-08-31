import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DictionaryController } from './dictionary.controller';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { AmountAccessModule } from '../amount-access/amount-access.module';

@Module({
  imports: [AuthModule, AmountAccessModule],
  controllers: [DictionaryController, SystemController],
  providers: [SystemService],
})
export class SystemModule {}
