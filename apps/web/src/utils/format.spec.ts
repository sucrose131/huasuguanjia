import { describe, expect, it } from 'vitest';
import { dateText, dateTimeText } from './format';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function localDateTime(value: string) {
  const date = new Date(value);
  return {
    day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    minute: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

describe('dateText / dateTimeText', () => {
  it('converts UTC ISO instants to the browser local wall clock', () => {
    const utc = '2026-09-03T08:32:45.000Z';
    const local = localDateTime(utc);
    expect(dateText(utc)).toBe(local.day);
    expect(dateText(utc, true)).toBe(`${local.day} ${local.time}`);
    expect(dateTimeText(utc)).toBe(`${local.day} ${local.minute}`);
  });

  it('uses local hours instead of slicing the UTC ISO string', () => {
    const utc = '2026-09-03T16:00:00.000Z';
    const displayedHour = Number(dateTimeText(utc).slice(11, 13));
    expect(displayedHour).toBe(new Date(utc).getHours());
  });

  it('returns em dash for empty or invalid values', () => {
    expect(dateText('')).toBe('—');
    expect(dateTimeText(null)).toBe('—');
    expect(dateTimeText('not-a-date')).toBe('—');
  });
});
