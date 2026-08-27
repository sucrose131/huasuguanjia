import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ApiInterceptor } from './common/api.interceptor';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { systemLogger } from './common/logger/winston-logger';

// 进程级系统错误兜底：未捕获异常 / 未处理的 Promise 拒绝
process.on('uncaughtException', (error) => {
  systemLogger.error('未捕获异常(uncaughtException)', error, 'System');
  // 留出文件传输刷盘时间后退出，交由进程管理器（PM2/systemd 等）重启
  setTimeout(() => process.exit(1), 500);
});
process.on('unhandledRejection', (reason) => {
  systemLogger.error(
    '未处理的Promise拒绝(unhandledRejection)',
    reason instanceof Error ? reason : new Error(String(reason)),
    'System',
  );
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bufferLogs: true,
  });
  app.useLogger(systemLogger);
  app.flushLogs();
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',') ?? true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ApiInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(Number(process.env.API_PORT ?? 8000));
}
bootstrap().catch((error) => {
  systemLogger.error('应用启动失败', error, 'System');
  process.exit(1);
});
