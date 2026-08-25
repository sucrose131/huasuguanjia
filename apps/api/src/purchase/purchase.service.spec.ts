import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PurchaseService } from './purchase.service';

function serviceWith(
  prisma: Record<string, any>,
  trace: Record<string, any> = { link: vi.fn(), removeForDocument: vi.fn() },
) {
  return new PurchaseService(
    prisma as never,
    { goodsOptions: vi.fn(), assertGoodsLines: vi.fn() } as never,
    { post: vi.fn() } as never,
    { syncExpiryAlert: vi.fn() } as never,
    trace as never,
    { generate: vi.fn(async (prefix: string) => `${prefix}202608040001`) } as never,
  );
}

describe('PurchaseService quick catalog materialization', () => {
  it('creates goods under an enabled parent category inside the document transaction', async () => {
    const goodsCreate = vi.fn().mockResolvedValue({ goods_id: 101n });
    const skuCreate = vi.fn().mockResolvedValue({ sku_id: 202n });
    const childCount = vi.fn().mockResolvedValue(2);
    const tx = {
      hspsi_goods_info: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: goodsCreate,
      },
      hspsi_goods_info_category: {
        findFirst: vi.fn().mockResolvedValue({ goods_catg_id: 3n, warehouse_type: 2 }),
        count: childCount,
      },
      hspsi_goods_info_sku: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: skuCreate,
      },
    };
    const line: Record<string, any> = {
      goodsId: 'quick-goods',
      skuId: 'quick-sku',
      unitType: 5,
      newGoods: {
        goodsName: '快捷补充商品',
        categoryId: 3,
        unitType: 5,
        specModels: '盒装',
      },
      newSku: { specModels: '盒装', unitType: 5, pcsQty: 12, costPrice: 2 },
    };

    await (serviceWith({}) as any).materializeQuickCatalog(tx, [line], '9');

    expect(goodsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        goods_name: '快捷补充商品',
        goods_catg_id: 3n,
        org_id: 0n,
        vendor_id: 0n,
        warehouse_id: 0n,
      }),
    });
    expect(skuCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        good_id: 101n,
        spec_models: '盒装',
        pcs_qty: 12,
        is_default: 1,
      }),
    });
    expect(line.goodsId).toBe(101n);
    expect(line.skuId).toBe(202n);
    expect(childCount).not.toHaveBeenCalled();
  });

  it('materializes staged goods before a direct receipt writes its generated documents', async () => {
    const service = serviceWith({});
    const expected = new Error('stop after materialization');
    const materialize = vi
      .spyOn(service as any, 'materializeQuickCatalog')
      .mockRejectedValue(expected);
    vi.spyOn(service as any, 'guardedTransaction').mockImplementation((async (
      callback: (tx: Record<string, never>) => unknown,
    ) => callback({})) as any);
    const details = [
      {
        goodsId: 'quick-goods',
        skuId: 'quick-sku',
        inputQuantity: 1,
        unitType: 5,
        newGoods: { goodsName: '直接入库快捷商品', categoryId: 3, unitType: 5 },
        newSku: { specModels: '默认规格', unitType: 5, pcsQty: 1 },
      },
    ];

    await expect(
      service.saveReceipt(
        null,
        {
          orderId: '',
          orgId: 1,
          warehouseId: 2,
          deptId: 3,
          receiverId: 9,
          inputType: 1,
          details,
        },
        '9',
      ),
    ).rejects.toBe(expected);
    expect(materialize).toHaveBeenCalledWith({}, expect.any(Array), '9');
  });

  it('uses the newly created goods and default SKU across the complete direct-receipt document chain', async () => {
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const goodsCreate = vi.fn().mockResolvedValue({ goods_id: 101n });
    const skuCreate = vi.fn().mockResolvedValue({ sku_id: 202n });
    const applicationCreate = vi.fn().mockResolvedValue({ pur_id: 301n });
    const applicationDetailCreate = vi.fn();
    const orderCreate = vi.fn().mockResolvedValue({ po_id: 401n });
    const orderDetailCreate = vi.fn();
    const receiptCreate = vi.fn().mockResolvedValue({ po_input_id: 501n });
    const receiptDetailCreate = vi.fn();
    const tx = {
      hspsi_goods_info: { findFirst: vi.fn().mockResolvedValue(null), create: goodsCreate },
      hspsi_goods_info_category: {
        findFirst: vi.fn().mockResolvedValue({ goods_catg_id: 3n, warehouse_type: 2 }),
        count: vi.fn().mockResolvedValue(0),
      },
      hspsi_goods_info_sku: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: skuCreate,
      },
      hspsi_purchase_approve: { create: applicationCreate, update: vi.fn() },
      hspsi_purchase_approve_detail: { createMany: applicationDetailCreate },
      hspsi_purchase_order: { create: orderCreate },
      hspsi_purchase_order_detail: { createMany: orderDetailCreate },
      hspsi_purchase_order_input: { create: receiptCreate },
      hspsi_purchase_order_input_detail: {
        deleteMany: vi.fn(),
        createMany: receiptDetailCreate,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, trace);
    vi.spyOn(service as any, 'dictionaryValue').mockResolvedValue(99);
    vi.spyOn(service as any, 'assertOrganizationScope').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'assertPurchaseWarehouse').mockResolvedValue(undefined);

    const result = await service.saveReceipt(
      null,
      {
        orderId: '',
        orgId: 1,
        warehouseId: 2,
        deptId: 3,
        vendorId: 4,
        receiverId: 9,
        inputType: 1,
        details: [
          {
            goodsId: 'quick-goods',
            skuId: 'quick-sku',
            inputQuantity: 2,
            unitPrice: 12.5,
            unitType: 5,
            batchNo: 'PH20260809',
            newGoods: { goodsName: '直接入库全链路商品', categoryId: 3, unitType: 5 },
            newSku: { specModels: '默认规格', unitType: 5, pcsQty: 1 },
          },
        ],
      },
      '9',
    );

    expect(goodsCreate).toHaveBeenCalledOnce();
    expect(skuCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ good_id: 101n, spec_models: '默认规格', is_default: 1 }),
    });
    expect(applicationDetailCreate).toHaveBeenCalledWith({
      data: [expect.objectContaining({ goods_id: 101n, sku_id: 202n, qty: 2 })],
    });
    expect(orderDetailCreate).toHaveBeenCalledWith({
      data: [expect.objectContaining({ goods_id: 101n, sku_id: 202n, qty: 2 })],
    });
    expect(receiptDetailCreate).toHaveBeenCalledWith({
      data: [expect.objectContaining({ goods_id: 101n, sku_id: 202n, input_qty: 2 })],
    });
    expect(trace.link).toHaveBeenCalledTimes(2);
    expect(result).toEqual(expect.objectContaining({ id: 501n, message: '入库单已创建' }));
  });
});

