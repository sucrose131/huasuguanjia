import { describe, expect, it, vi } from 'vitest';
import {
  assertGeneratedDamageLinesUnchanged,
  calculateInventoryCheckProgress,
  classifyInventoryCheckQuantities,
  filterQuantityAlertsByStatus,
  parseInventoryLossDisposal,
  partitionInventoryCheckDetails,
  splitInventoryDamageDetails,
} from './inventory-helpers';
import { InventoryService } from './inventory.service';

describe('inventory quantity alert status filter', () => {
  const items = [
    { id: 1, warning: false },
    { id: 2, warning: true },
  ];

  it('keeps normal inventory when status is 0', () => {
    expect(filterQuantityAlertsByStatus(items, '0')).toEqual([{ id: 1, warning: false }]);
  });

  it('keeps shortage inventory when status is 1', () => {
    expect(filterQuantityAlertsByStatus(items, 1)).toEqual([{ id: 2, warning: true }]);
  });

  it('keeps all inventory when status is empty and rejects invalid values', () => {
    expect(filterQuantityAlertsByStatus(items, '')).toEqual(items);
    expect(() => filterQuantityAlertsByStatus(items, 'unexpected')).toThrow('库存状态参数无效');
  });
});

describe('inventory stock option scope', () => {
  function serviceWith(prisma: Record<string, any>, masterData: Record<string, any>) {
    return new InventoryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      masterData as never,
      {} as never,
    );
  }

  it('returns no options when organization or warehouse is missing', async () => {
    const findMany = vi.fn();
    const service = serviceWith(
      { hspsi_inventory_batch_total: { findMany } },
      { assertWarehouse: vi.fn() },
    );

    await expect(service.stockOptions({})).resolves.toEqual([]);
    await expect(service.stockOptions({ orgId: '1' })).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('queries only positive inventory inside the selected organization and warehouse', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const assertWarehouse = vi.fn().mockResolvedValue({ warehouse_id: 20n, org_id: 10n });
    const service = serviceWith(
      {
        hspsi_inventory_batch_total: { findMany },
        hspsi_goods_info: { findMany: vi.fn().mockResolvedValue([]) },
        hspsi_goods_info_sku: { findMany: vi.fn().mockResolvedValue([]) },
        hspsi_basic_warehouse: { findMany: vi.fn().mockResolvedValue([]) },
        hspsi_basic_organization: { findMany: vi.fn().mockResolvedValue([]) },
        hspsi_basic_unit: { findMany: vi.fn().mockResolvedValue([]) },
        hspsi_goods_info_category: { findMany: vi.fn().mockResolvedValue([]) },
      },
      { assertWarehouse },
    );

    await expect(service.stockOptions({ orgId: '10', warehouseId: '20' })).resolves.toEqual([]);
    expect(assertWarehouse).toHaveBeenCalledWith(10n, 20n);
    expect(findMany).toHaveBeenCalledWith({
      where: { org_id: 10n, warehouse_id: 20n, inventory_qty: { gt: 0 } },
      orderBy: [{ goods_id: 'asc' }, { batch_no: 'asc' }],
    });
  });
});

describe('inventory stock export scope', () => {
  function serviceWith(prisma: Record<string, any>) {
    return new InventoryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  it('requires an organization and rejects an organization outside the scoped client', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = serviceWith({ hspsi_basic_organization: { findFirst } });

    await expect(service.stockExportData({})).rejects.toThrow('请先选择组织');
    await expect(service.stockExportData({ orgId: '10' })).rejects.toThrow(
      '所选组织不存在或不在当前账号授权范围内',
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: { org_id: 10n, operation_status: 1, deleted_at: null },
      select: { org_id: true, name: true },
    });
  });

  it('exports all matching rows without page parameters and validates the selected warehouse', async () => {
    const stock = {
      goods_id: 1n,
      sku_id: 2n,
      warehouse_id: 20n,
      org_id: 10n,
      batch_no: 'B001',
      unit_type: 1n,
      input_qty: 12,
      output_qty: 2,
      inventory_qty: 10,
      inventory_amount: 123.45,
    };
    const stockFindMany = vi.fn().mockResolvedValue([stock]);
    const service = serviceWith({
      hspsi_basic_organization: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 10n, name: '华数生物' }),
        findMany: vi.fn().mockResolvedValue([{ org_id: 10n, name: '华数生物' }]),
      },
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ warehouse_id: 20n, name: '原料仓' }),
        findMany: vi.fn().mockResolvedValue([{ warehouse_id: 20n, name: '原料仓' }]),
      },
      hspsi_inventory_batch_total: {
        count: vi.fn().mockResolvedValue(1),
        findMany: stockFindMany,
      },
      hspsi_goods_info: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { goods_id: 1n, goods_name: '测试商品', query_code: 'G001', goods_catg_id: 0n },
          ]),
      },
      hspsi_goods_info_sku: {
        findMany: vi.fn().mockResolvedValue([{ sku_id: 2n, spec_models: '10kg/袋' }]),
      },
      hspsi_basic_unit: {
        findMany: vi.fn().mockResolvedValue([{ id: 1n, name: '袋' }]),
      },
      hspsi_goods_info_category: { findMany: vi.fn().mockResolvedValue([]) },
    });

    await expect(
      service.stockExportData({
        orgId: '10',
        warehouseId: '20',
        page: 9,
        pageSize: 1,
        inStockOnly: true,
      }),
    ).resolves.toMatchObject({
      organizationName: '华数生物',
      warehouseName: '原料仓',
      items: [{ goodsCode: 'G001', inventoryQty: 10, inventoryAmount: 123.45 }],
    });
    expect(stockFindMany).toHaveBeenCalledWith({
      where: { org_id: 10n, warehouse_id: 20n, inventory_qty: { gt: 0 } },
      take: 100_001,
      orderBy: [
        { warehouse_id: 'asc' },
        { goods_id: 'asc' },
        { sku_id: 'asc' },
        { batch_no: 'asc' },
      ],
    });
  });

  it('rejects an empty export instead of creating a blank workbook', async () => {
    const service = serviceWith({
      hspsi_basic_organization: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 10n, name: '华数生物' }),
      },
      hspsi_inventory_batch_total: { count: vi.fn().mockResolvedValue(0) },
    });

    await expect(service.stockExportData({ orgId: '10' })).rejects.toThrow(
      '当前查询条件下暂无可导出数据',
    );
  });
});

