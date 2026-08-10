import { describe, expect, it, vi } from 'vitest';
import {
  assertDiscountOrderMatchesSource,
  assertDiscountOutputWithinSource,
  calculateDiscountSourceRemaining,
} from './sales-helpers';
import { SalesService } from './sales.service';

function createService(
  prisma: Record<string, any>,
  posting: Record<string, any> = { post: vi.fn() },
  production: Record<string, any> = {},
  trace: Record<string, any> = { link: vi.fn() },
) {
  return {
    service: new SalesService(
      prisma as never,
      posting as never,
      production as never,
      { enrich: vi.fn(async (items: unknown) => items) } as never,
      trace as never,
      { generate: vi.fn(async (prefix: string) => `${prefix}20260804000001`) } as never,
    ),
    posting,
  };
}

describe('SalesService after-sales progress', () => {
  it('creates an independent progress and updates the main service status with an audit log', async () => {
    const createProgress = vi.fn().mockResolvedValue({
      progress_id: 31n,
      service_id: 8n,
      progress_content: '已联系客户确认处理方案',
      progress_status: 1,
    });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_sale_order_service: {
        findFirst: vi.fn().mockResolvedValue({ service_id: 8n, so_id: 5n }),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn().mockResolvedValue({}),
      },
      hspsi_sale_order_service_progress: { create: createProgress },
      hspsi_sale_order: { update: vi.fn().mockResolvedValue({}) },
      hspsi_sys_dictionary_category: {
        findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 2 }),
      },
      hspsi_sys_dictionary: { findFirst: vi.fn().mockResolvedValue({ dict_id: 3 }) },
      hspsi_sys_oper_log: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const { service } = createService(prisma);

    const result = await service.saveServiceProgress(
      '8',
      null,
      { content: '已联系客户确认处理方案', status: 1, handlerId: 9 },
      '9',
    );

    expect(result.id).toBe(31n);
    expect(createProgress).toHaveBeenCalledWith({
      data: expect.objectContaining({
        service_id: 8n,
        progress_content: '已联系客户确认处理方案',
        progress_status: 1,
        source_type: 1,
      }),
    });
    expect(tx.hspsi_sale_order_service.update).toHaveBeenCalledWith({
      where: { service_id: 8n },
      data: expect.objectContaining({ event_status: 1, handler_id: 9n }),
    });
    expect(tx.hspsi_sys_oper_log.create).toHaveBeenCalledOnce();
  });
});

