import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  AMOUNT_ALL_SCOPE_ONLY_KEY,
  AMOUNT_SCOPE_EXEMPT_KEY,
} from '../amount-access/amount-access.decorator';
import { InventoryController } from './inventory.controller';

const allScopeOnlyOf = (handler: (...args: any[]) => any) =>
  Reflect.getMetadata(AMOUNT_ALL_SCOPE_ONLY_KEY, handler);

describe('InventoryController stock-snapshot amount scope', () => {
  it('requires all-scope amount access for inventory stock queries', () => {
    expect(allScopeOnlyOf(InventoryController.prototype.stocks)).toBe(true);
    expect(
      Reflect.getMetadata(
        AMOUNT_SCOPE_EXEMPT_KEY,
        InventoryController.prototype.stocks,
      ),
    ).not.toBe(true);
  });

  it('marks stock-snapshot detail endpoints as all-scope-only', () => {
    // 盘点单明细与盘点衍生的报亏出库/报盈入库详情携带库存成本快照：
    // 金额仅「权限内全部」可见，不随单据 created_by 归属放行（防止通过单据详情反推库存价值）。
    expect(allScopeOnlyOf(InventoryController.prototype.check)).toBe(true);
    expect(allScopeOnlyOf(InventoryController.prototype.lossOutput)).toBe(true);
    expect(allScopeOnlyOf(InventoryController.prototype.overflowInput)).toBe(true);
  });
});