describe('inventory check quantity branches', () => {
  it('keeps shortage and damage as independent branches', () => {
    const result = classifyInventoryCheckQuantities(10, 8, 2);

    expect(result).toMatchObject({
      difference: -2,
      quantityBranch: 'shortage',
      hasDamage: true,
    });
    expect(result.inventory + result.difference - result.damaged).toBe(
      result.actual - result.damaged,
    );
  });

  it('keeps overflow and damage as independent branches', () => {
    const result = classifyInventoryCheckQuantities(10, 12, 2);

    expect(result).toMatchObject({
      difference: 2,
      quantityBranch: 'overflow',
      hasDamage: true,
    });
    expect(result.inventory + result.difference - result.damaged).toBe(
      result.actual - result.damaged,
    );
  });

  it('places the same detail into both quantity and damage document groups', () => {
    const shortageWithDamage = { id: 1, differentQty: -2, damagedQty: 2 };
    const overflowWithDamage = { id: 2, differentQty: 3, damagedQty: 1 };
    const groups = partitionInventoryCheckDetails([shortageWithDamage, overflowWithDamage]);

    expect(groups.negative).toEqual([shortageWithDamage]);
    expect(groups.positive).toEqual([overflowWithDamage]);
    expect(groups.damaged).toEqual([shortageWithDamage, overflowWithDamage]);
  });

  it('creates one independent damage document group for every damaged batch', () => {
    const batchA = { id: 1, batchNo: 'A', damagedQty: 1 };
    const batchB = { id: 2, batchNo: 'B', damagedQty: 2 };

    expect(
      splitInventoryDamageDetails([batchA, batchB, { id: 3, batchNo: 'C', damagedQty: 0 }]),
    ).toEqual([[batchA], [batchB]]);
  });

  it('creates only the damage branch when quantity has no difference', () => {
    expect(classifyInventoryCheckQuantities(10, 10, 2)).toMatchObject({
      difference: 0,
      quantityBranch: null,
      hasDamage: true,
    });
  });

  it('allows damaged overflow stock but never more than the physical count', () => {
    expect(classifyInventoryCheckQuantities(10, 12, 11)).toMatchObject({
      quantityBranch: 'overflow',
      hasDamage: true,
      damaged: 11,
    });
    expect(() => classifyInventoryCheckQuantities(10, 8, 9)).toThrow('损坏数量不能超过实盘总数');
  });
});

describe('inventory damage disposal parsing', () => {
  it.each([
    [0, 0],
    ['0', 0],
    [1, 1],
    ['1', 1],
    [2, 2],
    ['2', 2],
  ])('accepts only explicit disposal %p', (value, expected) => {
    expect(parseInventoryLossDisposal(value, true)).toBe(expected);
  });

  it.each([null, undefined, '', ' ', -1, '-1', false, '01'])(
    'rejects non-explicit disposal %p when required',
    (value) => {
      expect(() => parseInventoryLossDisposal(value, true)).toThrow(
        '必须选择直接报废、折价出售或退货',
      );
    },
  );

  it('allows only the unset sentinel while saving a draft', () => {
    expect(parseInventoryLossDisposal('', false)).toBe(-1);
    expect(parseInventoryLossDisposal(-1, false)).toBe(-1);
    expect(parseInventoryLossDisposal(2, false)).toBe(2);
  });
});

