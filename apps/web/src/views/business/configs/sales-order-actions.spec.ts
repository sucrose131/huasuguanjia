import { describe, expect, it } from 'vitest';
import { salesOrderConfig } from './sales-order';

describe('sales order row actions', () => {
  it('keeps only the frequent view and direct-output actions inline', () => {
    const actions = salesOrderConfig.rowActions ?? [];
    const primaryKeys = actions
      .filter((action) => action.primary !== false)
      .map((action) => action.key);
    const moreKeys = actions
      .filter((action) => action.primary === false)
      .map((action) => action.key);

    expect(primaryKeys).toEqual(['view', 'direct-output']);
    expect(moreKeys).toEqual([
      'analyze',
      'receive',
      'refund',
      'return',
      'service',
      'delete',
    ]);
  });
});
