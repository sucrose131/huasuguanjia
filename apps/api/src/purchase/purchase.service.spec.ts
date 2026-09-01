import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PurchaseService } from './purchase.service';

function serviceWith(
  prisma: Record<string, any>,
  trace: Record<string, any> = { link: vi.fn(), removeForDocument: vi.fn() },
  message: Record<string, any> = { sendPurchaseReceiptNotification: vi.fn() },
) {
  const prismaWithDefaults = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    hspsi_basic_organization: { findMany: vi.fn().mockResolvedValue([]) },
    ...prisma,
  };
  const todoService = {
    create: vi.fn().mockResolvedValue({ created: true }),
    completeByBusiness: vi.fn().mockResolvedValue(0),
    resolveRecipients: vi.fn().mockResolvedValue([]),
  };
  const service = new PurchaseService(
    prismaWithDefaults as never,
    { goodsOptions: vi.fn(), assertGoodsLines: vi.fn() } as never,
    { enrichGoods: vi.fn(async (rows: unknown[]) => rows) } as never,
    { post: vi.fn() } as never,
    { syncExpiryAlert: vi.fn() } as never,
    trace as never,
    { generate: vi.fn(async (prefix: string) => `${prefix}202608040001`) } as never,
    message as never,
    todoService as never,
  );
  vi.spyOn(service as any, 'assertReceiverScope').mockResolvedValue(undefined);
  vi.spyOn(service as any, 'resolveApplicationOaSelection').mockResolvedValue({
    value: '1',
    label: '主组织',
    deptId: '2',
    deptName: '申请部门',
    accountSetId: '1',
  });
  vi.spyOn(service as any, 'assertApplicationCostScope').mockResolvedValue(undefined);
  vi.spyOn(service as any, 'assertApplicationReceiverScope').mockResolvedValue({
    id: 9n,
    staff_id: 19n,
    dept_id: 2n,
    receiverDeptId: 2n,
  });
  vi.spyOn(service as any, 'syncPurchaseOrderTodo').mockResolvedValue(undefined);
  vi.spyOn(service as any, 'recalcOrderStatus').mockResolvedValue({});
  return Object.assign(service, { __todoService: todoService });
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

describe('PurchaseService receiver assignment and todo', () => {
  it('returns only active OA users whose primary department matches the selected organization', async () => {
    const prisma = {
      hspsi_basic_dept: { findFirst: vi.fn().mockResolvedValue({ dept_id: 2n }) },
      hspsi_sys_user: {
        findMany: vi.fn().mockResolvedValue([
          { id: 9n, staff_id: 90n, username: 'receiver', nickname: '收货人甲' },
          { id: 10n, staff_id: 100n, username: 'other', nickname: '其他人员' },
        ]),
      },
      hspsi_basic_staff: { findMany: vi.fn().mockResolvedValue([{ id: 90n }, { id: 100n }]) },
      hspsi_basic_staff_organizations: {
        findMany: vi.fn().mockResolvedValue([{ staff_id: 90n }]),
      },
    };
    const result = await serviceWith(prisma).receiverOptions('1', '2');
    expect(result).toEqual([expect.objectContaining({ value: 9n, label: '收货人甲' })]);
  });

  it('rejects a receiver without a valid OA primary department relation', async () => {
    const tx = {
      hspsi_sys_user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 9n,
          staff_id: 90n,
          username: 'receiver',
          nickname: '收货人甲',
        }),
      },
      hspsi_basic_staff: { findFirst: vi.fn().mockResolvedValue({ id: 90n }) },
      hspsi_basic_staff_organizations: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = serviceWith({});
    (service as any).assertReceiverScope.mockRestore();
    await expect((service as any).assertReceiverScope(tx, 1n, 2n, 9n)).rejects.toThrow(
      'OA主组织、部门关系无效',
    );
  });

  it('creates a personal todo linked by the full bigint purchase-order id', async () => {
    const todoCreate = vi.fn();
    const tx = {
      hspsi_sys_todo: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: todoCreate,
        update: vi.fn(),
      },
    };
    const service = serviceWith({});
    (service as any).syncPurchaseOrderTodo.mockRestore();
    await (service as any).syncPurchaseOrderTodo(
      tx,
      {
        po_id: 1786090216033523n,
        po_no: 'PO202608190008',
        org_id: 4n,
        receiver_id: 13n,
        status: 1,
        created_by: 7n,
      },
      '7',
    );
    expect(todoCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 13,
        source_id: 1786090216033523n,
        business_id: 1786090216033523n,
        status: 0,
      }),
    });
  });
});

