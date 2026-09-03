import { describe, expect, it, vi } from 'vitest';
import { canEditAmountRecord } from './auth';

vi.mock('@/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

describe('canEditAmountRecord', () => {
  it('denies when the user has no amount-edit capability', () => {
    expect(
      canEditAmountRecord({ canEditAmount: false, amountScope: 'all' }, '9', '8'),
    ).toBe(false);
  });

  it('allows all-scope editors to edit any record', () => {
    expect(
      canEditAmountRecord({ canEditAmount: true, amountScope: 'all' }, '9', '8'),
    ).toBe(true);
  });

  it('allows own-scope editors to edit records they created', () => {
    expect(
      canEditAmountRecord({ canEditAmount: true, amountScope: 'own' }, '9', '9'),
    ).toBe(true);
  });

  it('blocks own-scope editors from editing records created by others', () => {
    expect(
      canEditAmountRecord({ canEditAmount: true, amountScope: 'own' }, '9', '8'),
    ).toBe(false);
  });

  it('treats a missing scope as all (backward compatibility)', () => {
    expect(
      canEditAmountRecord({ canEditAmount: true }, '9', '8'),
    ).toBe(true);
  });
});
