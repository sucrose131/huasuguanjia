import { describe, expect, it } from 'vitest';
import { generateBatchNo } from './batch-number';

describe('generateBatchNo', () => {
  it('uses the Shanghai calendar date', () => {
    expect(generateBatchNo(new Date('2026-08-06T16:30:00.000Z'))).toBe('PH20260807');
  });
});