describe('generated inventory damage detail integrity', () => {
  const source = [
    { goodsId: 1n, skuId: 11n, batchNo: 'B001', unitType: 1, quantity: 2, amount: 20 },
    { goodsId: 2n, skuId: 22n, batchNo: 'B002', unitType: 1, quantity: 1, amount: 15 },
  ];

  it('allows the original source-check damage lines in any order', () => {
    expect(() => assertGeneratedDamageLinesUnchanged(source, [...source].reverse())).not.toThrow();
  });

  it('rejects changing the source batch or adding and deleting lines', () => {
    expect(() =>
      assertGeneratedDamageLinesUnchanged(source, [
        { ...source[0]!, batchNo: 'OTHER' },
        source[1]!,
      ]),
    ).toThrow('不允许更换商品、SKU或批次');
    expect(() => assertGeneratedDamageLinesUnchanged(source, [source[0]!])).toThrow(
      '不允许增删或重复',
    );
  });

  it('rejects changing quantity, unit, or amount', () => {
    expect(() =>
      assertGeneratedDamageLinesUnchanged(source, [{ ...source[0]!, quantity: 3 }, source[1]!]),
    ).toThrow('单位、数量和金额不允许修改');
    expect(() =>
      assertGeneratedDamageLinesUnchanged(source, [{ ...source[0]!, amount: 1 }, source[1]!]),
    ).toThrow('单位、数量和金额不允许修改');
  });
});

describe('inventory check progress with damage branch', () => {
  it('keeps pure damage at zero until the damage branch is completed', () => {
    expect(calculateInventoryCheckProgress(0, 0, 5, 0, 0, 0)).toEqual({
      total: 5,
      processed: 0,
      progressPct: 0,
    });
    expect(calculateInventoryCheckProgress(0, 0, 5, 0, 0, 5)).toEqual({
      total: 5,
      processed: 5,
      progressPct: 100,
    });
  });

  it('combines shortage, overflow, and damage processing without exceeding 100%', () => {
    expect(calculateInventoryCheckProgress(2, 3, 5, 2, 0, 0)).toEqual({
      total: 10,
      processed: 2,
      progressPct: 20,
    });
    expect(calculateInventoryCheckProgress(2, 3, 5, 2, 3, 5)).toEqual({
      total: 10,
      processed: 10,
      progressPct: 100,
    });
  });
});