describe('PurchaseService receipt confirmation', () => {
  it('posts inventory, marks a pending receipt as confirmed and notifies the order creator', async () => {
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const message = { sendPurchaseReceiptNotification: vi.fn().mockResolvedValue(undefined) };
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
          input_qty: 2,
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
    const service = serviceWith(prisma, trace, message);
    const postReceipt = vi.spyOn(service as any, 'postReceipt').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'syncProductionShortageState').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'purchaseOrderLifecycle').mockResolvedValue({
      lineProgress: new Map([
        [
          '101:202',
          {
            ordered: 2,
            cancelled: 0,
            confirmedNormal: 0,
            pendingNormal: 2,
            exchangeReturned: 0,
            confirmedExchange: 0,
          },
        ],
      ]),
    });

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
    const recalcOrderStatus = (service as any).recalcOrderStatus as ReturnType<typeof vi.fn>;
    expect(recalcOrderStatus).toHaveBeenCalledWith(tx, 401n);
    expect(receiptUpdate.mock.invocationCallOrder[0]!).toBeLessThan(
      recalcOrderStatus.mock.invocationCallOrder[0]!,
    );
    expect(message.sendPurchaseReceiptNotification).toHaveBeenCalledWith({
      poId: 401n,
      receiptNo: 'GA501',
      orderNo: 'PO401',
      quantity: 2,
    });
    expect(result.message).toBe('入库已确认，库存已增加');
  });

  it('does not notify again when the same receipt is confirmed twice', async () => {
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const message = { sendPurchaseReceiptNotification: vi.fn().mockResolvedValue(undefined) };
    const tx = {
      $queryRaw: vi.fn(),
      hspsi_purchase_order_input: {
        findFirst: vi.fn().mockResolvedValue({
          po_input_id: 501n,
          po_input_no: 'GA501',
          po_id: 401n,
          warehouse_id: 2n,
          comfirm_status: 1,
          posting_version: 1,
          input_qty: 2,
        }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, trace, message);

    const result = await service.confirmReceipt('501', true, '再次确认', '9');

    expect(result.message).toBe('入库已确认');
    expect(message.sendPurchaseReceiptNotification).not.toHaveBeenCalled();
  });
});