describe('SalesService external after-sales webhook', () => {
  it('stores the immutable original payload when receiving a new request', async () => {
    const payload = {
      externalRequestId: 'HSZJ-1001',
      externalRequestNo: 'AS-20260807-01',
      eventContent: '客户反馈设备无法启动',
      customer: { name: '测试客户', mobile: '13800000000' },
    };
    const create = vi.fn().mockResolvedValue({ service_id: 81n, service_no: 'AS20260807000001' });
    const tx = {
      hspsi_sale_order_service: { create },
      hspsi_sys_oper_log: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      hspsi_sale_order_service: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const { service } = createService(prisma);

    const result = await service.receiveExternalAfterSales('huashu_home', payload);

    expect(result).toMatchObject({ id: 81n, duplicate: false });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source_system: 'huashu_home',
        external_request_id: 'HSZJ-1001',
        external_request_no: 'AS-20260807-01',
        external_payload: payload,
        event_content: '客户反馈设备无法启动',
      }),
    });
    expect(tx.hspsi_sys_oper_log.create).toHaveBeenCalledOnce();
  });

  it('returns the existing service without overwriting it on a repeated request', async () => {
    const existing = { service_id: 81n, service_no: 'AS20260807000001' };
    const prisma = {
      hspsi_sale_order_service: { findFirst: vi.fn().mockResolvedValue(existing) },
      $transaction: vi.fn(),
    };
    const { service } = createService(prisma);

    const result = await service.receiveExternalAfterSales('huashu_home', {
      externalRequestId: 'HSZJ-1001',
      eventContent: '重复推送不应覆盖',
    });

    expect(result).toEqual({
      id: 81n,
      businessNo: 'AS20260807000001',
      duplicate: true,
      message: '该外部售后申请已接收',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('SalesService ordinary-order P0 guards', () => {
  it('saves an ordinary sales order as effective without an approval step', async () => {
    const createOrder = vi.fn().mockResolvedValue({ so_id: 10n });
    const tx = {
      hspsi_sale_order: {
        create: createOrder,
        update: vi.fn().mockResolvedValue({ so_id: 10n }),
      },
      hspsi_sale_order_detail: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      hspsi_basic_customer: {
        findUnique: vi.fn().mockResolvedValue({
          customer_id: 3n,
          org_id: 1n,
          name: '测试客户',
          mobile: '13800000000',
          address: '测试地址',
          referrer_name: '销售员',
          referrer_mobile: '13900000000',
        }),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const { service } = createService(prisma);

    await service.saveOrder(
      null,
      {
        customerId: 3,
        orgId: 1,
        warehouseId: 2,
        propertyType: 2,
        approveStatus: 1,
        orderStatus: 3,
        status: 0,
        details: [
          {
            goodsId: 101,
            skuId: 201,
            unitType: 1,
            quantity: 2,
            price: 12.5,
          },
        ],
      },
      '9',
      1,
    );

    expect(createOrder).toHaveBeenCalledWith({
      data: expect.objectContaining({
        so_property_type: 1,
        approve_status: 1,
        approve_comment: '销售订单无需审批',
        approve_by: 9n,
        approve_date: expect.any(Date),
        order_status: 1,
        status: 1,
      }),
    });
  });

  it('allows an ordinary sales output to confirm only the available partial quantity', async () => {
    const posting = { post: vi.fn().mockResolvedValue(undefined) };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_sale_order_output: {
        findFirst: vi.fn().mockResolvedValue({
          so_output_id: 50n,
          so_output_no: 'SOO50',
          so_id: 10n,
          org_id: 1n,
          warehouse_id: 2n,
          comfirm_status: 0,
          posting_version: 0,
        }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
      hspsi_sale_order_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            goods_id: 101n,
            sku_id: 201n,
            batch_no: 'B001',
            unit_type: 1,
            output_qty: 1,
          },
        ]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { output_qty: 1 } }),
      },
      hspsi_sale_order: {
        findFirst: vi.fn().mockResolvedValue({
          so_id: 10n,
          so_qty: 10,
          fact_amount: 100,
          so_property_type: 1,
          approve_status: 1,
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          so_id: 10n,
          so_no: 'SO10',
          org_id: 1n,
          warehouse_id: 2n,
          so_property_type: 1,
          so_qty: 10,
        }),
        update: vi.fn(),
      },
      hspsi_sales_order_payment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      hspsi_sale_order_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            goods_id: 101n,
            sku_id: 201n,
            sale_qty: 10,
          },
        ]),
      },
      hspsi_inventory_total: {
        findUnique: vi.fn().mockResolvedValue({ inventory_qty: 1 }),
      },
      hspsi_production_plan: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const { service } = createService(prisma, posting);

    await expect(service.confirmOutput('50', '确认', '9')).resolves.toEqual({
      id: '50',
      message: '销售出库确认成功',
    });
    expect(posting.post).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: [
          expect.objectContaining({ goodsId: 101n, skuId: 201n, batchNo: 'B001', quantity: '1' }),
        ],
      }),
      tx,
    );
    expect(tx.hspsi_sale_order_output.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ comfirm_status: 1 }),
      }),
    );
  });

  it('rejects the legacy approval endpoint for an ordinary sales order', async () => {
    const { service } = createService({});
    vi.spyOn(service, 'order').mockResolvedValue({ approve_status: 1, propertyType: 1 } as never);

    await expect(service.approveOrder('10', true, '通过', '9')).rejects.toThrow(
      '销售订单无需审批，请直接办理后续业务',
    );
  });
});