describe('inventory draft document row locking', () => {
  function serviceWithTransaction(tx: Record<string, any>) {
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const posting = {
      post: vi.fn().mockResolvedValue(undefined),
    };
    const documentTrace = {
      link: vi.fn().mockResolvedValue(undefined),
      removeForDocument: vi.fn().mockResolvedValue(undefined),
    };
    return {
      service: new InventoryService(
        prisma as never,
        posting as never,
        documentTrace as never,
        { generate: vi.fn(async (prefix: string) => `${prefix}20260804000001`) } as never,
        { assertGoodsLines: vi.fn(), assertWarehouse: vi.fn() } as never,
        {} as never,
      ),
      prisma,
      posting,
      documentTrace,
    };
  }

  it('locks and rechecks a draft header before submitting it', async () => {
    const lock = vi.fn().mockResolvedValue([]);
    const findUnique = vi.fn().mockResolvedValue({
      loss_id: 7n,
      deleted_at: null,
      status: 0,
      approve_status: 0,
      business_kind: 2,
      go_where: 0,
    });
    const update = vi.fn().mockResolvedValue({ loss_id: 7n });
    const tx = {
      $queryRaw: lock,
      hspsi_inventory_loss: { findUnique, update },
      hspsi_inventory_overflow: {},
    };
    const { service } = serviceWithTransaction(tx);

    await expect(service.submitDocument('loss', '7')).resolves.toEqual({
      id: '7',
      message: '已提交审批',
    });
    expect(lock).toHaveBeenCalledOnce();
    expect(findUnique).toHaveBeenCalledWith({ where: { loss_id: 7n } });
    expect(update).toHaveBeenCalledWith({
      where: { loss_id: 7n },
      data: { status: 1, approve_status: 0 },
    });
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(findUnique.mock.invocationCallOrder[0]!);
    expect(findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0]!,
    );
  });

  it('rejects independent overflow edits before changing any detail', async () => {
    const update = vi.fn();
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_inventory_loss: {},
      hspsi_inventory_overflow: {
        findUnique: vi.fn().mockResolvedValue({
          overflow_id: 8n,
          deleted_at: null,
          status: 1,
          approve_status: 1,
        }),
        update,
      },
      hspsi_inventory_overflow_detail: { deleteMany, createMany },
    };
    const { service } = serviceWithTransaction(tx);
    vi.spyOn(service as any, 'document').mockResolvedValue({
      id: 8n,
      status: 0,
      approveStatus: 0,
      sourceCheckId: 0n,
    });
    vi.spyOn(service as any, 'normalizeInventoryDocumentLines').mockResolvedValue([
      {
        goodsId: 101n,
        skuId: 201n,
        batchNo: 'B001',
        unitType: 1,
        quantity: 1,
        amount: 10,
      },
    ]);

    await expect(
      service.saveDocument(
        'overflow',
        '8',
        {
          orgId: 1,
          warehouseId: 2,
          deptId: 3,
          reason: '盘盈',
          date: '2026-07-31',
          details: [{ goodsId: 101, skuId: 201, batchNo: 'B001', quantity: 1 }],
        },
        '9',
        false,
      ),
    ).rejects.toThrow('报盈入库单只能由库存盘点生成');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'overflow',
      {
        overflow_id: 8n,
        deleted_at: null,
        status: 1,
        approve_status: 0,
      },
    ],
    [
      'loss-output',
      {
        loss_id: 9n,
        deleted_at: null,
        status: 1,
        approve_status: 1,
      },
    ],
  ] as const)(
    'does not delete a concurrently submitted or confirmed %s document',
    async (type, lockedHeader) => {
      const lossOutputUpdate = vi.fn();
      const overflowUpdate = vi.fn();
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        hspsi_inventory_loss: {},
        hspsi_inventory_loss_output: {
          findUnique: vi.fn().mockResolvedValue(type === 'loss-output' ? lockedHeader : null),
          update: lossOutputUpdate,
        },
        hspsi_inventory_overflow: {
          findUnique: vi.fn().mockResolvedValue(type === 'overflow' ? lockedHeader : null),
          update: overflowUpdate,
        },
      };
      const { service } = serviceWithTransaction(tx);

      await expect(
        service.removeDocument(type, type === 'overflow' ? '8' : '9', '3'),
      ).rejects.toThrow('仅草稿单据可删除');
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
      expect(lossOutputUpdate).not.toHaveBeenCalled();
      expect(overflowUpdate).not.toHaveBeenCalled();
    },
  );

  it('keeps a generated damage document undeletable after locking it', async () => {
    const update = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_inventory_loss: {
        findUnique: vi.fn().mockResolvedValue({
          loss_id: 10n,
          deleted_at: null,
          status: 0,
          approve_status: 0,
          business_kind: 2,
          source_check_id: 6n,
        }),
        update,
      },
      hspsi_inventory_loss_output: {},
      hspsi_inventory_overflow: {},
    };
    const { service } = serviceWithTransaction(tx);

    await expect(service.removeDocument('loss', '10', '3')).rejects.toThrow(
      '盘点生成的报损出库单不能删除',
    );
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects editing a generated loss output', async () => {
    const update = vi.fn();
    const deleteMany = vi.fn();
    const createMany = vi.fn();
    const sourceFindUnique = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_inventory_loss: { findUnique: sourceFindUnique },
      hspsi_inventory_loss_detail: { findMany: vi.fn() },
      hspsi_inventory_loss_output: {
        findUnique: vi.fn().mockResolvedValue({
          loss_id: 11n,
          deleted_at: null,
          status: 1,
          approve_status: 1,
          source_loss_id: 5n,
        }),
        findFirst: vi.fn(),
        update,
      },
      hspsi_inventory_loss_output_detail: { deleteMany, createMany },
      hspsi_inventory_overflow: {},
    };
    const { service } = serviceWithTransaction(tx);

    await expect(service.saveLossOutput('11', { sourceLossId: 5 }, '9')).rejects.toThrow(
      '报亏出库单只能由库存盘点生成',
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(sourceFindUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('rejects changing a generated loss-output source', async () => {
    const sourceFindUnique = vi.fn();
    const update = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_inventory_loss: { findUnique: sourceFindUnique },
      hspsi_inventory_loss_detail: { findMany: vi.fn() },
      hspsi_inventory_loss_output: {
        findUnique: vi.fn().mockResolvedValue({
          loss_id: 11n,
          deleted_at: null,
          status: 0,
          approve_status: 0,
          source_loss_id: 5n,
        }),
        findFirst: vi.fn(),
        update,
      },
      hspsi_inventory_loss_output_detail: { deleteMany: vi.fn(), createMany: vi.fn() },
      hspsi_inventory_overflow: {},
    };
    const { service } = serviceWithTransaction(tx);

    await expect(service.saveLossOutput('11', { sourceLossId: 6 }, '9')).rejects.toThrow(
      '报亏出库单只能由库存盘点生成',
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(sourceFindUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects manually generating a loss output from an intermediate shortage', async () => {
    const sourceLock = vi.fn().mockResolvedValue([]);
    const sourceFindUnique = vi.fn().mockResolvedValue({
      loss_id: 5n,
      loss_no: 'ILS5',
      loss_type: 1,
      loss_reson: '盘亏',
      org_id: 1n,
      warehouse_id: 2n,
      dept_id: 3n,
      source_check_id: 4n,
      business_kind: 1,
      approve_status: 1,
      deleted_at: null,
    });
    const duplicateFind = vi.fn().mockResolvedValue(null);
    const detailFind = vi.fn().mockResolvedValue([
      {
        goods_id: 101n,
        sku_id: 201n,
        batch_no: 'B001',
        unit_type: 1,
        loss_qty: 2,
        loss_amount: 20,
      },
    ]);
    const create = vi.fn().mockResolvedValue({ loss_id: 12n, loss_no: 'TMP12' });
    const update = vi.fn().mockResolvedValue({ loss_id: 12n, loss_no: 'ILO12' });
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: sourceLock,
      hspsi_inventory_loss: { findUnique: sourceFindUnique },
      hspsi_inventory_loss_detail: { findMany: detailFind },
      hspsi_inventory_loss_output: {
        findFirst: duplicateFind,
        create,
        update,
      },
      hspsi_inventory_loss_output_detail: { deleteMany, createMany },
      hspsi_inventory_overflow: {},
    };
    const { service, documentTrace } = serviceWithTransaction(tx);

    await expect(
      service.saveLossOutput(
        null,
        {
          sourceLossId: 5,
          date: '2026-07-31',
          remark: '自动生成',
        },
        '9',
      ),
    ).rejects.toThrow('报亏出库单只能由库存盘点生成');
    expect(sourceLock).not.toHaveBeenCalled();
    expect(sourceFindUnique).not.toHaveBeenCalled();
    expect(duplicateFind).not.toHaveBeenCalled();
    expect(detailFind).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(documentTrace.link).not.toHaveBeenCalled();
  });

  it('approves a check-generated loss output using details read after its row lock', async () => {
    const lock = vi.fn().mockResolvedValue([]);
    const outputFindUnique = vi.fn().mockResolvedValue({
      loss_id: 13n,
      loss_no: 'ILO13',
      loss_reson: '盘亏出库',
      org_id: 1n,
      warehouse_id: 2n,
      source_loss_id: 0n,
      source_check_id: 4n,
      loss_qty: 3,
      loss_total_amount: 30,
      status: 1,
      approve_status: 0,
      deleted_at: null,
    });
    const checkFindUnique = vi.fn().mockResolvedValue({
      check_id: 4n,
      check_no: 'IC4',
      approve_status: 1,
      deleted_at: null,
    });
    const detailFind = vi.fn().mockResolvedValue([
      {
        goods_id: 101n,
        sku_id: 201n,
        batch_no: 'LATEST',
        unit_type: 1,
        loss_qty: 3,
        loss_amount: 30,
      },
    ]);
    const outputUpdate = vi.fn().mockResolvedValue({ loss_id: 13n });
    const tx = {
      $queryRaw: lock,
      hspsi_inventory_loss: { findUnique: vi.fn() },
      hspsi_inventory_loss_output: {
        findUnique: outputFindUnique,
        findFirst: vi.fn().mockResolvedValue(null),
        update: outputUpdate,
      },
      hspsi_inventory_loss_output_detail: { findMany: detailFind },
      hspsi_inventory_overflow: {},
      hspsi_inventory_check: { findUnique: checkFindUnique, update: vi.fn() },
    };
    const { service, posting } = serviceWithTransaction(tx);

    await expect(service.approveLossOutput('13', true, '审核通过', '9')).resolves.toEqual({
      id: '13',
      inventoryPosted: true,
      message: '报亏出库审核通过，库存已按全部来源批次一次性扣减',
    });
    expect(outputFindUnique.mock.invocationCallOrder[0]).toBeLessThan(
      detailFind.mock.invocationCallOrder[0]!,
    );
    expect(posting.post).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 13n,
        lines: [expect.objectContaining({ batchNo: 'LATEST', quantity: '3', amount: '30' })],
      }),
      tx,
    );
    expect(outputUpdate).toHaveBeenCalledOnce();
  });

  it('rejects a loss output without posting inventory', async () => {
    const outputUpdate = vi.fn().mockResolvedValue({ loss_id: 14n });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_inventory_loss_output: {
        findUnique: vi.fn().mockResolvedValue({
          loss_id: 14n,
          status: 1,
          approve_status: 0,
          deleted_at: null,
        }),
        update: outputUpdate,
      },
    };
    const { service, posting } = serviceWithTransaction(tx);

    await expect(service.approveLossOutput('14', false, '数量需复核', '9')).resolves.toEqual({
      id: '14',
      inventoryPosted: false,
      message: '报亏出库审核未通过，库存未变动',
    });
    expect(posting.post).not.toHaveBeenCalled();
    expect(outputUpdate).toHaveBeenCalledWith({
      where: { loss_id: 14n },
      data: expect.objectContaining({ approve_status: 2, approve_comment: '数量需复核' }),
    });
  });

  it('generates a purchase-return draft for damage return without posting inventory', async () => {
    const lockedLoss = {
      loss_id: 15n,
      loss_no: 'IL15',
      loss_reson: '包装损坏退供应商',
      business_kind: 2,
      go_where: 2,
      org_id: 1n,
      warehouse_id: 2n,
      status: 1,
      approve_status: 0,
    };
    const lossDetail = {
      loss_detail_id: 150n,
      loss_id: 15n,
      goods_id: 5n,
      sku_id: 6n,
      batch_no: 'PH20260807',
      unit_type: 1,
      loss_qty: 2,
      source_receipt_detail_id: 70n,
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_inventory_loss: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(lockedLoss),
        update: vi.fn(),
      },
      hspsi_inventory_loss_detail: { findMany: vi.fn().mockResolvedValue([lossDetail]) },
      hspsi_purchase_order_input_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 70n,
            po_input_id: 8n,
            po_id: 9n,
            goods_id: 5n,
            sku_id: 6n,
            batch_no: 'PH20260807',
            unit_type: 1,
            po_qty: 10,
            input_qty: 8,
          },
        ]),
      },
      hspsi_purchase_order_input: {
        findFirst: vi.fn().mockResolvedValue({
          po_input_id: 8n,
          po_input_no: 'PI8',
          po_id: 9n,
          org_id: 1n,
          warehouse_id: 2n,
          comfirm_status: 1,
        }),
      },
      hspsi_purchase_order_input_exit: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ po_exit_id: 20n }),
      },
      hspsi_purchase_order_input_exit_detail: { createMany: vi.fn() },
    };
    const { service, posting, documentTrace } = serviceWithTransaction(tx);
    vi.spyOn(service as any, 'document').mockResolvedValue({
      id: 15n,
      businessNo: 'IL15',
      businessKind: 2,
      status: 1,
      approveStatus: 0,
      org_id: 1n,
      warehouse_id: 2n,
      sourceCheckId: 0n,
      details: [],
    } as never);

    const result = await service.approveDocument('loss', '15', true, '同意退货', '9');

    expect(result).toMatchObject({ purchaseReturnIds: [20n] });
    expect(tx.hspsi_purchase_order_input_exit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          generation_key: 'inventory-loss-return:15:8',
          auto_created: 1,
          status: false,
          approve_status: 0,
        }),
      }),
    );
    expect(posting.post).not.toHaveBeenCalled();
    expect(documentTrace.link).toHaveBeenCalledWith(
      expect.objectContaining({ relationKind: 'damage_return' }),
      tx,
    );
  });
});

