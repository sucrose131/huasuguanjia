import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { AMOUNT_SCOPE_EXEMPT_KEY } from '../amount-access/amount-access.decorator';
import { PurchaseController } from './purchase.controller';

const maskFields = (value: unknown, fields: ReadonlySet<string>): unknown => {
  if (Array.isArray(value)) return value.map((item) => maskFields(item, fields));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      fields.has(key) ? null : maskFields(item, fields),
    ]),
  );
};

function controllerWith(
  access: {
    level: 'none' | 'view' | 'edit';
    canViewAmount: boolean;
    canEditAmount: boolean;
    amountScope: 'own' | 'all';
  },
  values: { order?: Record<string, unknown>; receipt?: Record<string, unknown> },
) {
  const amountAccess = {
    forUser: vi.fn().mockResolvedValue(access),
    maskFields: vi.fn(maskFields),
    maskAmountsByOwner: vi.fn((value: unknown) => value),
  };
  const service = {
    order: vi.fn().mockResolvedValue(values.order),
    receipt: vi.fn().mockResolvedValue(values.receipt),
  };
  return {
    controller: new PurchaseController(
      service as never,
      {} as never,
      {} as never,
      amountAccess as never,
    ),
    amountAccess,
  };
}

describe('PurchaseController amount ownership', () => {
  const ownAccess = {
    level: 'view' as const,
    canViewAmount: true,
    canEditAmount: false,
    amountScope: 'own' as const,
  };

  it('marks another user purchase order as masked for an own-scope user', async () => {
    const { controller, amountAccess } = controllerWith(ownAccess, {
      order: {
        id: 20n,
        created_by: 8n,
        totalAmount: 100,
        details: [{ unitPrice: 10, totalAmount: 100 }],
      },
    });

    const result = (await controller.order('20', { id: '7' } as never)) as any;

    expect(result.amountMasked).toBe(true);
    expect(result.totalAmount).toBeNull();
    expect(result.details[0].unitPrice).toBeNull();
    expect(amountAccess.maskFields).toHaveBeenCalledOnce();
    expect(amountAccess.maskAmountsByOwner).not.toHaveBeenCalled();
  });

  it('shows a generated receipt when its source order belongs to the own-scope user', async () => {
    const { controller, amountAccess } = controllerWith(ownAccess, {
      receipt: {
        id: 91n,
        created_by: 8n,
        sourceOrderCreatedBy: 7n,
        details: [{ unitPrice: 10, amount: 30 }],
      },
    });

    const result = (await controller.receipt('91', { id: '7' } as never)) as any;

    expect(result.amountMasked).toBe(false);
    expect(result.details[0]).toEqual({ unitPrice: 10, amount: 30 });
    expect(amountAccess.maskFields).not.toHaveBeenCalled();
    expect(amountAccess.maskAmountsByOwner).not.toHaveBeenCalled();
  });

  it('masks a generated receipt when its source order belongs to another user', async () => {
    const { controller } = controllerWith(ownAccess, {
      receipt: {
        id: 91n,
        created_by: 7n,
        sourceOrderCreatedBy: 8n,
        details: [{ unitPrice: 10, amount: 30 }],
      },
    });

    const result = (await controller.receipt('91', { id: '7' } as never)) as any;

    expect(result.amountMasked).toBe(true);
    expect(result.details[0].unitPrice).toBeNull();
    expect(result.details[0].amount).toBeNull();
  });

  it('shows source order amounts for an all-scope user', async () => {
    const { controller } = controllerWith(
      { ...ownAccess, level: 'edit', canEditAmount: true, amountScope: 'all' },
      {
        receipt: {
          id: 91n,
          created_by: 7n,
          sourceOrderCreatedBy: 8n,
          details: [{ unitPrice: 10, amount: 30 }],
        },
      },
    );

    const result = (await controller.receipt('91', { id: '7' } as never)) as any;

    expect(result.amountMasked).toBe(false);
    expect(result.details[0]).toEqual({ unitPrice: 10, amount: 30 });
  });

  it('exempts receipt detail from the generic receipt-creator ownership pass', () => {
    expect(
      Reflect.getMetadata(AMOUNT_SCOPE_EXEMPT_KEY, PurchaseController.prototype.receipt),
    ).toBe(true);
  });
});
