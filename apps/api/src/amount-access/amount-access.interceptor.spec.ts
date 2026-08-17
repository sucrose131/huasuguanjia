import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AmountAccessInterceptor } from './amount-access.interceptor';

const contextWith = (userId = '1') =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }),
    getHandler: () => 'handler',
    getClass: () => 'controller',
  }) as never;

describe('AmountAccessInterceptor', () => {
  it('masks registered amount fields while preserving pagination and quantities', async () => {
    const amountAccess = {
      forUser: vi.fn().mockResolvedValue({ canViewAmount: false, canEditAmount: false }),
      assertCanEdit: vi.fn(),
      maskFields: vi.fn((value: any, fields: ReadonlySet<string>) => ({
        ...value,
        items: value.items.map((item: any) => ({
          ...item,
          amount: fields.has('amount') ? null : item.amount,
        })),
      })),
    };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) };
    const interceptor = new AmountAccessInterceptor(amountAccess as never, reflector as never);
    const stream = await interceptor.intercept(contextWith(), {
      handle: () => of({ items: [{ amount: 99, quantity: 2 }], total: 1 }),
    });

    await expect(firstValueFrom(stream)).resolves.toEqual({
      items: [{ amount: null, quantity: 2 }],
      total: 1,
    });
    expect(amountAccess.assertCanEdit).not.toHaveBeenCalled();
  });

  it('requires edit access only for handlers explicitly marked as amount-editing', async () => {
    const amountAccess = {
      forUser: vi.fn().mockResolvedValue({ canViewAmount: true, canEditAmount: false }),
      assertCanEdit: vi.fn().mockRejectedValue(new Error('forbidden')),
      maskFields: vi.fn(),
    };
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(true) };
    const interceptor = new AmountAccessInterceptor(amountAccess as never, reflector as never);

    await expect(
      interceptor.intercept(contextWith(), { handle: () => of({ ok: true }) }),
    ).rejects.toThrow('forbidden');
    expect(amountAccess.assertCanEdit).toHaveBeenCalledWith('1');
  });
});