describe('inventory requisition history query', () => {
  function setup() {
    const output = {
      draw_output_id: 7n,
      draw_output_no: 'DRO7',
      draw_id: 3n,
      org_id: 1n,
      warehouse_id: 2n,
      dept_id: 4n,
      receiver_id: 5n,
      output_date: new Date('2026-08-07T08:00:00+08:00'),
      comfirm_status: 1,
    };
    const prisma = {
      hspsi_draw_approve_output: { findMany: vi.fn().mockResolvedValue([output]) },
      hspsi_draw_approve_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            output_detail_id: 71n,
            draw_output_id: 7n,
            goods_id: 10n,
            sku_id: 11n,
            batch_no: 'PH20260807',
            unit_type: 1,
            fact_draw_qty: 5,
            is_returnable: 1,
          },
          {
            output_detail_id: 72n,
            draw_output_id: 7n,
            goods_id: 12n,
            sku_id: 13n,
            batch_no: 'PH20260807',
            unit_type: 1,
            fact_draw_qty: 2,
            is_returnable: 0,
          },
        ]),
      },
      hspsi_draw_approve_output_exit: {
        findMany: vi.fn().mockResolvedValue([{ draw_exit_id: 8n }]),
      },
      hspsi_draw_approve_output_exit_detail: {
        findMany: vi.fn().mockResolvedValue([{ draw_output_detail_id: 71n, exit_qty: 3 }]),
      },
      hspsi_draw_approve: {
        findMany: vi.fn().mockResolvedValue([{ draw_id: 3n, draw_no: 'DR3' }]),
      },
      hspsi_goods_info: {
        findMany: vi.fn().mockResolvedValue([
          { goods_id: 10n, query_code: 'G10', goods_name: '借用设备' },
          { goods_id: 12n, query_code: 'G12', goods_name: '领用耗材' },
        ]),
      },
      hspsi_goods_info_sku: {
        findMany: vi.fn().mockResolvedValue([
          { sku_id: 11n, spec_models: '默认规格' },
          { sku_id: 13n, spec_models: '默认规格' },
        ]),
      },
      hspsi_basic_warehouse: {
        findMany: vi.fn().mockResolvedValue([{ warehouse_id: 2n, name: '行政仓' }]),
      },
      hspsi_basic_organization: {
        findMany: vi.fn().mockResolvedValue([{ org_id: 1n, name: '总部' }]),
      },
      hspsi_basic_dept: {
        findMany: vi.fn().mockResolvedValue([{ dept_id: 4n, name: '实验室' }]),
      },
      hspsi_basic_staff: {
        findMany: vi.fn().mockResolvedValue([{ id: 5n, name: '领用人甲' }]),
      },
      hspsi_basic_unit: {
        findMany: vi.fn().mockResolvedValue([{ id: 1n, name: '件' }]),
      },
    };
    const service = new InventoryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      { assertGoodsLines: vi.fn(), assertWarehouse: vi.fn() } as never,
      {} as never,
    );
    return { service, prisma };
  }

  it('shows every confirmed usage detail by default', async () => {
    const { service } = setup();

    const result = await service.requisitionHistory({ orgId: 1, page: 1, pageSize: 20 });

    expect(result.total).toBe(2);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 71n, returnedQty: 3, remainingQty: 2 }),
        expect.objectContaining({ id: 72n, holdingStatusName: '无需归还' }),
      ]),
    );
  });

  it('limits holding inventory to returnable details that are not fully returned', async () => {
    const { service, prisma } = setup();

    const result = await service.requisitionHistory({
      orgId: 1,
      departmentId: 4,
      receiverId: 5,
      holdingStatus: 'holding',
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ id: 71n, remainingQty: 2, returnable: true });
    expect(prisma.hspsi_draw_approve_output.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ org_id: 1n, dept_id: 4n, receiver_id: 5n }),
      }),
    );
  });
});

