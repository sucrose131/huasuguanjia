import { type LoggerService } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

/**
 * 系统日志：将 NestJS 默认 Logger 桥接到 winston。
 * 现有 `new Logger(...)` / `logger.log/error/warn/debug` 调用经 app.useLogger 后全部走本实现，
 * 无需逐个改动业务代码。
 *
 * 级别映射：Nest log→info、warn→warn、error→error、debug→debug、verbose→verbose、fatal→error。
 * 输出：
 * - 控制台：开发环境彩色可读格式，生产环境 JSON；
 * - logs/error-%DATE%.log：仅 error 级（系统错误）；
 * - logs/combined-%DATE%.log：全量。
 */
const LOG_DIR = path.resolve(process.cwd(), 'logs');

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // 目录创建失败不阻断应用启动
  }
}

function buildFormats() {
  const base = [
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
  ] as const;
  const text = winston.format.printf((info) => {
    const { level, message, timestamp, context, stack } = info as Record<string, unknown>;
    const ctx = context ? ` [${String(context)}]` : '';
    const extra = stack ? `\n${String(stack)}` : '';
    return `${String(timestamp)} ${level}${ctx}: ${String(message)}${extra}`;
  });
  if (process.env.NODE_ENV === 'production') {
    const json = winston.format.combine(...base, winston.format.json());
    return { shared: json, console: json, files: json };
  }
  const shared = winston.format.combine(...base, text);
  const console = winston.format.combine(...base, winston.format.colorize(), text);
  return { shared, console, files: shared };
}

export class WinstonLogger implements LoggerService {
  private readonly logger: winston.Logger;

  constructor() {
    ensureLogDir();
    const { shared, console: consoleFormat, files } = buildFormats();
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL ?? 'info',
      format: shared,
      transports: [
        new winston.transports.Console({ format: consoleFormat }),
        new DailyRotateFile({
          dirname: LOG_DIR,
          filename: 'error-%DATE%.log',
          level: 'error',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '30d',
          format: files,
        }),
        new DailyRotateFile({
          dirname: LOG_DIR,
          filename: 'combined-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          maxSize: '20m',
          maxFiles: '30d',
          format: files,
        }),
      ],
    });
  }

  log(message: unknown, ...optional: unknown[]) {
    this.write('info', message, optional);
  }

  error(message: unknown, ...optional: unknown[]) {
    this.write('error', message, optional);
  }

  warn(message: unknown, ...optional: unknown[]) {
    this.write('warn', message, optional);
  }

  debug(message: unknown, ...optional: unknown[]) {
    this.write('debug', message, optional);
  }

  verbose(message: unknown, ...optional: unknown[]) {
    this.write('verbose', message, optional);
  }

  fatal(message: unknown, ...optional: unknown[]) {
    this.write('error', message, optional);
  }

  private write(level: string, message: unknown, optional: unknown[]) {
    const { context, trace } = this.parseArgs(optional);
    const meta: Record<string, unknown> = { context };
    if (trace !== undefined) {
      if (trace instanceof Error) {
        meta.error = { name: trace.name, message: trace.message };
        meta.stack = trace.stack;
      } else {
        meta.stack = trace;
      }
    }
    let text: string;
    if (message instanceof Error) {
      text = message.message;
      meta.error = { name: message.name, message: message.message };
      meta.stack = message.stack;
    } else if (typeof message === 'object' && message !== null) {
      try {
        text = JSON.stringify(message);
      } catch {
        text = String(message);
      }
    } else {
      text = String(message ?? '');
    }
    this.logger.log(level, text, meta);
  }

  /** 解析 Nest 调用约定：`error(msg, stack?, context?)` / `log(msg, context?)` */
  private parseArgs(args: unknown[]) {
    let context: string | undefined;
    if (args.length > 0 && typeof args[args.length - 1] === 'string') {
      context = args[args.length - 1] as string;
    }
    const rest = context !== undefined ? args.slice(0, -1) : args.slice();
    const trace = rest.length > 0 ? rest[rest.length - 1] : undefined;
    return { context, trace };
  }
}

/** 供进程级兜底与 app.useLogger 复用的全局实例 */
export const systemLogger = new WinstonLogger();
