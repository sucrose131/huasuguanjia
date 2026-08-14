import { describe, expect, it } from 'vitest';
import { toSort } from './sync.service';

describe('toSort', () => {
  it('把薪福通字符串序号转成整数', () => {
    expect(toSort('1')).toBe(1);
    expect(toSort('10')).toBe(10);
  });

  it('空值和非法值写 0', () => {
    expect(toSort(null)).toBe(0);
    expect(toSort(undefined)).toBe(0);
    expect(toSort('')).toBe(0);
    expect(toSort('abc')).toBe(0);
  });

  it('截断小数并限制在 Int 范围内', () => {
    expect(toSort(1.8)).toBe(1);
    expect(toSort(-3)).toBe(0);
    expect(toSort(Number.MAX_SAFE_INTEGER)).toBe(2147483647);
  });
});