describe('inventory stocks keyword search (BUG-NEW-01)', () => {
  function stocksService() {
    const prisma = {
      hspsi_goods_info: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_goods_info_sku: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_inventory_batch_total: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      hspsi_basic_unit: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_goods_info_category: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const service = new InventoryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(service as any, 'names').mockResolvedValue({
      goods: [],
      skus: [],
      warehouses: [],
      orgs: [],
    });
    vi.spyOn(service as any, 'quantityAlertCount').mockResolvedValue(0);
    return { service, prisma };
  }

  it('matches a pure numeric keyword against sku_id even when spec_models has no match', async () => {
    const { service, prisma } = stocksService();
    await service.stocks({ keyword: '1900701110', orgId: '9', page: '1', pageSize: '20' });
    const where = prisma.hspsi_inventory_batch_total.findMany.mock.calls[0]![0].where;
    expect(where.org_id).toBe(9n);
    expect(where.OR).toContainEqual({ sku_id: 1900701110n });
    expect(prisma.hspsi_goods_info_sku.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deleted_at: null, spec_models: { contains: '1900701110' } },
      }),
    );
  });

  it('keeps the original goods/spec matching for non-numeric keywords', async () => {
    const { service, prisma } = stocksService();
    await service.stocks({ keyword: '墨水', page: '1', pageSize: '20' });
    const where = prisma.hspsi_inventory_batch_total.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([{ goods_id: { in: [] } }, { sku_id: { in: [] } }]);
  });

  it('skips keyword matching entirely when no keyword is given', async () => {
    const { service, prisma } = stocksService();
    await service.stocks({ orgId: '9', page: '1', pageSize: '20' });
    const where = prisma.hspsi_inventory_batch_total.findMany.mock.calls[0]![0].where;
    expect(where.OR).toBeUndefined();
  });
});