describe('discount source quantity and batch guards', () => {
  const source = [
    { goodsId: 101n, skuId: 201n, batchNo: 'B001', unitType: 1, quantity: 2 },
    { goodsId: 101n, skuId: 201n, batchNo: 'B002', unitType: 1, quantity: 3 },
  ];

  it('requires the discount order to equal source goods/SKU quantity', () => {
    expect(() =>
      assertDiscountOrderMatchesSource(source, [{ goodsId: 101n, skuId: 201n, quantity: 5 }]),
    ).not.toThrow();
    expect(() =>
      assertDiscountOrderMatchesSource(source, [{ goodsId: 101n, skuId: 201n, quantity: 4 }]),
    ).toThrow('必须等于来源可处置数量');
    expect(() =>
      assertDiscountOrderMatchesSource(source, [{ goodsId: 999n, skuId: 201n, quantity: 5 }]),
    ).toThrow('必须与来源处置单一致');
  });

  it('subtracts confirmed output by goods/SKU/batch and rejects normal batches', () => {
    expect(() =>
      assertDiscountOutputWithinSource(
        source,
        [{ goods_id: 101n, sku_id: 201n, batch_no: 'B001', output_qty: 1 }],
        [{ goodsId: 101n, skuId: 201n, batchNo: 'B001', quantity: 1 }],
      ),
    ).not.toThrow();
    expect(() =>
      assertDiscountOutputWithinSource(
        source,
        [{ goods_id: 101n, sku_id: 201n, batch_no: 'B001', output_qty: 1 }],
        [{ goodsId: 101n, skuId: 201n, batchNo: 'B001', quantity: 2 }],
      ),
    ).toThrow('超过来源批次剩余可处置数量');
    expect(() =>
      assertDiscountOutputWithinSource(
        source,
        [],
        [{ goodsId: 101n, skuId: 201n, batchNo: 'NORMAL', quantity: 1 }],
      ),
    ).toThrow('必须使用来源处置单的商品、SKU和批次');
  });

  it('aggregates duplicate source rows before calculating the remaining batch quantity', () => {
    expect(
      calculateDiscountSourceRemaining(
        [
          { goodsId: 101n, skuId: 201n, batchNo: 'B001', unitType: 1, quantity: 2 },
          { goodsId: 101n, skuId: 201n, batchNo: 'B001', unitType: 1, quantity: 3 },
        ],
        [{ goods_id: 101n, sku_id: 201n, batch_no: 'B001', output_qty: 2 }],
      ),
    ).toEqual([
      expect.objectContaining({
        goodsId: 101n,
        skuId: 201n,
        batchNo: 'B001',
        quantity: 5,
        confirmedQuantity: 2,
        remainingQuantity: 3,
      }),
    ]);
  });
});

describe('discount sale final confirmation', () => {
  it('confirms the whole trusted-source order and posts every source batch once', async () => {
    const posting = { post: vi.fn().mockResolvedValue(undefined) };
    const orderUpdate = vi.fn().mockResolvedValue({ so_id: 8n });
    const outputUpdate = vi.fn().mockResolvedValue({
      so_output_id: 18n,
      so_output_no: 'DSO20260802000I',
      posting_version: 0,
    });
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_sale_order: {
        findFirst: vi.fn().mockResolvedValue({
          so_id: 8n,
          so_no: 'DS202608020008',
          so_property_type: 2,
          business_source_type: 'inventory_loss',
          business_source_id: 5n,
          org_id: 1n,
          warehouse_id: 2n,
          fact_amount: 60,
          approve_status: 0,
        }),
        findMany: vi.fn().mockResolvedValue([{ so_id: 8n }]),
        update: orderUpdate,
      },
      hspsi_sale_order_detail: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 101n, sku_id: 201n, sale_qty: 5 }]),
      },
      hspsi_inventory_loss: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ loss_id: 5n, loss_no: 'ILD5', org_id: 1n, warehouse_id: 2n }),
      },
      hspsi_inventory_loss_detail: {
        findMany: vi.fn().mockResolvedValue([
          { goods_id: 101n, sku_id: 201n, batch_no: 'B001', unit_type: 1, loss_qty: 2 },
          { goods_id: 101n, sku_id: 201n, batch_no: 'B002', unit_type: 1, loss_qty: 3 },
        ]),
      },
      hspsi_sale_order_output: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockResolvedValue({ so_output_id: 18n, so_output_no: 'TMP18', posting_version: 0 }),
        update: outputUpdate,
      },
      hspsi_sale_order_output_detail: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const { service } = createService(prisma, posting);
    vi.spyOn(service, 'order').mockResolvedValue({
      id: 8n,
      approve_status: 0,
      propertyType: 2,
      businessSourceType: 'inventory_loss',
      businessSourceId: 5n,
    } as never);

    await expect(service.approveOrder('8', true, '确认售出', '9')).resolves.toMatchObject({
      id: '8',
      inventoryPosted: true,
      message: '折价销售已确认售出，库存已按全部来源批次一次性扣减',
    });
    expect(posting.post).toHaveBeenCalledWith(
      expect.objectContaining({
        inventoryMode: 10,
        lines: [
          expect.objectContaining({ batchNo: 'B001', quantity: '2' }),
          expect.objectContaining({ batchNo: 'B002', quantity: '3' }),
        ],
      }),
      tx,
    );
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { so_id: 8n },
        data: expect.objectContaining({ approve_status: 1, delivery_status: 3 }),
      }),
    );
  });
});

