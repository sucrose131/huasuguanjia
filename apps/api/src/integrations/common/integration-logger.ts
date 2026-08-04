import { Injectable, Logger } from '@nestjs/common';

/**
 * 对接流水日志服务
 * 职责：记录每次外部调用的请求/响应，便于排障
 * 骨架占位，后续可落库或写入独立日志文件
 */
@Injectable()
export class IntegrationLoggerService {
  private readonly logger = new Logger('Integration');

  log(provider: string, message: string) {
    this.logger.log(`[${provider}] ${message}`);
  }

  error(provider: string, message: string, detail?: unknown) {
    this.logger.error(`[${provider}] ${message}`, detail as string | undefined);
  }
}
