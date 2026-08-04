import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { InventoryGeneralService } from './inventory-general.service';

function createService(initialInputEnabled = true) {
  const order = { id: 9n, business_no: 'GI20260804000001', direction: 1 };
  const tx = {
    hspsi_inventory_general_order: {
      create: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockResolvedValue(order),
    },
    hspsi_inventory_general_order_detail: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    hspsi_sys_oper_log: { create: vi.fn().mockResolvedValue({ id: 1n }) },
  };
  const prisma = {
    hspsi_inventory_feature_config: {
      findUnique: vi.fn().mockResolvedValue({ enabled: initialInputEnabled ? 1 : 0 }),
    },
    hspsi_inventory_general_order: { findUnique: vi.fn().mockResolvedValue(null) },
    hspsi_goods_info: {
      findMany: vi.fn().mockResolvedValue([
        {
          goods_id: 1n,
          org_id: 2n,
          unit_type: 3,
          query_code: 'WATER',
          goods_name: '饮用水',
        },
      ]),
    },
    hspsi_goods_info_sku: {
      findMany: vi.fn().mockResolvedValue([
        {
          sku_id: 4n,
          good_id: 1n,
          unit_type: 5,
          pcs_qty: 24,
          const_price: 2,
          spec_models: '500ml×24',
        },
      ]),
    },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const posting = { post: vi.fn().mockResolvedValue(undefined) };
  const businessNumber = { generate: vi.fn().mockResolvedValue(order.business_no) };
  const service = new InventoryGeneralService(
    prisma as never,
    posting as never,
    businessNumber as never,
  );
  return { service, prisma, posting, tx };
}

describe('InventoryGeneralService', () => {
  it('converts document quantity to integer pieces and snapshots base cost', async () => {
    const { service, posting, tx } = createService();

    const result = await service.create(
      1,
      {
        requestKey: 'request-0001',
        businessType: 'entrusted_purchase',
        orgId: '2',
        warehouseId: '8',
        lines: [{ goodsId: '1', skuId: '4', quantity: 2, batchNo: 'B001' }],
      },
      '7',
    );

    expect(result).toMatchObject({ id: 9n, businessNo: 'GI20260804000001' });
    expect(tx.hspsi_inventory_general_order_detail.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          document_quantity: 2,
          pieces_per_unit: 24,
          pieces_quantity: 48,
          pieces_unit_type: 3,
          base_cost: expect.anything(),
          amount: expect.anything(),
        }),
      ],
    });
    expect(posting.post).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 1,
        lines: [expect.objectContaining({ quantity: 48, amount: 96, unitType: 3 })],
      }),
      tx,
    );
  });

  it('rejects initial input while its feature switch is disabled', async () => {
    const { service, posting } = createService(false);

    await expect(
      service.create(1, { requestKey: 'request-0002', businessType: 'initial', lines: [{}] }, '7'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(posting.post).not.toHaveBeenCalled();
  });

  it('writes the locked batch moving cost back to a direct-output snapshot', async () => {
    const { service, posting, tx } = createService();
    posting.post.mockResolvedValueOnce([
      { goodsId: 1n, skuId: 4n, batchNo: 'B001', quantity: 24, amount: 60, unitCost: 2.5 },
    ]);

    await service.create(
      -1,
      {
        requestKey: 'request-0004',
        businessType: 'direct_output',
        orgId: '2',
        warehouseId: '8',
        lines: [{ goodsId: '1', skuId: '4', quantity: 1, batchNo: 'B001' }],
      },
      '7',
    );

    expect(tx.hspsi_inventory_general_order_detail.updateMany).toHaveBeenCalledWith({
      where: { order_id: 9n, goods_id: 1n, sku_id: 4n, batch_no: 'B001' },
      data: expect.objectContaining({ base_cost: expect.anything(), amount: expect.anything() }),
    });
    expect(tx.hspsi_inventory_general_order.update).toHaveBeenCalledWith({
      where: { id: 9n },
      data: expect.objectContaining({ total_amount: expect.anything() }),
    });
  });

  it('returns an existing order for a repeated request key without posting twice', async () => {
    const { service, prisma, posting } = createService();
    prisma.hspsi_inventory_general_order.findUnique.mockResolvedValueOnce({
      id: 10n,
      business_no: 'GO20260804000002',
      direction: -1,
    });

    await expect(service.create(-1, { requestKey: 'request-0003' }, '7')).resolves.toMatchObject({
      id: 10n,
      businessNo: 'GO20260804000002',
      duplicate: true,
    });
    expect(posting.post).not.toHaveBeenCalled();
  });
});