describe('discount sale payment sequencing', () => {
  const paymentBody = {
    orderId: 8,
    deptId: 3,
    paymentMode: 1,
    paymentDate: '2026-08-02',
    amount: 20,
    requestKey: '5ca81213-84cc-4ee3-8e2a-dbe4e66c3a90',
  };

  it('rejects receipt registration before the discount sale has completed output', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_sales_order_payment: { findUnique: vi.fn().mockResolvedValue(null) },
      hspsi_sale_order: {
        findFirst: vi.fn().mockResolvedValue({
          so_id: 8n,
          so_property_type: 2,
          approve_status: 1,
          delivery_status: 1,
        }),
      },
    };
    const { service } = createService({
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    });

    await expect(service.createPayment(paymentBody, 1, '9')).rejects.toThrow(
      '折价销售单必须先确认销售并完成出库',
    );
  });

  it('rejects receipt registration when the completed state lacks a confirmed discount output', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hspsi_sales_order_payment: { findUnique: vi.fn().mockResolvedValue(null) },
      hspsi_sale_order: {
        findFirst: vi.fn().mockResolvedValue({
          so_id: 8n,
          so_property_type: 2,
          approve_status: 1,
          delivery_status: 3,
        }),
      },
      hspsi_sale_order_output: { count: vi.fn().mockResolvedValue(0) },
    };
    const { service } = createService({
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    });

    await expect(service.createPayment(paymentBody, 1, '9')).rejects.toThrow(
      '缺少已确认的折价销售出库记录',
    );
  });
});

describe('SalesService sales P1 guards', () => {
  const customer = {
    customer_id: 3n,
    org_id: 1n,
    name: '测试客户',
    mobile: '13800000000',
    address: '测试地址',
    referrer_name: '销售员',
    referrer_mobile: '13900000000',
  };

  it('rejects duplicate order goods/SKU and forged manual discount sources', async () => {
    const transaction = vi.fn();
    const { service } = createService({
      hspsi_basic_customer: { findUnique: vi.fn().mockResolvedValue(customer) },
      $transaction: transaction,
    });
    await expect(
      service.saveOrder(
        null,
        {
          customerId: 3,
          details: [
            { goodsId: 101, skuId: 201, unitType: 1, quantity: 1, price: 10 },
            { goodsId: 101, skuId: 201, unitType: 1, quantity: 2, price: 10 },
          ],
        },
        '9',
        1,
      ),
    ).rejects.toThrow('同一商品和SKU不能重复');
    await expect(
      service.saveOrder(
        null,
        {
          customerId: 3,
          businessSourceType: 'inventory_loss',
          businessSourceId: 8,
          businessSourceNo: 'ILD8',
          details: [{ goodsId: 101, skuId: 201, unitType: 1, quantity: 1, price: 10 }],
        },
        '9',
        2,
      ),
    ).rejects.toThrow('不允许伪造业务来源');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('forces ordinary list queries to property 1 and discount queries to property 2', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const prisma = {
      hspsi_sale_order: { findMany, count },
      hspsi_sales_order_payment: { findMany: vi.fn() },
      hspsi_sale_order_detail: { findMany: vi.fn() },
      hspsi_sale_order_output: { findMany: vi.fn() },
      hspsi_goods_info: { findMany: vi.fn() },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const { service } = createService(prisma);
    await service.orders({ propertyType: 2 });
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ so_property_type: 1 }),
      }),
    );
    await service.orders({}, 2);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ so_property_type: 2 }),
      }),
    );
  });

  it('rejects shortage analysis for discount orders after the locked order recheck', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_sale_order: {
        findFirst: vi.fn().mockResolvedValue({ so_id: 8n, so_property_type: 2, approve_status: 1 }),
      },
      hspsi_sale_order_detail: { findMany: vi.fn() },
    };
    const { service } = createService({
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    });

    await expect(service.analyze('8', '9')).rejects.toThrow('仅普通销售订单');
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.hspsi_sale_order_detail.findMany).not.toHaveBeenCalled();
  });

  it('protects trusted-source orders and orders linked to production plans from deletion', async () => {
    const trustedTx = {
      $queryRaw: vi.fn(),
      hspsi_sale_order: {
        findFirst: vi.fn().mockResolvedValue({
          so_id: 8n,
          so_property_type: 2,
          business_source_type: 'inventory_loss',
          business_source_id: 5n,
        }),
      },
      hspsi_inventory_loss: { count: vi.fn().mockResolvedValue(1) },
    };
    const trusted = createService({
      $transaction: vi.fn(async (callback: (tx: typeof trustedTx) => unknown) =>
        callback(trustedTx),
      ),
    }).service;
    await expect(trusted.deleteOrder('8', '9')).rejects.toThrow('来源折价销售单不可直接删除');

    const linkedPlanCount = vi.fn().mockResolvedValue(1);
    const plannedTx = {
      $queryRaw: vi.fn(),
      hspsi_sale_order: {
        findFirst: vi.fn().mockResolvedValue({
          so_id: 9n,
          so_property_type: 1,
          business_source_type: '',
          business_source_id: 0n,
        }),
      },
      hspsi_production_plan: { count: linkedPlanCount },
    };
    const planned = createService({
      $transaction: vi.fn(async (callback: (tx: typeof plannedTx) => unknown) =>
        callback(plannedTx),
      ),
    }).service;
    await expect(planned.deleteOrder('9', '9')).rejects.toThrow('已关联生产计划');
    expect(linkedPlanCount).toHaveBeenCalledWith({
      where: {
        source_type: { in: ['sales_order', '4'] },
        source_id: 9n,
        deleted_at: null,
      },
    });
  });

  it('keeps a manually created discount order active after approval until its output is completed', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const { service } = createService({ hspsi_sale_order: { update } });
    vi.spyOn(service, 'order').mockResolvedValue({
      id: 12n,
      approve_status: 0,
      propertyType: 2,
      businessSourceType: '',
      businessSourceId: 0n,
    } as never);

    await expect(service.approveOrder('12', true, '', '9')).resolves.toEqual({
      id: '12',
      message: '折价销售已通过，待生成折价销售出库',
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approve_status: 1, order_status: 1 }),
      }),
    );
  });

  it('returns the confirmed-return quantity and remaining returnable quantity for each output batch', async () => {
    const { service } = createService({
      hspsi_sale_order_output: {
        findFirst: vi.fn().mockResolvedValue({ so_output_id: 20n, so_id: 10n, warehouse_id: 2n }),
      },
      hspsi_sale_order_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1n,
            goods_id: 101n,
            sku_id: 201n,
            batch_no: 'B01',
            unit_type: 1,
            sale_qty: 5,
            output_qty: 5,
          },
        ]),
      },
      hspsi_sale_order: {
        findUnique: vi.fn().mockResolvedValue({
          so_property_type: 1,
          business_source_type: '',
          business_source_id: 0n,
        }),
      },
      hspsi_sale_order_exit: {
        findMany: vi.fn().mockResolvedValue([{ so_exit_id: 30n }]),
      },
      hspsi_sale_order_exit_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_id: 101n, sku_id: 201n, batch_no: 'B01', exit_qty: 2 }]),
      },
    });

    const result = await service.output('20');
    expect(result.details[0]).toEqual(
      expect.objectContaining({
        returnedQuantity: 2,
        remainingReturnQuantity: 3,
      }),
    );
  });
});

