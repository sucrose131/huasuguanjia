import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AMOUNT_SCOPE_EXEMPT_KEY } from '../amount-access/amount-access.decorator';
import { InventoryController } from './inventory.controller';

describe('InventoryController amount scope', () => {
  it('does not exempt stock queries from amount-scope masking', () => {
    const metadata = Reflect.getMetadata(
      AMOUNT_SCOPE_EXEMPT_KEY,
      InventoryController.prototype.stocks,
    );

    expect(metadata).not.toBe(true);
  });

  it('keeps inventory alert endpoints scope-exempt', () => {
    expect(
      Reflect.getMetadata(
        AMOUNT_SCOPE_EXEMPT_KEY,
        InventoryController.prototype.quantityAlerts,
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        AMOUNT_SCOPE_EXEMPT_KEY,
        InventoryController.prototype.expiryAlerts,
      ),
    ).toBe(true);
  });
});