describe('inventory quantity alerts sql pagination', () => {
  function serviceWith(prisma: Record<string, any>) {
    const service = new InventoryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return service;
  }

  const statsRows = [
    { warehouse_id: 1n, item_count: 3n, total_amount: '60.50', warning_count: 1n },
    { warehouse_id: 2n, item_count: 2n, total_amount: '40.00', warning_count: 0n },
  ];

  function prismaWith(
    raw: ReturnType<typeof vi.fn>,
    warehouses = [{ warehouse_id: 1n }, { warehouse_id: 2n }],
  ) {
    return {
      hspsi_basic_warehouse: { findMany: vi.fn().mockResolvedValue(warehouses) },
      $queryRaw: raw,
    };
  }

  it('keeps total/summary/warehouseCounts stable even when the requested page is empty', async () => {
    const raw = vi.fn().mockResolvedValueOnce(statsRows).mockResolvedValueOnce([]);
    const service = serviceWith(prismaWith(raw));
    vi.spyOn(service as any, 'names').mockResolvedValue({
      goods: [],
      skus: [],
      warehouses: [],
      orgs: [],
    });
    const res = await service.quantityAlerts({ page: 99, pageSize: 20 });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(5);
    expect(res.page).toBe(99);
    expect(res.pageSize).toBe(20);
    expect(res.warehouseCounts).toEqual({ 1: 3, 2: 2 });
    expect(res.summary).toEqual({ itemCount: 5, totalAmount: 100.5, warningCount: 1 });
  });

  it('scopes total and summary to the selected warehouse while warehouseCounts stays org-wide', async () => {
    const raw = vi.fn().mockResolvedValueOnce(statsRows).mockResolvedValueOnce([]);
    const service = serviceWith(prismaWith(raw));
    vi.spyOn(service as any, 'names').mockResolvedValue({
      goods: [],
      skus: [],
      warehouses: [],
      orgs: [],
    });
    const res = await service.quantityAlerts({ warehouseId: '1', page: 1, pageSize: 20 });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(3);
    expect(res.summary).toEqual({ itemCount: 3, totalAmount: 60.5, warningCount: 1 });
    expect(res.warehouseCounts).toEqual({ 1: 3, 2: 2 });
  });

  it('maps a configured page row to the same item shape with refs enrichment', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(statsRows)
      .mockResolvedValueOnce([
        {
          stock_id: 101n,
          config_id: 5n,
          org_id: 9n,
          warehouse_id: 1n,
          goods_id: 11n,
          sku_id: 111n,
          fact_qty: 5,
          inventory_amount: '12.50',
          safe_qty: 8,
          gap_qty: 3,
          purchase_qty: 4,
        },
      ]);
    const service = serviceWith(prismaWith(raw));
    vi.spyOn(service as any, 'names').mockResolvedValue({
      goods: [{ goods_id: 11n, query_code: 'G-11', goods_name: '商品11', goods_catg_id: 0n }],
      skus: [{ sku_id: 111n, spec_models: '规格11' }],
      warehouses: [{ warehouse_id: 1n, name: '仓库一' }],
      orgs: [{ org_id: 9n, name: '组织九' }],
    });
    const res = await service.quantityAlerts({ page: 1, pageSize: 20 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: 5n,
      orgId: 9n,
      goodsId: 11n,
      goodsCode: 'G-11',
      goodsName: '商品11',
      skuId: 111n,
      skuSpec: '规格11',
      warehouseId: 1n,
      warehouseName: '仓库一',
      factQty: 5,
      safeQty: 8,
      gapQty: 3,
      purchaseQty: 4,
      inventoryAmount: 12.5,
      warning: true,
    });
  });

  it('keeps an unconfigured row as normal with no config id', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(statsRows)
      .mockResolvedValueOnce([
        {
          stock_id: 102n,
          config_id: null,
          org_id: 9n,
          warehouse_id: 2n,
          goods_id: 22n,
          sku_id: 222n,
          fact_qty: 3,
          inventory_amount: '40.00',
          safe_qty: 0,
          gap_qty: 0,
          purchase_qty: 0,
        },
      ]);
    const service = serviceWith(prismaWith(raw));
    vi.spyOn(service as any, 'names').mockResolvedValue({
      goods: [],
      skus: [],
      warehouses: [],
      orgs: [],
    });
    const res = await service.quantityAlerts({ page: 1, pageSize: 20 });
    expect(res.items[0]).toMatchObject({
      id: undefined,
      factQty: 3,
      safeQty: 0,
      gapQty: 0,
      purchaseQty: 0,
      warning: false,
    });
  });

  it('rejects an invalid status value with the same message as before', async () => {
    const service = serviceWith(prismaWith(vi.fn()));
    await expect(service.quantityAlerts({ status: 'x' })).rejects.toThrow('库存状态参数无效');
  });
});

