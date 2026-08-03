import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { ProductionService } from '../production/production.service';
import { PurchaseService } from '../purchase/purchase.service';
import { SalesService } from '../sales/sales.service';

const envFile = existsSync('.env') ? '.env' : 'apps/api/.env';
process.loadEnvFile?.(envFile);

function fulfilledCount(results: PromiseSettledResult<unknown>[]) {
  return results.filter((result) => result.status === 'fulfilled').length;
}

async function main() {
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = context.get(PrismaService);
  const sales = context.get(SalesService);
  const purchase = context.get(PurchaseService);
  const production = context.get(ProductionService);
  const suffix = String(Date.now()).slice(-9);
  const marker = `VQ${suffix}`;
  const actorId = '1';
  const saleOrderId = BigInt(`97${Date.now()}`);
  const purchaseOrderId = BigInt(`96${Date.now()}`);
  let productionPlanId = 1_700_000_000n + BigInt(Date.now() % 50_000_000);
  let goodsId = 1_800_000_000n + BigInt(Date.now() % 100_000_000);
  let skuId = goodsId + 1n;

  try {
    const warehouse = await prisma.hspsi_basic_warehouse.findFirst({
      where: { status: 1, deleted_at: null },
      orderBy: { warehouse_id: 'asc' },
    });
    if (!warehouse) throw new Error('没有可用于冒烟测试的启用仓库');
    const organization = await prisma.hspsi_basic_organization.findFirst({
      where: { org_id: warehouse.org_id, deleted_at: null },
    });
    if (!organization) throw new Error('测试仓库缺少有效组织');
    const category = await prisma.hspsi_goods_info_category.findFirst({
      where: { warehouse_type: warehouse.warehouse_type, deleted_at: null },
      orderBy: { goods_catg_id: 'asc' },
    });
    if (!category) throw new Error('没有与测试仓库类型匹配的商品分类');
    const unit = await prisma.hspsi_basic_unit.findFirst({
      where: { status: 1, deleted_at: null },
      orderBy: { id: 'asc' },
    });
    if (!unit) throw new Error('没有可用于冒烟测试的启用计量单位');

    while (
      (await prisma.hspsi_goods_info.findUnique({ where: { goods_id: goodsId } })) ||
      (await prisma.hspsi_goods_info_sku.findUnique({ where: { sku_id: skuId } }))
    ) {
      goodsId += 2n;
      skuId += 2n;
    }
    while (
      await prisma.hspsi_production_plan.findUnique({ where: { plan_id: productionPlanId } })
    ) {
      productionPlanId += 1n;
    }
    const unitType = Number(unit.id);
    const orgId = warehouse.org_id;
    const warehouseId = warehouse.warehouse_id;
    const batchNo = `${marker}B`.slice(0, 50);

    await prisma.hspsi_goods_info.create({
      data: {
        goods_id: goodsId,
        org_id: orgId,
        query_code: marker,
        goods_name: `${marker}并发校验商品`,
        short_name: marker,
        unit_type: unitType,
        goods_catg_id: category.goods_catg_id,
        supply_type: 2,
        goods_type: 1,
        warehouse_id: warehouseId,
        status: 1,
        remark: marker,
        created_by: 1n,
        updated_by: 1n,
      },
    });
    await prisma.hspsi_goods_info_sku.create({
      data: {
        sku_id: skuId,
        good_id: goodsId,
        spec_models: marker,
        unit_type: unitType,
        is_default: 1,
        status: 1,
        remark: marker,
        created_by: 1n,
        updated_by: 1n,
      },
    });
    await prisma.hspsi_inventory_total.create({
      data: {
        org_id: orgId,
        warehouse_id: warehouseId,
        goods_id: goodsId,
        sku_id: skuId,
        unit_type: unitType,
        input_qty: 10,
        output_qty: 0,
        inventory_qty: 10,
        inventory_amount: new Prisma.Decimal(0),
      },
    });
    await prisma.hspsi_inventory_batch_total.create({
      data: {
        org_id: orgId,
        warehouse_id: warehouseId,
        goods_id: goodsId,
        sku_id: skuId,
        batch_no: batchNo,
        unit_type: unitType,
        input_qty: 10,
        output_qty: 0,
        inventory_qty: 10,
        inventory_amount: new Prisma.Decimal(0),
      },
    });

    await prisma.hspsi_sale_order.create({
      data: {
        so_id: saleOrderId,
        org_id: orgId,
        warehouse_id: warehouseId,
        so_no: `${marker}SO`.slice(0, 20),
        so_type: 1,
        so_source: 4,
        so_source_id: 0n,
        so_property_type: 1,
        customer_id: 0n,
        customer_name: marker,
        customer_mobile: '',
        customer_address: '',
        order_date: new Date(),
        sales_name: marker,
        sales_mobile: '',
        so_qty: 1,
        so_amount: new Prisma.Decimal(1),
        fact_amount: new Prisma.Decimal(1),
        priceoff_amount: new Prisma.Decimal(0),
        order_status: 2,
        delivery_status: 1,
        service_status: 3,
        status: 1,
        approve_status: 1,
        remark: marker,
        created_by: 1n,
        updated_by: 1n,
      },
    });
    await prisma.hspsi_sale_order_detail.create({
      data: {
        so_id: saleOrderId,
        goods_id: goodsId,
        sku_id: skuId,
        unit_type: unitType,
        sale_qty: 1,
        sale_price: new Prisma.Decimal(1),
        sale_amount: new Prisma.Decimal(1),
        fact_sale_amount: new Prisma.Decimal(1),
      },
    });
    const saleOutputs = [];
    for (const index of [1, 2]) {
      const output = await prisma.hspsi_sale_order_output.create({
        data: {
          so_output_no: `${marker}O${index}`.slice(0, 20),
          so_id: saleOrderId,
          org_id: orgId,
          warehouse_id: warehouseId,
          output_date: new Date(),
          go_where: 1,
          dept_id: 0n,
          receiver_id: 1n,
          output_sku_qty: 1,
          status: true,
          comfirm_status: 0,
          comfirm_comment: '',
          comfirm_by: 0n,
          remark: marker,
          created_by: 1n,
          updated_by: 1n,
        },
      });
      await prisma.hspsi_sale_order_output_detail.create({
        data: {
          so_output_id: output.so_output_id,
          so_id: saleOrderId,
          goods_id: goodsId,
          sku_id: skuId,
          batch_no: batchNo,
          unit_type: unitType,
          sale_qty: 1,
          output_qty: 1,
        },
      });
      saleOutputs.push(output);
    }
    const saleConfirmResults = await Promise.allSettled(
      saleOutputs.map((output) =>
        sales.confirmOutput(String(output.so_output_id), marker, actorId),
      ),
    );
    assert.equal(fulfilledCount(saleConfirmResults), 1, '两张占满订单的销售出库只能确认一张');
    const confirmedOutput = await prisma.hspsi_sale_order_output.findFirstOrThrow({
      where: { so_id: saleOrderId, comfirm_status: 1, deleted_at: null },
    });

    const saleReturns = [];
    for (const index of [1, 2]) {
      const saleReturn = await prisma.hspsi_sale_order_exit.create({
        data: {
          so_exit_no: `${marker}R${index}`.slice(0, 20),
          so_id: saleOrderId,
          source_output_id: confirmedOutput.so_output_id,
          exit_reson: marker,
          exit_qty: 1,
          disposal_type: 1,
          org_id: orgId,
          warehouse_id: warehouseId,
          exit_date: new Date(),
          dept_id: 0n,
          receiver_id: 1n,
          customer_id: 0n,
          customer_name: marker,
          customer_mobile: '',
          customer_address: '',
          sales_name: marker,
          sales_mobile: '',
          status: true,
          comfirm_status: 0,
          comfirm_comment: '',
          comfirm_by: 0n,
          remark: marker,
          created_by: 1n,
          updated_by: 1n,
        },
      });
      await prisma.hspsi_sale_order_exit_detail.create({
        data: {
          so_exit_id: saleReturn.so_exit_id,
          so_id: saleOrderId,
          goods_id: goodsId,
          sku_id: skuId,
          batch_no: batchNo,
          unit_type: unitType,
          so_qty: 1,
          exit_qty: 1,
          remark: marker,
        },
      });
      saleReturns.push(saleReturn);
    }
    const saleReturnResults = await Promise.allSettled(
      saleReturns.map((item) => sales.confirmReturn(String(item.so_exit_id), marker, actorId)),
    );
    assert.equal(
      fulfilledCount(saleReturnResults),
      1,
      '同一来源出库的销售退货只能累计确认到来源数量',
    );

    await prisma.hspsi_purchase_order.create({
      data: {
        po_id: purchaseOrderId,
        po_no: `${marker}PO`.slice(0, 30),
        pur_id: 0n,
        org_id: orgId,
        warehouse_id: warehouseId,
        dept_id: 0n,
        receiver_id: 1n,
        vendor_id: 0n,
        pcs_qty: 1,
        arrival_type: 1,
        plan_arrival_date: new Date(),
        delivery_type: 1,
        delivery_no: '',
        arrival_qty: 0,
        is_all_arrival: 0,
        pay_amout: new Prisma.Decimal(1),
        pay_type: 1,
        pay_amount_done: new Prisma.Decimal(0),
        pay_status: 0,
        status: 1,
        approve_status: 1,
        approve_comment: '',
        approve_by: 1n,
        remark: marker,
        created_by: 1n,
        updated_by: 1n,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    await prisma.hspsi_purchase_order_detail.create({
      data: {
        po_id: purchaseOrderId,
        goods_id: goodsId,
        sku_id: skuId,
        qty: 1,
        actual_qty: 0,
        cancel_qty: 0,
        unit_type: unitType,
        unit_price: new Prisma.Decimal(1),
        total_amout: new Prisma.Decimal(1),
        remark: marker,
      },
    });
    const receipts = [];
    for (const index of [1, 2]) {
      const receipt = await prisma.hspsi_purchase_order_input.create({
        data: {
          po_input_no: `${marker}I${index}`.slice(0, 30),
          po_id: purchaseOrderId,
          org_id: orgId,
          warehouse_id: warehouseId,
          dept_id: 0n,
          input_type: 1,
          po_qty: 1,
          input_qty: 1,
          remark: marker,
          receiver_id: 1n,
          comfirm_status: 0,
          comfirm_comment: '',
          created_by: 1n,
          updated_by: 1n,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      await prisma.hspsi_purchase_order_input_detail.create({
        data: {
          po_input_id: receipt.po_input_id,
          batch_no: batchNo,
          po_id: purchaseOrderId,
          goods_id: goodsId,
          sku_id: skuId,
          po_qty: 1,
          input_qty: 1,
          unit_type: unitType,
          input_position: '',
          remark: marker,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      receipts.push(receipt);
    }
    const receiptResults = await Promise.allSettled(
      receipts.map((receipt) =>
        purchase.confirmReceipt(String(receipt.po_input_id), true, marker, actorId),
      ),
    );
    assert.equal(fulfilledCount(receiptResults), 1, '两张占满订单的采购入库只能确认一张');
    const confirmedReceipt = await prisma.hspsi_purchase_order_input.findFirstOrThrow({
      where: { po_id: purchaseOrderId, comfirm_status: 1, deleted_at: null },
    });

    const purchaseReturns = [];
    for (const index of [1, 2]) {
      const item = await prisma.hspsi_purchase_order_input_exit.create({
        data: {
          po_exit_no: `${marker}E${index}`.slice(0, 30),
          po_input_id: confirmedReceipt.po_input_id,
          po_id: purchaseOrderId,
          exit_reson: marker,
          exit_date: new Date(),
          exit_type: 1,
          status: true,
          approve_by: 0n,
          approve_status: 0,
          approve_comment: '',
          remark: marker,
          created_by: 1n,
          updated_by: 1n,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      await prisma.hspsi_purchase_order_input_exit_detail.create({
        data: {
          po_exit_id: item.po_exit_id,
          po_input_id: confirmedReceipt.po_input_id,
          po_id: purchaseOrderId,
          goods_id: goodsId,
          sku_id: skuId,
          batch_no: batchNo,
          unit_type: BigInt(unitType),
          po_qty: 1,
          input_qty: 1,
          exit_qty: 1,
          remark: marker,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      purchaseReturns.push(item);
    }
    const purchaseReturnResults = await Promise.allSettled(
      purchaseReturns.map((item) =>
        purchase.approveReturn(String(item.po_exit_id), true, marker, actorId),
      ),
    );
    assert.equal(
      fulfilledCount(purchaseReturnResults),
      1,
      '同一采购入库的退货只能累计审批到来源数量',
    );

    await prisma.hspsi_production_plan.create({
      data: {
        plan_id: productionPlanId,
        plan_no: `${marker}PP`.slice(0, 30),
        org_id: orgId,
        bom_id: 0n,
        goods_id: goodsId,
        sku_id: skuId,
        plan_qty: 1,
        plan_date: new Date(),
        warehouse_id: warehouseId,
        product_warehouse_id: warehouseId,
        plan_status: 2,
        material_status: 1,
        stock_check_status: 1,
        outbound_status: 0,
        delivered_qty: 0,
        approve_status: 1,
        approve_comment: '',
        approve_by: 1n,
        remark: marker,
        created_by: 1,
        updated_by: 1,
      },
    });
    await prisma.hspsi_production_plan_detail.create({
      data: {
        plan_id: productionPlanId,
        bom_id: 0n,
        goods_id: goodsId,
        sku_id: skuId,
        bom_unit_qty: 1,
        standard_qty: 1,
        require_qty: 1,
        plan_out_qty: 1,
        unit_type: unitType,
        remark: marker,
      },
    });
    const productionBody = {
      planId: String(productionPlanId),
      outType: 1,
      outDate: new Date().toISOString(),
      details: [
        {
          goodsId: String(goodsId),
          skuId: String(skuId),
          unitType,
          quantity: 1,
          batchNo,
          remark: marker,
        },
      ],
      remark: marker,
    };
    const productionResults = await Promise.allSettled([
      production.saveOutputChecked(null, productionBody, actorId),
      production.saveOutputChecked(null, productionBody, actorId),
    ]);
    assert.equal(
      fulfilledCount(productionResults),
      1,
      '同一生产计划只能并发创建一张正式 BOM 出库单',
    );

    const finalStock = await prisma.hspsi_inventory_batch_total.findUniqueOrThrow({
      where: {
        goods_id_sku_id_warehouse_id_batch_no: {
          goods_id: goodsId,
          sku_id: skuId,
          warehouse_id: warehouseId,
          batch_no: batchNo,
        },
      },
    });
    assert.equal(
      Number(finalStock.inventory_qty),
      10,
      '销售与采购出退库守卫完成后测试库存应回到初始数量',
    );
    console.log('PASS: sales, purchase and production concurrent quantity guards');
  } finally {
    try {
      await prisma.$transaction(async (tx) => {
        const saleOutputs = await tx.hspsi_sale_order_output.findMany({
          where: { so_id: saleOrderId },
          select: { so_output_id: true },
        });
        const saleReturns = await tx.hspsi_sale_order_exit.findMany({
          where: { so_id: saleOrderId },
          select: { so_exit_id: true },
        });
        const receipts = await tx.hspsi_purchase_order_input.findMany({
          where: { po_id: purchaseOrderId },
          select: { po_input_id: true },
        });
        const purchaseReturns = await tx.hspsi_purchase_order_input_exit.findMany({
          where: { po_id: purchaseOrderId },
          select: { po_exit_id: true },
        });
        const productionOutputs = await tx.hspsi_production_material_out.findMany({
          where: { plan_id: Number(productionPlanId) },
          select: { out_id: true },
        });

        await tx.hspsi_business_document_relation.deleteMany({
          where: {
            OR: [
              { upstream_no: { startsWith: marker } },
              { downstream_no: { startsWith: marker } },
            ],
          },
        });
        await tx.hspsi_inventory_total_detail.deleteMany({ where: { goods_id: goodsId } });
        if (saleReturns.length)
          await tx.hspsi_sale_order_exit_detail.deleteMany({
            where: { so_exit_id: { in: saleReturns.map((item) => item.so_exit_id) } },
          });
        await tx.hspsi_sale_order_exit.deleteMany({ where: { so_id: saleOrderId } });
        if (saleOutputs.length)
          await tx.hspsi_sale_order_output_detail.deleteMany({
            where: { so_output_id: { in: saleOutputs.map((item) => item.so_output_id) } },
          });
        await tx.hspsi_sale_order_output.deleteMany({ where: { so_id: saleOrderId } });
        await tx.hspsi_sale_order_service.deleteMany({ where: { so_id: saleOrderId } });
        await tx.hspsi_sale_order_detail.deleteMany({ where: { so_id: saleOrderId } });
        await tx.hspsi_sale_order.deleteMany({ where: { so_id: saleOrderId } });

        if (purchaseReturns.length)
          await tx.hspsi_purchase_order_input_exit_detail.deleteMany({
            where: { po_exit_id: { in: purchaseReturns.map((item) => item.po_exit_id) } },
          });
        await tx.hspsi_purchase_order_input_exit.deleteMany({ where: { po_id: purchaseOrderId } });
        if (receipts.length)
          await tx.hspsi_purchase_order_input_detail.deleteMany({
            where: { po_input_id: { in: receipts.map((item) => item.po_input_id) } },
          });
        await tx.hspsi_purchase_order_input.deleteMany({ where: { po_id: purchaseOrderId } });
        await tx.hspsi_purchase_order_detail.deleteMany({ where: { po_id: purchaseOrderId } });
        await tx.hspsi_purchase_order.deleteMany({ where: { po_id: purchaseOrderId } });

        if (productionOutputs.length)
          await tx.hspsi_production_material_out_detail.deleteMany({
            where: { out_id: { in: productionOutputs.map((item) => item.out_id) } },
          });
        await tx.hspsi_production_material_out.deleteMany({
          where: { plan_id: Number(productionPlanId) },
        });
        await tx.hspsi_production_plan_detail.deleteMany({ where: { plan_id: productionPlanId } });
        await tx.hspsi_production_plan.deleteMany({ where: { plan_id: productionPlanId } });

        await tx.hspsi_inventory_batch_total.deleteMany({
          where: { goods_id: goodsId, sku_id: skuId },
        });
        await tx.hspsi_inventory_total.deleteMany({ where: { goods_id: goodsId, sku_id: skuId } });
        await tx.hspsi_goods_info_sku.deleteMany({ where: { sku_id: skuId } });
        await tx.hspsi_goods_info.deleteMany({ where: { goods_id: goodsId } });
      });
    } finally {
      await context.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
