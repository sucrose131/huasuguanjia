import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { AppModule } from '../app.module';
import { BaseDataService } from '../base-data/base-data.service';
import { GoodsService } from '../goods/goods.service';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../database/prisma.service';
import { ProductionService } from '../production/production.service';
import { PurchaseService } from '../purchase/purchase.service';
import { RequisitionService } from '../requisition/requisition.service';
import { SalesService } from '../sales/sales.service';

const envFile = existsSync('.env') ? '.env' : 'apps/api/.env';
process.loadEnvFile?.(envFile);

const runTag = process.env.DEMO_CHAIN_TAG ?? 'REAL-CHAIN-20260731-A';
const actorId = '1';
const orgId = 9n;
const deptId = 11n;
const finishedWarehouseId = 1n;
const transferWarehouseId = 2n;
const today = '2026-07-31';

function json(value: unknown) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
    2,
  );
}

async function main() {
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = context.get(PrismaService);
  const base = context.get(BaseDataService);
  const goodsService = context.get(GoodsService);
  const purchase = context.get(PurchaseService);
  const production = context.get(ProductionService);
  const sales = context.get(SalesService);
  const inventory = context.get(InventoryService);
  const requisitions = context.get(RequisitionService);

  const result: Record<string, unknown> = { runTag };
  const step = async <T>(name: string, action: () => Promise<T>) => {
    process.stdout.write(`[${name}] `);
    try {
      const value = await action();
      process.stdout.write('OK\n');
      return value;
    } catch (error) {
      process.stdout.write('FAILED\n');
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      throw new Error(`${name}：${message}`, { cause: error });
    }
  };

  try {
    const actor = await prisma.hspsi_sys_user.findFirst({
      where: { id: BigInt(actorId), status: 1, deleted_at: null },
    });
    if (!actor) throw new Error('系统用户 1 不存在或未启用');

    const rawWarehouse = await step('主数据-原料仓库', async () => {
      const name = '华溯全链路原料仓';
      const existing = await prisma.hspsi_basic_warehouse.findFirst({
        where: { org_id: orgId, name, deleted_at: null },
      });
      if (existing) return existing;
      const created = await base.create(
        'warehouses',
        {
          orgId: orgId.toString(),
          deptId: deptId.toString(),
          name,
          warehouseType: 2,
          address: '深圳市龙岗区华溯智能制造基地A栋原料区',
          managerName: '周启航',
          contactPhone: '13800138021',
          status: 1,
          sort: 1,
          remark: '正式业务路演全链路原料仓',
        },
        actorId,
      );
      return prisma.hspsi_basic_warehouse.findUniqueOrThrow({
        where: { warehouse_id: BigInt(created.id) },
      });
    });

    const vendor = await step('主数据-供应商', async () => {
      const queryCode = 'QCLYL';
      const existing = await prisma.hspsi_basic_vendor.findFirst({
        where: { query_code: queryCode, deleted_at: null },
      });
      if (existing) return existing;
      const created = await base.create(
        'vendors',
        {
          queryCode,
          companyName: '深圳前程医疗原料有限公司',
          shortName: '前程原料',
          saleContact: '陈卓',
          saleTel: '13800138022',
          saleEmail: 'sales@qiancheng-med.example',
          serviceContact: '许文静',
          serviceTel: '13800138023',
          address: '深圳市坪山区生物医药产业园6号楼',
          remark: '医疗康复产品原辅料长期供应商',
        },
        actorId,
      );
      return prisma.hspsi_basic_vendor.findUniqueOrThrow({
        where: { vendor_id: BigInt(created.id) },
      });
    });

    const customer = await step('主数据-客户', async () => {
      const name = '深圳市康宁康复中心';
      const existing = await prisma.hspsi_basic_customer.findFirst({
        where: { org_id: orgId, name, deleted_at: null },
      });
      if (existing) return existing;
      const created = await base.create(
        'customers',
        {
          orgId: orgId.toString(),
          name,
          gender: 0,
          birthday: '1990-01-01',
          mobile: '13800138025',
          address: '深圳市南山区科技园康复大厦',
          referrerName: '林雅雯',
          referrerMobile: '13800138026',
          sourceType: 1,
          relatedCustomerId: 0,
          status: 1,
          sort: 1,
          remark: '机构客户，年度康复器材采购',
        },
        actorId,
      );
      return prisma.hspsi_basic_customer.findUniqueOrThrow({
        where: { customer_id: BigInt(created.id) },
      });
    });

    const ensureGoods = async (definition: {
      code: string;
      name: string;
      shortName: string;
      spec: string;
      unitType: number;
      categoryId: number;
      supplyType: number;
      goodsType: number;
      costPrice: number;
      salePrice: number;
      vendorId: bigint;
      warehouseId: bigint;
      alertQty: number;
    }) => {
      let goods = await prisma.hspsi_goods_info.findFirst({
        where: { query_code: definition.code, deleted_at: null },
      });
      if (!goods) {
        const created = await goodsService.save(
          null,
          {
            orgId: orgId.toString(),
            queryCode: definition.code,
            goodsName: definition.name,
            shortName: definition.shortName,
            brandName: '华溯医疗',
            specModels: definition.spec,
            unitType: definition.unitType,
            categoryId: definition.categoryId,
            supplyType: definition.supplyType,
            goodsType: definition.goodsType,
            costPrice: definition.costPrice,
            salePrice: definition.salePrice,
            vendorId: definition.vendorId.toString(),
            warehouseId: definition.warehouseId.toString(),
            status: 1,
            sort: 1,
            remark: `${runTag} 主数据`,
            isAlertPeriod: 1,
            alertQty: definition.alertQty,
            skus: [
              {
                specModels: definition.spec,
                pcsQty: 1,
                costPrice: definition.costPrice,
                salePrice: definition.salePrice,
                unitType: definition.unitType,
                isDefault: 1,
                status: 1,
                sort: 1,
                isAlertPeriod: 1,
                alertQty: definition.alertQty,
                remark: '默认业务规格',
              },
            ],
          },
          actorId,
        );
        goods = await prisma.hspsi_goods_info.findUniqueOrThrow({
          where: { goods_id: BigInt(created.id) },
        });
      }
      const sku = await prisma.hspsi_goods_info_sku.findFirstOrThrow({
        where: { good_id: goods.goods_id, deleted_at: null },
        orderBy: [{ is_default: 'desc' }, { sku_id: 'asc' }],
      });
      return { goods, sku };
    };

    const rawA = await step('主数据-原料A', () =>
      ensureGoods({
        code: `YL-A-${runTag.slice(-12)}`,
        name: '医用级天然乳胶原片',
        shortName: '乳胶原片',
        spec: '25kg/袋，医用级',
        unitType: 18,
        categoryId: 5,
        supplyType: 2,
        goodsType: 2,
        costPrice: 48,
        salePrice: 58,
        vendorId: vendor.vendor_id,
        warehouseId: rawWarehouse.warehouse_id,
        alertQty: 30,
      }),
    );
    const rawB = await step('主数据-原料B', () =>
      ensureGoods({
        code: `YL-B-${runTag.slice(-12)}`,
        name: '环保防滑织物套',
        shortName: '防滑织物套',
        spec: '中号，蓝色，100只/箱',
        unitType: 2,
        categoryId: 5,
        supplyType: 2,
        goodsType: 2,
        costPrice: 32,
        salePrice: 42,
        vendorId: vendor.vendor_id,
        warehouseId: rawWarehouse.warehouse_id,
        alertQty: 20,
      }),
    );
    const finished = await step('主数据-成品', () =>
      ensureGoods({
        code: `CP-${runTag.slice(-12)}`,
        name: '华溯康复训练拉力套装',
        shortName: '康复拉力套装',
        spec: '中阻力/蓝色/含收纳袋',
        unitType: 7,
        categoryId: 1,
        supplyType: 1,
        goodsType: 1,
        costPrice: 128,
        salePrice: 1280,
        vendorId: 0n,
        warehouseId: finishedWarehouseId,
        alertQty: 10,
      }),
    );

    const bom = await step('生产-BOM', async () => {
      const name = `康复拉力套装标准BOM-${runTag}`;
      const existing = await prisma.hspsi_production_bom.findFirst({
        where: { bom_name: name, deleted_at: null },
      });
      if (existing) return existing;
      const created = await production.saveBomChecked(
        null,
        {
          bomName: name,
          goodsId: finished.goods.goods_id.toString(),
          skuId: finished.sku.sku_id.toString(),
          warehouseId: rawWarehouse.warehouse_id.toString(),
          orgId: orgId.toString(),
          status: 1,
          sort: 1,
          remark: `${runTag} 标准BOM：每套2kg乳胶原片、1个织物套`,
          details: [
            {
              goodsId: rawA.goods.goods_id.toString(),
              skuId: rawA.sku.sku_id.toString(),
              quantity: 2,
              unitType: rawA.sku.unit_type,
              remark: '主体弹性材料',
            },
            {
              goodsId: rawB.goods.goods_id.toString(),
              skuId: rawB.sku.sku_id.toString(),
              quantity: 1,
              unitType: rawB.sku.unit_type,
              remark: '防滑保护套',
            },
          ],
        },
        actorId,
      );
      return prisma.hspsi_production_bom.findUniqueOrThrow({
        where: { bom_id: BigInt(created.id) },
      });
    });

    const salesOrder = await step('销售-订单', async () => {
      const existing = await prisma.hspsi_sale_order.findFirst({
        where: { remark: runTag, so_property_type: 1, deleted_at: null },
        orderBy: { so_id: 'desc' },
      });
      if (existing) {
        if (existing.approve_status === 0) {
          await sales.approveOrder(String(existing.so_id), true, '客户合同及价格审批通过', actorId);
        }
        return prisma.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: existing.so_id } });
      }
      const created = await sales.saveOrder(
        null,
        {
          orgId: orgId.toString(),
          warehouseId: finishedWarehouseId.toString(),
          orderType: 1,
          sourceType: 1,
          sourceId: 0,
          customerId: customer.customer_id.toString(),
          customerMobile: customer.mobile,
          customerAddress: customer.address,
          orderDate: today,
          salesName: '林雅雯',
          salesMobile: '13800138026',
          remark: runTag,
          details: [
            {
              goodsId: finished.goods.goods_id.toString(),
              skuId: finished.sku.sku_id.toString(),
              unitType: finished.sku.unit_type,
              quantity: 10,
              price: 1280,
              factAmount: 12800,
            },
          ],
        },
        actorId,
        1,
      );
      await sales.approveOrder(String(created.id), true, '客户合同及价格审批通过', actorId);
      return prisma.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: BigInt(created.id) } });
    });

    const plan = await step('销售缺口-生产计划', async () => {
      let created = await prisma.hspsi_production_plan.findFirst({
        where: {
          source_type: 'sales_order',
          source_id: salesOrder.so_id,
          goods_id: finished.goods.goods_id,
          deleted_at: null,
        },
        orderBy: { plan_id: 'desc' },
      });
      if (!created) {
        await sales.analyze(String(salesOrder.so_id), actorId);
        created = await prisma.hspsi_production_plan.findFirstOrThrow({
          where: {
            source_type: 'sales_order',
            source_id: salesOrder.so_id,
            goods_id: finished.goods.goods_id,
            deleted_at: null,
          },
          orderBy: { plan_id: 'desc' },
        });
      }
      if (created.plan_status === 1 && created.approve_status === 0) {
        await production.approvePlan(
          String(created.plan_id),
          true,
          '销售订单缺口生产计划审批通过',
          actorId,
        );
      }
      return prisma.hspsi_production_plan.findUniqueOrThrow({
        where: { plan_id: created.plan_id },
      });
    });

    const purchaseApplication = await step('生产缺料-采购申请', async () => {
      const existing = await prisma.hspsi_purchase_approve.findFirst({
        where: { source_type: 'production_plan', source_id: plan.plan_id, deleted_at: null },
        orderBy: { pur_id: 'desc' },
      });
      if (existing) return existing;
      throw new Error('缺料生产计划未自动生成采购申请');
    });

    const purchaseOrder = await step('采购申请-采购订单', async () => {
      const existing = await prisma.hspsi_purchase_order.findFirst({
        where: { pur_id: purchaseApplication.pur_id, deleted_at: null },
        orderBy: { po_id: 'desc' },
      });
      if (existing) return existing;
      await purchase.approveApplication(
        String(purchaseApplication.pur_id),
        true,
        '生产缺料采购审批通过',
        actorId,
      );
      const applicationLines = await prisma.hspsi_purchase_approve_detail.findMany({
        where: { pur_id: purchaseApplication.pur_id },
      });
      const generated = await purchase.generateApplicationOrder(
        String(purchaseApplication.pur_id),
        {
          generationMode: 'all',
          vendorId: vendor.vendor_id.toString(),
          details: applicationLines.map((line) => ({
            applicationDetailId: line.id.toString(),
            totalAmount: Math.max(1, Number(line.reference_price) * line.qty),
          })),
        },
        actorId,
      );
      return prisma.hspsi_purchase_order.findUniqueOrThrow({
        where: { po_id: BigInt(generated.id) },
      });
    });

    await step('采购订单-开始采购', async () => {
      const current = await prisma.hspsi_purchase_order.findUniqueOrThrow({
        where: { po_id: purchaseOrder.po_id },
      });
      if (current.status !== 1) return current;
      if (current.vendor_id <= 0n) {
        await prisma.hspsi_purchase_order.update({
          where: { po_id: current.po_id },
          data: { vendor_id: vendor.vendor_id },
        });
      }
      await purchase.startOrder(String(current.po_id), actorId);
      return prisma.hspsi_purchase_order.findUniqueOrThrow({ where: { po_id: current.po_id } });
    });

    const rawBatchA = `PC-A-${runTag.slice(-8)}`;
    const rawBatchB = `PC-B-${runTag.slice(-8)}`;
    const receipt = await step('采购订单-采购入库', async () => {
      const existing = await prisma.hspsi_purchase_order_input.findFirst({
        where: { po_id: purchaseOrder.po_id, comfirm_status: 1, deleted_at: null },
        orderBy: { po_input_id: 'desc' },
      });
      if (existing) return existing;
      const generated = await purchase.generateReceipt(String(purchaseOrder.po_id), actorId);
      const draft = await purchase.receipt(String(generated.id));
      await purchase.saveReceipt(
        String(generated.id),
        {
          orderId: purchaseOrder.po_id.toString(),
          deptId: deptId.toString(),
          receiverId: actorId,
          inputType: 1,
          remark: `${runTag} 原料质检合格入库`,
          details: draft.details.map((line: Record<string, unknown>) => ({
            ...line,
            inputQuantity: Number(line.inputQuantity),
            batchNo: String(line.goodsId) === String(rawA.goods.goods_id) ? rawBatchA : rawBatchB,
            position: 'A-01-01',
            productionDate: '2026-07-20',
            validityPeriod: '2027-07-19',
            arrivalDate: today,
            remark: '随货检验合格',
          })),
        },
        actorId,
      );
      await purchase.confirmReceipt(
        String(generated.id),
        true,
        '采购入库确认，原料库存增加',
        actorId,
      );
      return prisma.hspsi_purchase_order_input.findUniqueOrThrow({
        where: { po_input_id: BigInt(generated.id) },
      });
    });

    const payment = await step('采购-付款', async () => {
      const existing = await prisma.hspsi_purchase_order_payment.findFirst({
        where: {
          po_id: purchaseOrder.po_id,
          remark: `${runTag} 原料货款银行转账`,
          deleted_at: null,
        },
        orderBy: { pay_id: 'desc' },
      });
      if (existing) return { id: existing.pay_id };
      const detail = await purchase.order(String(purchaseOrder.po_id));
      return purchase.savePayment(
        null,
        {
          orderId: purchaseOrder.po_id.toString(),
          deptId: deptId.toString(),
          paymentAmount: Number(detail.totalAmount),
          paymentChannel: 1,
          paymentDate: today,
          remark: `${runTag} 原料货款银行转账`,
        },
        actorId,
      );
    });

    await step('生产-补料重校与审批', async () => {
      let current = await prisma.hspsi_production_plan.findUniqueOrThrow({
        where: { plan_id: plan.plan_id },
      });
      if (current.plan_status === 7 && current.material_status === 4) {
        await production.recheckPlan(String(plan.plan_id), actorId);
        current = await prisma.hspsi_production_plan.findUniqueOrThrow({
          where: { plan_id: plan.plan_id },
        });
      }
      if (current.plan_status === 1 && current.approve_status === 0) {
        await production.approvePlan(
          String(plan.plan_id),
          true,
          '缺料补齐后生产计划审批通过',
          actorId,
        );
      }
      return production.plan(String(plan.plan_id));
    });

    const formalOutput = await step('生产-BOM领料出库', async () => {
      const currentPlan = await production.plan(String(plan.plan_id));
      const details = currentPlan.details.map((line: Record<string, unknown>) => ({
        goodsId: String(line.goodsId),
        skuId: String(line.skuId),
        unitType: Number(line.unitType),
        quantity: Number(line.planOutQty),
        batchNo: String(line.goodsId) === String(rawA.goods.goods_id) ? rawBatchA : rawBatchB,
        remark: '按BOM正式领料',
      }));
      let output = await prisma.hspsi_production_material_out.findFirst({
        where: { plan_id: plan.plan_id, out_type: 1, deleted_at: null },
        orderBy: { out_id: 'desc' },
      });
      if (!output) {
        const created = await production.saveOutputChecked(
          null,
          {
            planId: plan.plan_id.toString(),
            outType: 1,
            outDate: today,
            remark: `${runTag} BOM正式领料`,
            details,
          },
          actorId,
        );
        output = await prisma.hspsi_production_material_out.findUniqueOrThrow({
          where: { out_id: Number(created.id) },
        });
      }
      if (output.confirm_tag === 0) {
        await production.confirmOutput(
          String(output.out_id),
          {
            comment: 'BOM物料按批次正式出库',
            details,
          },
          actorId,
        );
      }
      return prisma.hspsi_production_material_out.findUniqueOrThrow({
        where: { out_id: output.out_id },
      });
    });

    const finishedBatch = `FG-${runTag.slice(-8)}`;
    const productionInput = await step('生产-成品入库', async () => {
      const existing = await prisma.hspsi_production_plan_input.findFirst({
        where: { plan_id: plan.plan_id, deleted_at: null },
        orderBy: { id: 'desc' },
      });
      if (existing) return existing;
      const created = await production.createInputChecked(
        {
          planId: plan.plan_id.toString(),
          warehouseId: finishedWarehouseId.toString(),
          quantity: 10,
          batchNo: finishedBatch,
          inputDate: today,
          productDate: today,
          validityPeriod: '2028-07-30',
          position: 'CP-A-01',
          remark: `${runTag} 完工检验合格`,
        },
        actorId,
      );
      return prisma.hspsi_production_plan_input.findUniqueOrThrow({
        where: { id: BigInt(created.id) },
      });
    });

    const salesOutput = await step('销售-成品出库', async () => {
      const existing = await prisma.hspsi_sale_order_output.findFirst({
        where: { so_id: salesOrder.so_id, deleted_at: null },
        orderBy: { so_output_id: 'desc' },
      });
      if (existing) {
        if (existing.comfirm_status === 0) {
          await sales.confirmOutput(
            String(existing.so_output_id),
            '客户订单整单出库并交付物流',
            actorId,
          );
        }
        return prisma.hspsi_sale_order_output.findUniqueOrThrow({
          where: { so_output_id: existing.so_output_id },
        });
      }
      const created = await sales.saveOutput(
        null,
        {
          orderId: salesOrder.so_id.toString(),
          orgId: orgId.toString(),
          warehouseId: finishedWarehouseId.toString(),
          deptId: deptId.toString(),
          receiverId: actorId,
          outputDate: today,
          destination: 1,
          remark: `${runTag} 客户订单发货`,
          details: [
            {
              goodsId: finished.goods.goods_id.toString(),
              skuId: finished.sku.sku_id.toString(),
              batchNo: finishedBatch,
              unitType: finished.sku.unit_type,
              orderQty: 10,
              quantity: 10,
            },
          ],
        },
        actorId,
      );
      await sales.confirmOutput(String(created.id), '客户订单整单出库并交付物流', actorId);
      return prisma.hspsi_sale_order_output.findUniqueOrThrow({
        where: { so_output_id: BigInt(created.id) },
      });
    });

    const salesPayment = await step('销售-收款', () =>
      sales.createPayment(
        {
          orderId: salesOrder.so_id.toString(),
          deptId: deptId.toString(),
          paymentMode: 1,
          paymentDate: today,
          amount: 12800,
          requestKey: `${runTag}:PAYMENT`,
          remark: '客户合同款已到账',
        },
        1,
        actorId,
      ),
    );

    const salesRefund = await step('销售-退款', () =>
      sales.createPayment(
        {
          orderId: salesOrder.so_id.toString(),
          deptId: deptId.toString(),
          paymentMode: 1,
          paymentDate: today,
          amount: 800,
          requestKey: `${runTag}:REFUND`,
          remark: '客户价格复核后退回差额',
        },
        2,
        actorId,
      ),
    );

    const salesReturn = await step('销售-退货及折价后继', async () => {
      const existing = await prisma.hspsi_sale_order_exit.findFirst({
        where: {
          so_id: salesOrder.so_id,
          remark: `${runTag} 退货返库后转折价销售`,
          deleted_at: null,
        },
        orderBy: { so_exit_id: 'desc' },
      });
      if (existing) {
        if (existing.comfirm_status === 0) {
          await sales.confirmReturn(
            String(existing.so_exit_id),
            '退货验收通过，返库并生成折价销售单',
            actorId,
          );
        }
        const successor = await prisma.hspsi_sale_order.findFirstOrThrow({
          where: {
            business_source_type: 'sales_return',
            business_source_id: existing.so_exit_id,
            so_property_type: 2,
            deleted_at: null,
          },
        });
        return { return: existing, discountOrderId: successor.so_id };
      }
      const created = await sales.saveReturn(
        null,
        {
          orderId: salesOrder.so_id.toString(),
          sourceOutputId: salesOutput.so_output_id.toString(),
          warehouseId: finishedWarehouseId.toString(),
          deptId: deptId.toString(),
          receiverId: actorId,
          reason: '客户试用后外包装轻微磨损，功能完好',
          disposalType: 3,
          returnDate: today,
          remark: `${runTag} 退货返库后转折价销售`,
          details: [
            {
              goodsId: finished.goods.goods_id.toString(),
              skuId: finished.sku.sku_id.toString(),
              batchNo: finishedBatch,
              unitType: finished.sku.unit_type,
              orderQty: 10,
              quantity: 1,
              remark: '外包装轻微磨损',
            },
          ],
        },
        actorId,
      );
      const confirmed = (await sales.confirmReturn(
        String(created.id),
        '退货验收通过，返库并生成折价销售单',
        actorId,
      )) as Record<string, unknown>;
      if (!confirmed.successorId) throw new Error('销售退货确认后未生成折价销售单');
      return {
        return: await prisma.hspsi_sale_order_exit.findUniqueOrThrow({
          where: { so_exit_id: BigInt(created.id) },
        }),
        discountOrderId: BigInt(String(confirmed.successorId)),
      };
    });

    const discountOrder = await step('销售-折价销售单', async () => {
      const current = await prisma.hspsi_sale_order.findUniqueOrThrow({
        where: { so_id: salesReturn.discountOrderId },
      });
      if (current.approve_status === 0) {
        await sales.approveOrder(
          String(salesReturn.discountOrderId),
          true,
          '折价销售处置方案审批通过',
          actorId,
        );
      }
      return prisma.hspsi_sale_order.findUniqueOrThrow({
        where: { so_id: salesReturn.discountOrderId },
      });
    });

    const service = await step('销售-售后记录', async () => {
      const existing = await prisma.hspsi_sale_order_service.findFirst({
        where: { so_id: salesOrder.so_id, remark: `${runTag} 客户回访记录`, deleted_at: null },
        orderBy: { service_id: 'desc' },
      });
      if (existing) return existing;
      const created = await sales.saveService(
        null,
        {
          orderId: salesOrder.so_id.toString(),
          goodsId: finished.goods.goods_id.toString(),
          skuId: finished.sku.sku_id.toString(),
          eventType: 1,
          eventContent: '客户回访：已完成产品使用指导，满意度良好',
          eventStatus: 2,
          handlerId: actorId,
          eventDate: today,
          remark: `${runTag} 客户回访记录`,
        },
        actorId,
      );
      return prisma.hspsi_sale_order_service.findUniqueOrThrow({
        where: { service_id: BigInt(created.id) },
      });
    });

    const extraRawBatch = `PC-EXTRA-${runTag.slice(-8)}`;
    const extraReceipt = await step('采购-临时入库', async () => {
      const existing = await prisma.hspsi_purchase_order_input.findFirst({
        where: { remark: `${runTag} 临时补充安全库存`, deleted_at: null },
        orderBy: { po_input_id: 'desc' },
      });
      if (existing) {
        if (existing.comfirm_status === 0) {
          await purchase.confirmReceipt(
            String(existing.po_input_id),
            true,
            '临时采购入库确认',
            actorId,
          );
        }
        return prisma.hspsi_purchase_order_input.findUniqueOrThrow({
          where: { po_input_id: existing.po_input_id },
        });
      }
      const created = await purchase.saveReceipt(
        null,
        {
          orderId: '',
          orgId: orgId.toString(),
          warehouseId: rawWarehouse.warehouse_id.toString(),
          vendorId: vendor.vendor_id.toString(),
          deptId: deptId.toString(),
          receiverId: actorId,
          inputType: 2,
          remark: `${runTag} 临时补充安全库存`,
          details: [
            {
              goodsId: rawA.goods.goods_id.toString(),
              skuId: rawA.sku.sku_id.toString(),
              inputQuantity: 5,
              unitType: rawA.sku.unit_type,
              unitPrice: 48,
              batchNo: extraRawBatch,
              position: 'A-02-01',
              productionDate: '2026-07-25',
              validityPeriod: '2026-08-20',
              arrivalDate: today,
              remark: '临时安全库存补货',
            },
          ],
        },
        actorId,
      );
      await purchase.confirmReceipt(String(created.id), true, '临时采购入库确认', actorId);
      return prisma.hspsi_purchase_order_input.findUniqueOrThrow({
        where: { po_input_id: BigInt(created.id) },
      });
    });

    const purchaseReturn = await step('采购-退货', async () => {
      const existing = await prisma.hspsi_purchase_order_input_exit.findFirst({
        where: {
          po_input_id: extraReceipt.po_input_id,
          remark: `${runTag} 采购退货`,
          deleted_at: null,
        },
        orderBy: { po_exit_id: 'desc' },
      });
      if (existing) {
        if (!existing.status) await purchase.submitReturn(String(existing.po_exit_id), actorId);
        const current = await prisma.hspsi_purchase_order_input_exit.findUniqueOrThrow({
          where: { po_exit_id: existing.po_exit_id },
        });
        if (current.approve_status === 0) {
          await purchase.approveReturn(
            String(current.po_exit_id),
            true,
            '供应商已确认换货，退货审批通过',
            actorId,
          );
        }
        return prisma.hspsi_purchase_order_input_exit.findUniqueOrThrow({
          where: { po_exit_id: current.po_exit_id },
        });
      }
      const created = await purchase.saveReturn(
        null,
        {
          receiptId: extraReceipt.po_input_id.toString(),
          reason: '抽检发现外包装破损，退回供应商换货',
          returnDate: today,
          returnType: 1,
          remark: `${runTag} 采购退货`,
          details: [
            {
              goodsId: rawA.goods.goods_id.toString(),
              skuId: rawA.sku.sku_id.toString(),
              batchNo: extraRawBatch,
              unitType: rawA.sku.unit_type,
              orderQuantity: 5,
              inputQuantity: 5,
              returnQuantity: 1,
              remark: '外包装破损',
            },
          ],
        },
        actorId,
        false,
      );
      await purchase.submitReturn(String(created.id), actorId);
      await purchase.approveReturn(
        String(created.id),
        true,
        '供应商已确认换货，退货审批通过',
        actorId,
      );
      return prisma.hspsi_purchase_order_input_exit.findUniqueOrThrow({
        where: { po_exit_id: BigInt(created.id) },
      });
    });

    const transfer = await step('库存-调拨', async () => {
      const existing = await prisma.hspsi_inventory_transfer.findFirst({
        where: { remark: `${runTag} 成品调拨`, deleted_at: null },
        orderBy: { transfer_id: 'desc' },
      });
      if (existing) {
        if (existing.status === 1 && existing.approve_status === 0) {
          await inventory.approveTransfer(
            String(existing.transfer_id),
            true,
            '调拨审批通过并双边过账',
            actorId,
          );
        }
        return prisma.hspsi_inventory_transfer.findUniqueOrThrow({
          where: { transfer_id: existing.transfer_id },
        });
      }
      const created = await inventory.saveTransfer(
        null,
        {
          orgId: orgId.toString(),
          warehouseId: finishedWarehouseId.toString(),
          toOrgId: orgId.toString(),
          toWarehouseId: transferWarehouseId.toString(),
          reason: '路演样品调拨至虚拟展厅仓',
          transferDate: today,
          sendBy: actorId,
          receiveBy: actorId,
          remark: `${runTag} 成品调拨`,
          details: [
            {
              goodsId: finished.goods.goods_id.toString(),
              skuId: finished.sku.sku_id.toString(),
              batchNo: finishedBatch,
              unitType: finished.sku.unit_type,
              quantity: 1,
            },
          ],
        },
        actorId,
        true,
      );
      await inventory.approveTransfer(String(created.id), true, '调拨审批通过并双边过账', actorId);
      return prisma.hspsi_inventory_transfer.findUniqueOrThrow({
        where: { transfer_id: BigInt(created.id) },
      });
    });

    const adjustment = await step('库存-调整', async () => {
      const existing = await prisma.hspsi_inventory_adjust.findFirst({
        where: { remark: `${runTag} 库存调整`, deleted_at: null },
        orderBy: { adjust_id: 'desc' },
      });
      if (existing) {
        if (existing.status === 1 && existing.approve_status === 0) {
          await inventory.approveAdjustment(
            String(existing.adjust_id),
            true,
            '调整依据完整，审批过账',
            actorId,
          );
        }
        return prisma.hspsi_inventory_adjust.findUniqueOrThrow({
          where: { adjust_id: existing.adjust_id },
        });
      }
      const created = await inventory.saveAdjustment(
        null,
        {
          reason: '展厅仓开箱复核补记赠品套装',
          applicantDate: today,
          remark: `${runTag} 库存调整`,
          details: [
            {
              goodsId: finished.goods.goods_id.toString(),
              skuId: finished.sku.sku_id.toString(),
              warehouseId: transferWarehouseId.toString(),
              batchNo: finishedBatch,
              adjustType: 1,
              quantity: 2,
              remark: '盘前账面补记',
            },
          ],
        },
        actorId,
        true,
      );
      await inventory.approveAdjustment(
        String(created.id),
        true,
        '调整依据完整，审批过账',
        actorId,
      );
      return prisma.hspsi_inventory_adjust.findUniqueOrThrow({
        where: { adjust_id: BigInt(created.id) },
      });
    });

    const check = await step('库存-盘点', async () => {
      const existing = await prisma.hspsi_inventory_check.findFirst({
        where: { remark: `${runTag} 展厅仓例行盘点`, deleted_at: null },
        orderBy: { check_id: 'desc' },
      });
      if (existing) return existing;
      const created = await inventory.createCheck(
        {
          orgId: orgId.toString(),
          warehouseId: transferWarehouseId.toString(),
          checkType: 1,
          checkDate: today,
          remark: `${runTag} 展厅仓例行盘点`,
        },
        actorId,
      );
      return prisma.hspsi_inventory_check.findUniqueOrThrow({
        where: { check_id: BigInt(created.id) },
      });
    });

    const overflow = await step('库存-报盈及入库', async () => {
      const existing = await prisma.hspsi_inventory_overflow.findFirst({
        where: { remark: `${runTag} 手工报盈`, deleted_at: null },
        orderBy: { overflow_id: 'desc' },
      });
      if (existing) {
        if (existing.approve_status === 0) {
          await inventory.approveDocument(
            'overflow',
            String(existing.overflow_id),
            true,
            '报盈依据核实，自动入库',
            actorId,
          );
        }
        return prisma.hspsi_inventory_overflow.findUniqueOrThrow({
          where: { overflow_id: existing.overflow_id },
        });
      }
      const created = await inventory.saveDocument(
        'overflow',
        null,
        {
          orgId: orgId.toString(),
          warehouseId: transferWarehouseId.toString(),
          deptId: deptId.toString(),
          sourceCheckId: 0,
          documentType: 1,
          reason: '展厅交接发现随箱备用套装，办理报盈',
          date: today,
          remark: `${runTag} 手工报盈`,
          details: [
            {
              goodsId: finished.goods.goods_id.toString(),
              skuId: finished.sku.sku_id.toString(),
              batchNo: finishedBatch,
              unitType: finished.sku.unit_type,
              quantity: 2,
              amount: 256,
            },
          ],
        },
        actorId,
        true,
      );
      await inventory.approveDocument(
        'overflow',
        String(created.id),
        true,
        '报盈依据核实，自动入库',
        actorId,
      );
      return prisma.hspsi_inventory_overflow.findUniqueOrThrow({
        where: { overflow_id: BigInt(created.id) },
      });
    });

    const loss = await step('库存-报亏及出库', async () => {
      const existing = await prisma.hspsi_inventory_loss.findFirst({
        where: { remark: `${runTag} 手工报亏`, deleted_at: null },
        orderBy: { loss_id: 'desc' },
      });
      if (existing) {
        if (existing.approve_status === 0) {
          await inventory.approveDocument(
            'loss',
            String(existing.loss_id),
            true,
            '报亏原因属实，自动生成并确认出库',
            actorId,
          );
        }
        return prisma.hspsi_inventory_loss.findUniqueOrThrow({
          where: { loss_id: existing.loss_id },
        });
      }
      const created = await inventory.saveDocument(
        'loss',
        null,
        {
          orgId: orgId.toString(),
          warehouseId: transferWarehouseId.toString(),
          deptId: deptId.toString(),
          sourceCheckId: 0,
          businessKind: 1,
          documentType: 1,
          reason: '展厅拆样消耗一套，办理报亏',
          date: today,
          remark: `${runTag} 手工报亏`,
          details: [
            {
              goodsId: finished.goods.goods_id.toString(),
              skuId: finished.sku.sku_id.toString(),
              batchNo: finishedBatch,
              unitType: finished.sku.unit_type,
              quantity: 1,
              amount: 128,
            },
          ],
        },
        actorId,
        true,
      );
      await inventory.approveDocument(
        'loss',
        String(created.id),
        true,
        '报亏原因属实，自动生成并确认出库',
        actorId,
      );
      return prisma.hspsi_inventory_loss.findUniqueOrThrow({
        where: { loss_id: BigInt(created.id) },
      });
    });

    await step('库存-预警配置', async () => {
      await inventory.saveQuantityAlert({
        orgId: orgId.toString(),
        warehouseId: transferWarehouseId.toString(),
        goodsId: finished.goods.goods_id.toString(),
        skuId: finished.sku.sku_id.toString(),
        safeQty: 10,
        purchaseQty: 8,
      });
      const old = await prisma.hspsi_inventory_alert_period.findFirst({
        where: {
          goods_id: rawA.goods.goods_id,
          sku_id: rawA.sku.sku_id,
          warehouse_id: rawWarehouse.warehouse_id,
          batch_no: extraRawBatch,
        },
      });
      if (!old) {
        await prisma.hspsi_inventory_alert_period.create({
          data: {
            goods_id: rawA.goods.goods_id,
            sku_id: rawA.sku.sku_id,
            warehouse_id: rawWarehouse.warehouse_id,
            batch_no: extraRawBatch,
            alter_type: 1,
            alter_qty: 4,
            alter_day: 45,
            alter_value: '192.00',
            end_day: new Date('2026-08-20'),
          },
        });
      }
      return true;
    });

    const requisition = await step('领用-申请出库退回', async () => {
      const existing = await prisma.hspsi_draw_approve.findFirst({
        where: { remark: `${runTag} 可归还样品领用`, deleted_at: null },
        orderBy: { draw_id: 'desc' },
      });
      if (existing) {
        let output = await prisma.hspsi_draw_approve_output.findFirst({
          where: { draw_id: existing.draw_id, deleted_at: null },
          orderBy: { draw_output_id: 'desc' },
        });
        if (!output) {
          const approved = await requisitions.approve(
            String(existing.draw_id),
            true,
            '领用用途明确，审批通过',
            actorId,
          );
          if (!approved.outputId) throw new Error('领用审批通过后未生成出库草稿');
          output = await prisma.hspsi_draw_approve_output.findUniqueOrThrow({
            where: { draw_output_id: BigInt(approved.outputId) },
          });
        }
        if (output.comfirm_status === 0) {
          const draft = await requisitions.output(String(output.draw_output_id));
          if (
            draft.details.some(
              (line: Record<string, unknown>) => !String(line.batchNo ?? '').trim(),
            )
          ) {
            await requisitions.saveOutput(
              String(draft.id),
              {
                applicationId: String(draft.applicationId),
                receiverId: actorId,
                outDate: today,
                remark: `${runTag} 样品领用出库`,
                details: draft.details.map((line: Record<string, unknown>) => ({
                  applicationDetailId: String(line.applicationDetailId),
                  batchNo: finishedBatch,
                  quantity: Number(line.quantity),
                })),
              },
              actorId,
            );
          }
          await requisitions.confirmOutput(
            String(output.draw_output_id),
            '领用人身份核验通过，样品出库',
            actorId,
          );
          output = await prisma.hspsi_draw_approve_output.findUniqueOrThrow({
            where: { draw_output_id: output.draw_output_id },
          });
        }
        let returned = await prisma.hspsi_draw_approve_output_exit.findFirst({
          where: { draw_output_id: output.draw_output_id, deleted_at: null },
          orderBy: { draw_exit_id: 'desc' },
        });
        if (!returned) {
          const confirmedOutput = await requisitions.output(String(output.draw_output_id));
          const createdReturn = await requisitions.saveReturn(
            null,
            {
              outputId: String(output.draw_output_id),
              receiverId: actorId,
              reason: '客户路演结束，样品状态完好退回',
              returnDate: today,
              remark: `${runTag} 样品退回`,
              details: confirmedOutput.details.map((line: Record<string, unknown>) => ({
                outputDetailId: String(line.id),
                quantity: Number(line.quantity),
                remark: '外观及配件检查完好',
              })),
            },
            actorId,
          );
          returned = await prisma.hspsi_draw_approve_output_exit.findUniqueOrThrow({
            where: { draw_exit_id: BigInt(createdReturn.id) },
          });
        }
        if (returned.comfirm_status === 0) {
          await requisitions.confirmReturn(
            String(returned.draw_exit_id),
            '退回验收合格，库存恢复',
            actorId,
          );
        }
        return {
          applicationId: existing.draw_id,
          outputId: output.draw_output_id,
          returnId: returned.draw_exit_id,
        };
      }
      const application = await requisitions.saveApplication(
        null,
        {
          orgId: orgId.toString(),
          warehouseId: transferWarehouseId.toString(),
          deptId: deptId.toString(),
          applicantId: actorId,
          drawType: 1,
          date: today,
          reason: '客户路演现场样品领用',
          signatureContent: 'data:image/png;base64,5p6X6ZuF6ZuH',
          signedBy: actorId,
          signedAt: new Date().toISOString(),
          remark: `${runTag} 可归还样品领用`,
          details: [
            {
              goodsId: finished.goods.goods_id.toString(),
              skuId: finished.sku.sku_id.toString(),
              batchNo: finishedBatch,
              unitType: finished.sku.unit_type,
              quantity: 1,
              returnable: true,
              remark: '路演结束后归还',
            },
          ],
        },
        actorId,
        true,
      );
      const approved = await requisitions.approve(
        String(application.id),
        true,
        '领用用途明确，审批通过',
        actorId,
      );
      const output = await requisitions.output(String(approved.outputId));
      if (
        output.details.some((line: Record<string, unknown>) => !String(line.batchNo ?? '').trim())
      ) {
        await requisitions.saveOutput(
          String(output.id),
          {
            applicationId: String(output.applicationId),
            receiverId: actorId,
            outDate: today,
            remark: `${runTag} 样品领用出库`,
            details: output.details.map((line: Record<string, unknown>) => ({
              applicationDetailId: String(line.applicationDetailId),
              batchNo: finishedBatch,
              quantity: Number(line.quantity),
            })),
          },
          actorId,
        );
      }
      await requisitions.confirmOutput(String(output.id), '领用人身份核验通过，样品出库', actorId);
      const confirmedOutput = await requisitions.output(String(output.id));
      const returned = await requisitions.saveReturn(
        null,
        {
          outputId: String(output.id),
          receiverId: actorId,
          reason: '客户路演结束，样品状态完好退回',
          returnDate: today,
          remark: `${runTag} 样品退回`,
          details: confirmedOutput.details.map((line: Record<string, unknown>) => ({
            outputDetailId: String(line.id),
            quantity: Number(line.quantity),
            remark: '外观及配件检查完好',
          })),
        },
        actorId,
      );
      await requisitions.confirmReturn(String(returned.id), '退回验收合格，库存恢复', actorId);
      return { applicationId: application.id, outputId: output.id, returnId: returned.id };
    });

    const counts = await step('最终核验-各页面记录数', async () => {
      await Promise.all([
        purchase.applications({ page: 1, pageSize: 10 }),
        purchase.orders({ page: 1, pageSize: 10 }),
        purchase.receipts({ page: 1, pageSize: 10 }),
        purchase.returns({ page: 1, pageSize: 10 }),
        purchase.payments({ page: 1, pageSize: 10 }),
        production.boms({ page: 1, pageSize: 10 }),
        production.plans({ page: 1, pageSize: 10 }),
        production.shortages({ page: 1, pageSize: 10 }),
        production.outputs({ page: 1, pageSize: 10 }),
        production.inputs({ page: 1, pageSize: 10 }),
        sales.orders({ page: 1, pageSize: 10 }),
        sales.outputs({ page: 1, pageSize: 10 }),
        sales.returns({ page: 1, pageSize: 10 }),
        sales.payments({ page: 1, pageSize: 10 }, 1),
        sales.payments({ page: 1, pageSize: 10 }, 2),
        sales.orders({ page: 1, pageSize: 10 }, 2),
        sales.services({ page: 1, pageSize: 10 }),
        inventory.stocks({ page: 1, pageSize: 10 }),
        inventory.transfers({ page: 1, pageSize: 10 }),
        inventory.adjustments({ page: 1, pageSize: 10 }),
        inventory.losses({ page: 1, pageSize: 10 }),
        inventory.lossOutputs({ page: 1, pageSize: 10 }),
        inventory.overflows({ page: 1, pageSize: 10 }),
        inventory.overflowInputs({ page: 1, pageSize: 10 }),
        inventory.checks({ page: 1, pageSize: 10 }),
        inventory.quantityAlerts({ page: 1, pageSize: 10 }),
        inventory.expiryAlerts({ page: 1, pageSize: 10 }),
        requisitions.applications({ page: 1, pageSize: 10 }),
        requisitions.outputs({ page: 1, pageSize: 10 }),
        requisitions.returns({ page: 1, pageSize: 10 }),
      ]);
      const [
        purchaseApplications,
        purchaseOrders,
        purchaseReceipts,
        purchaseReturns,
        purchasePayments,
        boms,
        plans,
        shortages,
        productionOutputs,
        productionInputs,
        salesOrders,
        salesOutputs,
        salesReturns,
        salesPayments,
        salesRefunds,
        discountOrders,
        services,
        transfers,
        adjustments,
        losses,
        lossOutputs,
        overflows,
        checks,
        requisitionApplications,
        requisitionOutputs,
        requisitionReturns,
        relations,
      ] = await Promise.all([
        prisma.hspsi_purchase_approve.count({ where: { deleted_at: null } }),
        prisma.hspsi_purchase_order.count({ where: { deleted_at: null } }),
        prisma.hspsi_purchase_order_input.count({ where: { deleted_at: null } }),
        prisma.hspsi_purchase_order_input_exit.count({ where: { deleted_at: null } }),
        prisma.hspsi_purchase_order_payment.count({ where: { deleted_at: null } }),
        prisma.hspsi_production_bom.count({ where: { deleted_at: null } }),
        prisma.hspsi_production_plan.count({ where: { deleted_at: null } }),
        prisma.hspsi_production_shortage.count({ where: { deleted_at: null } }),
        prisma.hspsi_production_material_out.count({ where: { deleted_at: null } }),
        prisma.hspsi_production_plan_input.count({ where: { deleted_at: null } }),
        prisma.hspsi_sale_order.count({ where: { so_property_type: 1, deleted_at: null } }),
        prisma.hspsi_sale_order_output.count({ where: { deleted_at: null } }),
        prisma.hspsi_sale_order_exit.count({ where: { deleted_at: null } }),
        prisma.hspsi_sales_order_payment.count({ where: { so_pay_type: 1, deleted_at: null } }),
        prisma.hspsi_sales_order_payment.count({ where: { so_pay_type: 2, deleted_at: null } }),
        prisma.hspsi_sale_order.count({ where: { so_property_type: 2, deleted_at: null } }),
        prisma.hspsi_sale_order_service.count({ where: { deleted_at: null } }),
        prisma.hspsi_inventory_transfer.count({ where: { deleted_at: null } }),
        prisma.hspsi_inventory_adjust.count({ where: { deleted_at: null } }),
        prisma.hspsi_inventory_loss.count({ where: { deleted_at: null } }),
        prisma.hspsi_inventory_loss_output.count({ where: { deleted_at: null } }),
        prisma.hspsi_inventory_overflow.count({ where: { deleted_at: null } }),
        prisma.hspsi_inventory_check.count({ where: { deleted_at: null } }),
        prisma.hspsi_draw_approve.count({ where: { deleted_at: null } }),
        prisma.hspsi_draw_approve_output.count({ where: { deleted_at: null } }),
        prisma.hspsi_draw_approve_output_exit.count({ where: { deleted_at: null } }),
        prisma.hspsi_business_document_relation.count(),
      ]);
      return {
        purchase: {
          applications: purchaseApplications,
          orders: purchaseOrders,
          receipts: purchaseReceipts,
          returns: purchaseReturns,
          payments: purchasePayments,
        },
        production: {
          boms,
          plans,
          shortages,
          outputs: productionOutputs,
          inputs: productionInputs,
        },
        sales: {
          orders: salesOrders,
          outputs: salesOutputs,
          returns: salesReturns,
          payments: salesPayments,
          refunds: salesRefunds,
          discountOrders,
          services,
        },
        inventory: {
          transfers,
          adjustments,
          losses,
          lossOutputs,
          overflows,
          overflowInputs: overflows,
          checks,
        },
        requisitions: {
          applications: requisitionApplications,
          outputs: requisitionOutputs,
          returns: requisitionReturns,
        },
        documentRelations: relations,
      };
    });

    const finalStock = await prisma.hspsi_inventory_batch_total.findMany({
      where: {
        goods_id: { in: [rawA.goods.goods_id, rawB.goods.goods_id, finished.goods.goods_id] },
        inventory_qty: { gt: 0 },
      },
      orderBy: [{ warehouse_id: 'asc' }, { goods_id: 'asc' }],
    });

    Object.assign(result, {
      masterData: {
        rawWarehouseId: rawWarehouse.warehouse_id,
        vendorId: vendor.vendor_id,
        customerId: customer.customer_id,
        goodsIds: [rawA.goods.goods_id, rawB.goods.goods_id, finished.goods.goods_id],
        skuIds: [rawA.sku.sku_id, rawB.sku.sku_id, finished.sku.sku_id],
      },
      chain: {
        salesOrder: salesOrder.so_no,
        productionPlan: plan.plan_no,
        purchaseApplication: purchaseApplication.pur_no,
        purchaseOrder: purchaseOrder.po_no,
        purchaseReceipt: receipt.po_input_no,
        purchasePaymentId: payment.id,
        productionOutput: formalOutput.out_no,
        productionInput: productionInput.input_no,
        salesOutput: salesOutput.so_output_no,
        salesPaymentId: salesPayment.id,
        salesRefundId: salesRefund.id,
        salesReturn: salesReturn.return.so_exit_no,
        discountOrder: discountOrder.so_no,
        service: service.service_no,
        purchaseReturn: purchaseReturn.po_exit_no,
        inventoryTransfer: transfer.transfer_no,
        inventoryAdjustment: adjustment.adjust_no,
        inventoryCheck: check.check_no,
        inventoryOverflow: overflow.overflow_no,
        inventoryLoss: loss.loss_no,
        requisition,
      },
      counts,
      finalPositiveStock: finalStock.map((item) => ({
        goodsId: item.goods_id,
        skuId: item.sku_id,
        warehouseId: item.warehouse_id,
        batchNo: item.batch_no,
        quantity: item.inventory_qty,
      })),
    });
    process.stdout.write(`${json(result)}\n`);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
