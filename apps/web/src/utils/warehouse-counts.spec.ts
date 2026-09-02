import { describe, expect, it } from 'vitest';
import { sumWarehouseCounts } from './warehouse-counts';

describe('sumWarehouseCounts', () => {
  it('求和各仓库计数', () => {
    expect(sumWarehouseCounts({ '1': 6, '2': 1, '87': 5 })).toBe(12);
  });
  it('空对象返回 0', () => {
    expect(sumWarehouseCounts({})).toBe(0);
  });
  it('undefined/null 返回 0', () => {
    expect(sumWarehouseCounts(undefined)).toBe(0);
    expect(sumWarehouseCounts(null)).toBe(0);
  });
  it('忽略缺失/非法值', () => {
    const counts: Record<string, number> = {
      '1': 2,
      '2': undefined as unknown as number,
    };
    expect(sumWarehouseCounts(counts)).toBe(2);
  });
});
