import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = error instanceof HttpException ? error.getResponse() : null;
    const message =
      typeof response === 'string'
        ? response
        : ((response as { message?: string | string[] } | null)?.message ?? '服务器内部错误');
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.logger.error(detail);
    }
    reply.status(status).json({
      code: status === 500 ? 'INTERNAL_ERROR' : `HTTP_${status}`,
      message: Array.isArray(message) ? message.join('；') : message,
    });
  }
}