describe('PurchaseService production-shortage guards', () => {
  it('采购申请组织选项包含直接授权组织的有效上级组织', async () => {
    const service = serviceWith({
      $queryRaw: vi.fn().mockResolvedValue([
        { org_id: 13n, parent_id: 0n, name: '华溯生物科技（深圳）有限公司' },
        { org_id: 14n, parent_id: 13n, name: '华溯云（深圳）科技有限公司' },
      ]),
    });

    await expect(
      service.applicationOrganizationOptions({
        id: '58',
        username: '18922946273',
        orgId: '14',
        orgName: '华溯云（深圳）科技有限公司',
        authorizedOrganizations: [{ id: '14', name: '华溯云（深圳）科技有限公司' }],
        permissions: ['purchase'],
      }),
    ).resolves.toEqual([
      { value: '14', label: '华溯云（深圳）科技有限公司' },
      { value: '13', label: '华溯生物科技（深圳）有限公司' },
    ]);
  });

  it('采购申请允许使用当前账号已授权的额外组织', async () => {
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
        oaOrgId: 1,
        receiverId: 9,
        deptId: 2,
        warehouseId: 3,
        details: [{ goodsId: 10, skuId: 11, quantity: 1, unitType: 1 }],
      },
      {
        id: '9',
        username: 'applicant',
        orgId: '1',
        deptId: '2',
        authorizedOrganizations: [
          { id: '1', name: '主组织' },
          { id: '999', name: '额外授权组织' },
        ],
        permissions: ['purchase'],
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ org_id: 999n, created_by: 9n }),
    });
  });

  it('采购申请拒绝使用当前账号未授权的组织', async () => {
    const service = serviceWith({});
    await expect(
      service.saveApplication(
        null,
        {
          orgId: 999,
          oaOrgId: 1,
          receiverId: 9,
          deptId: 2,
          warehouseId: 3,
          details: [{ goodsId: 10, skuId: 11, quantity: 1, unitType: 1 }],
        },
        {
          id: '9',
          username: 'applicant',
          orgId: '1',
          deptId: '2',
          authorizedOrganizations: [{ id: '1', name: '主组织' }],
          permissions: ['purchase'],
        },
      ),
    ).rejects.toThrow('采购申请所属组织不在当前账号授权组织范围内');
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

  it('reopens a production shortage when the effective received quantity no longer covers it', async () => {
    const shortageUpdate = vi.fn();
    const planUpdate = vi.fn();
    const tx = {
      hspsi_purchase_order: { findMany: vi.fn().mockResolvedValue([{ po_id: 20n }]) },
      hspsi_purchase_order_detail: {
        findMany: vi.fn().mockResolvedValue([{ goods_id: 10n, sku_id: 11n, actual_qty: 4 }]),
      },
      hspsi_purchase_approve_detail: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ source_shortage_id: 8n, goods_id: 10n, sku_id: 11n, qty: 10 }]),
      },
      hspsi_production_shortage: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            {
              shortage_id: 8n,
              plan_id: 6n,
              status: 2,
              suggest_purchase_qty: 10,
              require_qty: 15,
            },
          ])
          .mockResolvedValueOnce([{ shortage_id: 8n, status: 1 }]),
        update: shortageUpdate,
      },
      hspsi_production_plan: {
        findFirst: vi.fn().mockResolvedValue({
          plan_id: 6n,
          plan_status: 4,
          delivered_qty: 0,
        }),
        update: planUpdate,
      },
      hspsi_production_material_out: { count: vi.fn().mockResolvedValue(0) },
      hspsi_production_plan_input: { count: vi.fn().mockResolvedValue(0) },
    };

    await (serviceWith({}) as any).syncProductionShortageState(tx, 7n, '3');

    expect(shortageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 1, fact_qty: 9 }) }),
    );
    expect(planUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plan_status: 7,
          material_status: 3,
          stock_check_status: 2,
        }),
      }),
    );
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

    const service = serviceWith(prisma);
    vi.spyOn(service as any, 'purchaseOrderLifecycle').mockResolvedValue({
      lifecycle: { canCancelUnarrived: true },
    });
    await expect(
      service.cancelOrderPending(
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
        update: vi.fn(),
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

    const service = serviceWith(prisma);
    const result = await service.cancelReceipt('90', '客户取消到货', '3');

    expect(receiptUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ comfirm_status: 2 }) }),
    );
    expect((service as any).recalcOrderStatus).toHaveBeenCalledWith(tx, 20n);
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
          oaOrgId: 1,
          receiverId: 9,
          deptId: 2,
          warehouseId: 3,
          details: [{ goodsId: 10, skuId: 11, quantity: 1, unitType: 1, referencePrice: 5 }],
        },
        {
          id: '9',
          username: 'applicant',
          orgId: '1',
          deptId: '2',
          authorizedOrganizations: [{ id: '1', name: '主组织' }],
          permissions: ['purchase'],
        },
      ),
    ).rejects.toThrow('采购申请提交审核后不允许修改原单');

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

    await expect(
      serviceWith(prisma).submitApplication('7', {
        id: '9',
        username: 'applicant',
        orgId: '1',
        deptId: '2',
        authorizedOrganizations: [{ id: '1', name: '主组织' }],
        permissions: ['purchase'],
      }),
    ).rejects.toThrow('采购申请已经提交，不能重复提交');

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

  it('审批通过后同时给采购经理和申请单收货人下发待办', async () => {
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
          dept_id: 2n,
          receiver_id: 9n,
          warehouse_id: 3n,
          status: 1,
          approve_status: 0,
          source_type: 'manual',
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
      hspsi_purchase_order: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
      hspsi_purchase_order_detail: { createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma, trace);
    const todoService = service.__todoService;
    (todoService.resolveRecipients as ReturnType<typeof vi.fn>).mockResolvedValue([1, 2]);

    await service.approveApplication('7', true, '', '9');

    // 接收人按「权限码 + 组织授权」配置化解析，不写死角色
    expect(todoService.resolveRecipients).toHaveBeenCalledWith(
      'purchase:applications:generate-order',
      1,
      tx,
    );
    expect(todoService.create).toHaveBeenCalledTimes(3);
    for (const call of (todoService.create.mock.calls as any[]).slice(0, 2)) {
      expect(call[0]).toMatchObject({
        organizationId: 1,
        title: 'PA7',
        content: '采购申请已审批通过，请生成采购订单',
        businessType: 'purchase_application',
        businessId: 7,
      });
      expect(call[1]).toBe(tx);
    }
    expect(todoService.create).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        userId: 9,
        organizationId: 1,
        title: 'PA7',
        content: '采购申请已审批通过，您被指定为收货人，请关注后续采购及到货入库',
        businessType: 'purchase_application',
        businessId: 7,
      }),
      tx,
    );
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
        receiverId: '9',
        details: [{ applicationDetailId: '12', totalAmount: 100 }],
      },
      '9',
    );

    expect(orderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        pur_id: 7n,
        vendor_id: 5n,
        receiver_id: 9n,
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
    expect((service as any).syncPurchaseOrderTodo).not.toHaveBeenCalled();
    // 采购订单已生成 → 关闭「采购申请待生成订单」待办
    expect((service as any).__todoService.completeByBusiness).toHaveBeenCalledWith(
      'purchase_application',
      7,
      tx,
    );
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

  it('rejects payment data embedded in a direct-order draft save', async () => {
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

    await expect(
      service.saveOrder(
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
      ),
    ).rejects.toThrow('采购付款请通过订单操作列的“付款”入口登记');

    expect(paymentCreate).not.toHaveBeenCalled();
    expect(trace.link).not.toHaveBeenCalled();
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
      hspsi_purchase_order_input: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: receiptCreate,
        update: vi.fn(),
      },
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
      $queryRaw: vi.fn(),
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
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({
          po_id: 20n,
          po_no: 'PO20',
          org_id: 1n,
          warehouse_id: 15n,
          dept_id: 2n,
          receiver_id: 9n,
          pcs_qty: 12,
          status: 3,
        }),
      },
      hspsi_purchase_order_detail: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 1n,
            goods_id: 10n,
            sku_id: 11n,
            qty: 12,
            cancel_qty: 0,
            unit_type: 1,
            remark: '',
          },
        ]),
      },
      hspsi_purchase_order_input: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: receiptCreate,
        update: vi.fn(),
      },
      hspsi_purchase_order_input_detail: { createMany: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const trace = { link: vi.fn(), removeForDocument: vi.fn() };
    const service = serviceWith(prisma, trace);
    vi.spyOn(service as any, 'purchaseOrderLifecycle').mockResolvedValue({
      lifecycle: { status: 3 },
      lineProgress: new Map([
        [
          '10:11',
          {
            ordered: 12,
            cancelled: 0,
            confirmedNormal: 5,
            pendingNormal: 0,
            purchaseReturned: 0,
            exchangeReturned: 0,
            confirmedExchange: 0,
            pendingExchange: 0,
          },
        ],
      ]),
    });

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
        findMany: vi
          .fn()
          .mockResolvedValue([{ good_id: 101n, sku_id: 202n, unit_type: 5, is_default: 0 }]),
      },
    };
    const service = serviceWith(prisma);
    const lines = [{ goodsId: '101', skuId: 0, unitType: 0 }];
    await (service as any).resolveLineSkus(lines);

    expect(String(lines[0]!.skuId)).toBe('202');
    expect(lines[0]!.unitType).toBe(5);
  });
});

