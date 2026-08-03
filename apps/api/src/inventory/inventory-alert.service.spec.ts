import { describe, expect, it, vi } from 'vitest';
import {
  InventoryAlertService,
  expiryAlertDaysFromDictionaryName,
} from './inventory-alert.service';

describe('InventoryAlertService', () => {
  it('reads warning days from the expiry dictionary label', () => {
    expect(expiryAlertDaysFromDictionaryName('紧急处理（90天）')).toBe(90);
    expect(expiryAlertDaysFromDictionaryName('加速处理（180天）')).toBe(180);
  });

  it('creates a batch expiry configuration from the active dictionary item', async () => {
    const create = vi.fn().mockResolvedValue({ id: 1n });
    const db = {
      hspsi_sys_dictionary_category: {
        findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 10n }),
      },
      hspsi_sys_dictionary: {
        findFirst: vi.fn().mockResolvedValue({ dict_value: '1', dict_name: '紧急处理（90天）' }),
      },
      hspsi_inventory_batch_total: {
        findUnique: vi.fn().mockResolvedValue({ inventory_qty: 8, inventory_amount: 320 }),
      },
      hspsi_inventory_alert_period: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
        update: vi.fn(),
      },
    };
    const service = new InventoryAlertService({} as never);

    await service.syncExpiryAlert(db as never, {
      goodsId: 1n,
      skuId: 2n,
      warehouseId: 3n,
      batchNo: 'BATCH-01',
      endDay: '2026-12-31',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          goods_id: 1n,
          sku_id: 2n,
          warehouse_id: 3n,
          batch_no: 'BATCH-01',
          alter_type: 1,
          alter_day: 90,
        }),
      }),
    );
  });
});
