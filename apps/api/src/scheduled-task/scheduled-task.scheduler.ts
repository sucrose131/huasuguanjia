import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { cronMatchesCurrentMinute, shanghaiMinuteKey } from './cron.util';
import { ScheduledTaskRunner } from './scheduled-task.runner';
import { ScheduledTaskService } from './scheduled-task.service';

@Injectable()
export class ScheduledTaskScheduler {
  private static readonly logger = new Logger(ScheduledTaskScheduler.name);
  private lastMinuteKey = '';
  private ticking = false;

  constructor(
    @Inject(ScheduledTaskService) private readonly tasks: ScheduledTaskService,
    @Inject(ScheduledTaskRunner) private readonly runner: ScheduledTaskRunner,
  ) {}

  @Interval(10_000)
  async tick() {
    if (this.ticking) return;
    const now = new Date();
    const minuteKey = shanghaiMinuteKey(now);
    if (minuteKey === this.lastMinuteKey) return;
    this.ticking = true;
    try {
      const enabled = await this.tasks.listEnabled();
      for (const task of enabled) {
        if (!cronMatchesCurrentMinute(task.cron_expr, now)) continue;
        ScheduledTaskScheduler.logger.log(`触发任务 ${task.task_code} (${task.cron_expr})`);
        this.runner.enqueue(task.id, task.task_code);
      }
      this.lastMinuteKey = minuteKey;
    } catch (error) {
      ScheduledTaskScheduler.logger.error('调度扫描失败，将在本分钟内重试', error as Error);
    } finally {
      this.ticking = false;
    }
  }
}