describe('SalesService after-sales batch guards', () => {
  it('rejects a sales return without a reason before touching the database', async () => {
    const { service } = createService({});
    await expect(
      service.saveReturn(
        null,
        {
          orderId: 10,
          sourceOutputId: 20,
          reason: '   ',
          details: [{ goodsId: 101, skuId: 201, batchNo: 'B001', unitType: 1, quantity: 1 }],
        },
        '9',
      ),
    ).rejects.toThrow('退货原因必填');
  });

  it('calculates售后可退换数量 by source output batch after confirmed returns and active reservations', async () => {
    const prisma = {
      hspsi_sale_order_output: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ so_output_id: 20n, so_output_no: 'SOO20', warehouse_id: 2n }]),
      },
      hspsi_sale_order_output_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            so_output_id: 20n,
            goods_id: 101n,
            sku_id: 201n,
            batch_no: 'B001',
            unit_type: 1,
            output_qty: 10,
          },
        ]),
      },
      hspsi_sale_order_exit: {
        findMany: vi.fn().mockResolvedValue([{ so_exit_id: 30n, source_output_id: 20n }]),
      },
      hspsi_sale_order_exit_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { so_exit_id: 30n, goods_id: 101n, sku_id: 201n, batch_no: 'B001', exit_qty: 2 },
          ]),
      },
      hspsi_sale_order_service: { findMany: vi.fn().mockResolvedValue([{ service_id: 40n }]) },
      hspsi_sale_order_service_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            service_id: 40n,
            source_output_id: 20n,
            goods_id: 101n,
            sku_id: 201n,
            batch_no: 'B001',
            service_qty: 3,
          },
        ]),
      },
    };
    const { service } = createService(prisma);

    const result = await service.serviceSourceOptions({ orderId: 10, goodsId: 101, skuId: 201 });

    expect(result).toHaveLength(1);
    expect(result[0]!.details).toEqual([
      expect.objectContaining({ batchNo: 'B001', sourceQuantity: 10, remainingQuantity: 5 }),
    ]);
  });
});
