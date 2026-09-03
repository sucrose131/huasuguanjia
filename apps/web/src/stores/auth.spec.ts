import { describe, expect, it, vi } from 'vitest';
import { canEditAmountRecord, isAmountRecordMasked } from './auth';

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

describe('isAmountRecordMasked', () => {
  it('masks every record when the user has no view capability', () => {
    expect(
      isAmountRecordMasked({ canViewAmount: false, amountScope: 'own' }, '9', '9'),
    ).toBe(true);
    expect(
      isAmountRecordMasked({ canViewAmount: false, amountScope: 'all' }, '9', '9'),
    ).toBe(true);
  });

  it('keeps all records visible for all-scope viewers', () => {
    expect(
      isAmountRecordMasked({ canViewAmount: true, amountScope: 'all' }, '9', '8'),
    ).toBe(false);
  });

  it('masks records created by others for own-scope viewers', () => {
    expect(
      isAmountRecordMasked({ canViewAmount: true, amountScope: 'own' }, '9', '8'),
    ).toBe(true);
  });

  it('keeps own records visible for own-scope viewers', () => {
    expect(
      isAmountRecordMasked({ canViewAmount: true, amountScope: 'own' }, '9', '9'),
    ).toBe(false);
  });

  it('treats a missing scope as all (backward compatibility)', () => {
    expect(isAmountRecordMasked({ canViewAmount: true }, '9', '8')).toBe(false);
  });
});
