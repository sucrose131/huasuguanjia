import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  HUASU_HOME_USER_SYNC_DEFAULT_INTERVAL_MS,
  HUASU_HOME_USER_SYNC_DEFAULT_PAGE_SIZE,
} from '../huasu-home.constants';
import { HuasuHomeUserSyncService } from './user-sync.service';

/**
 * 华溯之家用户同步定时任务（进程内 setInterval，无手动 HTTP 触发）
 *
 * 本期参数写死在常量中；开关/间隔/分页等后期改为数据库配置管理，不走环境变量。
 */
@Injectable()
export class HuasuHomeUserSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private static readonly logger = new Logger(HuasuHomeUserSyncScheduler.name);

  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(HuasuHomeUserSyncService) private readonly userSync: HuasuHomeUserSyncService,
  ) {}

  onModuleInit(): void {
    const intervalMs = HUASU_HOME_USER_SYNC_DEFAULT_INTERVAL_MS;
    const pageSize = HUASU_HOME_USER_SYNC_DEFAULT_PAGE_SIZE;
    HuasuHomeUserSyncScheduler.logger.log(
      `华溯用户同步定时任务已启动 intervalMs=${intervalMs} pageSize=${pageSize}`,
    );

    // 启动后稍延迟首轮，避免与其它模块冷启动抢资源
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
        pageSize: HUASU_HOME_USER_SYNC_DEFAULT_PAGE_SIZE,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      HuasuHomeUserSyncScheduler.logger.error(`华溯用户同步失败: ${message}`);
    }
  }
}
