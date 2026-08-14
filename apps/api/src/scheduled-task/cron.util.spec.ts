import { describe, expect, it } from 'vitest';
import { assertCronExpr, cronMatchesCurrentMinute, formatShanghaiDateTime, nextRunAt } from './cron.util';

describe('assertCronExpr', () => {
  it('接受每天 1 点的五段表达式', () => {
    expect(assertCronExpr('0 1 * * *')).toBe('0 1 * * *');
  });

  it('接受每 10 分钟', () => {
    expect(assertCronExpr('*/10 * * * *')).toBe('*/10 * * * *');
  });

  it('拒绝 6 段表达式', () => {
    expect(() => assertCronExpr('0 0 1 * * *')).toThrow(/5 段/);
  });

  it('拒绝空值', () => {
    expect(() => assertCronExpr('')).toThrow(/5 段/);
  });

  it('拒绝无法解析的字段', () => {
    expect(() => assertCronExpr('99 1 * * *')).toThrow();
  });
});

describe('nextRunAt / cronMatchesCurrentMinute', () => {
  it('下次执行时间晚于当前时间', () => {
    const next = nextRunAt('0 1 * * *');
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it('每分钟表达式始终命中当前分钟', () => {
    expect(cronMatchesCurrentMinute('* * * * *', new Date('2026-08-14T06:18:30.000Z'))).toBe(true);
  });

  it('远离当前时刻的定点 Cron 不命中', () => {
    const now = new Date();
    const shanghaiHour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(now),
    );
    const otherHour = (shanghaiHour + 12) % 24;
    expect(cronMatchesCurrentMinute(`0 ${otherHour} * * *`, now)).toBe(false);
  });

  it('UTC 17:00 格式化为上海次日 01:00', () => {
    expect(formatShanghaiDateTime(new Date('2026-08-13T17:00:00.000Z'))).toBe('2026-08-14 01:00');
  });

  it('0 1 * * * 在上海 00:00 之后的下次执行为当天 01:00', () => {
    const next = nextRunAt('0 1 * * *', new Date('2026-08-13T16:00:00.000Z'));
    expect(formatShanghaiDateTime(next)).toBe('2026-08-14 01:00');
  });
});
