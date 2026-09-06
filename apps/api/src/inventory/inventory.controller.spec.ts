import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { AMOUNT_SCOPE_EXEMPT_KEY } from '../amount-access/amount-access.decorator';
import { InventoryController } from './inventory.controller';

const scopeExemptOf = (handler: (...args: any[]) => any) =>
  Reflect.getMetadata(AMOUNT_SCOPE_EXEMPT_KEY, handler);

describe('InventoryController amount scope', () => {
  it('does not exempt stock queries from amount-scope masking', () => {
    expect(scopeExemptOf(InventoryController.prototype.stocks)).not.toBe(true);
  });

  it('does not exempt inventory alert endpoints from amount-scope masking', () => {
    // 库存预警/效期预警金额与库存查询同口径：仅「权限内全部」可见，
    // own 范围或无金额查看能力由全局金额拦截器在服务端脱敏，防止反推库存价值。
    expect(scopeExemptOf(InventoryController.prototype.quantityAlerts)).not.toBe(true);
    expect(scopeExemptOf(InventoryController.prototype.expiryAlerts)).not.toBe(true);
  });
});
