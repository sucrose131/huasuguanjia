import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  SHIFANG_QINGYUAN_USER_SYNC_DEFAULT_INTERVAL_MS,
  SHIFANG_QINGYUAN_USER_SYNC_DEFAULT_PAGE_SIZE,
} from '../shifang-qingyuan.constants';
import { ShifangQingyuanUserSyncService } from './user-sync.service';

/**
 * 十方清源用户同步定时任务（进程内 setInterval，无手动 HTTP 触发）
 *
 * 本期参数写死在常量中；开关/间隔/分页等后期改为数据库配置管理，不走环境变量。
 */
@Injectable()
export class ShifangQingyuanUserSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(ShifangQingyuanUserSyncScheduler.name);

  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ShifangQingyuanUserSyncService) private readonly userSync: ShifangQingyuanUserSyncService,
  ) {}

  onModuleInit(): void {
    const intervalMs = SHIFANG_QINGYUAN_USER_SYNC_DEFAULT_INTERVAL_MS;
    const pageSize = SHIFANG_QINGYUAN_USER_SYNC_DEFAULT_PAGE_SIZE;
    ShifangQingyuanUserSyncScheduler.logger.log(
      `十方清源用户同步定时任务已启动 intervalMs=${intervalMs} pageSize=${pageSize}`,
    );

    this.bootTimer = setTimeout(() => {
      void this.runSafe();
    }, 15_000);

    this.timer = setInterval(() => {
      void this.runSafe();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    if (this.timer) clearInterval(this.timer);
    this.bootTimer = null;
    this.timer = null;
  }

  private async runSafe(): Promise<void> {
    try {
      await this.userSync.syncUsers({
        pageSize: SHIFANG_QINGYUAN_USER_SYNC_DEFAULT_PAGE_SIZE,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ShifangQingyuanUserSyncScheduler.logger.error(`十方清源用户同步失败: ${message}`);
    }
  }
}
