import { describe, expect, it, vi } from 'vitest';
import { ProductionService } from './production.service';

function serviceWith(
  prisma: Record<string, any>,
  trace: Record<string, any> = { link: vi.fn(), removeForDocument: vi.fn() },
  posting: Record<string, any> = { post: vi.fn() },
  masterData: Record<string, any> = {
    assertGoodsLines: vi.fn(),
    assertGoodsActive: vi.fn(),
    assertWarehouse: vi.fn(),
  },
) {
  return new ProductionService(
    prisma as never,
    posting as never,
    { syncExpiryAlert: vi.fn() } as never,
    { enrich: vi.fn(async (rows: unknown[]) => rows) } as never,
    trace as never,
    { generate: vi.fn(async (prefix: string) => `${prefix}20260804000001`) } as never,
    masterData as never,
  );
}

describe('ProductionService mapped product options', () => {
  it('loads BOM finished-goods candidates from all warehouse types owned by the organization', async () => {
    const masterData = {
      assertGoodsLines: vi.fn(),
      assertGoodsActive: vi.fn(),
      assertWarehouse: vi.fn(),
      goodsOptionsByOrg: vi
        .fn()
        .mockResolvedValue([{ goodsId: 101n, goodsName: '康复训练成品' }]),
    };
    const service = serviceWith({}, undefined, undefined, masterData);

    await expect(service.allProductOptions('6')).resolves.toEqual([
      { goodsId: 101n, goodsName: '康复训练成品' },
    ]);
    expect(masterData.goodsOptionsByOrg).toHaveBeenCalledWith(6n);
  });
});

