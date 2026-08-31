import { CronExpressionParser } from 'cron-parser';
import { SCHEDULED_TASK_TIMEZONE } from './scheduled-task.constants';

export function assertCronExpr(value: string): string {
  const expr = value.trim();
  if (expr.split(/\s+/).length !== 5) {
    throw new Error('Cron 必须是 5 段 Linux 格式（分 时 日 月 周），例如 0 1 * * *');
  }
  try {
    CronExpressionParser.parse(expr, { tz: SCHEDULED_TASK_TIMEZONE });
  } catch {
    throw new Error('Cron 表达式无法解析');
  }
  return expr;
}

export function nextRunAt(expr: string, from = new Date()): Date | null {
  try {
    const interval = CronExpressionParser.parse(assertCronExpr(expr), {
      currentDate: from,
      tz: SCHEDULED_TASK_TIMEZONE,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

function shanghaiDateTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHEDULED_TASK_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
}

export function shanghaiMinuteKey(date: Date): string {
  const parts = shanghaiDateTimeParts(date);
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`;
}

/** 列表/预览展示用：Asia/Shanghai 墙钟 `YYYY-MM-DD HH:mm` */
export function formatShanghaiDateTime(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const parts = shanghaiDateTimeParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 当前上海时区分钟是否命中 5 段 Cron */
export function cronMatchesCurrentMinute(expr: string, now = new Date()): boolean {
  try {
    const parsed = assertCronExpr(expr);
    const interval = CronExpressionParser.parse(parsed, {
      currentDate: new Date(now.getTime() + 1000),
      tz: SCHEDULED_TASK_TIMEZONE,
    });
    const prev = interval.prev().toDate();
    return shanghaiMinuteKey(prev) === shanghaiMinuteKey(now);
  } catch {
    return false;
  }
}