describe('PurchaseService paid order todo notification', () => {
  function paymentTx(overrides: Record<string, any> = {}) {
    const tx: Record<string, any> = {
      $queryRaw: vi.fn(),
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({
          po_id: 20n,
          po_no: 'CG202608260001',
          org_id: 9n,
          status: 2,
          pay_status: 1,
          receiver_id: 5n,
          pay_amout: new Prisma.Decimal(21),
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          po_id: 20n,
          po_no: 'CG202608260001',
          org_id: 9n,
          status: 2,
          receiver_id: 5n,
          created_by: 9n,
        }),
        update: vi.fn(),
      },
      hspsi_sys_todo: {
        findFirst: vi.fn().mockResolvedValue({ id: 1, source_type: 'purchase_order' }),
        update: vi.fn(),
        create: vi.fn(),
      },
      hspsi_purchase_order_detail: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_purchase_order_input: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
      hspsi_purchase_order_input_exit: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_purchase_order_payment: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ pay_id: 30n, pay_no: 'FK202608260001' }),
        aggregate: vi.fn().mockResolvedValue({ _sum: { fact_pay_amount: new Prisma.Decimal(0) } }),
      },
      hspsi_purchase_refund: { findMany: vi.fn().mockResolvedValue([]) },
      hspsi_purchase_refund_flow: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { refund_amount: new Prisma.Decimal(0) } }),
      },
      hspsi_sys_dictionary_category: { findFirst: vi.fn().mockResolvedValue({ dict_catg_id: 1 }) },
      hspsi_sys_dictionary: { findFirst: vi.fn().mockResolvedValue({ dict_id: 1 }) },
      ...overrides,
    };
    return tx;
  }

  it('付款完成时把「待收货」待办更新为“已完成付款”，与待收货合并为同一条（不再重复写 purchase_order 待办）', async () => {
    const tx = paymentTx();
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma) as any;
    (service.syncPurchaseOrderTodo as ReturnType<typeof vi.fn>).mockRestore();
    (service.recalcOrderStatus as ReturnType<typeof vi.fn>).mockRestore();

    await service.savePayment(
      null,
      {
        orderId: 20,
        deptId: 2,
        paymentAmount: 21,
        paymentChannel: 2,
        paymentDate: '2026-08-02',
      },
      '9',
    );

    // 待收货（recalcOrderStatus）与已付款（ensurePurchasePaidTodo）都更新同一条 hspsi_sys_todo
    const updates = (tx.hspsi_sys_todo.update.mock.calls as any[]).map((call) => call[0].data);
    expect(updates.some((data) => data.content.includes('已完成付款'))).toBe(true);
    expect(updates.some((data) => data.content.includes('到货及入库'))).toBe(true);
    expect(
      updates.every(
        (data) =>
          data.user_id === 5 &&
          data.business_type === 'purchase_receipt' &&
          data.business_id === 20n,
      ),
    ).toBe(true);
    // 不再给同一订单写第二条 purchase_order 类型的待办
    const serviceTodoCalls = (service.__todoService.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(serviceTodoCalls.some((call) => call[0]?.businessType === 'purchase_order')).toBe(false);
  });

  it('startOrder 时若订单已完成付款，同样把待办文案更新为“已完成付款”', async () => {
    const tx = paymentTx();
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma) as any;

    (service.syncPurchaseOrderTodo as ReturnType<typeof vi.fn>).mockRestore();
    await service.ensurePurchasePaidTodo(tx, 20n);

    expect(tx.hspsi_sys_todo.update).toHaveBeenCalledTimes(1);
    const data = (tx.hspsi_sys_todo.update.mock.calls[0] as any[])[0].data;
    expect(data.content).toBe('采购订单 CG202608260001 已完成付款，请关注到货/收货');
    expect(data.user_id).toBe(5);
    expect(data.business_type).toBe('purchase_receipt');
    expect(data.business_id).toBe(20n);
  });

  it('订单未开始采购（status=1）时禁止登记付款', async () => {
    const tx = paymentTx({
      hspsi_purchase_order: {
        findFirst: vi.fn().mockResolvedValue({
          po_id: 22n,
          po_no: 'CG202608260003',
          org_id: 9n,
          status: 1,
          pay_status: 0,
          receiver_id: 7n,
          pay_amout: new Prisma.Decimal(100),
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({
          po_id: 22n,
          po_no: 'CG202608260003',
          org_id: 9n,
          status: 1,
          receiver_id: 7n,
          created_by: 9n,
        }),
        update: vi.fn(),
      },
    });
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const service = serviceWith(prisma) as any;

    await expect(
      service.savePayment(
        null,
        {
          orderId: 22,
          deptId: 2,
          paymentAmount: 21,
          paymentChannel: 2,
          paymentDate: '2026-08-02',
        },
        '9',
      ),
    ).rejects.toThrow('请先开始采购，再登记采购付款');

    const updates = (tx.hspsi_sys_todo.update.mock.calls as any[]).map((call) => call[0].data);
    expect(updates).toHaveLength(0);
    expect(tx.hspsi_purchase_order_payment.create).not.toHaveBeenCalled();
  });
});
