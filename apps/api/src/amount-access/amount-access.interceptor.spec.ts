import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AmountAccessInterceptor } from './amount-access.interceptor';

const contextWith = (userId = '1') =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }),
    getHandler: () => 'handler',
    getClass: () => 'controller',
  }) as never;

const reflectorWith = (
  requiresEdit = false,
  scopeExempt = false,
  allScopeOnly = false,
) => ({
  getAllAndOverride: vi.fn((key: string) => {
    if (key === 'require_amount_edit') return requiresEdit;
    if (key === 'amount_scope_exempt') return scopeExempt;
    if (key === 'amount_all_scope_only') return allScopeOnly;
    return undefined;
  }),
});

describe('AmountAccessInterceptor', () => {
  it('masks registered amount fields while preserving pagination and quantities', async () => {
    const amountAccess = {
      forUser: vi.fn().mockResolvedValue({
        level: 'none',
        canViewAmount: false,
        canEditAmount: false,
        amountScope: 'own',
      }),
      assertCanEdit: vi.fn(),
      maskFields: vi.fn((value: any, fields: ReadonlySet<string>) => ({
        ...value,
        items: value.items.map((item: any) => ({
          ...item,
          amount: fields.has('amount') ? null : item.amount,
        })),
      })),
      maskAmountsByOwner: vi.fn((value: any) => value),
    };
    const interceptor = new AmountAccessInterceptor(
      amountAccess as never,
      reflectorWith() as never,
    );
    const stream = await interceptor.intercept(contextWith(), {
      handle: () => of({ items: [{ amount: 99, quantity: 2 }], total: 1 }),
    });

    await expect(firstValueFrom(stream)).resolves.toEqual({
      items: [{ amount: null, quantity: 2 }],
      total: 1,
    });
    expect(amountAccess.assertCanEdit).not.toHaveBeenCalled();
    expect(amountAccess.maskAmountsByOwner).not.toHaveBeenCalled();
  });

  it('requires edit access only for handlers explicitly marked as amount-editing', async () => {
    const amountAccess = {
      forUser: vi.fn().mockResolvedValue({
        level: 'none',
        canViewAmount: true,
        canEditAmount: false,
        amountScope: 'own',
      }),
      assertCanEdit: vi.fn().mockRejectedValue(new Error('forbidden')),
      maskFields: vi.fn(),
      maskAmountsByOwner: vi.fn((value: any) => value),
    };
    const interceptor = new AmountAccessInterceptor(
      amountAccess as never,
      reflectorWith(true, false) as never,
    );

    await expect(
      interceptor.intercept(contextWith(), { handle: () => of({ ok: true }) }),
    ).rejects.toThrow('forbidden');
    expect(amountAccess.assertCanEdit).toHaveBeenCalledWith('1');
  });

  it('applies per-record masking for own-scope users', async () => {
    const amountAccess = {
      forUser: vi.fn().mockResolvedValue({
        level: 'view',
        canViewAmount: true,
        canEditAmount: false,
        amountScope: 'own',
      }),
      assertCanEdit: vi.fn(),
      maskFields: vi.fn((value: any) => value),
      maskAmountsByOwner: vi.fn((value: any, userId: string) => ({
        ...value,
        maskedBy: userId,
      })),
    };
    const interceptor = new AmountAccessInterceptor(
      amountAccess as never,
      reflectorWith(false, false) as never,
    );
    const stream = await interceptor.intercept(contextWith('7'), {
      handle: () => of({ items: [{ createdBy: '8', amount: 99 }] }),
    });

    await expect(firstValueFrom(stream)).resolves.toEqual({
      items: [{ createdBy: '8', amount: 99 }],
      maskedBy: '7',
    });
    expect(amountAccess.maskAmountsByOwner).toHaveBeenCalledWith(
      { items: [{ createdBy: '8', amount: 99 }] },
      '7',
    );
  });

  it('does not mask own-scope responses of scope-exempt master-data endpoints', async () => {
    const amountAccess = {
      forUser: vi.fn().mockResolvedValue({
        level: 'view',
        canViewAmount: true,
        canEditAmount: false,
        amountScope: 'own',
      }),
      assertCanEdit: vi.fn(),
      maskFields: vi.fn((value: any) => value),
      maskAmountsByOwner: vi.fn((value: any) => value),
    };
    const interceptor = new AmountAccessInterceptor(
      amountAccess as never,
      reflectorWith(false, true) as never,
    );
    const stream = await interceptor.intercept(contextWith('7'), {
      handle: () => of({ items: [{ createdBy: '8', costPrice: 99 }] }),
    });

    await expect(firstValueFrom(stream)).resolves.toEqual({
      items: [{ createdBy: '8', costPrice: 99 }],
    });
    expect(amountAccess.maskAmountsByOwner).not.toHaveBeenCalled();
  });

  it('passes responses through unchanged for all-scope users', async () => {
    const amountAccess = {
      forUser: vi.fn().mockResolvedValue({
        level: 'edit',
        canViewAmount: true,
        canEditAmount: true,
        amountScope: 'all',
      }),
      assertCanEdit: vi.fn(),
      maskFields: vi.fn((value: any) => value),
      maskAmountsByOwner: vi.fn((value: any) => value),
    };
    const interceptor = new AmountAccessInterceptor(
      amountAccess as never,
      reflectorWith(false, false) as never,
    );
    const stream = await interceptor.intercept(contextWith(), {
      handle: () => of({ items: [{ createdBy: '9', amount: 88 }] }),
    });

    await expect(firstValueFrom(stream)).resolves.toEqual({
      items: [{ createdBy: '9', amount: 88 }],
    });
    expect(amountAccess.maskFields).not.toHaveBeenCalled();
    expect(amountAccess.maskAmountsByOwner).not.toHaveBeenCalled();
  });

  it('masks stock-snapshot amount fields for own-scope users regardless of created_by', async () => {
    const amountAccess = {
      forUser: vi.fn().mockResolvedValue({
        level: 'view',
        canViewAmount: true,
        canEditAmount: false,
        amountScope: 'own',
      }),
      assertCanEdit: vi.fn(),
      maskFields: vi.fn((value: any, fields: ReadonlySet<string>) => ({
        ...value,
        details: value.details.map((item: any) => ({
          ...item,
          unitPrice: fields.has('unitPrice') ? null : item.unitPrice,
        })),
        allValue: fields.has('all_value') ? null : value.allValue,
      })),
      maskAmountsByOwner: vi.fn((value: any) => value),
    };
    const interceptor = new AmountAccessInterceptor(
      amountAccess as never,
      reflectorWith(false, false, true) as never,
    );
    // 盘点单 created_by 为当前用户本人：不应因归属而放行成本快照金额
    const stream = await interceptor.intercept(contextWith('7'), {
      handle: () =>
        of({
          createdBy: '7',
          allValue: 999,
          details: [{ unitPrice: 12.5, differentAmount: 8 }],
        }),
    });

    await expect(firstValueFrom(stream)).resolves.toEqual({
      createdBy: '7',
      allValue: null,
      details: [{ unitPrice: null, differentAmount: 8 }],
    });
    expect(amountAccess.maskAmountsByOwner).not.toHaveBeenCalled();
  });

  it('keeps stock-snapshot amount fields visible for all-scope users', async () => {
    const amountAccess = {
      forUser: vi.fn().mockResolvedValue({
        level: 'edit',
        canViewAmount: true,
        canEditAmount: true,
        amountScope: 'all',
      }),
      assertCanEdit: vi.fn(),
      maskFields: vi.fn((value: any) => value),
      maskAmountsByOwner: vi.fn((value: any) => value),
    };
    const interceptor = new AmountAccessInterceptor(
      amountAccess as never,
      reflectorWith(false, false, true) as never,
    );
    const stream = await interceptor.intercept(contextWith('7'), {
      handle: () =>
        of({
          createdBy: '8',
          allValue: 999,
          details: [{ unitPrice: 12.5, differentAmount: 8 }],
        }),
    });

    await expect(firstValueFrom(stream)).resolves.toEqual({
      createdBy: '8',
      allValue: 999,
      details: [{ unitPrice: 12.5, differentAmount: 8 }],
    });
    expect(amountAccess.maskFields).not.toHaveBeenCalled();
    expect(amountAccess.maskAmountsByOwner).not.toHaveBeenCalled();
  });
});