describe('inventory expiry alerts sql pagination', () => {
  function serviceWith(prisma: Record<string, any>) {
    return new InventoryService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  function expiryPrisma(raw: ReturnType<typeof vi.fn>) {
    return {
      hspsi_basic_warehouse: {
        findMany: vi.fn().mockResolvedValue([{ warehouse_id: 1n }]),
      },
      hspsi_sys_dictionary_category: {
        findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1n }),
      },
      hspsi_sys_dictionary: {
        findMany: vi.fn().mockResolvedValue([{ dict_value: 1, dict_name: '临期' }]),
      },
      hspsi_inventory_alert_period: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 9n, end_day: new Date('2030-01-01T00:00:00.000Z') }]),
      },
      $queryRaw: raw,
    };
  }

  const statsRows = [{ warehouse_id: 1n, item_count: 2n }];
  const pageRow = {
    period_id: 9n,
    warehouse_id: 1n,
    goods_id: 11n,
    sku_id: 111n,
    batch_no: 'B001',
    alter_type: 1,
    alter_day: 30,
    inventory_qty: 10,
    inventory_amount: '55.50',
  };

  it('aggregates total/warehouseCounts from stats and maps page rows with refs and dictionary', async () => {
    const raw = vi.fn().mockResolvedValueOnce(statsRows).mockResolvedValueOnce([pageRow]);
    const service = serviceWith(expiryPrisma(raw));
    vi.spyOn(service as any, 'names').mockResolvedValue({
      goods: [{ goods_id: 11n, query_code: 'G-11', goods_name: '商品11', goods_catg_id: 0n }],
      skus: [{ sku_id: 111n, spec_models: '规格11' }],
      warehouses: [{ warehouse_id: 1n, name: '仓库一' }],
      orgs: [],
    });
    const res = await service.expiryAlerts({ page: 1, pageSize: 20 });
    expect(res.total).toBe(2);
    expect(res.warehouseCounts).toEqual({ 1: 2 });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: 9n,
      goodsId: 11n,
      goodsCode: 'G-11',
      goodsName: '商品11',
      skuSpec: '规格11',
      warehouseId: 1n,
      warehouseName: '仓库一',
      batchNo: 'B001',
      inventoryQty: 10,
      alertQty: 10,
      alertType: 1,
      alertTypeName: '临期',
      alertDays: 30,
      alertValue: 55.5,
    });
    // 2030 到期日在 30 天以上 → 正常
    expect(res.items[0]!.expiryStatus).toBe('正常');
  });

  it('keeps org-wide warehouseCounts and totals when a warehouse tab is selected', async () => {
    const raw = vi
      .fn()
      .mockResolvedValueOnce(statsRows)
      .mockResolvedValueOnce([pageRow])
      .mockResolvedValueOnce(statsRows)
      .mockResolvedValueOnce([]);
    const service = serviceWith(expiryPrisma(raw));
    vi.spyOn(service as any, 'names').mockResolvedValue({
      goods: [],
      skus: [],
      warehouses: [],
      orgs: [],
    });
    const res = await service.expiryAlerts({ warehouseId: '1', page: 1, pageSize: 20 });
    expect(res.total).toBe(2);
    expect(res.warehouseCounts).toEqual({ 1: 2 });
    const empty = await service.expiryAlerts({ warehouseId: '9', page: 1, pageSize: 20 });
    expect(empty.total).toBe(0);
    expect(empty.items).toEqual([]);
  });
});
