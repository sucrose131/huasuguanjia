import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthRequest } from '../auth/auth.types';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<AuthRequest>();
    const reply = ctx.getResponse<Response>();
    const status =
      error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = error instanceof HttpException ? error.getResponse() : null;
    const message =
      typeof response === 'string'
        ? response
        : ((response as { message?: string | string[] } | null)?.message ?? '服务器内部错误');
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      // 系统错误：请求上下文放 message、堆栈走结构化字段（meta.stack/meta.error），供生产 JSON 采集（业务 4xx 不记录）
      const where = `${request.method ?? ''} ${request.originalUrl ?? request.url ?? ''}`;
      const userId = request.user?.id ? ` user=${request.user.id}` : '';
      const detail = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`[${where}${userId}] 请求处理失败`, detail);
    }
    reply.status(status).json({
      code: status === 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`,
      message: Array.isArray(message) ? message.join('；') : message,
    });
  }
}