describe('ProductionService chain guards', () => {
  it('allows confirmed temporary supplements and subtracts draft BOM return occupancy', async () => {
    const prisma = {
      hspsi_production_material_out: {
        findFirst: vi.fn().mockResolvedValue({
          out_id: 7,
          out_no: 'PMO7',
          out_type: 2,
          confirm_tag: 1,
          org_id: 1,
          warehouse_id: 2,
        }),
      },
      hspsi_production_material_out_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            serial_number: 11,
            goods_id: 100,
            sku_id: 200,
            out_qty: 10,
            batch_no: 'PH20260807',
          },
        ]),
      },
      hspsi_production_material_return: {
        findMany: vi.fn().mockImplementation((args: any) => {
          if (!args.select) return [];
          return args.where.status.in[0] === 1 ? [{ return_id: 20n }] : [{ return_id: 21n }];
        }),
      },
      hspsi_production_material_return_detail: {
        groupBy: vi
          .fn()
          .mockResolvedValueOnce([{ source_out_detail_id: 11, _sum: { return_qty: 2 } }])
          .mockResolvedValueOnce([{ source_out_detail_id: 11, _sum: { return_qty: 3 } }]),
      },
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ name: '原料仓' }),
      },
    };

    const result = await serviceWith(prisma).materialReturnAvailable('7');

    expect(result.details).toEqual([
      expect.objectContaining({ returnedQty: 2, occupiedQty: 3, remainingQty: 5 }),
    ]);
    expect(result.returnableQty).toBe(5);
  });

  it('blocks deleting a plan that still has an active shortage purchase application', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_production_plan: {
        findFirst: vi.fn().mockResolvedValue({ plan_id: 1n, outbound_status: 0, delivered_qty: 0 }),
        update: vi.fn(),
      },
      hspsi_production_material_out: { count: vi.fn().mockResolvedValue(0) },
      hspsi_production_plan_input: { count: vi.fn().mockResolvedValue(0) },
      hspsi_production_shortage: {
        findMany: vi.fn().mockResolvedValue([{ pur_id: 7n }]),
        updateMany: vi.fn(),
      },
      hspsi_purchase_approve: {
        findMany: vi.fn().mockResolvedValue([{ pur_id: 7n, approve_status: 0 }]),
      },
      hspsi_purchase_order: { count: vi.fn().mockResolvedValue(0) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(serviceWith(prisma).deletePlan('1', '9')).rejects.toThrow(
      '有效采购申请或采购订单',
    );
    expect(tx.hspsi_production_plan.update).not.toHaveBeenCalled();
  });

  it('does not create another plan when sales outputs and existing plans already cover the order', async () => {
    const createPlan = vi.fn();
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_production_bom: {
        findFirst: vi.fn().mockResolvedValue({ bom_id: 3n, goods_id: 100n, sku_id: 200n }),
      },
      hspsi_production_bom_detail: { findMany: vi.fn().mockResolvedValue([{ goods_id: 10n }]) },
      hspsi_sale_order: {
        findFirst: vi.fn().mockResolvedValue({ so_id: 2n, org_id: 1n, warehouse_id: 3n }),
      },
      hspsi_sale_order_detail: { findMany: vi.fn().mockResolvedValue([{ sale_qty: 15 }]) },
      hspsi_sale_order_output: { findMany: vi.fn().mockResolvedValue([{ so_output_id: 7n }]) },
      hspsi_sale_order_output_detail: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { output_qty: 5 } }),
      },
      hspsi_production_plan: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { plan_qty: 10 } }),
        create: createPlan,
      },
    };

    await expect(
      serviceWith({}).createPlanFromSalesGap(
        tx as never,
        {
          sourceId: 2,
          bomId: 3,
          planQty: 10,
          orgId: 1,
          warehouseId: 2,
          productWarehouseId: 3,
        },
        '9',
      ),
    ).resolves.toEqual({ type: 'production', created: false });
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('allows a second plan only for the two-unit uncovered sales quantity', async () => {
    const planUpdate = vi.fn();
    const createPlan = vi.fn().mockResolvedValue({ plan_id: 6n });
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_production_bom: {
        findFirst: vi.fn().mockResolvedValue({ bom_id: 3n, goods_id: 100n, sku_id: 200n }),
      },
      hspsi_production_bom_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { goods_id: 10n, sku_id: 11n, require_qty: 2, unit_type: 1, remark: '' },
          ]),
      },
      hspsi_sale_order: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ so_id: 2n, so_no: 'SO2', org_id: 1n, warehouse_id: 3n }),
      },
      hspsi_sale_order_detail: { findMany: vi.fn().mockResolvedValue([{ sale_qty: 15 }]) },
      hspsi_sale_order_output: { findMany: vi.fn().mockResolvedValue([{ so_output_id: 7n }]) },
      hspsi_sale_order_output_detail: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { output_qty: 5 } }),
      },
      hspsi_production_plan: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { plan_qty: 8 } }),
        create: createPlan,
        update: planUpdate,
      },
      hspsi_production_shortage: {
        create: vi.fn().mockResolvedValue({ shortage_id: 9n }),
        update: vi.fn(),
      },
      hspsi_production_plan_detail: { create: vi.fn() },
      hspsi_inventory_batch_total: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { inventory_qty: 20 } }),
      },
    };
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };

    const result = await serviceWith({}, trace).createPlanFromSalesGap(
      tx as never,
      {
        sourceId: 2,
        sourceNo: 'SO2',
        bomId: 3,
        orgId: 1,
        warehouseId: 2,
        planQty: 2,
        productWarehouseId: 3,
      },
      '9',
    );

    expect(result).toMatchObject({ id: 6n, created: true });
    expect(createPlan).toHaveBeenCalledWith({
      data: expect.objectContaining({
        plan_qty: expect.anything(),
        source_id: 2n,
        product_warehouse_id: 3n,
      }),
    });
    expect(Number(createPlan.mock.calls[0]![0].data.plan_qty)).toBe(2);
    expect(planUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { plan_id: 6n },
      }),
    );
  });

  it('marks a newly created shortage plan and automatically creates its purchase application', async () => {
    const planUpdate = vi.fn();
    const purchaseCreate = vi.fn().mockResolvedValue({ pur_id: 21n, pur_no: 'TMP21' });
    const shortage = {
      shortage_id: 9n,
      shortage_no: 'PS202608020009',
      goods_id: 10n,
      sku_id: 11n,
      unit_type: 1,
      suggest_purchase_qty: 3,
      pur_id: 0n,
    };
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_production_bom: {
        findFirst: vi.fn().mockResolvedValue({ bom_id: 3n, goods_id: 100n, sku_id: 200n }),
      },
      hspsi_production_bom_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { goods_id: 10n, sku_id: 11n, require_qty: 2, unit_type: 1, remark: '' },
          ]),
      },
      hspsi_sale_order: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ so_id: 2n, so_no: 'SO2', org_id: 1n, warehouse_id: 3n }),
      },
      hspsi_sale_order_detail: { findMany: vi.fn().mockResolvedValue([{ sale_qty: 15 }]) },
      hspsi_sale_order_output: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_production_plan: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { plan_qty: 0 } }),
        create: vi
          .fn()
          .mockResolvedValue({ plan_id: 6n, plan_no: 'TMP6', org_id: 1n, warehouse_id: 2n }),
        update: planUpdate,
      },
      hspsi_production_plan_detail: { create: vi.fn() },
      hspsi_inventory_batch_total: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { inventory_qty: 1 } }),
      },
      hspsi_production_shortage: {
        create: vi.fn().mockResolvedValue({ shortage_id: 9n }),
        update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([shortage]),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
      hspsi_goods_info: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 10n, const_price: 5 }]),
      },
      hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ dept_id: 2n }) },
      hspsi_purchase_approve: { create: purchaseCreate, update: vi.fn(), findFirst: vi.fn() },
      hspsi_purchase_approve_detail: { createMany: vi.fn() },
    };
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };

    const result = await serviceWith({}, trace).createPlanFromSalesGap(
      tx as never,
      {
        sourceId: 2,
        sourceNo: 'SO2',
        bomId: 3,
        orgId: 1,
        warehouseId: 2,
        productWarehouseId: 3,
        planQty: 2,
      },
      '9',
    );

    expect(result).toMatchObject({
      id: 6n,
      created: true,
      shortage: true,
      purchaseApplicationId: 21n,
    });
    expect(purchaseCreate).toHaveBeenCalledOnce();
    expect(purchaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dept_id: 2n }) }),
    );
    expect(planUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { plan_id: 6n },
        data: expect.objectContaining({
          plan_status: 7,
          material_status: 3,
          stock_check_status: 2,
          approve_status: 0,
        }),
      }),
    );
  });

  it('moves a shortage plan to pending approval after inventory recheck succeeds', async () => {
    const planUpdate = vi.fn();
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_production_plan: {
        findFirst: vi.fn().mockResolvedValue({
          plan_id: 6n,
          plan_no: 'PP202608020006',
          org_id: 1n,
          warehouse_id: 2n,
          plan_status: 7,
          material_status: 4,
          approve_status: 0,
          outbound_status: 0,
          delivered_qty: 0,
        }),
        update: planUpdate,
      },
      hspsi_production_material_out: { count: vi.fn().mockResolvedValue(0) },
      hspsi_production_shortage: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      hspsi_inventory_batch_total: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { inventory_qty: 10 } }),
      },
    };
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, trace);
    vi.spyOn(service, 'plan').mockResolvedValue({
      id: 6n,
      planNo: 'PP202608020006',
      orgId: 1n,
      warehouseId: 2n,
      planStatus: 7,
      materialStatus: 4,
      stockCheckStatus: 0,
      outboundStatus: 0,
      approveStatus: 0,
      deliveredQty: 0,
      details: [{ goodsId: 10n, skuId: 11n, standardQty: 4, unitType: 1 }],
    } as never);

    const result = await service.recheckPlan('6', '9');

    expect(result).toMatchObject({
      id: '6',
      shortage: false,
      message: '库存校验通过，生产计划已进入待审核',
    });
    expect(planUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { plan_id: 6n },
        data: expect.objectContaining({
          plan_status: 1,
          material_status: 4,
          stock_check_status: 1,
          approve_status: 0,
        }),
      }),
    );
  });

  it('checks selected batch stock before a formal material issue is saved', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_inventory_total: { findUnique: vi.fn().mockResolvedValue({ inventory_qty: 10 }) },
      hspsi_inventory_batch_total: { findUnique: vi.fn().mockResolvedValue({ inventory_qty: 1 }) },
    };
    const service = serviceWith({});
    const check = (
      service as unknown as {
        assertFormalBatchStockReady: (
          db: typeof tx,
          orgId: bigint,
          warehouseId: bigint,
          lines: Record<string, any>[],
        ) => Promise<void>;
      }
    ).assertFormalBatchStockReady.bind(service);

    await expect(
      check(tx, 1n, 2n, [{ goodsId: 10, skuId: 11, batchNo: 'B1', quantity: 2 }]),
    ).rejects.toThrow('批次 B1 库存不足');
  });

  it('requires every manually created production plan to reference a sales order', async () => {
    const transaction = vi.fn();
    const service = serviceWith({
      hspsi_basic_warehouse: { findFirst: vi.fn().mockResolvedValue({ warehouse_id: 2n }) },
      $transaction: transaction,
    });
    vi.spyOn(service, 'bom').mockResolvedValue({
      id: 3n,
      orgId: 1n,
      goodsId: 100n,
      skuId: 200n,
      details: [{ goodsId: 10n, skuId: 11n, quantity: 2, unitType: 1, remark: '' }],
    } as never);

    await expect(
      service.savePlanChecked(
        null,
        {
          bomId: 3,
          orgId: 1,
          warehouseId: 2,
          productWarehouseId: 4,
          planQty: 1,
        },
        '9',
        false,
      ),
    ).rejects.toThrow('生产计划必须关联销售订单');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('persists plan source, detail adjustments and traces in one write transaction', async () => {
    const detailAdjustment = vi.fn();
    const createPlan = vi.fn().mockResolvedValue({ plan_id: 5n, plan_no: 'TMP5', bom_id: 3n });
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_sale_order: {
        findFirst: vi.fn().mockResolvedValue({ so_id: 12n, org_id: 1n, warehouse_id: 4n }),
      },
      hspsi_sale_order_detail: { findMany: vi.fn().mockResolvedValue([{ sale_qty: 15 }]) },
      hspsi_sale_order_output: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_production_plan: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { plan_qty: 0 } }),
        create: createPlan,
        update: vi.fn(),
      },
      hspsi_production_plan_detail: {
        deleteMany: vi.fn(),
        create: vi.fn(),
        updateMany: detailAdjustment,
      },
      hspsi_production_shortage: {
        deleteMany: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      hspsi_inventory_batch_total: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { inventory_qty: 100 } }),
      },
    };
    const transaction = vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));
    const prisma = {
      $transaction: transaction,
      hspsi_basic_warehouse: { findFirst: vi.fn().mockResolvedValue({ warehouse_id: 2n }) },
      hspsi_production_plan: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = serviceWith(prisma);
    vi.spyOn(service, 'bom').mockResolvedValue({
      id: 3n,
      orgId: 1n,
      goodsId: 100n,
      skuId: 200n,
      details: [{ goodsId: 10n, skuId: 11n, quantity: 2, unitType: 1, remark: '' }],
    } as never);

    await service.savePlanChecked(
      null,
      {
        bomId: 3,
        orgId: 1,
        warehouseId: 2,
        productWarehouseId: 4,
        planQty: 5,
        sourceType: 4,
        sourceId: 12,
        details: [{ goodsId: 10, skuId: 11, quantity: 9, planOutQty: 8, remark: '调整' }],
      },
      '9',
      false,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createPlan).toHaveBeenCalledWith({
      data: expect.objectContaining({ source_type: 'sales_order', source_id: 12n }),
    });
    expect(tx.hspsi_sale_order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ so_id: 12n, so_property_type: 1, deleted_at: null }),
      }),
    );
    expect(detailAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ remark: '调整' }),
      }),
    );
  });

  it('rejects a manual plan that exceeds the sales order uncovered quantity', async () => {
    const createPlan = vi.fn();
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_sale_order: {
        findFirst: vi.fn().mockResolvedValue({ so_id: 12n, org_id: 1n, warehouse_id: 4n }),
      },
      hspsi_sale_order_detail: { findMany: vi.fn().mockResolvedValue([{ sale_qty: 15 }]) },
      hspsi_sale_order_output: { findMany: vi.fn().mockResolvedValue([{ so_output_id: 3n }]) },
      hspsi_sale_order_output_detail: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { output_qty: 5 } }),
      },
      hspsi_production_plan: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { plan_qty: 8 } }),
        create: createPlan,
        update: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      hspsi_basic_warehouse: { findFirst: vi.fn().mockResolvedValue({ warehouse_id: 2n }) },
      hspsi_production_plan: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const service = serviceWith(prisma, trace);
    vi.spyOn(service, 'bom').mockResolvedValue({
      id: 3n,
      orgId: 1n,
      goodsId: 100n,
      skuId: 200n,
      details: [{ goodsId: 10n, skuId: 11n, quantity: 2, unitType: 1, remark: '' }],
    } as never);

    await expect(
      service.savePlanChecked(
        null,
        {
          bomId: 3,
          orgId: 1,
          warehouseId: 2,
          productWarehouseId: 4,
          planQty: 3,
          sourceType: 4,
          sourceId: 12,
        },
        '9',
        false,
      ),
    ).rejects.toThrow('不能超过销售订单剩余可计划数量 2');

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('completes a BOM return into the original warehouse exactly once', async () => {
    const posting = { post: vi.fn() };
    const update = vi.fn();
    const returnRow = {
      return_id: 21n,
      return_no: 'PMR20260807000001',
      source_out_id: 7,
      org_id: 1n,
      warehouse_id: 2n,
      status: 0,
      posting_version: 0,
      return_reason: '生产余料退回',
    };
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_production_material_return: {
        findFirst: vi.fn().mockResolvedValue(returnRow),
        findMany: vi.fn().mockResolvedValue([]),
        update,
      },
      hspsi_production_material_return_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            source_out_detail_id: 11,
            goods_id: 100n,
            sku_id: 200n,
            batch_no: 'PH20260807',
            unit_type: 1,
            return_qty: 3,
          },
        ]),
        groupBy: vi.fn(),
      },
      hspsi_production_material_out: {
        findFirst: vi.fn().mockResolvedValue({
          out_id: 7,
          out_type: 1,
          confirm_tag: 1,
          org_id: 1,
          warehouse_id: 2,
        }),
      },
      hspsi_production_material_out_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { serial_number: 11, goods_id: 100, out_qty: 10, batch_no: 'PH20260807' },
          ]),
      },
      hspsi_goods_info: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 100n, const_price: 5 }]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      hspsi_production_material_return: {
        findFirst: vi.fn().mockResolvedValue({ source_out_id: 7 }),
      },
    };

    await expect(
      serviceWith(prisma, undefined, posting).confirmMaterialReturn('21', '9'),
    ).resolves.toMatchObject({
      id: 21n,
    });
    expect(posting.post).toHaveBeenCalledWith(
      expect.objectContaining({
        warehouseId: 2n,
        direction: 1,
        inventoryMode: 16,
        idempotencyKey: 'production-material-return:21:confirm:v1',
        lines: [expect.objectContaining({ quantity: 3, amount: 15 })],
      }),
      tx,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 1, posting_version: 1 }) }),
    );
  });

  it('rechecks completed BOM returns under lock and blocks an over-return', async () => {
    const posting = { post: vi.fn() };
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_production_material_return: {
        findFirst: vi.fn().mockResolvedValue({
          return_id: 21n,
          return_no: 'PMR21',
          source_out_id: 7,
          org_id: 1n,
          warehouse_id: 2n,
          status: 0,
          posting_version: 0,
          return_reason: '',
        }),
        findMany: vi.fn().mockResolvedValue([{ return_id: 20n }]),
      },
      hspsi_production_material_return_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            source_out_detail_id: 11,
            goods_id: 100n,
            sku_id: 200n,
            batch_no: 'PH20260807',
            unit_type: 1,
            return_qty: 3,
          },
        ]),
        groupBy: vi.fn().mockResolvedValue([{ source_out_detail_id: 11, _sum: { return_qty: 8 } }]),
      },
      hspsi_production_material_out: {
        findFirst: vi.fn().mockResolvedValue({
          out_id: 7,
          out_type: 1,
          confirm_tag: 1,
          org_id: 1,
          warehouse_id: 2,
        }),
      },
      hspsi_production_material_out_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { serial_number: 11, goods_id: 100, out_qty: 10, batch_no: 'PH20260807' },
          ]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      hspsi_production_material_return: {
        findFirst: vi.fn().mockResolvedValue({ source_out_id: 7 }),
      },
    };

    await expect(
      serviceWith(prisma, undefined, posting).confirmMaterialReturn('21', '9'),
    ).rejects.toThrow('当前最多可退 2');
    expect(posting.post).not.toHaveBeenCalled();
  });

  it('reverses a completed BOM return with an outbound posting before changing status', async () => {
    const update = vi.fn();
    const posting = { post: vi.fn().mockResolvedValue([]) };
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_production_material_return: {
        findFirst: vi.fn().mockResolvedValue({
          return_id: 21n,
          return_no: 'PMR21',
          source_out_id: 7,
          org_id: 1n,
          warehouse_id: 2n,
          status: 1,
          posting_version: 1,
        }),
        update,
      },
      hspsi_production_material_return_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            goods_id: 100n,
            sku_id: 200n,
            batch_no: 'PH20260807',
            unit_type: 1,
            return_qty: 3,
          },
        ]),
      },
    };
    const prisma = {
      hspsi_production_material_return: {
        findFirst: vi.fn().mockResolvedValue({ source_out_id: 7 }),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      serviceWith(prisma, undefined, posting).reverseMaterialReturn(
        '21',
        { reversalReason: '录入错误' },
        '9',
      ),
    ).resolves.toMatchObject({ id: 21n });
    expect(posting.post).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: -1,
        sourceType: 'production_material_return_reversal',
        idempotencyKey: 'production-material-return:21:reverse:v2',
        lines: [expect.objectContaining({ quantity: 3 })],
      }),
      tx,
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 3,
          posting_version: 2,
          reversal_reason: '录入错误',
          reversed_by: 9n,
        }),
      }),
    );
  });

  it('keeps a completed BOM return unchanged when reversal stock is insufficient', async () => {
    const update = vi.fn();
    const posting = { post: vi.fn().mockRejectedValue(new Error('批次库存不足')) };
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_production_material_return: {
        findFirst: vi.fn().mockResolvedValue({
          return_id: 21n,
          return_no: 'PMR21',
          source_out_id: 7,
          org_id: 1n,
          warehouse_id: 2n,
          status: 1,
          posting_version: 1,
        }),
        update,
      },
      hspsi_production_material_return_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            goods_id: 100n,
            sku_id: 200n,
            batch_no: 'PH20260807',
            unit_type: 1,
            return_qty: 3,
          },
        ]),
      },
    };
    const prisma = {
      hspsi_production_material_return: {
        findFirst: vi.fn().mockResolvedValue({ source_out_id: 7 }),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      serviceWith(prisma, undefined, posting).reverseMaterialReturn(
        '21',
        { reversalReason: '录入错误' },
        '9',
      ),
    ).rejects.toThrow('批次库存不足');
    expect(update).not.toHaveBeenCalled();
  });
});
