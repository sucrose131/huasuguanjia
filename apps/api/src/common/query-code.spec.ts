import { describe, expect, it } from 'vitest';
import { buildQueryCodeFromName } from './query-code';

describe('buildQueryCodeFromName', () => {
  it('builds uppercase pinyin initials from Chinese names', () => {
    expect(buildQueryCodeFromName('全局已有')).toBe('QJYY');
  });

  it('keeps latin letters and digits, skips punctuation and spaces', () => {
    expect(buildQueryCodeFromName('ABC-净水 套餐01')).toBe('ABCJSTC01');
  });

  it('returns empty string for blank or symbol-only names', () => {
    expect(buildQueryCodeFromName('')).toBe('');
    expect(buildQueryCodeFromName('   ')).toBe('');
    expect(buildQueryCodeFromName('---')).toBe('');
  });

  it('truncates to 30 characters', () => {
    const name = '一二三四五六七八九十'.repeat(4);
    expect(buildQueryCodeFromName(name).length).toBe(30);
  });
});
