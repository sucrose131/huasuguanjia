import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { HuasuHomeModule } from '../integrations/huasu-home/huasu-home.module';
import { ShifangQingyuanModule } from '../integrations/shifang-qingyuan/shifang-qingyuan.module';
import { XinfutongOaModule } from '../integrations/xinfutong-oa/xinfutong-oa.module';
import { ScheduledTaskController } from './scheduled-task.controller';
import { ScheduledTaskHandlers } from './scheduled-task.handlers';
import { ScheduledTaskRunner } from './scheduled-task.runner';
import { ScheduledTaskScheduler } from './scheduled-task.scheduler';
import { ScheduledTaskService } from './scheduled-task.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    HuasuHomeModule,
    ShifangQingyuanModule,
    XinfutongOaModule,
  ],
  controllers: [ScheduledTaskController],
  providers: [ScheduledTaskService, ScheduledTaskHandlers, ScheduledTaskRunner, ScheduledTaskScheduler],
})
export class ScheduledTaskModule {}