describe('PurchaseService receipt confirmation', () => {
  it('posts inventory and marks a pending receipt as confirmed', async () => {
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const receiptUpdate = vi.fn();
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_order_input: {
        findFirst: vi.fn().mockResolvedValue({
          po_input_id: 501n,
          po_input_no: 'GA501',
          po_id: 401n,
          warehouse_id: 2n,
          comfirm_status: 0,
          posting_version: 0,
        }),
        findMany: vi.fn().mockResolvedValue([]),
        update: receiptUpdate,
      },
      hspsi_purchase_order: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ po_id: 401n, po_no: 'PO401', pur_id: 301n }),
      },
      hspsi_purchase_order_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 1n, goods_id: 101n, sku_id: 202n, qty: 2, cancel_qty: 0 }]),
      },
      hspsi_purchase_order_input_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            goods_id: 101n,
            sku_id: 202n,
            batch_no: 'PH20260809',
            unit_type: 5,
            input_qty: 2,
            validity_period: null,
          },
        ]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, trace);
    const postReceipt = vi.spyOn(service as any, 'postReceipt').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'syncProductionShortageState').mockResolvedValue(undefined);

    const result = await service.confirmReceipt('501', true, '办理采购入库', '9');

    expect(postReceipt).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        po_input_id: 501n,
        receiptNo: 'GA501',
        details: [expect.objectContaining({ goodsId: 101n, skuId: 202n, inputQuantity: 2 })],
      }),
      1,
      '9',
      1,
    );
    expect(receiptUpdate).toHaveBeenCalledWith({
      where: { po_input_id: 501n },
      data: expect.objectContaining({ comfirm_status: 1, posting_version: 1, updated_by: 9n }),
    });
    expect(result.message).toBe('入库已确认，库存已增加');
  });
});

describe('PurchaseService production-shortage guards', () => {
  it('采购申请忽略客户端伪造组织并固定使用发起人OA所属组织', async () => {
    const create = vi.fn().mockResolvedValue({ pur_id: 7n });
    const tx = {
      hspsi_purchase_approve: { create },
      hspsi_purchase_approve_detail: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const service = serviceWith({
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    });
    vi.spyOn(service as any, 'materializeQuickCatalog').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'assertOrganizationScope').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'assertPurchaseWarehouse').mockResolvedValue(undefined);

    await service.saveApplication(
      null,
      {
        orgId: 999,
        deptId: 2,
        warehouseId: 3,
        details: [{ goodsId: 10, skuId: 11, quantity: 1, unitType: 1 }],
      },
      '9',
      false,
      '1',
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ org_id: 1n, created_by: 9n }),
    });
  });

  it('creates one pending purchase-refund task for an effective paid return', async () => {
    const refundCreate = vi.fn().mockResolvedValue({
      refund_id: 77n,
      po_exit_id: 30n,
      refund_no: 'PRF202608040001',
    });
    const refundUpdate = vi.fn().mockResolvedValue({ refund_id: 77n, refund_no: 'CGTK77' });
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const tx = {
      hspsi_purchase_refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _sum: { refundable_amount: null } }),
        create: refundCreate,
        update: refundUpdate,
      },
      hspsi_purchase_order_input_exit: {
        findFirst: vi.fn().mockResolvedValue({
          po_exit_id: 30n,
          po_exit_no: 'CGTH30',
          po_input_id: 90n,
          po_id: 20n,
          exit_type: 1,
          exit_reson: '退货',
        }),
        findMany: vi.fn().mockResolvedValue([{ po_exit_id: 30n }]),
      },
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({
          po_id: 20n,
          pay_amout: 100,
          org_id: 1n,
          dept_id: 2n,
          vendor_id: 3n,
        }),
      },
      hspsi_purchase_order_detail: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 10n, sku_id: 11n, unit_price: 10 }]),
      },
      hspsi_purchase_order_input_exit_detail: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 10n, sku_id: 11n, exit_qty: 3 }]),
      },
      hspsi_purchase_order_payment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { fact_pay_amount: 100 } }),
      },
      hspsi_sys_dictionary_category: { findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1 }) },
      hspsi_sys_dictionary: { findFirst: vi.fn().mockResolvedValue({ dict_id: 1 }) },
    };

    const service = serviceWith({} as never, trace);
    vi.spyOn(service as any, 'recalcPayment').mockResolvedValue(undefined);
    const result = await (service as any).createRefundTask(tx, 30n, '9');

    expect(refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          return_amount: expect.anything(),
          refundable_amount: expect.anything(),
          refund_status: 0,
          source_type: 2,
          return_type: 1,
        }),
      }),
    );
    const created = refundCreate.mock.calls[0]![0].data;
    expect(Number(created.return_amount)).toBe(30);
    expect(Number(created.refundable_amount)).toBe(30);
    expect(created.refund_no).toBe('PRF202608040001');
    expect(refundUpdate).not.toHaveBeenCalled();
    expect(trace.link).toHaveBeenCalledWith(
      expect.objectContaining({
        upstreamType: 'purchase_return',
        downstreamType: 'purchase_refund',
      }),
      tx,
    );
    expect(result.refund_no).toBe('PRF202608040001');
  });

  it('does not create a refund task when payment does not exceed the effective payable', async () => {
    const refundCreate = vi.fn().mockResolvedValue({ refund_id: 78n, po_exit_id: 31n });
    const tx = {
      hspsi_purchase_refund: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _sum: { refundable_amount: null } }),
        create: refundCreate,
        update: vi.fn().mockResolvedValue({ refund_id: 78n, refund_no: 'CGTK78' }),
      },
      hspsi_purchase_order_input_exit: {
        findFirst: vi.fn().mockResolvedValue({
          po_exit_id: 31n,
          po_exit_no: 'CGTH31',
          po_input_id: 0n,
          po_id: 20n,
          exit_type: 1,
          exit_reson: '未到货退回',
        }),
        findMany: vi.fn().mockResolvedValue([{ po_exit_id: 31n }]),
      },
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({
          po_id: 20n,
          pay_amout: 100,
          org_id: 1n,
          dept_id: 2n,
          vendor_id: 3n,
        }),
      },
      hspsi_purchase_order_detail: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 10n, sku_id: 11n, unit_price: 10 }]),
      },
      hspsi_purchase_order_input_exit_detail: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 10n, sku_id: 11n, exit_qty: 3 }]),
      },
      hspsi_purchase_order_payment: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { fact_pay_amount: 50 } }),
      },
      hspsi_sys_dictionary_category: { findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1 }) },
      hspsi_sys_dictionary: { findFirst: vi.fn().mockResolvedValue({ dict_id: 1 }) },
    };
    const service = serviceWith({} as never);
    vi.spyOn(service as any, 'recalcPayment').mockResolvedValue(undefined);

    const result = await (service as any).createRefundTask(tx, 31n, '9');

    expect(result).toBeNull();
    expect(refundCreate).not.toHaveBeenCalled();
    expect((service as any).recalcPayment).toHaveBeenCalledWith(tx, 20n);
  });

  it('records a partial supplier refund and recalculates the task status', async () => {
    const flowCreate = vi.fn().mockResolvedValue({ flow_id: 88n });
    const taskUpdate = vi.fn();
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_refund: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            refund_id: 77n,
            refund_no: 'CGTK77',
            refundable_amount: new Prisma.Decimal(100),
            refund_status: 0,
          })
          .mockResolvedValueOnce({
            refund_id: 77n,
            refundable_amount: new Prisma.Decimal(100),
            refund_status: 0,
          }),
        update: taskUpdate,
      },
      hspsi_purchase_refund_flow: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi
          .fn()
          .mockResolvedValueOnce({ _sum: { refund_amount: null } })
          .mockResolvedValueOnce({ _sum: { refund_amount: new Prisma.Decimal(40) } }),
        create: flowCreate,
        update: vi.fn(),
      },
      hspsi_sys_dictionary_category: { findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1 }) },
      hspsi_sys_dictionary: { findFirst: vi.fn().mockResolvedValue({ dict_id: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    const service = serviceWith(prisma, trace);
    vi.spyOn(service as any, 'recalcPayment').mockResolvedValue(undefined);
    const result = await service.createRefundFlow(
      '77',
      {
        refundAmount: 40,
        refundChannel: 2,
        refundDate: '2026-08-02',
        requestKey: 'refund-77-1',
      },
      '9',
    );

    expect(flowCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          refund_id: 77n,
          refund_channel: 2,
          request_key: 'refund-77-1',
        }),
      }),
    );
    expect(taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ refund_status: 1 }) }),
    );
    expect(trace.link).toHaveBeenCalledWith(
      expect.objectContaining({ downstreamType: 'purchase_refund_flow' }),
      tx,
    );
    expect(result.message).toBe('采购退款已记录');
  });

  it('rejects a supplier refund greater than the remaining refundable amount', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_refund: {
        findFirst: vi.fn().mockResolvedValue({
          refund_id: 77n,
          refund_no: 'CGTK77',
          refundable_amount: new Prisma.Decimal(100),
          refund_status: 1,
        }),
      },
      hspsi_purchase_refund_flow: {
        findUnique: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _sum: { refund_amount: new Prisma.Decimal(80) } }),
        create: vi.fn(),
      },
      hspsi_sys_dictionary_category: { findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1 }) },
      hspsi_sys_dictionary: { findFirst: vi.fn().mockResolvedValue({ dict_id: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      serviceWith(prisma).createRefundFlow(
        '77',
        {
          refundAmount: 21,
          refundChannel: 2,
          refundDate: '2026-08-02',
          requestKey: 'refund-77-over',
        },
        '9',
      ),
    ).rejects.toThrow('本次退款超过剩余应退款 20.00 元');
    expect(tx.hspsi_purchase_refund_flow.create).not.toHaveBeenCalled();
  });

  it('caps a new payment at the effective payable after confirmed purchase returns', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({
          po_id: 20n,
          po_no: 'PO20',
          pay_amout: new Prisma.Decimal(100),
          org_id: 1n,
          dept_id: 2n,
          vendor_id: 3n,
        }),
      },
      hspsi_purchase_order_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_id: 10n, sku_id: 11n, unit_price: new Prisma.Decimal(10) }]),
      },
      hspsi_purchase_order_input_exit: {
        findMany: vi.fn().mockResolvedValue([{ po_exit_id: 30n }]),
      },
      hspsi_purchase_order_input_exit_detail: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 10n, sku_id: 11n, exit_qty: 3 }]),
      },
      hspsi_purchase_order_payment: {
        findFirst: vi.fn(),
        aggregate: vi.fn().mockResolvedValue({ _sum: { fact_pay_amount: new Prisma.Decimal(50) } }),
        create: vi.fn(),
      },
      hspsi_purchase_refund: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_sys_dictionary_category: { findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1 }) },
      hspsi_sys_dictionary: { findFirst: vi.fn().mockResolvedValue({ dict_id: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      serviceWith(prisma).savePayment(
        null,
        {
          orderId: 20,
          deptId: 2,
          paymentAmount: 21,
          paymentChannel: 2,
          paymentDate: '2026-08-02',
        },
        '9',
      ),
    ).rejects.toThrow('付款金额超过剩余应付');
    expect(tx.hspsi_purchase_order_payment.create).not.toHaveBeenCalled();
  });

  it('rolls a production shortage and its plan back when the generated application is rejected', async () => {
    const shortageUpdate = vi.fn();
    const planUpdate = vi.fn();
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_oa_approval_instance: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_purchase_approve: {
        findFirst: vi.fn().mockResolvedValue({
          pur_id: 7n,
          pur_no: 'PA7',
          status: 1,
          approve_status: 0,
          source_type: 'production_plan',
        }),
        findUnique: vi.fn().mockResolvedValue({ source_type: 'production_plan' }),
        update: vi.fn(),
      },
      hspsi_purchase_approve_detail: {
        findMany: vi.fn().mockResolvedValue([{ source_shortage_id: 8n }]),
      },
      hspsi_production_shortage: {
        findMany: vi.fn().mockResolvedValue([{ shortage_id: 8n, plan_id: 9n }]),
        updateMany: shortageUpdate,
      },
      hspsi_production_plan: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ plan_status: 7, outbound_status: 0, delivered_qty: 0 }),
        update: planUpdate,
      },
      hspsi_production_material_out: { count: vi.fn().mockResolvedValue(0) },
      hspsi_production_plan_input: { count: vi.fn().mockResolvedValue(0) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await serviceWith(prisma).approveApplication('7', false, '缺货取消', '3');

    expect(shortageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 0, pur_id: 0n }),
      }),
    );
    expect(planUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plan_status: 7,
          material_status: 2,
          stock_check_status: 2,
          approve_status: 0,
        }),
      }),
    );
  });

  it('rejects cancelling a shortage purchase order below its unresolved gap', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({ po_id: 20n, pur_id: 7n, status: 2 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ po_id: 20n, pcs_qty: 10, arrival_qty: 0, is_all_arrival: 0 }),
        findMany: vi.fn().mockResolvedValue([{ po_id: 20n }]),
        update: vi.fn(),
      },
      hspsi_purchase_order_detail: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              id: 1n,
              po_id: 20n,
              goods_id: 10n,
              sku_id: 11n,
              qty: 10,
              actual_qty: 0,
              cancel_qty: 0,
            },
          ])
          .mockResolvedValueOnce([{ goods_id: 10n, sku_id: 11n, qty: 10, cancel_qty: 2 }]),
        update: vi.fn(),
      },
      hspsi_purchase_order_input: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_purchase_order_input_detail: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_purchase_approve_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ source_shortage_id: 8n, goods_id: 10n, sku_id: 11n }]),
      },
      hspsi_production_shortage: {
        findMany: vi.fn().mockResolvedValue([{ shortage_id: 8n, suggest_purchase_qty: 10 }]),
      },
      hspsi_purchase_order_input_exit: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_purchase_order_input_exit_detail: { aggregate: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      serviceWith(prisma).cancelOrderPending(
        '20',
        {
          details: [{ goodsId: 10, skuId: 11, cancelQuantity: 2 }],
        },
        '3',
      ),
    ).rejects.toThrow('不能低于尚未解决的缺料数量');
    expect(tx.hspsi_purchase_order.update).not.toHaveBeenCalled();
  });

  it('blocks direct deletion of a production-shortage purchase order', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({ pur_id: 7n }),
        update: vi.fn(),
      },
      hspsi_purchase_order_input: { count: vi.fn().mockResolvedValue(0) },
      hspsi_purchase_order_payment: { count: vi.fn().mockResolvedValue(0) },
      hspsi_purchase_approve_detail: { count: vi.fn().mockResolvedValue(1) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(serviceWith(prisma).removeOrder('20', '3')).rejects.toThrow(
      '生产缺料采购订单不能直接删除',
    );
    expect(tx.hspsi_purchase_order.update).not.toHaveBeenCalled();
  });

  it('does not let an order-level return consume quantities already locked by a pending receipt', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({ po_id: 20n, po_no: 'PO20', pur_id: 0n, status: 2 }),
      },
      hspsi_purchase_order_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1n,
            po_id: 20n,
            goods_id: 10n,
            sku_id: 11n,
            qty: 12,
            actual_qty: 0,
            cancel_qty: 0,
            unit_type: 1,
          },
        ]),
        update: vi.fn(),
      },
      hspsi_purchase_order_input: { findMany: vi.fn().mockResolvedValue([{ po_input_id: 90n }]) },
      hspsi_purchase_order_input_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ po_input_id: 90n, goods_id: 10n, sku_id: 11n, input_qty: 5 }]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      serviceWith(prisma).cancelOrderPending(
        '20',
        {
          details: [{ goodsId: 10, skuId: 11, cancelQuantity: 8 }],
        },
        '3',
      ),
    ).rejects.toThrow('可退未到货数量不足 (最大 7)');
    expect(tx.hspsi_purchase_order_detail.update).not.toHaveBeenCalled();
  });

  it('cancels a pending receipt without posting inventory and releases its quantity', async () => {
    const receiptUpdate = vi.fn();
    const orderUpdate = vi.fn();
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_order_input: {
        findFirst: vi.fn().mockResolvedValue({ po_input_id: 90n, po_id: 20n, comfirm_status: 0 }),
        update: receiptUpdate,
      },
      hspsi_purchase_order: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          po_id: 20n,
          pcs_qty: 12,
          arrival_qty: 0,
          is_all_arrival: 0,
          status: 2,
        }),
        update: orderUpdate,
      },
      hspsi_purchase_order_detail: {
        findMany: vi.fn().mockResolvedValue([{ qty: 12, actual_qty: 0, cancel_qty: 0 }]),
      },
      hspsi_purchase_order_input_exit: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_purchase_order_input_exit_detail: { aggregate: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    const result = await serviceWith(prisma).cancelReceipt('90', '客户取消到货', '3');

    expect(receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ comfirm_status: 2 }) }),
    );
    expect(orderUpdate).toHaveBeenCalled();
    expect(result.message).toContain('锁定数量已释放');
  });

  it('does not save over an application that is already approved when the row lock is acquired', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_oa_approval_instance: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_purchase_approve: {
        findFirst: vi.fn().mockResolvedValue({
          pur_id: 7n,
          status: 1,
          approve_status: 1,
          source_type: '',
        }),
        update: vi.fn(),
      },
      hspsi_purchase_approve_detail: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      serviceWith(prisma).saveApplication(
        '7',
        {
          orgId: 1,
          deptId: 2,
          warehouseId: 3,
          details: [{ goodsId: 10, skuId: 11, quantity: 1, unitType: 1, referencePrice: 5 }],
        },
        '9',
      ),
    ).rejects.toThrow('当前状态不能编辑');

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.hspsi_purchase_approve.update).not.toHaveBeenCalled();
    expect(tx.hspsi_purchase_approve_detail.deleteMany).not.toHaveBeenCalled();
    expect(tx.hspsi_purchase_approve_detail.createMany).not.toHaveBeenCalled();
  });

  it('does not resubmit an application that is already approved when the row lock is acquired', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_approve: {
        findFirst: vi.fn().mockResolvedValue({
          pur_id: 7n,
          status: 1,
          approve_status: 1,
          source_type: '',
        }),
        update: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(serviceWith(prisma).submitApplication('7', '9')).rejects.toThrow(
      '当前状态不能提交',
    );

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.hspsi_purchase_approve.update).not.toHaveBeenCalled();
  });

  it('starts a direct order and creates an already-approved reverse application', async () => {
    const orderUpdate = vi.fn();
    const applicationCreate = vi.fn().mockResolvedValue({ pur_id: 7n });
    const applicationDetailCreate = vi.fn();
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({
          po_id: 20n,
          po_no: 'PO20',
          pur_id: 0n,
          org_id: 1n,
          dept_id: 2n,
          warehouse_id: 3n,
          vendor_id: 4n,
          status: 1,
          remark: '',
        }),
        update: orderUpdate,
      },
      hspsi_basic_vendor: { findFirst: vi.fn().mockResolvedValue({ vendor_id: 4n }) },
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 1n, name: '成品一仓', warehouse_type: 1 }),
      },
      hspsi_goods_info: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_id: 10n, goods_name: '测试商品', goods_catg_id: 30n }]),
      },
      hspsi_goods_info_category: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_catg_id: 30n, goods_name: '成品', warehouse_type: 1 }]),
      },
      hspsi_purchase_order_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { goods_id: 10n, sku_id: 11n, qty: 2, unit_type: 1, unit_price: 5, remark: '' },
          ]),
      },
      hspsi_purchase_approve: { findFirst: vi.fn(), create: applicationCreate },
      hspsi_purchase_approve_detail: { createMany: applicationDetailCreate },
      hspsi_sys_oper_log: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    const result = await serviceWith(prisma, trace).startOrder('20', '9');

    expect(applicationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_type: 'direct_order',
          source_id: 20n,
          status: 1,
          approve_status: 1,
        }),
      }),
    );
    expect(applicationDetailCreate).toHaveBeenCalledOnce();
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { po_id: 20n },
        data: expect.objectContaining({ status: 2 }),
      }),
    );
    expect(trace.link).toHaveBeenCalledOnce();
    expect(result.message).toBe('采购订单已开始采购');
  });

  it('backfills the department and leaves order generation to the purchaser after approval', async () => {
    const orderCreate = vi.fn().mockResolvedValue({ po_id: 30n });
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const applicationLines = [
      { goods_id: 10n, sku_id: 11n, qty: 2, unit_type: 1, reference_price: 5, remark: '' },
    ];
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_oa_approval_instance: { findFirst: vi.fn().mockResolvedValue(null) },
      hspsi_purchase_approve: {
        findFirst: vi.fn().mockResolvedValue({
          pur_id: 7n,
          pur_no: 'PA7',
          org_id: 1n,
          dept_id: 0n,
          warehouse_id: 3n,
          status: 1,
          approve_status: 0,
          source_type: 'production_plan',
          remark: '',
        }),
        update: vi.fn(),
      },
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_dept: {
        findFirst: vi.fn().mockResolvedValueOnce({ dept_id: 2n }).mockResolvedValue({ org_id: 1n }),
      },
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 1n, name: '成品一仓', warehouse_type: 1 }),
      },
      hspsi_goods_info: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_id: 10n, goods_name: '测试商品', goods_catg_id: 30n }]),
      },
      hspsi_goods_info_category: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_catg_id: 30n, goods_name: '成品', warehouse_type: 1 }]),
      },
      hspsi_purchase_approve_detail: {
        findMany: vi.fn().mockResolvedValueOnce(applicationLines).mockResolvedValueOnce([]),
      },
      hspsi_purchase_order: { count: vi.fn().mockResolvedValue(0), create: orderCreate },
      hspsi_purchase_order_detail: { createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    const result = await serviceWith(prisma, trace).approveApplication('7', true, '', '9');

    expect(orderCreate).not.toHaveBeenCalled();
    expect(trace.link).not.toHaveBeenCalled();
    expect(result.message).toBe('审批通过，请由采购人员生成采购订单');
  });

  it('generates selected application lines using total amount as the authoritative price', async () => {
    const orderCreate = vi.fn().mockResolvedValue({ po_id: 30n });
    const detailCreate = vi.fn();
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const applicationLine = {
      id: 12n,
      pur_id: 7n,
      goods_id: 10n,
      sku_id: 11n,
      qty: 4,
      unit_type: 1,
      reference_price: new Prisma.Decimal(0),
      remark: '',
    };
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_approve: {
        findFirst: vi.fn().mockResolvedValue({
          pur_id: 7n,
          pur_no: 'PA7',
          org_id: 1n,
          dept_id: 2n,
          warehouse_id: 3n,
          status: 1,
          approve_status: 1,
          remark: '',
        }),
      },
      hspsi_basic_vendor: { findFirst: vi.fn().mockResolvedValue({ vendor_id: 5n }) },
      hspsi_purchase_approve_detail: { findMany: vi.fn().mockResolvedValue([applicationLine]) },
      hspsi_purchase_order: { findMany: vi.fn().mockResolvedValue([]), create: orderCreate },
      hspsi_purchase_order_detail: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
        createMany: detailCreate,
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, trace);
    vi.spyOn(service as any, 'assertOrganizationScope').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'assertPurchaseWarehouse').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'assertProductionShortageOrderCapacity').mockResolvedValue(undefined);

    const result = await service.generateApplicationOrder(
      '7',
      {
        generationMode: 'partial',
        vendorId: '5',
        details: [{ applicationDetailId: '12', totalAmount: 100 }],
      },
      '9',
    );

    expect(orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pur_id: 7n,
        vendor_id: 5n,
        pcs_qty: 4,
        pay_amout: new Prisma.Decimal(100),
      }),
    });
    expect(detailCreate).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          source_application_detail_id: 12n,
          qty: 4,
          unit_price: new Prisma.Decimal(25),
          total_amout: new Prisma.Decimal(100),
        }),
      ],
    });
    expect(trace.link).toHaveBeenCalledOnce();
    expect(result).toEqual(
      expect.objectContaining({ id: 30n, totalAmount: new Prisma.Decimal(100) }),
    );
  });

  it('treats an empty plan payment date placeholder as no date when saving an order', async () => {
    const orderCreate = vi.fn().mockResolvedValue({ po_id: 30n });
    const tx = {
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 1n, name: '成品一仓', warehouse_type: 1 }),
      },
      hspsi_goods_info: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_id: 10n, goods_name: '测试商品', goods_catg_id: 30n }]),
      },
      hspsi_goods_info_category: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_catg_id: 30n, goods_name: '成品', warehouse_type: 1 }]),
      },
      hspsi_purchase_order: { create: orderCreate },
      hspsi_purchase_order_detail: { deleteMany: vi.fn(), createMany: vi.fn() },
      hspsi_sys_dictionary_category: { findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1 }) },
      hspsi_sys_dictionary: { findFirst: vi.fn().mockResolvedValue({ dict_id: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    const service = serviceWith(prisma);
    vi.spyOn(service as any, 'purchaseMoneyPosition').mockResolvedValue({
      effectivePayable: new Prisma.Decimal(10),
      netPaid: new Prisma.Decimal(0),
    });
    vi.spyOn(service as any, 'recalcPayment').mockResolvedValue(undefined);
    await service.saveOrder(
      null,
      {
        orgId: 1,
        deptId: 2,
        warehouseId: 3,
        receiverId: 9,
        vendorId: 4,
        arrivalType: 1,
        planArrivalDate: '2026-08-02',
        deliveryType: 1,
        paymentType: 1,
        planPayDate: '—',
        details: [{ goodsId: 10, skuId: 11, quantity: 3, unitType: 1, totalAmount: 100 }],
      },
      '9',
    );

    expect(orderCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plan_pay_date: null, pay_amout: new Prisma.Decimal(100) }),
      }),
    );
    const detail = tx.hspsi_purchase_order_detail.createMany.mock.calls[0]![0].data[0];
    expect(Number(detail.unit_price)).toBe(33.33);
    expect(Number(detail.total_amout)).toBe(100);
  });

  it('creates the first payment in the same transaction when a new order includes a current payment', async () => {
    const paymentCreate = vi.fn(async ({ data }: any) => ({ pay_id: 90n, pay_no: data.pay_no }));
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const tx = {
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 1n, name: '成品一仓', warehouse_type: 1 }),
      },
      hspsi_goods_info: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_id: 10n, goods_name: '测试商品', goods_catg_id: 30n }]),
      },
      hspsi_goods_info_category: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_catg_id: 30n, goods_name: '成品', warehouse_type: 1 }]),
      },
      hspsi_purchase_order: { create: vi.fn().mockResolvedValue({ po_id: 30n }) },
      hspsi_purchase_order_detail: { deleteMany: vi.fn(), createMany: vi.fn() },
      hspsi_purchase_order_payment: { create: paymentCreate },
      hspsi_sys_dictionary_category: { findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1 }) },
      hspsi_sys_dictionary: { findFirst: vi.fn().mockResolvedValue({ dict_id: 1 }) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, trace);
    vi.spyOn(service as any, 'purchaseMoneyPosition').mockResolvedValue({
      effectivePayable: new Prisma.Decimal(10),
      netPaid: new Prisma.Decimal(4),
    });
    vi.spyOn(service as any, 'recalcPayment').mockResolvedValue(undefined);

    const result = await service.saveOrder(
      null,
      {
        orgId: 1,
        deptId: 2,
        warehouseId: 3,
        receiverId: 9,
        vendorId: 4,
        arrivalType: 1,
        planArrivalDate: '2026-08-02',
        deliveryType: 1,
        paymentType: 1,
        currentPaymentAmount: 4,
        currentPaymentChannel: 2,
        currentPaymentDate: '2026-08-02',
        currentPaymentRemark: '首笔付款',
        details: [{ goodsId: 10, skuId: 11, quantity: 2, unitType: 1, totalAmount: 10 }],
      },
      '9',
    );

    expect(paymentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          po_id: expect.any(BigInt),
          pay_type: 2,
          fact_pay_amount: expect.any(Prisma.Decimal),
          remark: '首笔付款',
        }),
      }),
    );
    expect(Number(paymentCreate.mock.calls[0]![0].data.fact_pay_amount)).toBe(4);
    expect(trace.link).toHaveBeenCalledWith(
      expect.objectContaining({
        upstreamType: 'purchase_order',
        downstreamType: 'purchase_payment',
        relationKind: 'payment',
      }),
      tx,
    );
    expect(result.message).toBe('采购订单及本次付款已创建');
  });

  it('rejects a purchase order when the selected warehouse type differs from the goods category', async () => {
    const tx = {
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 1n, name: '原料一仓', warehouse_type: 2 }),
      },
      hspsi_goods_info: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_id: 10n, goods_name: '测试成品', goods_catg_id: 30n }]),
      },
      hspsi_goods_info_category: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_catg_id: 30n, goods_name: '成品', warehouse_type: 1 }]),
      },
      hspsi_purchase_order: { create: vi.fn() },
      hspsi_purchase_order_detail: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      serviceWith(prisma).saveOrder(
        null,
        {
          orgId: 1,
          deptId: 2,
          warehouseId: 3,
          receiverId: 9,
          vendorId: 4,
          arrivalType: 1,
          planArrivalDate: '2026-08-02',
          deliveryType: 1,
          paymentType: 1,
          details: [{ goodsId: 10, skuId: 11, quantity: 2, unitType: 1, totalAmount: 10 }],
        },
        '9',
      ),
    ).rejects.toThrow('商品分类要求不一致');
    expect(tx.hspsi_purchase_order.create).not.toHaveBeenCalled();
  });

  it('rejects mixed goods category warehouse types in one purchase document', async () => {
    const tx = {
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 1n, name: '成品一仓', warehouse_type: 1 }),
      },
      hspsi_goods_info: {
        findMany: vi.fn().mockResolvedValue([
          { goods_id: 10n, goods_name: '测试成品', goods_catg_id: 30n },
          { goods_id: 20n, goods_name: '测试原料', goods_catg_id: 40n },
        ]),
      },
      hspsi_goods_info_category: {
        findMany: vi.fn().mockResolvedValue([
          { goods_catg_id: 30n, goods_name: '成品', warehouse_type: 1 },
          { goods_catg_id: 40n, goods_name: '原料', warehouse_type: 2 },
        ]),
      },
      hspsi_purchase_order: { create: vi.fn() },
      hspsi_purchase_order_detail: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };

    await expect(
      serviceWith(prisma).saveOrder(
        null,
        {
          orgId: 1,
          deptId: 2,
          warehouseId: 3,
          receiverId: 9,
          vendorId: 4,
          arrivalType: 1,
          planArrivalDate: '2026-08-02',
          deliveryType: 1,
          paymentType: 1,
          details: [
            { goodsId: 10, skuId: 11, quantity: 1, unitType: 1, totalAmount: 5 },
            { goodsId: 20, skuId: 21, quantity: 1, unitType: 1, totalAmount: 5 },
          ],
        },
        '9',
      ),
    ).rejects.toThrow('同一采购单据只能包含相同仓库类型');
    expect(tx.hspsi_purchase_order.create).not.toHaveBeenCalled();
  });

  it('allows a receipt to use another warehouse of the same type in the same organization', async () => {
    const receiptCreate = vi.fn().mockResolvedValue({ po_input_id: 90n });
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({
          po_id: 20n,
          po_no: 'PO20',
          org_id: 1n,
          warehouse_id: 3n,
          pcs_qty: 2,
        }),
      },
      hspsi_basic_organization: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ org_id: 1n }) },
      hspsi_basic_warehouse: {
        findFirst: vi.fn().mockResolvedValue({ org_id: 1n, name: '成品二仓', warehouse_type: 1 }),
      },
      hspsi_goods_info: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_id: 10n, goods_name: '测试成品', goods_catg_id: 30n }]),
      },
      hspsi_goods_info_category: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_catg_id: 30n, goods_name: '成品', warehouse_type: 1 }]),
      },
      hspsi_purchase_order_input: { create: receiptCreate, update: vi.fn() },
      hspsi_purchase_order_input_detail: { deleteMany: vi.fn(), createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const service = serviceWith(prisma, trace);
    vi.spyOn(service, 'order').mockResolvedValue({
      id: 20n,
      details: [{ goodsId: 10n, skuId: 11n, remainingQuantity: 2 }],
    } as never);

    await service.saveReceipt(
      null,
      {
        orderId: 20,
        warehouseId: 9,
        deptId: 2,
        receiverId: 9,
        inputType: 1,
        details: [{ goodsId: 10, skuId: 11, inputQuantity: 2, unitType: 1, batchNo: 'B001' }],
      },
      '9',
    );

    expect(receiptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ warehouse_id: 9n }),
      }),
    );
  });

  it('generates a pending receipt immediately and falls back to the goods default warehouse when the order warehouse is incompatible', async () => {
    const receiptCreate = vi.fn().mockResolvedValue({ po_input_id: 91n });
    const tx = {
      hspsi_goods_info: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { goods_id: 10n, goods_name: '医疗耗材', goods_catg_id: 30n, warehouse_id: 9n },
          ]),
      },
      hspsi_goods_info_category: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ goods_catg_id: 30n, goods_name: '医疗耗材', warehouse_type: 9 }]),
      },
      hspsi_basic_warehouse: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ warehouse_id: 9n })
          .mockResolvedValueOnce({ name: '健服-医疗耗材仓', warehouse_type: 9 }),
      },
      hspsi_purchase_order_input: { create: receiptCreate, update: vi.fn() },
      hspsi_purchase_order_input_detail: { createMany: vi.fn() },
    };
    const prisma = {
      hspsi_purchase_order_input: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const service = serviceWith(prisma, trace);
    vi.spyOn(service, 'order').mockResolvedValue({
      po_id: 20n,
      orderNo: 'PO20',
      org_id: 1n,
      warehouse_id: 15n,
      dept_id: 2n,
      receiver_id: 9n,
      pcs_qty: 12,
      status: 3,
      details: [
        { goodsId: 10n, skuId: 11n, quantity: 12, remainingQuantity: 7, unitType: 1, remark: '' },
      ],
    } as never);

    const result = await service.generateReceipt('20', '9');

    expect(receiptCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ warehouse_id: 9n, input_qty: 7, comfirm_status: 0 }),
      }),
    );
    expect(result).toEqual(expect.objectContaining({ id: 91n, created: true }));
  });

  it('resolveLineSkus fills default SKU for lines with sku_id=0', async () => {
    const prisma = {
      hspsi_goods_info: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 101n, unit_type: 3 }]),
      },
      hspsi_goods_info_sku: {
        findMany: vi.fn().mockResolvedValue([
          { good_id: 101n, sku_id: 202n, unit_type: 5, is_default: 0 },
        ]),
      },
    };
    const service = serviceWith(prisma);
    const lines = [{ goodsId: '101', skuId: 0, unitType: 0 }];
    await (service as any).resolveLineSkus(lines);

    expect(String(lines[0].skuId)).toBe('202');
    expect(lines[0].unitType).toBe(5);
  });
});

