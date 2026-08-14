import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import { InventoryAlertService } from '../inventory/inventory-alert.service';
import {
  INVENTORY_BUSINESS_MODE,
  PRODUCTION_OUTBOUND_STATUS,
} from '../inventory/inventory-dictionary';
import { BusinessReferenceService } from '../database/business-reference.service';
import { DocumentTraceService } from '../document-trace/document-trace.service';
import { BUSINESS_PREFIX } from '../business-number/business-number.constants';
import { BusinessNumberService } from '../business-number/business-number.service';
import { generateBatchNo } from '../common/batch-number';
import { BusinessMasterDataService } from '../database/business-master-data.service';
import type { ApprovalCallbackPayload } from '../integrations/xinfutong-oa/approval/approval.types';
type B = Record<string, any>;
const PRODUCTION_PLAN_STATUS = {
  DRAFT: 0,
  PENDING_APPROVAL: 1,
  APPROVED: 2,
  IN_PRODUCTION: 3,
  PARTIAL_DELIVERY: 4,
  COMPLETED: 5,
  TERMINATED: 6,
  SHORTAGE: 7,
} as const;
@Injectable()
export class ProductionService {
  constructor(
    @Inject(PrismaService) private readonly p: PrismaService,
    @Inject(InventoryPostingService) private readonly posting: InventoryPostingService,
    @Inject(InventoryAlertService) private readonly inventoryAlerts: InventoryAlertService,
    @Inject(BusinessReferenceService) private readonly refs: BusinessReferenceService,
    @Inject(DocumentTraceService) private readonly documentTrace: DocumentTraceService,
    @Inject(BusinessNumberService) private readonly businessNumber: BusinessNumberService,
    @Inject(BusinessMasterDataService) private readonly masterData: BusinessMasterDataService,
  ) {}
  private d(v: any) {
    return new Prisma.Decimal(String(v ?? 0));
  }
  private qty(v: any, label = '数量', allowZero = false) {
    const quantity = Number(v);
    if (!Number.isSafeInteger(quantity) || (allowZero ? quantity < 0 : quantity <= 0))
      throw new BadRequestException(`${label}必须为${allowZero ? '非负' : '正'}整数`);
    return quantity;
  }
  private pg(q: B) {
    return { page: Math.max(1, +q.page || 1), pageSize: Math.min(100, +q.pageSize || 20) };
  }
  private guardedTransaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.p.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }
  async productOptions(orgIdValue: unknown, warehouseIdValue: unknown) {
    if (!orgIdValue || !warehouseIdValue) return [];
    return this.masterData.goodsOptions(
      BigInt(String(orgIdValue)),
      BigInt(String(warehouseIdValue)),
    );
  }
  async warehouseOptions(orgIdValue: unknown, goodsIdValue: unknown) {
    if (!orgIdValue || !goodsIdValue) return [];
    const orgId = BigInt(String(orgIdValue));
    const goods = (
      await this.masterData.assertGoodsActive(orgId, [{ goodsId: BigInt(String(goodsIdValue)) }])
    )[0]!;
    const category = await this.p.hspsi_goods_info_category.findFirstOrThrow({
      where: { goods_catg_id: goods.goods_catg_id, status: 1, deleted_at: null },
    });
    const warehouses = await this.p.hspsi_basic_warehouse.findMany({
      where: {
        org_id: orgId,
        warehouse_type: category.warehouse_type,
        status: 1,
        deleted_at: null,
      },
      orderBy: [{ sort: 'asc' }, { warehouse_id: 'asc' }],
    });
    return warehouses.map((item) => ({
      value: item.warehouse_id,
      label: item.name,
      raw: { orgId: item.org_id, warehouseType: item.warehouse_type },
    }));
  }
  private async createShortagePurchaseApplication(
    t: Prisma.TransactionClient,
    plan: { plan_id: bigint; plan_no: string; org_id: bigint; warehouse_id: bigint },
    u: string,
  ) {
    const shortages = await t.hspsi_production_shortage.findMany({
      where: { plan_id: plan.plan_id, status: 0, deleted_at: null },
    });
    if (!shortages.length) {
      const linked = await t.hspsi_production_shortage.findFirst({
        where: { plan_id: plan.plan_id, pur_id: { gt: 0n }, deleted_at: null },
      });
      if (linked) {
        const existing = await t.hspsi_purchase_approve.findFirst({
          where: { pur_id: linked.pur_id, deleted_at: null },
        });
        if (existing) return { id: existing.pur_id, purNo: existing.pur_no, created: false };
      }
      throw new BadRequestException('没有待处理缺料');
    }
    const preferredDept = await t.hspsi_basic_dept.findFirst({
      where: { org_id: plan.org_id, status: 1, deleted_at: null, name: { contains: '采购' } },
      orderBy: [{ sort: 'asc' }, { dept_id: 'asc' }],
      select: { dept_id: true },
    });
    const fallbackDept =
      preferredDept ??
      (await t.hspsi_basic_dept.findFirst({
        where: { org_id: plan.org_id, status: 1, deleted_at: null },
        orderBy: [{ sort: 'asc' }, { dept_id: 'asc' }],
        select: { dept_id: true },
      }));
    if (!fallbackDept) throw new BadRequestException('当前组织没有可用部门，不能生成缺料采购申请');
    const goods = await t.hspsi_goods_info.findMany({
      where: { goods_id: { in: shortages.map((item) => item.goods_id) } },
    });
    const purNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_APPLICATION);
    const application = await t.hspsi_purchase_approve.create({
      data: {
        pur_no: purNo,
        org_id: plan.org_id,
        dept_id: fallbackDept.dept_id,
        pur_reson: `生产计划 ${plan.plan_no} 缺料采购`,
        source_type: 'production_plan',
        source_id: plan.plan_id,
        warehouse_id: plan.warehouse_id,
        status: 1,
        approve_status: 0,
        approve_comment: '',
        remark: '生产缺料自动生成',
        created_by: BigInt(u),
        updated_by: BigInt(u),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
    await t.hspsi_purchase_approve_detail.createMany({
      data: shortages.map((item) => ({
        pur_id: application.pur_id,
        goods_id: item.goods_id,
        sku_id: item.sku_id,
        source_shortage_id: item.shortage_id,
        qty: Math.ceil(Number(item.suggest_purchase_qty)),
        unit_type: item.unit_type,
        reference_price:
          goods.find((goodsItem) => goodsItem.goods_id === item.goods_id)?.const_price ?? this.d(0),
        remark: '生产缺料',
      })),
    });
    await t.hspsi_production_shortage.updateMany({
      where: { shortage_id: { in: shortages.map((item) => item.shortage_id) } },
      data: { status: 1, pur_id: application.pur_id, updated_by: BigInt(u) },
    });
    await t.hspsi_production_plan.update({
      where: { plan_id: plan.plan_id },
      data: {
        plan_status: PRODUCTION_PLAN_STATUS.SHORTAGE,
        material_status: 3,
        stock_check_status: 2,
        approve_status: 0,
        updated_by: Number(u),
      },
    });
    for (const shortage of shortages)
      await this.documentTrace.link(
        {
          upstreamType: 'production_shortage',
          upstreamId: shortage.shortage_id,
          upstreamNo: shortage.shortage_no,
          downstreamType: 'purchase_application',
          downstreamId: application.pur_id,
          downstreamNo: purNo,
          createdBy: u,
        },
        t,
      );
    return { id: application.pur_id, purNo, created: true };
  }
  private assertFormalOutputReady(
    planStatus: number,
    materialStatus: number,
    stockCheckStatus: number,
  ) {
    if (planStatus !== 3 || stockCheckStatus !== 1 || ![1, 4].includes(materialStatus))
      throw new BadRequestException(
        '生产计划尚未进入可执行状态：缺料补齐后请先重校库存并完成生产计划审批',
      );
  }
  private async assertFormalPlanStockReady(
    t: Prisma.TransactionClient,
    plan: { plan_id: bigint; org_id: bigint; warehouse_id: bigint },
  ) {
    const materials = await t.hspsi_production_plan_detail.findMany({
      where: { plan_id: plan.plan_id },
    });
    if (!materials.length)
      throw new BadRequestException('生产计划没有BOM原料明细，不能生成整单出库单');
    const goodsIds = [...new Set(materials.map((material) => material.goods_id))];
    const [totals, goods] = await Promise.all([
      t.hspsi_inventory_total.findMany({
        where: { org_id: plan.org_id, warehouse_id: plan.warehouse_id, goods_id: { in: goodsIds } },
      }),
      t.hspsi_goods_info.findMany({
        where: { goods_id: { in: goodsIds } },
        select: { goods_id: true, goods_name: true },
      }),
    ]);
    const shortages: string[] = [];
    for (const material of materials) {
      const total = totals.find(
        (item) => item.goods_id === material.goods_id && item.sku_id === material.sku_id,
      );
      const current = Number(total?.inventory_qty ?? 0),
        planned = Number(material.plan_out_qty);
      if (current + 0.000001 < planned) {
        const goodsName =
          goods.find((item) => item.goods_id === material.goods_id)?.goods_name ??
          String(material.goods_id);
        shortages.push(`${goodsName}（计划 ${planned}，当前 ${current}）`);
      }
    }
    if (shortages.length)
      throw new BadRequestException(
        `当前库存不满足BOM计划出库量，不能生成整单出库单：${shortages.join('；')}`,
      );
  }
  private async assertFormalBatchStockReady(
    t: Prisma.TransactionClient,
    orgId: bigint,
    warehouseId: bigint,
    lines: B[],
  ) {
    const batches = new Map<
        string,
        { goodsId: bigint; skuId: bigint; batchNo: string; quantity: number }
      >(),
      totals = new Map<string, { goodsId: bigint; skuId: bigint; quantity: number }>();
    for (const line of lines) {
      const goodsId = BigInt(String(line.goodsId)),
        skuId = BigInt(String(line.skuId)),
        batchNo = String(line.batchNo ?? '').trim(),
        quantity = Number(line.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || !batchNo)
        throw new BadRequestException('正式BOM出库数量必须为正整数且批号必填');
      const totalKey = `${goodsId}:${skuId}`,
        batchKey = `${totalKey}:${batchNo}`;
      const total = totals.get(totalKey);
      if (total) total.quantity += quantity;
      else totals.set(totalKey, { goodsId, skuId, quantity });
      const batch = batches.get(batchKey);
      if (batch) batch.quantity += quantity;
      else batches.set(batchKey, { goodsId, skuId, batchNo, quantity });
    }
    const checkedTotals = new Set<string>();
    for (const [key, item] of [...batches.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const totalKey = `${item.goodsId}:${item.skuId}`;
      if (!checkedTotals.has(totalKey)) {
        checkedTotals.add(totalKey);
        const totalRequest = totals.get(totalKey)!;
        await t.$queryRaw`SELECT id FROM hspsi_inventory_total WHERE org_id=${orgId} AND warehouse_id=${warehouseId} AND goods_id=${item.goodsId} AND sku_id=${item.skuId} FOR UPDATE`;
        const total = await t.hspsi_inventory_total.findUnique({
          where: {
            org_id_warehouse_id_goods_id_sku_id: {
              org_id: orgId,
              warehouse_id: warehouseId,
              goods_id: item.goodsId,
              sku_id: item.skuId,
            },
          },
          select: { inventory_qty: true },
        });
        if (Number(total?.inventory_qty ?? 0) + 0.000001 < totalRequest.quantity)
          throw new BadRequestException('正式BOM出库库存不足，请重新校验生产计划');
      }
      await t.$queryRaw`SELECT goods_id FROM hspsi_inventory_batch_total WHERE warehouse_id=${warehouseId} AND goods_id=${item.goodsId} AND sku_id=${item.skuId} AND batch_no=${item.batchNo} FOR UPDATE`;
      const batch = await t.hspsi_inventory_batch_total.findUnique({
        where: {
          goods_id_sku_id_warehouse_id_batch_no: {
            goods_id: item.goodsId,
            sku_id: item.skuId,
            warehouse_id: warehouseId,
            batch_no: item.batchNo,
          },
        },
        select: { inventory_qty: true },
      });
      if (Number(batch?.inventory_qty ?? 0) + 0.000001 < item.quantity)
        throw new BadRequestException(
          `正式BOM出库批次 ${item.batchNo} 库存不足，请调整批次或重新校验生产计划`,
        );
    }
  }
  private async assertNoActiveProcurement(
    t: Prisma.TransactionClient,
    planId: bigint,
    action = '删除或终止',
  ) {
    const shortages = await t.hspsi_production_shortage.findMany({
      where: { plan_id: planId, pur_id: { gt: 0n }, status: { in: [1, 2] }, deleted_at: null },
      select: { pur_id: true },
    });
    const shortagePurIds = [...new Set(shortages.map((item) => item.pur_id))];
    const or: Prisma.hspsi_purchase_approveWhereInput[] = [
      { source_type: 'production_plan', source_id: planId },
    ];
    if (shortagePurIds.length) or.push({ pur_id: { in: shortagePurIds } });
    const applications = await t.hspsi_purchase_approve.findMany({
      where: { deleted_at: null, OR: or },
      select: { pur_id: true, approve_status: true },
    });
    const purIds = [...new Set([...shortagePurIds, ...applications.map((item) => item.pur_id)])];
    const activeApplication = applications.some((item) => item.approve_status !== 2);
    const activeOrder = purIds.length
      ? await t.hspsi_purchase_order.count({ where: { pur_id: { in: purIds }, deleted_at: null } })
      : 0;
    if (activeApplication || activeOrder)
      throw new BadRequestException(`生产计划已有有效采购申请或采购订单，不能${action}`);
  }
  private async salesOrderPlanningCapacity(
    t: Prisma.TransactionClient,
    input: {
      sourceId: bigint;
      goodsId: bigint;
      skuId: bigint;
      excludePlanId?: bigint;
      lock?: boolean;
    },
  ) {
    if (input.lock !== false)
      await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${input.sourceId} FOR UPDATE`;
    const order = await t.hspsi_sale_order.findFirst({
      where: { so_id: input.sourceId, so_property_type: 1, approve_status: 1, deleted_at: null },
    });
    if (!order) throw new BadRequestException('关联销售订单不存在、未审核或不是普通销售订单');
    const orderLines = await t.hspsi_sale_order_detail.findMany({
      where: { so_id: order.so_id, goods_id: input.goodsId, sku_id: input.skuId },
    });
    const orderQty = orderLines.reduce((sum, line) => sum + Number(line.sale_qty), 0);
    if (!(orderQty > 0)) throw new BadRequestException('所选销售订单不包含当前BOM成品及SKU');
    const outputHeads = await t.hspsi_sale_order_output.findMany({
      where: { so_id: order.so_id, deleted_at: null },
      select: { so_output_id: true },
    });
    const output = outputHeads.length
      ? await t.hspsi_sale_order_output_detail.aggregate({
          _sum: { output_qty: true },
          where: {
            so_output_id: { in: outputHeads.map((item) => item.so_output_id) },
            goods_id: input.goodsId,
            sku_id: input.skuId,
          },
        })
      : null;
    const planned = await t.hspsi_production_plan.aggregate({
      _sum: { plan_qty: true },
      where: {
        source_type: { in: ['sales_order', '4'] },
        source_id: order.so_id,
        goods_id: input.goodsId,
        sku_id: input.skuId,
        deleted_at: null,
        plan_status: { not: 6 },
        ...(input.excludePlanId ? { plan_id: { not: input.excludePlanId } } : {}),
      },
    });
    const outputQty = Number(output?._sum.output_qty ?? 0),
      plannedQty = Number(planned._sum.plan_qty ?? 0);
    return {
      order,
      orderQty,
      outputQty,
      plannedQty,
      remainingQty: Math.max(0, orderQty - outputQty - plannedQty),
    };
  }
  async planSourceOptions(q: B) {
    if (!q.goodsId || !q.skuId) return [];
    const goodsId = BigInt(q.goodsId),
      skuId = BigInt(q.skuId),
      excludePlanId = q.excludePlanId ? BigInt(q.excludePlanId) : undefined;
    const orders = await this.p.hspsi_sale_order.findMany({
      where: { so_property_type: 1, approve_status: 1, deleted_at: null },
      orderBy: { so_id: 'desc' },
      take: 200,
    });
    const items: B[] = [];
    for (const order of orders) {
      if (q.orgId && order.org_id !== BigInt(q.orgId)) continue;
      try {
        const capacity = await this.salesOrderPlanningCapacity(this.p, {
          sourceId: order.so_id,
          goodsId,
          skuId,
          excludePlanId,
          lock: false,
        });
        if (capacity.remainingQty > 0)
          items.push({
            id: order.so_id,
            orderId: order.so_id,
            orderNo: order.so_no,
            customerName: order.customer_name,
            orgId: order.org_id,
            warehouseId: order.warehouse_id,
            goodsId,
            skuId,
            orderQty: capacity.orderQty,
            outputQty: capacity.outputQty,
            plannedQty: capacity.plannedQty,
            remainingQty: capacity.remainingQty,
          });
      } catch (error) {
        if (!(error instanceof BadRequestException)) throw error;
      }
    }
    return items;
  }
  async boms(q: B) {
    const { page, pageSize } = this.pg(q),
      where: Prisma.hspsi_production_bomWhereInput = { deleted_at: null };
    if (q.status !== undefined && q.status !== '') where.status = Number(q.status);
    if (q.orgId) where.org_id = BigInt(q.orgId);
    if (q.keyword)
      where.OR = [
        { bom_no: { contains: String(q.keyword) } },
        { bom_name: { contains: String(q.keyword) } },
      ];
    const [records, total] = await this.p.$transaction([
      this.p.hspsi_production_bom.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { bom_id: 'desc' },
      }),
      this.p.hspsi_production_bom.count({ where }),
    ]);
    const counts = records.length
      ? await this.p.hspsi_production_bom_detail.groupBy({
          by: ['bom_id'],
          where: { bom_id: { in: records.map((i) => i.bom_id) } },
          _count: true,
        })
      : [];
    const goodsIds = [...new Set(records.map((i) => i.goods_id))],
      skus = records.length
        ? await this.p.hspsi_goods_info_sku.findMany({
            where: { sku_id: { in: [...new Set(records.map((i) => i.sku_id).filter(Boolean))] } },
          })
        : [],
      goods = goodsIds.length
        ? await this.p.hspsi_goods_info.findMany({ where: { goods_id: { in: goodsIds } } })
        : [],
      catIds = [...new Set(goods.map((g) => g.goods_catg_id).filter(Boolean))],
      cats = catIds.length
        ? await this.p.hspsi_goods_info_category.findMany({
            where: { goods_catg_id: { in: catIds } },
          })
        : [],
      unitIds = [...new Set(skus.map((s) => s.unit_type).filter(Boolean))],
      units = unitIds.length
        ? await this.p.hspsi_basic_unit.findMany({ where: { id: { in: unitIds } } })
        : [];
    const items = await this.refs.enrich(
      records.map((i) => {
        const g = goods.find((x) => x.goods_id === i.goods_id),
          s = skus.find((x) => x.sku_id === i.sku_id);
        return {
          ...i,
          id: i.bom_id,
          bomNo: i.bom_no,
          bomName: i.bom_name,
          goodsId: i.goods_id,
          skuId: i.sku_id,
          warehouseId: i.warehouse_id,
          orgId: i.org_id,
          categoryName: cats.find((c) => c.goods_catg_id === g?.goods_catg_id)?.goods_name ?? '',
          unitName: units.find((u) => u.id === BigInt(s?.unit_type ?? 0))?.name ?? '',
          materialCount: counts.find((c) => c.bom_id === i.bom_id)?._count ?? 0,
          createdBy: i.created_by,
          updatedBy: i.updated_by,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
        };
      }),
      { status: 'enabled_status' },
    );
    return { items, total, page, pageSize };
  }
  async bom(id: string) {
    const i = await this.p.hspsi_production_bom.findFirst({
      where: { bom_id: BigInt(id), deleted_at: null },
    });
    if (!i) throw new NotFoundException('BOM不存在');
    const d = await this.p.hspsi_production_bom_detail.findMany({ where: { bom_id: i.bom_id } });
    const allGoodsIds = [i.goods_id, ...d.map((x) => x.goods_id)];
    const allSkuIds = [i.sku_id, ...d.map((x) => x.sku_id)].filter(Boolean).map(BigInt);
    const [goods, skus, units] = await Promise.all([
      this.p.hspsi_goods_info.findMany({ where: { goods_id: { in: allGoodsIds } } }),
      allSkuIds.length
        ? this.p.hspsi_goods_info_sku.findMany({ where: { sku_id: { in: allSkuIds } } })
        : [],
      this.p.hspsi_basic_unit.findMany(),
    ]);
    const catIds = [...new Set(goods.map((g) => g.goods_catg_id).filter(Boolean))];
    const cats = catIds.length
      ? await this.p.hspsi_goods_info_category.findMany({
          where: { goods_catg_id: { in: catIds } },
        })
      : [];
    const bomGoods = goods.find((g) => g.goods_id === i.goods_id),
      bomSku = skus.find((s) => s.sku_id === i.sku_id);
    return {
      ...i,
      id: i.bom_id,
      bomNo: i.bom_no,
      bomName: i.bom_name,
      goodsId: i.goods_id,
      goodsCode: bomGoods?.query_code ?? '',
      goodsName: bomGoods?.goods_name ?? '',
      goodsSpec: bomSku?.spec_models ?? '',
      categoryName: cats.find((c) => c.goods_catg_id === bomGoods?.goods_catg_id)?.goods_name ?? '',
      unitName: units.find((u) => u.id === BigInt(bomSku?.unit_type ?? 0))?.name ?? '',
      skuId: i.sku_id,
      warehouseId: i.warehouse_id,
      orgId: i.org_id,
      details: d.map((x) => {
        const g = goods.find((g2) => g2.goods_id === x.goods_id),
          s = skus.find((s2) => s2.sku_id === x.sku_id);
        return {
          id: x.id,
          goodsId: x.goods_id,
          goodsCode: g?.query_code ?? '',
          goodsName: g?.goods_name ?? '',
          skuId: x.sku_id,
          skuSpec: s?.spec_models ?? '',
          quantity: x.require_qty,
          unitType: x.unit_type,
          unitName: units.find((u) => u.id === BigInt(x.unit_type))?.name ?? '',
          remark: x.remark,
        };
      }),
    };
  }
  async saveBom(id: string | null, b: B, u: string) {
    if (!Array.isArray(b.details) || !b.details.length)
      throw new BadRequestException('至少一条原料');
    const bid = await this.p.$transaction(async (t) => {
      const data = {
        bom_name: String(b.bomName),
        goods_id: BigInt(b.goodsId),
        sku_id: BigInt(b.skuId ?? 0),
        warehouse_id: BigInt(b.warehouseId),
        org_id: BigInt(b.orgId),
        status: Number(b.status ?? 1),
        sort: Number(b.sort ?? 0),
        remark: String(b.remark ?? ''),
        updated_by: Number(u),
      };
      const newBomNo = id ? '' : await this.businessNumber.generate(BUSINESS_PREFIX.PRODUCTION_BOM);
      const h = id
        ? await t.hspsi_production_bom.update({ where: { bom_id: BigInt(id) }, data })
        : await t.hspsi_production_bom.create({
            data: { ...data, bom_no: newBomNo, created_by: Number(u) },
          });
      await t.hspsi_production_bom_detail.deleteMany({ where: { bom_id: h.bom_id } });
      await t.hspsi_production_bom_detail.createMany({
        data: b.details.map((x: B) => ({
          bom_id: h.bom_id,
          goods_id: BigInt(x.goodsId),
          sku_id: BigInt(x.skuId ?? 0),
          require_qty: this.qty(x.quantity, '单件需求量'),
          unit_type: Number(x.unitType),
          remark: String(x.remark ?? ''),
        })),
      });
      return h.bom_id;
    });
    return { id: bid };
  }
  async bomStatus(id: string, status: number, u: string) {
    await this.p.hspsi_production_bom.update({
      where: { bom_id: BigInt(id) },
      data: { status, updated_by: Number(u) },
    });
    return { id };
  }
  async deleteBom(id: string, u: string) {
    if (
      await this.p.hspsi_production_plan.count({ where: { bom_id: BigInt(id), deleted_at: null } })
    )
      throw new BadRequestException('BOM已被引用');
    await this.p.hspsi_production_bom.update({
      where: { bom_id: BigInt(id) },
      data: { deleted_at: new Date(), updated_by: Number(u) },
    });
    return { id };
  }
  async plans(q: B) {
    const { page, pageSize } = this.pg(q),
      where: Prisma.hspsi_production_planWhereInput = { deleted_at: null };
    if (q.status !== undefined && q.status !== '') where.plan_status = Number(q.status);
    if (q.keyword) where.plan_no = { contains: String(q.keyword) };
    const [records, total] = await this.p.$transaction([
      this.p.hspsi_production_plan.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { plan_id: 'desc' },
      }),
      this.p.hspsi_production_plan.count({ where }),
    ]);
    const [boms, orders] = await Promise.all([
        records.length
          ? this.p.hspsi_production_bom.findMany({
              where: { bom_id: { in: records.map((i) => i.bom_id) } },
            })
          : [],
        records.length
          ? this.p.hspsi_sale_order.findMany({
              where: {
                so_id: {
                  in: [...new Set(records.map((i) => i.source_id).filter((id) => id > 0n))],
                },
              },
            })
          : [],
      ]),
      bomMap = new Map(boms.map((i) => [String(i.bom_id), i.bom_no])),
      orderMap = new Map(orders.map((i) => [String(i.so_id), i.so_no]));
    const items = await this.refs.enrich(
      records.map((i) => ({
        ...i,
        id: i.plan_id,
        planNo: i.plan_no,
        bomNo: bomMap.get(String(i.bom_id)) ?? '',
        sourceOrderNo: orderMap.get(String(i.source_id)) ?? '',
        goodsId: i.goods_id,
        skuId: i.sku_id,
        orgId: i.org_id,
        warehouseId: i.warehouse_id,
        planQty: i.plan_qty,
        deliveredQty: i.delivered_qty,
        deliveryProgress:
          Number(i.plan_qty) > 0
            ? Math.min(100, (Number(i.delivered_qty) * 100) / Number(i.plan_qty))
            : 0,
        planDate: i.plan_date,
        planStatus: i.plan_status,
        materialStatus: i.material_status,
        stockCheckStatus: i.stock_check_status,
        outboundStatus: i.outbound_status,
        approveStatus: i.approve_status,
        createdBy: i.created_by,
        updatedBy: i.updated_by,
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      })),
      {
        planStatus: 'production_plan_status',
        materialStatus: 'production_material_status',
        stockCheckStatus: 'production_stock_check_status',
        outboundStatus: 'production_outbound_status',
        approveStatus: 'approval_status',
      },
    );
    return { items, total, page, pageSize };
  }
  async plan(id: string) {
    const i = await this.p.hspsi_production_plan.findFirst({
      where: { plan_id: BigInt(id), deleted_at: null },
    });
    if (!i) throw new NotFoundException('计划不存在');
    const details = await this.p.hspsi_production_plan_detail.findMany({
        where: { plan_id: i.plan_id },
      }),
      shortages = await this.p.hspsi_production_shortage.findMany({
        where: { plan_id: i.plan_id, deleted_at: null },
      });
    const goodsIds = [...new Set([i.goods_id, ...details.map((d) => d.goods_id)])],
      skuIds = [...new Set([i.sku_id, ...details.map((d) => d.sku_id)].filter(Boolean))];
    const [goods, skus, units, stocks] = await Promise.all([
        goodsIds.length
          ? this.p.hspsi_goods_info.findMany({ where: { goods_id: { in: goodsIds } } })
          : [],
        skuIds.length
          ? this.p.hspsi_goods_info_sku.findMany({ where: { sku_id: { in: skuIds } } })
          : [],
        this.p.hspsi_basic_unit.findMany(),
        this.p.hspsi_inventory_batch_total.findMany({
          where: { warehouse_id: i.warehouse_id, goods_id: { in: goodsIds } },
        }),
      ]),
      stockMap = new Map<string, number>();
    for (const s of stocks) {
      const k = `${s.goods_id}-${s.sku_id}`;
      stockMap.set(k, (stockMap.get(k) ?? 0) + Number(s.inventory_qty));
    }
    const [planBom, sourceOrder] = await Promise.all([
        this.p.hspsi_production_bom.findFirst({ where: { bom_id: i.bom_id } }),
        i.source_id > 0n
          ? this.p.hspsi_sale_order.findFirst({ where: { so_id: i.source_id, deleted_at: null } })
          : null,
      ]),
      planGoods = goods.find((g) => g.goods_id === i.goods_id);
    return {
      ...i,
      id: i.plan_id,
      planNo: i.plan_no,
      orgId: i.org_id,
      bomId: i.bom_id,
      bomNo: planBom?.bom_no ?? '',
      goodsId: i.goods_id,
      goodsName: planGoods?.goods_name ?? '',
      skuId: i.sku_id,
      planQty: i.plan_qty,
      planDate: i.plan_date,
      warehouseId: i.warehouse_id,
      productWarehouseId: i.product_warehouse_id,
      sourceType: i.source_type,
      sourceId: i.source_id,
      sourceOrderNo: sourceOrder?.so_no ?? '',
      deliveredQty: i.delivered_qty,
      planStatus: i.plan_status,
      materialStatus: i.material_status,
      stockCheckStatus: i.stock_check_status,
      outboundStatus: i.outbound_status,
      approveStatus: i.approve_status,
      details: details.map((d) => {
        const g = goods.find((x) => x.goods_id === d.goods_id),
          s = skus.find((x) => x.sku_id === d.sku_id);
        return {
          id: d.id,
          goodsId: d.goods_id,
          goodsCode: g?.query_code ?? '',
          goodsName: g?.goods_name ?? '',
          skuId: d.sku_id,
          skuSpec: s?.spec_models ?? '',
          bomUnitQty: d.bom_unit_qty,
          standardQty: d.standard_qty,
          quantity: d.require_qty,
          planOutQty: d.plan_out_qty,
          currentStock: stockMap.get(`${d.goods_id}-${d.sku_id}`) ?? 0,
          unitType: d.unit_type,
          unitName: units.find((u) => u.id === BigInt(d.unit_type))?.name ?? '',
          remark: d.remark,
        };
      }),
      shortages,
    };
  }
  async createPlanFromSalesGap(t: Prisma.TransactionClient, b: B, u: string) {
    const sourceId = BigInt(b.sourceId),
      bomId = BigInt(b.bomId),
      qty = Number(b.planQty);
    if (!(qty > 0)) throw new BadRequestException('生产缺口数量必须大于0');
    const bom = await t.hspsi_production_bom.findFirst({
      where: { bom_id: bomId, status: 1, deleted_at: null },
    });
    if (!bom) throw new BadRequestException('销售缺口对应BOM不存在或未启用');
    const details = await t.hspsi_production_bom_detail.findMany({ where: { bom_id: bomId } });
    if (!details.length) throw new BadRequestException('销售缺口对应BOM没有原料明细');
    const capacity = await this.salesOrderPlanningCapacity(t, {
      sourceId,
      goodsId: bom.goods_id,
      skuId: bom.sku_id,
    });
    if (capacity.remainingQty <= 0.000001) return { type: 'production', created: false };
    if (qty > capacity.remainingQty + 0.000001)
      throw new BadRequestException(
        `生产数量不能超过销售订单剩余可计划数量 ${capacity.remainingQty}`,
      );
    if (
      BigInt(b.orgId) !== capacity.order.org_id ||
      BigInt(b.productWarehouseId ?? 0) !== capacity.order.warehouse_id
    )
      throw new BadRequestException('生产计划组织和成品仓库必须与关联销售订单一致');
    const planNo = await this.businessNumber.generate(BUSINESS_PREFIX.PRODUCTION_PLAN);
    const plan = await t.hspsi_production_plan.create({
      data: {
        plan_no: planNo,
        org_id: capacity.order.org_id,
        bom_id: bomId,
        goods_id: bom.goods_id,
        sku_id: bom.sku_id,
        plan_qty: this.qty(qty, '生产数量'),
        plan_date: new Date(),
        warehouse_id: BigInt(b.warehouseId),
        product_warehouse_id: capacity.order.warehouse_id,
        plan_status: PRODUCTION_PLAN_STATUS.PENDING_APPROVAL,
        material_status: 0,
        stock_check_status: 0,
        outbound_status: PRODUCTION_OUTBOUND_STATUS.NOT_STARTED,
        delivered_qty: 0,
        source_type: 'sales_order',
        source_id: sourceId,
        approve_status: 0,
        approve_comment: '',
        approve_by: 0n,
        remark: '销售缺口自动生成',
        created_by: Number(u),
        updated_by: Number(u),
      },
    });
    await this.documentTrace.link(
      {
        upstreamType: 'sales_order',
        upstreamId: sourceId,
        upstreamNo: b.sourceNo,
        downstreamType: 'production_plan',
        downstreamId: plan.plan_id,
        downstreamNo: planNo,
        createdBy: u,
      },
      t,
    );
    let shortage = false;
    for (const line of details) {
      const standard = Number(line.require_qty) * qty;
      const stock = await t.hspsi_inventory_batch_total.aggregate({
        _sum: { inventory_qty: true },
        where: {
          org_id: BigInt(b.orgId),
          warehouse_id: BigInt(b.warehouseId),
          goods_id: line.goods_id,
          sku_id: line.sku_id,
        },
      });
      const fact = Number(stock._sum.inventory_qty ?? 0);
      await t.hspsi_production_plan_detail.create({
        data: {
          plan_id: plan.plan_id,
          bom_id: bomId,
          goods_id: line.goods_id,
          sku_id: line.sku_id,
          bom_unit_qty: line.require_qty,
          standard_qty: standard,
          require_qty: standard,
          plan_out_qty: standard,
          unit_type: line.unit_type,
          remark: line.remark,
        },
      });
      if (fact < standard) {
        shortage = true;
        const shortageNo = await this.businessNumber.generate(BUSINESS_PREFIX.PRODUCTION_SHORTAGE);
        const item = await t.hspsi_production_shortage.create({
          data: {
            shortage_no: shortageNo,
            plan_id: plan.plan_id,
            goods_id: line.goods_id,
            sku_id: line.sku_id,
            unit_type: line.unit_type,
            require_qty: standard,
            fact_qty: fact,
            suggest_purchase_qty: standard - fact,
            status: 0,
            created_by: BigInt(u),
            updated_by: BigInt(u),
          },
        });
        await this.documentTrace.link(
          {
            upstreamType: 'production_plan',
            upstreamId: plan.plan_id,
            upstreamNo: planNo,
            downstreamType: 'production_shortage',
            downstreamId: item.shortage_id,
            downstreamNo: shortageNo,
            createdBy: u,
          },
          t,
        );
      }
    }
    await t.hspsi_production_plan.update({
      where: { plan_id: plan.plan_id },
      data: {
        plan_status: shortage
          ? PRODUCTION_PLAN_STATUS.SHORTAGE
          : PRODUCTION_PLAN_STATUS.PENDING_APPROVAL,
        material_status: shortage ? 2 : 1,
        stock_check_status: shortage ? 2 : 1,
        approve_status: 0,
      },
    });
    const purchase = shortage
      ? await this.createShortagePurchaseApplication(t, { ...plan, plan_no: planNo }, u)
      : null;
    return {
      id: plan.plan_id,
      planNo,
      type: 'production',
      created: true,
      shortage,
      purchaseApplicationId: purchase?.id,
    };
  }

  async savePlan(id: string | null, b: B, u: string, _submit: boolean) {
    const bom = await this.bom(String(b.bomId)),
      qty = Number(b.planQty);
    this.qty(qty, '生产数量');
    if (!b.sourceId) throw new BadRequestException('生产计划必须关联销售订单');
    const sourceId = BigInt(b.sourceId);
    const saved = await this.guardedTransaction(async (t) => {
      const base = {
        org_id: BigInt(b.orgId ?? bom.orgId),
        bom_id: BigInt(b.bomId),
        goods_id: BigInt(bom.goodsId),
        sku_id: BigInt(bom.skuId),
        plan_qty: this.qty(qty, '生产数量'),
        plan_date: new Date(b.planDate ?? Date.now()),
        warehouse_id: BigInt(b.warehouseId),
        product_warehouse_id: BigInt(b.productWarehouseId ?? 0),
        plan_status: PRODUCTION_PLAN_STATUS.PENDING_APPROVAL,
        material_status: 0,
        stock_check_status: 0,
        outbound_status: PRODUCTION_OUTBOUND_STATUS.NOT_STARTED,
        source_type: 'sales_order',
        source_id: sourceId,
        approve_status: 0,
        remark: String(b.remark ?? ''),
        updated_by: Number(u),
      };
      const capacity = await this.salesOrderPlanningCapacity(t, {
        sourceId,
        goodsId: base.goods_id,
        skuId: base.sku_id,
        excludePlanId: id ? BigInt(id) : undefined,
      });
      if (
        base.org_id !== capacity.order.org_id ||
        base.product_warehouse_id !== capacity.order.warehouse_id
      )
        throw new BadRequestException('生产计划组织和成品仓库必须与关联销售订单一致');
      if (qty > capacity.remainingQty + 0.000001)
        throw new BadRequestException(
          `生产数量不能超过销售订单剩余可计划数量 ${capacity.remainingQty}`,
        );
      let replacedShortages: Array<{ shortage_id: bigint }> = [];
      if (id) {
        const currentId = BigInt(id);
        await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${currentId} FOR UPDATE`;
        const current = await t.hspsi_production_plan.findFirst({
          where: { plan_id: currentId, deleted_at: null },
        });
        if (!current) throw new NotFoundException('生产计划不存在');
        if (current.source_id > 0n && base.source_id !== current.source_id)
          throw new BadRequestException('销售缺口生成的生产计划不允许更换或清空来源销售订单');
        const [outputCount, inputCount] = await Promise.all([
          t.hspsi_production_material_out.count({
            where: { plan_id: currentId, deleted_at: null },
          }),
          t.hspsi_production_plan_input.count({ where: { plan_id: currentId, deleted_at: null } }),
        ]);
        if (
          current.plan_status > 1 ||
          current.outbound_status !== PRODUCTION_OUTBOUND_STATUS.NOT_STARTED ||
          outputCount ||
          inputCount ||
          Number(current.delivered_qty) > 0
        )
          throw new BadRequestException('已提交审批后或已有出入库的生产计划不能修改业务字段');
        await this.assertNoActiveProcurement(t, currentId, '修改业务字段');
        replacedShortages = await t.hspsi_production_shortage.findMany({
          where: { plan_id: currentId, status: 0, deleted_at: null },
          select: { shortage_id: true },
        });
      }
      const newPlanNo = id
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.PRODUCTION_PLAN);
      const h = id
        ? await t.hspsi_production_plan.update({ where: { plan_id: BigInt(id) }, data: base })
        : await t.hspsi_production_plan.create({
            data: { ...base, plan_no: newPlanNo, created_by: Number(u) },
          });
      const planNo = h.plan_no;
      for (const shortage of replacedShortages)
        await this.documentTrace.removeForDocument('production_shortage', shortage.shortage_id, t);
      await t.hspsi_production_plan_detail.deleteMany({ where: { plan_id: h.plan_id } });
      await t.hspsi_production_shortage.deleteMany({ where: { plan_id: h.plan_id, status: 0 } });
      let shortage = false;
      for (const line of bom.details) {
        const standard = Number(line.quantity) * qty;
        const stock = await t.hspsi_inventory_batch_total.aggregate({
          _sum: { inventory_qty: true },
          where: {
            org_id: base.org_id,
            warehouse_id: base.warehouse_id,
            goods_id: BigInt(line.goodsId),
            sku_id: BigInt(line.skuId),
          },
        });
        const fact = Number(stock._sum.inventory_qty ?? 0);
        await t.hspsi_production_plan_detail.create({
          data: {
            plan_id: h.plan_id,
            bom_id: h.bom_id,
            goods_id: BigInt(line.goodsId),
            sku_id: BigInt(line.skuId),
            bom_unit_qty: Number(line.quantity),
            standard_qty: standard,
            require_qty: standard,
            plan_out_qty: standard,
            unit_type: Number(line.unitType),
            remark: String(line.remark ?? ''),
          },
        });
        if (fact < standard) {
          shortage = true;
          const shortageNo = await this.businessNumber.generate(
            BUSINESS_PREFIX.PRODUCTION_SHORTAGE,
          );
          await t.hspsi_production_shortage.create({
            data: {
              shortage_no: shortageNo,
              plan_id: h.plan_id,
              goods_id: BigInt(line.goodsId),
              sku_id: BigInt(line.skuId),
              unit_type: Number(line.unitType),
              require_qty: standard,
              fact_qty: fact,
              suggest_purchase_qty: standard - fact,
              status: 0,
              created_by: BigInt(u),
              updated_by: BigInt(u),
            },
          });
        }
      }
      await t.hspsi_production_plan.update({
        where: { plan_id: h.plan_id },
        data: {
          plan_status: shortage
            ? PRODUCTION_PLAN_STATUS.SHORTAGE
            : PRODUCTION_PLAN_STATUS.PENDING_APPROVAL,
          material_status: shortage ? 2 : 1,
          stock_check_status: shortage ? 2 : 1,
          approve_status: 0,
          approve_comment: '',
          approve_by: 0n,
          approve_date: null,
        },
      });
      if (Array.isArray(b.details))
        for (const line of b.details) {
          const requireQty = Number(line.quantity ?? line.requireQty ?? line.standardQty),
            planOutQty = Number(line.planOutQty ?? requireQty);
          this.qty(requireQty, '计划用量');
          this.qty(planOutQty, '计划出库量', true);
          await t.hspsi_production_plan_detail.updateMany({
            where: {
              plan_id: h.plan_id,
              goods_id: BigInt(line.goodsId),
              sku_id: BigInt(line.skuId),
            },
            data: {
              require_qty: this.qty(requireQty, '计划用量'),
              plan_out_qty: this.qty(planOutQty, '计划出库量', true),
              remark: String(line.remark ?? ''),
            },
          });
        }
      if (base.source_type === 'sales_order' && base.source_id > 0n)
        await this.documentTrace.link(
          {
            upstreamType: 'sales_order',
            upstreamId: base.source_id,
            downstreamType: 'production_plan',
            downstreamId: h.plan_id,
            downstreamNo: planNo,
            createdBy: u,
          },
          t,
        );
      const shortages = await t.hspsi_production_shortage.findMany({
        where: { plan_id: h.plan_id, deleted_at: null },
      });
      for (const item of shortages)
        await this.documentTrace.link(
          {
            upstreamType: 'production_plan',
            upstreamId: h.plan_id,
            upstreamNo: planNo,
            downstreamType: 'production_shortage',
            downstreamId: item.shortage_id,
            downstreamNo: item.shortage_no,
            createdBy: u,
          },
          t,
        );
      const purchase = shortage
        ? await this.createShortagePurchaseApplication(
            t,
            {
              plan_id: h.plan_id,
              plan_no: planNo,
              org_id: base.org_id,
              warehouse_id: base.warehouse_id,
            },
            u,
          )
        : null;
      return { planId: h.plan_id, shortage, purchaseApplicationId: purchase?.id };
    });
    return {
      id: saved.planId,
      shortage: saved.shortage,
      purchaseApplicationId: saved.purchaseApplicationId,
      message: saved.shortage
        ? '生产计划已创建，检测到缺料并已自动生成采购申请'
        : '生产计划已创建，原料充足，已进入待审核',
    };
  }
  async approvePlan(id: string, ok: boolean, comment: string, u: string, fromOa = false) {
    const planId = BigInt(id);
    if (!fromOa) await this.assertNoActiveOa(planId, '生产计划已进入OA审批，请在OA中处理');
    const result = await this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
      const plan = await t.hspsi_production_plan.findFirst({
        where: { plan_id: planId, deleted_at: null },
      });
      if (!plan) throw new NotFoundException('生产计划不存在');
      if (plan.plan_status !== PRODUCTION_PLAN_STATUS.PENDING_APPROVAL || plan.approve_status !== 0)
        throw new BadRequestException('仅待审核生产计划可操作');
      if (!ok) {
        await t.hspsi_production_plan.update({
          where: { plan_id: planId },
          data: {
            approve_status: 2,
            approve_comment: comment,
            approve_by: BigInt(u),
            approve_date: new Date(),
            plan_status: PRODUCTION_PLAN_STATUS.DRAFT,
            updated_by: Number(u),
          },
        });
        return { approved: false, shortage: false };
      }
      const details = await t.hspsi_production_plan_detail.findMany({ where: { plan_id: planId } });
      if (!details.length) throw new BadRequestException('生产计划没有BOM原料明细');
      const oldPending = await t.hspsi_production_shortage.findMany({
        where: { plan_id: planId, status: 0, deleted_at: null },
        select: { shortage_id: true },
      });
      if (oldPending.length) {
        await t.hspsi_production_shortage.updateMany({
          where: { shortage_id: { in: oldPending.map((item) => item.shortage_id) } },
          data: { deleted_at: new Date(), updated_by: BigInt(u) },
        });
        for (const item of oldPending)
          await this.documentTrace.removeForDocument('production_shortage', item.shortage_id, t);
      }
      const currentShortages: Array<{ shortage_id: bigint; shortage_no: string }> = [];
      for (const line of details) {
        const stock = await t.hspsi_inventory_batch_total.aggregate({
          _sum: { inventory_qty: true },
          where: {
            org_id: plan.org_id,
            warehouse_id: plan.warehouse_id,
            goods_id: line.goods_id,
            sku_id: line.sku_id,
          },
        });
        const fact = Number(stock._sum.inventory_qty ?? 0),
          required = Number(line.standard_qty);
        if (fact + 0.000001 < required) {
          const shortageNo = await this.businessNumber.generate(
            BUSINESS_PREFIX.PRODUCTION_SHORTAGE,
          );
          const shortage = await t.hspsi_production_shortage.create({
            data: {
              shortage_no: shortageNo,
              plan_id: planId,
              goods_id: line.goods_id,
              sku_id: line.sku_id,
              unit_type: line.unit_type,
              require_qty: required,
              fact_qty: fact,
              suggest_purchase_qty: required - fact,
              status: 0,
              created_by: BigInt(u),
              updated_by: BigInt(u),
            },
          });
          await this.documentTrace.link(
            {
              upstreamType: 'production_plan',
              upstreamId: planId,
              upstreamNo: plan.plan_no,
              downstreamType: 'production_shortage',
              downstreamId: shortage.shortage_id,
              downstreamNo: shortageNo,
              createdBy: u,
            },
            t,
          );
          currentShortages.push({ shortage_id: shortage.shortage_id, shortage_no: shortageNo });
        }
      }
      if (currentShortages.length) {
        await t.hspsi_production_plan.update({
          where: { plan_id: planId },
          data: {
            plan_status: PRODUCTION_PLAN_STATUS.SHORTAGE,
            material_status: 2,
            stock_check_status: 2,
            approve_status: 0,
            approve_comment: '',
            approve_by: 0n,
            approve_date: null,
            updated_by: Number(u),
          },
        });
        const purchase = await this.createShortagePurchaseApplication(t, plan, u);
        return { approved: false, shortage: true, purchaseApplicationId: purchase.id };
      }
      await t.hspsi_production_shortage.updateMany({
        where: { plan_id: planId, status: { in: [0, 1] }, deleted_at: null },
        data: { status: 2, updated_by: BigInt(u) },
      });
      await t.hspsi_production_plan.update({
        where: { plan_id: planId },
        data: {
          approve_status: 1,
          approve_comment: comment,
          approve_by: BigInt(u),
          approve_date: new Date(),
          plan_status: PRODUCTION_PLAN_STATUS.IN_PRODUCTION,
          material_status: plan.material_status === 4 ? 4 : 1,
          stock_check_status: 1,
          updated_by: Number(u),
        },
      });
      return { approved: true, shortage: false };
    });
    return {
      id,
      ...result,
      message: !ok
        ? '已驳回，计划可修改后重新提交'
        : result.shortage
          ? '审批前库存已发生变化，计划已转为缺料并自动生成采购申请'
          : '审批通过，计划已进入生产中',
    };
  }

  async handleOaApprovalResult(
    payload: ApprovalCallbackPayload,
    rawPayload: unknown,
    logId: bigint,
  ) {
    const instance = await this.p.hspsi_oa_approval_instance.findFirst({
      where: {
        business_type: 'production_plan',
        bus_key: payload.busKey,
        proc_inst_id: payload.procInstId,
        deleted_at: null,
      },
      orderBy: { id: 'desc' },
    });
    if (!instance) throw new NotFoundException('未找到对应的生产计划OA审批实例');
    const plan = await this.p.hspsi_production_plan.findFirst({
      where: { plan_id: instance.business_id, deleted_at: null },
    });
    if (!plan) throw new NotFoundException('OA审批对应的生产计划不存在');
    const passed = payload.procStatus === 'PASSED';
    const duplicate =
      instance.proc_status === payload.procStatus && plan.approve_status === (passed ? 1 : 2);
    const result = duplicate
      ? {}
      : await this.approvePlan(
          String(plan.plan_id),
          passed,
          this.oaComment(payload.procStatus),
          String(plan.created_by),
          true,
        );
    await this.p.$transaction(async (tx) => {
      await tx.hspsi_oa_approval_instance.update({
        where: { id: instance.id },
        data: {
          proc_key: payload.procKey,
          proc_status: payload.procStatus,
          callback_count: { increment: 1 },
          last_callback_at: new Date(),
          updated_by: 0n,
          updated_at: new Date(),
        },
      });
      await tx.hspsi_oa_approval_callback_log.update({
        where: { id: logId },
        data: {
          instance_id: instance.id,
          prj_cod: payload.prjCod,
          proc_status: payload.procStatus,
          bus_key: payload.busKey,
          proc_inst_id: payload.procInstId,
          proc_key: payload.procKey,
          raw_payload: JSON.stringify(rawPayload),
          processed: 1,
          process_result: duplicate ? '重复回调，已幂等确认' : '生产计划审批结果已处理',
          account_set_id: instance.account_set_id,
        },
      });
    });
    return {
      processed: true,
      duplicate,
      businessId: plan.plan_id,
      procStatus: payload.procStatus,
      ...result,
    };
  }

  private oaComment(status: ApprovalCallbackPayload['procStatus']) {
    return {
      PASSED: 'OA审批通过',
      REJECTED: 'OA审批驳回',
      CANCELED: 'OA审批取消',
      DELETED: 'OA审批流程删除',
    }[status];
  }

  private async assertNoActiveOa(businessId: bigint, message: string) {
    const repository = this.p.hspsi_oa_approval_instance;
    if (!repository) return;
    const active = await repository.findFirst({
      where: {
        business_type: 'production_plan',
        business_id: businessId,
        proc_status: { in: ['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'] },
        deleted_at: null,
      },
      select: { id: true },
    });
    if (active) throw new BadRequestException(message);
  }
  async deletePlan(id: string, u: string) {
    const planId = BigInt(id);
    await this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
      const plan = await t.hspsi_production_plan.findFirst({
        where: { plan_id: planId, deleted_at: null },
      });
      if (!plan) throw new NotFoundException('生产计划不存在');
      const [outputCount, inputCount] = await Promise.all([
        t.hspsi_production_material_out.count({ where: { plan_id: planId, deleted_at: null } }),
        t.hspsi_production_plan_input.count({ where: { plan_id: planId, deleted_at: null } }),
      ]);
      if (
        plan.outbound_status === PRODUCTION_OUTBOUND_STATUS.COMPLETED ||
        outputCount ||
        inputCount ||
        Number(plan.delivered_qty) > 0
      )
        throw new BadRequestException('已生成出库单或已执行的计划不可删除');
      await this.assertNoActiveProcurement(t, planId);
      const planShortages = await t.hspsi_production_shortage.findMany({
        where: { plan_id: planId, deleted_at: null },
        select: { shortage_id: true },
      });
      await t.hspsi_production_shortage.updateMany({
        where: { shortage_id: { in: planShortages.map((item) => item.shortage_id) } },
        data: { status: 3, deleted_at: new Date(), updated_by: BigInt(u) },
      });
      for (const shortage of planShortages)
        await this.documentTrace.removeForDocument('production_shortage', shortage.shortage_id, t);
      await t.hspsi_production_plan.update({
        where: { plan_id: planId },
        data: { deleted_at: new Date(), updated_by: Number(u) },
      });
      await this.documentTrace.removeForDocument('production_plan', id, t);
    });
    return { id, message: '删除成功' };
  }
  async shortages(q: B) {
    const { page, pageSize } = this.pg(q),
      where: Prisma.hspsi_production_shortageWhereInput = { deleted_at: null };
    if (q.planId) where.plan_id = BigInt(q.planId);
    if (q.status !== undefined && q.status !== '') where.status = Number(q.status);
    const [records, total] = await this.p.$transaction([
      this.p.hspsi_production_shortage.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { shortage_id: 'desc' },
      }),
      this.p.hspsi_production_shortage.count({ where }),
    ]);
    const plans = records.length
        ? await this.p.hspsi_production_plan.findMany({
            where: { plan_id: { in: records.map((i) => i.plan_id) }, deleted_at: null },
          })
        : [],
      planMap = new Map(plans.map((i) => [String(i.plan_id), i])),
      productGoodsIds = [...new Set(plans.map((p) => p.goods_id).filter(Boolean))],
      productGoods = productGoodsIds.length
        ? await this.p.hspsi_goods_info.findMany({ where: { goods_id: { in: productGoodsIds } } })
        : [];
    const items = await this.refs.enrich(
      records.map((i) => {
        const plan = planMap.get(String(i.plan_id));
        return {
          ...i,
          id: i.shortage_id,
          shortageNo: i.shortage_no,
          planId: i.plan_id,
          planNo: plan?.plan_no ?? '',
          productGoodsId: plan?.goods_id,
          productGoodsName:
            productGoods.find((g) => g.goods_id === plan?.goods_id)?.goods_name ?? '',
          goodsId: i.goods_id,
          skuId: i.sku_id,
          unitType: i.unit_type,
          requireQty: i.require_qty,
          factQty: i.fact_qty,
          gapQty: Number(i.require_qty) - Number(i.fact_qty),
          purchaseQty: i.suggest_purchase_qty,
          suggestPurchaseDays: i.suggest_purchase_days,
          purchaseId: i.pur_id,
          status: i.status,
          createdBy: i.created_by,
          updatedBy: i.updated_by,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
        };
      }),
      { status: 'production_shortage_status' },
    );
    return { items, total, page, pageSize };
  }
  async outputs(q: B) {
    const { page, pageSize } = this.pg(q),
      hasOutType = q.outType !== undefined && q.outType !== '',
      where: Prisma.hspsi_production_material_outWhereInput = {
        deleted_at: null,
        ...(hasOutType ? {} : { out_type: { not: 2 } }),
      };
    if (q.status !== undefined && q.status !== '') where.confirm_tag = Number(q.status);
    if (hasOutType) where.out_type = Number(q.outType);
    const [records, total] = await this.p.$transaction([
      this.p.hspsi_production_material_out.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { out_id: 'desc' },
      }),
      this.p.hspsi_production_material_out.count({ where }),
    ]);
    const planIds = records.filter((i) => i.plan_id !== null).map((i) => BigInt(i.plan_id!)),
      plans = planIds.length
        ? await this.p.hspsi_production_plan.findMany({ where: { plan_id: { in: planIds } } })
        : [],
      planMap = new Map(plans.map((i) => [String(i.plan_id), i])),
      bomIds = [...new Set(plans.map((p) => p.bom_id).filter(Boolean))],
      boms = bomIds.length
        ? await this.p.hspsi_production_bom.findMany({ where: { bom_id: { in: bomIds } } })
        : [],
      bomMap = new Map(boms.map((b) => [String(b.bom_id), b.bom_no])),
      details = records.length
        ? await this.p.hspsi_production_material_out_detail.groupBy({
            by: ['out_id'],
            where: { out_id: { in: records.map((i) => i.out_id) } },
            _count: true,
            _sum: { out_qty: true },
          })
        : [];
    const goodsIds = [...new Set(plans.map((p) => p.goods_id).filter(Boolean))],
      goods = goodsIds.length
        ? await this.p.hspsi_goods_info.findMany({ where: { goods_id: { in: goodsIds } } })
        : [],
      goodsMap = new Map(goods.map((g) => [String(g.goods_id), g]));
    const warehouseIds = [
        ...new Set(
          [
            ...records.map((i) => i.warehouse_id).filter(Boolean),
            ...plans.map((p) => p.warehouse_id).filter(Boolean),
          ].map(Number),
        ),
      ],
      warehouses = warehouseIds.length
        ? await this.p.hspsi_basic_warehouse.findMany({
            where: { warehouse_id: { in: warehouseIds } },
          })
        : [],
      whMap = new Map(warehouses.map((w) => [String(w.warehouse_id), w]));
    const items = await this.refs.enrich(
      records.map((i) => {
        const plan = planMap.get(String(i.plan_id)),
          summary = details.find((d) => d.out_id === i.out_id),
          bomNo = plan ? bomMap.get(String(plan.bom_id)) : '',
          g = plan ? goodsMap.get(String(plan.goods_id)) : null,
          w = whMap.get(String(i.warehouse_id ?? 0));
        return {
          ...i,
          id: i.out_id,
          outNo: i.out_no,
          planId: i.plan_id,
          planNo: plan?.plan_no ?? '',
          bomNo,
          bomId: plan?.bom_id,
          goodsId: plan?.goods_id,
          goodsName: g?.goods_name ?? '',
          warehouseId: i.warehouse_id,
          warehouseName: w?.name ?? '',
          orgId: i.org_id,
          outDate: i.out_date,
          outType: i.out_type,
          destinationType: i.destination_type,
          destinationTypeName: '',
          outTypeName: '',
          materialCount: summary?._count ?? 0,
          totalQty: summary?._sum.out_qty ?? 0,
          stockCheckStatus: plan?.stock_check_status,
          confirmStatus: i.confirm_tag,
          status: i.confirm_tag,
          createdBy: i.created_by,
          updatedBy: i.updated_by,
          createdAt: i.created_date,
          updatedAt: i.updated_date,
        };
      }),
      {
        outType: 'production_material_out_type',
        destinationType: 'temporary_outbound_destination',
        confirmStatus: 'confirm_status',
        status: 'confirm_status',
      },
    );
    return { items, total, page, pageSize };
  }
  async output(id: string) {
    const i = await this.p.hspsi_production_material_out.findFirst({
      where: { out_id: Number(id), deleted_at: null },
    });
    if (!i) throw new NotFoundException('出库单不存在');
    const details = await this.p.hspsi_production_material_out_detail.findMany({
      where: { out_id: i.out_id },
    });
    let supplements: any[] = [];
    let supplementDetails: Awaited<
      ReturnType<typeof this.p.hspsi_production_material_out_detail.findMany>
    > = [];
    if (i.out_type === 1 && i.plan_id) {
      const tempOuts = await this.p.hspsi_production_material_out.findMany({
        where: { plan_id: i.plan_id, out_type: 2, deleted_at: null },
        orderBy: { out_id: 'desc' },
      });
      if (tempOuts.length) {
        const tempIds = tempOuts.map((t) => t.out_id);
        supplementDetails = await this.p.hspsi_production_material_out_detail.findMany({
          where: { out_id: { in: tempIds } },
        });
        supplements = tempOuts.map((t) => ({
          id: t.out_id,
          outNo: t.out_no,
          outDate: t.out_date,
          confirmStatus: t.confirm_tag,
          remark: t.remark,
          createdAt: t.created_date,
          details: supplementDetails
            .filter((d) => d.out_id === t.out_id)
            .map((d) => ({
              goodsId: d.goods_id,
              skuId: d.sku_id,
              unitType: d.unit_type,
              quantity: d.out_qty,
              batchNo: d.batch_no,
              remark: d.remark,
            })),
        }));
      }
    }
    const allDetails = [...details, ...supplementDetails];
    const goodsIds = [
      ...new Set(
        allDetails.map((line) => line.goods_id).filter((value): value is number => value !== null),
      ),
    ];
    const skuIds = [
      ...new Set(
        allDetails.map((line) => line.sku_id).filter((value): value is number => value !== null),
      ),
    ];
    const unitTypes = [
      ...new Set(
        allDetails
          .map((line) => line.unit_type)
          .filter((value): value is number => value !== null)
          .map((value) => BigInt(value)),
      ),
    ];
    const [goods, skus, units, plan, warehouse] = await Promise.all([
      goodsIds.length
        ? this.p.hspsi_goods_info.findMany({ where: { goods_id: { in: goodsIds } } })
        : [],
      skuIds.length
        ? this.p.hspsi_goods_info_sku.findMany({ where: { sku_id: { in: skuIds } } })
        : [],
      unitTypes.length
        ? this.p.hspsi_basic_unit.findMany({ where: { id: { in: unitTypes } } })
        : [],
      i.plan_id ? this.p.hspsi_production_plan.findFirst({ where: { plan_id: i.plan_id } }) : null,
      i.warehouse_id
        ? this.p.hspsi_basic_warehouse.findFirst({
            where: { warehouse_id: Number(i.warehouse_id) },
          })
        : null,
    ]);
    const enrichLine = (line: (typeof allDetails)[number]) => ({
      id: line.serial_number,
      goodsId: line.goods_id,
      goodsCode:
        goods.find((item) => String(item.goods_id) === String(line.goods_id))?.query_code ?? '',
      goodsName:
        goods.find((item) => String(item.goods_id) === String(line.goods_id))?.goods_name ?? '',
      skuId: line.sku_id,
      skuSpec: skus.find((item) => String(item.sku_id) === String(line.sku_id))?.spec_models ?? '',
      unitType: line.unit_type,
      unitName: units.find((item) => item.id === BigInt(Number(line.unit_type ?? 0)))?.name ?? '',
      quantity: line.out_qty,
      batchNo: line.batch_no,
      remark: line.remark,
    });
    supplements = supplements.map((supplement) => ({
      ...supplement,
      details: supplement.details.map((line: B) => {
        const source = supplementDetails.find(
          (item) =>
            String(item.goods_id) === String(line.goodsId) &&
            String(item.sku_id) === String(line.skuId) &&
            String(item.batch_no) === String(line.batchNo) &&
            String(item.out_id) === String(supplement.id),
        );
        return source ? enrichLine(source) : line;
      }),
    }));
    return {
      ...i,
      id: i.out_id,
      outNo: i.out_no,
      planId: i.plan_id,
      planNo: plan?.plan_no ?? '',
      warehouseId: i.warehouse_id,
      warehouseName: warehouse?.name ?? '',
      orgId: i.org_id,
      outDate: i.out_date,
      outType: i.out_type,
      destinationType: i.destination_type,
      confirmStatus: i.confirm_tag,
      details: details.map(enrichLine),
      supplements,
    };
  }
  async createOutput(b: B, u: string) {
    const outType = Number(b.outType ?? 1),
      isLab = outType === 3;
    if (isLab) {
      const id = await this.p.$transaction(async (t) => {
        const outNo = await this.businessNumber.generate(
          BUSINESS_PREFIX.PRODUCTION_MATERIAL_OUTPUT,
        );
        const h = await t.hspsi_production_material_out.create({
          data: {
            out_no: outNo,
            warehouse_id: Number(b.warehouseId),
            org_id: Number(b.orgId ?? 1),
            out_date: new Date(b.outDate ?? Date.now()),
            out_type: 3,
            destination_type: Number(b.destinationType),
            confirm_tag: 0,
            remark: String(b.remark ?? ''),
            created_by: Number(u),
            created_date: new Date(),
            updated_by: Number(u),
            updated_date: new Date(),
          },
        });
        await t.hspsi_production_material_out_detail.createMany({
          data: b.details.map((l: B) => ({
            out_id: h.out_id,
            goods_id: Number(l.goodsId),
            sku_id: Number(l.skuId),
            unit_type: Number(l.unitType),
            out_qty: this.qty(l.quantity, '出库数量'),
            batch_no: String(l.batchNo ?? ''),
            remark: String(l.remark ?? ''),
          })),
        });
        return h.out_id;
      });
      return { id, message: '实验出库单已生成' };
    }
    if (![1, 2].includes(outType)) throw new BadRequestException('生产出库类型无效');
    if (!Array.isArray(b.details) || !b.details.length)
      throw new BadRequestException('至少一条出库明细');
    const planId = BigInt(b.planId);
    const id = await this.p.$transaction(async (t) => {
      await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
      const plan = await t.hspsi_production_plan.findFirst({
        where: { plan_id: planId, deleted_at: null },
      });
      if (!plan) throw new NotFoundException('生产计划不存在');
      if (plan.approve_status !== 1) throw new BadRequestException('仅已审批计划可出库');
      if (outType === 1) {
        this.assertFormalOutputReady(
          plan.plan_status,
          plan.material_status,
          plan.stock_check_status,
        );
        const existing = await t.hspsi_production_material_out.count({
          where: { plan_id: plan.plan_id, out_type: 1, deleted_at: null },
        });
        if (existing || plan.outbound_status !== PRODUCTION_OUTBOUND_STATUS.NOT_STARTED)
          throw new BadRequestException('该生产计划已存在有效正式BOM出库单');
        await this.assertFormalPlanStockReady(t, plan);
      } else if (plan.outbound_status !== PRODUCTION_OUTBOUND_STATUS.COMPLETED) {
        throw new BadRequestException('正式BOM尚未确认出库，不能临时补料');
      }
      const outNo = await this.businessNumber.generate(BUSINESS_PREFIX.PRODUCTION_MATERIAL_OUTPUT);
      const h = await t.hspsi_production_material_out.create({
        data: {
          out_no: outNo,
          plan_id: plan.plan_id,
          warehouse_id: Number(plan.warehouse_id),
          org_id: Number(plan.org_id),
          out_date: new Date(b.outDate ?? Date.now()),
          out_type: outType,
          confirm_tag: 0,
          remark: String(b.remark ?? ''),
          created_by: Number(u),
          created_date: new Date(),
          updated_by: Number(u),
          updated_date: new Date(),
        },
      });
      await t.hspsi_production_material_out_detail.createMany({
        data: b.details.map((l: B) => ({
          out_id: h.out_id,
          goods_id: Number(l.goodsId),
          sku_id: Number(l.skuId),
          unit_type: Number(l.unitType),
          out_qty: this.qty(l.quantity, '出库数量'),
          batch_no: String(l.batchNo ?? ''),
          remark: String(l.remark ?? ''),
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: 'production_plan',
          upstreamId: plan.plan_id,
          upstreamNo: plan.plan_no,
          downstreamType: 'production_material_output',
          downstreamId: h.out_id,
          downstreamNo: outNo,
          relationKind: outType === 1 ? 'generated' : 'supplement',
          createdBy: u,
        },
        t,
      );
      if (outType === 1)
        await t.hspsi_production_plan.update({
          where: { plan_id: plan.plan_id },
          data: { outbound_status: PRODUCTION_OUTBOUND_STATUS.PENDING, updated_by: Number(u) },
        });
      return h.out_id;
    });
    return { id, message: '出库草稿已生成' };
  }
  async confirmOutput(id: string, b: B, u: string) {
    const outId = Number(id);
    let alreadyConfirmed = false;
    await this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT out_id FROM hspsi_production_material_out WHERE out_id=${outId} FOR UPDATE`;
      const current = await t.hspsi_production_material_out.findFirst({
        where: { out_id: outId, deleted_at: null },
      });
      if (!current) throw new NotFoundException('生产出库单不存在');
      if (current.confirm_tag === 1) {
        alreadyConfirmed = true;
        return;
      }
      const savedDetails = await t.hspsi_production_material_out_detail.findMany({
        where: { out_id: outId },
      });
      const requested: B[] =
        Array.isArray(b.details) && b.details.length
          ? b.details
          : savedDetails.map((line) => ({
              goodsId: line.goods_id,
              skuId: line.sku_id,
              unitType: line.unit_type,
              quantity: line.out_qty,
              batchNo: line.batch_no,
              remark: line.remark,
            }));
      if (!requested.length) throw new BadRequestException('至少一条出库明细');
      for (const line of requested)
        if (
          !Number.isSafeInteger(Number(line.quantity)) ||
          Number(line.quantity) <= 0 ||
          !String(line.batchNo ?? '').trim()
        )
          throw new BadRequestException('出库数量必须为正整数且批号必填');
      let plan: Awaited<ReturnType<typeof t.hspsi_production_plan.findFirst>> = null;
      let planDetails: Awaited<ReturnType<typeof t.hspsi_production_plan_detail.findMany>> = [];
      if (current.out_type !== 3) {
        if (!current.plan_id) throw new BadRequestException('生产出库单缺少来源生产计划');
        const planId = BigInt(current.plan_id);
        await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
        plan = await t.hspsi_production_plan.findFirst({
          where: { plan_id: planId, deleted_at: null },
        });
        if (!plan || plan.approve_status !== 1)
          throw new BadRequestException('来源生产计划不存在或未审批');
        planDetails = await t.hspsi_production_plan_detail.findMany({ where: { plan_id: planId } });
        const allowed = new Set(planDetails.map((line) => `${line.goods_id}-${line.sku_id}`));
        for (const line of requested)
          if (!allowed.has(`${line.goodsId}-${line.skuId}`))
            throw new BadRequestException('出库物料必须来自计划BOM');
        if (current.out_type === 1) {
          this.assertFormalOutputReady(
            plan.plan_status,
            plan.material_status,
            plan.stock_check_status,
          );
          const formalOutputs = await t.hspsi_production_material_out.findMany({
            where: { plan_id: current.plan_id, out_type: 1, deleted_at: null },
            select: { out_id: true },
          });
          if (formalOutputs.length !== 1 || formalOutputs[0]?.out_id !== outId)
            throw new BadRequestException('该生产计划存在多张有效正式BOM出库单，请先清理重复草稿');
          if (
            plan.outbound_status !== PRODUCTION_OUTBOUND_STATUS.NOT_STARTED &&
            plan.outbound_status !== PRODUCTION_OUTBOUND_STATUS.PENDING
          )
            throw new BadRequestException('当前生产计划状态不能确认正式BOM出库');
          for (const material of planDetails) {
            const actual = requested
                .filter(
                  (line) =>
                    String(line.goodsId) === String(material.goods_id) &&
                    String(line.skuId) === String(material.sku_id),
                )
                .reduce((sum, line) => sum + Number(line.quantity), 0),
              planned = Number(material.plan_out_qty);
            if (actual > planned + 0.0001)
              throw new BadRequestException(
                `原料 ${material.goods_id} 各批号合计 ${actual} 不能超过计划出库量 ${material.plan_out_qty}`,
              );
            if (actual < planned - 0.0001)
              throw new BadRequestException(
                `原料 ${material.goods_id} 为整单出库，各批号合计必须等于计划出库量 ${material.plan_out_qty}`,
              );
          }
          await this.assertFormalBatchStockReady(t, plan.org_id, plan.warehouse_id, requested);
        } else if (plan.outbound_status !== PRODUCTION_OUTBOUND_STATUS.COMPLETED)
          throw new BadRequestException('正式BOM尚未确认出库，不能确认临时补料');
      }
      await t.hspsi_production_material_out_detail.deleteMany({ where: { out_id: outId } });
      await t.hspsi_production_material_out_detail.createMany({
        data: requested.map((line) => ({
          out_id: outId,
          goods_id: Number(line.goodsId),
          sku_id: Number(line.skuId),
          unit_type: Number(line.unitType),
          out_qty: this.qty(line.quantity, '出库数量'),
          batch_no: String(line.batchNo).trim(),
          remark: String(line.remark ?? ''),
        })),
      });
      if (plan)
        await this.documentTrace.link(
          {
            upstreamType: 'production_plan',
            upstreamId: plan.plan_id,
            upstreamNo: plan.plan_no,
            downstreamType: 'production_material_output',
            downstreamId: current.out_id,
            downstreamNo: current.out_no,
            relationKind: current.out_type === 2 ? 'supplement' : 'generated',
            createdBy: u,
          },
          t,
        );
      await this.posting.post(
        {
          orgId: BigInt(current.org_id ?? 0),
          warehouseId: BigInt(current.warehouse_id ?? 0),
          direction: -1,
          operationType: 2,
          inventoryMode: INVENTORY_BUSINESS_MODE.REQUISITION_OR_PRODUCTION_OUTPUT,
          sourceId: BigInt(current.out_id),
          sourceType: 'production_output',
          sourceNo: current.out_no,
          operationBy: u,
          idempotencyKey: `production-output:${id}`,
          remark: String(b.comment ?? '') || '生产原料出库',
          lines: requested.map((line) => ({
            goodsId: line.goodsId,
            skuId: line.skuId,
            batchNo: line.batchNo,
            unitType: line.unitType,
            quantity: String(line.quantity),
          })),
        },
        t,
      );
      await t.hspsi_production_material_out.update({
        where: { out_id: outId },
        data: { confirm_tag: 1, updated_by: Number(u), updated_date: new Date() },
      });
      if (plan && current.out_type === 1)
        await t.hspsi_production_plan.update({
          where: { plan_id: plan.plan_id },
          data: {
            outbound_status: PRODUCTION_OUTBOUND_STATUS.COMPLETED,
            plan_status: 3,
            updated_by: Number(u),
          },
        });
    });
    return { id, message: alreadyConfirmed ? '已确认' : '出库确认成功' };
  }
  async inputs(q: B) {
    const { page, pageSize } = this.pg(q),
      where: Prisma.hspsi_production_plan_inputWhereInput = { deleted_at: null };
    const [records, total] = await this.p.$transaction([
      this.p.hspsi_production_plan_input.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.p.hspsi_production_plan_input.count({ where }),
    ]);
    const plans = records.length
        ? await this.p.hspsi_production_plan.findMany({
            where: { plan_id: { in: records.map((i) => i.plan_id) } },
          })
        : [],
      planMap = new Map(plans.map((i) => [String(i.plan_id), i]));
    const items = await this.refs.enrich(
      records.map((i) => {
        const plan = planMap.get(String(i.plan_id));
        return {
          ...i,
          id: i.id,
          inputNo: i.input_no,
          planId: i.plan_id,
          planNo: plan?.plan_no ?? '',
          goodsId: i.goods_id,
          skuId: i.sku_id,
          unitType: 0,
          orgId: i.org_id,
          warehouseId: i.warehouse_id,
          inputDate: i.input_date,
          productDate: i.product_date,
          quantity: i.fact_input_qty,
          cumulativeQty: plan?.delivered_qty ?? i.fact_input_qty,
          planQty: plan?.plan_qty ?? 0,
          deliveryProgress:
            Number(plan?.plan_qty ?? 0) > 0
              ? Math.min(
                  100,
                  (Number(plan?.delivered_qty ?? 0) * 100) / Number(plan?.plan_qty ?? 1),
                )
              : 0,
          batchNo: i.batch_no,
          position: i.input_position,
          validityPeriod: i.validity_period,
          createdBy: i.created_by,
          updatedBy: i.updated_by,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
          status: 1,
        };
      }),
      { status: 'confirm_status' },
    );
    return { items, total, page, pageSize };
  }
  async input(id: string) {
    const result = (await this.inputs({ page: 1, pageSize: 100 })).items.find(
      (item) => String(item.id) === id,
    );
    if (!result) throw new NotFoundException('成品入库单不存在');
    return result;
  }
  async createInput(b: B, u: string) {
    const planId = BigInt(b.planId),
      qty = Number(b.quantity),
      warehouseId = BigInt(b.warehouseId);
    this.qty(qty, '入库数量');
    return this.p.$transaction(async (t) => {
      await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
      const plan = await t.hspsi_production_plan.findFirst({
        where: { plan_id: planId, deleted_at: null },
      });
      if (!plan) throw new NotFoundException('生产计划不存在');
      if (plan.outbound_status !== PRODUCTION_OUTBOUND_STATUS.COMPLETED)
        throw new BadRequestException('原料尚未正式出库，不能进行成品入库');
      const remaining = Number(plan.plan_qty) - Number(plan.delivered_qty);
      if (qty > remaining)
        throw new BadRequestException(`本次入库数量不能超过剩余可入数量 ${remaining}`);
      const warehouse = await t.hspsi_basic_warehouse.findFirst({
        where: { warehouse_id: warehouseId, org_id: plan.org_id, status: 1, deleted_at: null },
      });
      if (!warehouse) throw new BadRequestException('成品仓库不属于计划组织或已停用');
      const no = await this.businessNumber.generate(BUSINESS_PREFIX.PRODUCTION_PRODUCT_INPUT);
      const h = await t.hspsi_production_plan_input.create({
        data: {
          input_no: no,
          plan_id: plan.plan_id,
          batch_no: String(b.batchNo ?? '').trim() || generateBatchNo(),
          org_id: plan.org_id,
          goods_id: plan.goods_id,
          sku_id: plan.sku_id,
          warehouse_id: warehouseId,
          input_date: new Date(b.inputDate ?? Date.now()),
          fact_input_qty: this.qty(qty, '入库数量'),
          input_position: String(b.position ?? ''),
          validity_period: b.validityPeriod ? new Date(b.validityPeriod) : null,
          product_date: b.productDate ? new Date(b.productDate) : new Date(),
          remark: String(b.remark ?? ''),
          created_by: BigInt(u),
          updated_by: BigInt(u),
        },
      });
      await this.documentTrace.link(
        {
          upstreamType: 'production_plan',
          upstreamId: plan.plan_id,
          upstreamNo: plan.plan_no,
          downstreamType: 'production_input',
          downstreamId: h.id,
          downstreamNo: no,
          createdBy: u,
        },
        t,
      );
      await this.posting.post(
        {
          orgId: plan.org_id,
          warehouseId,
          direction: 1,
          operationType: 1,
          inventoryMode: INVENTORY_BUSINESS_MODE.PRODUCTION_INPUT,
          sourceId: h.id,
          sourceType: 'production_input',
          sourceNo: no,
          operationBy: u,
          idempotencyKey: `production-input:${h.id}`,
          remark: '生产成品入库',
          lines: [
            {
              goodsId: plan.goods_id,
              skuId: plan.sku_id,
              batchNo: String(b.batchNo),
              quantity: String(qty),
            },
          ],
        },
        t,
      );
      await this.inventoryAlerts.syncExpiryAlert(t, {
        goodsId: plan.goods_id,
        skuId: plan.sku_id,
        warehouseId,
        batchNo: String(b.batchNo),
        endDay: b.validityPeriod,
      });
      const delivered = Number(plan.delivered_qty) + qty;
      await t.hspsi_production_plan.update({
        where: { plan_id: plan.plan_id },
        data: { delivered_qty: delivered, plan_status: delivered >= Number(plan.plan_qty) ? 5 : 4 },
      });
      return { id: h.id, message: '成品入库成功' };
    });
  }
  async deleteInput(id: string, u: string) {
    const i = await this.p.hspsi_production_plan_input.findFirst({
      where: { id: BigInt(id), deleted_at: null },
    });
    if (!i) throw new NotFoundException('入库记录不存在');
    const plan = await this.plan(String(i.plan_id));
    await this.p.$transaction(async (t) => {
      await this.posting.post(
        {
          orgId: i.org_id,
          warehouseId: i.warehouse_id,
          direction: -1,
          operationType: 2,
          inventoryMode: INVENTORY_BUSINESS_MODE.PRODUCTION_INPUT,
          sourceId: i.id,
          sourceType: 'production_input_reverse',
          sourceNo: i.input_no,
          operationBy: u,
          idempotencyKey: `production-input:${id}:reverse`,
          remark: '成品入库回退',
          lines: [
            {
              goodsId: i.goods_id,
              skuId: i.sku_id,
              batchNo: i.batch_no,
              quantity: String(i.fact_input_qty),
            },
          ],
        },
        t,
      );
      const delivered = Math.max(0, Number(plan.deliveredQty) - Number(i.fact_input_qty));
      await t.hspsi_production_plan_input.update({
        where: { id: i.id },
        data: { deleted_at: new Date(), updated_by: BigInt(u) },
      });
      await t.hspsi_production_plan.update({
        where: { plan_id: i.plan_id },
        data: { delivered_qty: delivered, plan_status: delivered ? 4 : 3 },
      });
      await this.documentTrace.removeForDocument('production_input', i.id, t);
    });
    return { id, message: '已回退库存并删除入库记录' };
  }

  async saveBomChecked(id: string | null, b: B, u: string) {
    if (id) {
      const refCount = await this.p.hspsi_production_plan.count({
        where: { bom_id: BigInt(id), deleted_at: null },
      });
      if (refCount > 0) {
        const allowed = ['status'];
        const updates = Object.keys(b).filter((k) => k !== 'details' && !allowed.includes(k));
        if (updates.length) throw new BadRequestException('BOM已被生产计划引用，除状态外不可修改');
        return this.p.hspsi_production_bom
          .update({
            where: { bom_id: BigInt(id) },
            data: { status: Number(b.status ?? 1), updated_by: Number(u) },
          })
          .then(() => ({ id, message: '状态已更新' }));
      }
    }
    const lines = Array.isArray(b.details) ? b.details : [];
    if (!String(b.bomName ?? '').trim() || !b.goodsId || !b.warehouseId || !b.orgId)
      throw new BadRequestException('BOM名称、成品、组织和原料仓库必填');
    if (!lines.length) throw new BadRequestException('至少一条原料');
    const keys = new Set<string>();
    for (const line of lines) {
      const key = `${line.goodsId}-${line.skuId ?? 0}`;
      if (String(line.goodsId) === String(b.goodsId))
        throw new BadRequestException('成品不得作为自身原料');
      if (keys.has(key)) throw new BadRequestException('同一原料和SKU不得重复');
      this.qty(line.quantity, '单件需求量');
      keys.add(key);
    }
    await this.masterData.assertGoodsActive(b.orgId, [{ goodsId: b.goodsId, skuId: b.skuId }]);
    await this.masterData.assertGoodsLines(b.orgId, b.warehouseId, lines);
    return this.saveBom(id, b, u);
  }

  async savePlanChecked(id: string | null, b: B, u: string, submit: boolean) {
    const bom = await this.bom(String(b.bomId));
    await this.masterData.assertGoodsLines(
      b.orgId ?? bom.orgId,
      b.warehouseId,
      bom.details.map((line: B) => ({ goodsId: line.goodsId, skuId: line.skuId })),
    );
    await this.masterData.assertGoodsLines(b.orgId ?? bom.orgId, b.productWarehouseId, [
      { goodsId: bom.goodsId, skuId: bom.skuId },
    ]);
    if (id) {
      const old = await this.plan(id);
      if (Number(old.planStatus) > 1)
        throw new BadRequestException('提交审核后的计划只允许通过专用业务动作变更');
    }
    return this.savePlan(id, b, u, submit);
  }

  async recheckPlan(id: string, u: string) {
    const plan = await this.plan(id);
    if (
      Number(plan.approveStatus) !== 0 ||
      Number(plan.planStatus) !== PRODUCTION_PLAN_STATUS.SHORTAGE ||
      Number(plan.outboundStatus) !== PRODUCTION_OUTBOUND_STATUS.NOT_STARTED ||
      Number(plan.deliveredQty) > 0
    )
      throw new BadRequestException('仅尚未审批、尚未执行且处于缺料状态的计划可重新校验');
    if (Number(plan.materialStatus) !== 4)
      throw new BadRequestException('采购入库尚未补齐全部缺料，暂不能重新校验');
    return this.guardedTransaction(async (t) => {
      const planId = BigInt(id);
      await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
      const current = await t.hspsi_production_plan.findFirst({
        where: { plan_id: planId, deleted_at: null },
      });
      if (
        !current ||
        current.approve_status !== 0 ||
        current.plan_status !== PRODUCTION_PLAN_STATUS.SHORTAGE ||
        current.material_status !== 4 ||
        current.outbound_status !== PRODUCTION_OUTBOUND_STATUS.NOT_STARTED ||
        Number(current.delivered_qty) > 0
      )
        throw new BadRequestException('生产计划状态已变化或采购入库尚未补齐，不能重新校验');
      const outputCount = await t.hspsi_production_material_out.count({
        where: { plan_id: planId, deleted_at: null },
      });
      if (outputCount) throw new BadRequestException('生产计划已生成出库单，不能重新校验');
      const oldShortages = await t.hspsi_production_shortage.findMany({
        where: { plan_id: BigInt(id), status: 0, deleted_at: null },
        select: { shortage_id: true },
      });
      await t.hspsi_production_shortage.updateMany({
        where: { plan_id: BigInt(id), status: 0, deleted_at: null },
        data: { deleted_at: new Date(), updated_by: BigInt(u) },
      });
      await t.hspsi_production_shortage.updateMany({
        where: { plan_id: BigInt(id), status: 1, deleted_at: null },
        data: { status: 2, updated_by: BigInt(u) },
      });
      for (const item of oldShortages)
        await this.documentTrace.removeForDocument('production_shortage', item.shortage_id, t);
      let shortage = false;
      for (const line of plan.details) {
        const stock = await t.hspsi_inventory_batch_total.aggregate({
          _sum: { inventory_qty: true },
          where: {
            org_id: BigInt(plan.orgId),
            warehouse_id: BigInt(plan.warehouseId),
            goods_id: BigInt(line.goodsId),
            sku_id: BigInt(line.skuId),
          },
        });
        const fact = Number(stock._sum.inventory_qty ?? 0),
          standard = Number(line.standardQty);
        if (fact < standard) {
          shortage = true;
          const shortageNo = await this.businessNumber.generate(
            BUSINESS_PREFIX.PRODUCTION_SHORTAGE,
          );
          const item = await t.hspsi_production_shortage.create({
            data: {
              shortage_no: shortageNo,
              plan_id: BigInt(id),
              goods_id: BigInt(line.goodsId),
              sku_id: BigInt(line.skuId),
              unit_type: Number(line.unitType),
              require_qty: standard,
              fact_qty: fact,
              suggest_purchase_qty: standard - fact,
              status: 0,
              created_by: BigInt(u),
              updated_by: BigInt(u),
            },
          });
          await this.documentTrace.link(
            {
              upstreamType: 'production_plan',
              upstreamId: plan.id,
              upstreamNo: plan.planNo,
              downstreamType: 'production_shortage',
              downstreamId: item.shortage_id,
              downstreamNo: shortageNo,
              createdBy: u,
            },
            t,
          );
        }
      }
      await t.hspsi_production_plan.update({
        where: { plan_id: BigInt(id) },
        data: {
          plan_status: shortage
            ? PRODUCTION_PLAN_STATUS.SHORTAGE
            : PRODUCTION_PLAN_STATUS.PENDING_APPROVAL,
          stock_check_status: shortage ? 2 : 1,
          material_status: shortage ? 2 : 4,
          approve_status: 0,
          approve_comment: '',
          approve_by: 0n,
          approve_date: null,
          updated_by: Number(u),
        },
      });
      const purchase = shortage
        ? await this.createShortagePurchaseApplication(
            t,
            {
              plan_id: current.plan_id,
              plan_no: current.plan_no,
              org_id: current.org_id,
              warehouse_id: current.warehouse_id,
            },
            u,
          )
        : null;
      return {
        id,
        shortage,
        purchaseApplicationId: purchase?.id,
        message: shortage
          ? '库存仍不足，已更新缺料并自动生成新的采购申请'
          : '库存校验通过，生产计划已进入待审核',
      };
    });
  }

  async restartPlan(id: string, u: string) {
    const planId = BigInt(id);
    return this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
      const plan = await t.hspsi_production_plan.findFirst({
        where: { plan_id: planId, deleted_at: null },
      });
      if (!plan) throw new NotFoundException('生产计划不存在');
      if (
        plan.plan_status !== PRODUCTION_PLAN_STATUS.APPROVED ||
        plan.material_status !== 4 ||
        plan.stock_check_status !== 1 ||
        plan.outbound_status !== PRODUCTION_OUTBOUND_STATUS.NOT_STARTED ||
        Number(plan.delivered_qty) > 0
      )
        throw new BadRequestException('当前计划不符合历史重启迁移条件');
      const outputCount = await t.hspsi_production_material_out.count({
        where: { plan_id: planId, deleted_at: null },
      });
      if (outputCount) throw new BadRequestException('生产计划已生成出库单，不能重启');
      const details = await t.hspsi_production_plan_detail.findMany({ where: { plan_id: planId } });
      for (const line of details) {
        const stock = await t.hspsi_inventory_batch_total.aggregate({
          _sum: { inventory_qty: true },
          where: {
            org_id: plan.org_id,
            warehouse_id: plan.warehouse_id,
            goods_id: line.goods_id,
            sku_id: line.sku_id,
          },
        });
        if (Number(stock._sum.inventory_qty ?? 0) + 0.000001 < Number(line.standard_qty))
          throw new BadRequestException('库存已发生变化，请重新校验');
      }
      await t.hspsi_production_plan.update({
        where: { plan_id: planId },
        data: {
          plan_status: PRODUCTION_PLAN_STATUS.PENDING_APPROVAL,
          approve_status: 0,
          approve_comment: '',
          approve_by: 0n,
          approve_date: null,
          updated_by: Number(u),
        },
      });
      return { id, message: '历史计划已转入待审核，审批通过后方可生产' };
    });
  }

  async terminatePlan(id: string, u: string) {
    const planId = BigInt(id);
    return this.p.$transaction(async (t) => {
      await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
      const plan = await t.hspsi_production_plan.findFirst({
        where: { plan_id: planId, deleted_at: null },
      });
      if (!plan) throw new NotFoundException('生产计划不存在');
      if (plan.plan_status === 6) return { id, message: '计划已终止' };
      const [inputCount, confirmedOutputCount] = await Promise.all([
        t.hspsi_production_plan_input.count({ where: { plan_id: planId, deleted_at: null } }),
        t.hspsi_production_material_out.count({
          where: { plan_id: planId, confirm_tag: 1, deleted_at: null },
        }),
      ]);
      if (
        inputCount > 0 ||
        Number(plan.delivered_qty) > 0 ||
        confirmedOutputCount > 0 ||
        plan.outbound_status === PRODUCTION_OUTBOUND_STATUS.COMPLETED
      )
        throw new BadRequestException('已发生出入库的生产计划不可终止');
      await this.assertNoActiveProcurement(t, planId);
      const outputs = await t.hspsi_production_material_out.findMany({
        where: { plan_id: planId, confirm_tag: 0, deleted_at: null },
        select: { out_id: true },
      });
      await t.hspsi_production_plan.update({
        where: { plan_id: planId },
        data: {
          plan_status: 6,
          outbound_status: PRODUCTION_OUTBOUND_STATUS.TERMINATED,
          updated_by: Number(u),
        },
      });
      await t.hspsi_production_shortage.updateMany({
        where: { plan_id: planId, status: 0, deleted_at: null },
        data: { status: 3, updated_by: BigInt(u) },
      });
      await t.hspsi_production_material_out.updateMany({
        where: {
          out_id: { in: outputs.map((item) => item.out_id) },
          confirm_tag: 0,
          deleted_at: null,
        },
        data: { deleted_at: new Date(), updated_by: Number(u), updated_date: new Date() },
      });
      for (const output of outputs)
        await this.documentTrace.removeForDocument('production_material_output', output.out_id, t);
      return { id, message: '生产计划已终止' };
    });
  }

  async saveOutputChecked(id: string | null, b: B, u: string) {
    const outType = Number(b.outType ?? 1),
      lines = Array.isArray(b.details) ? b.details : [];
    if (!lines.length) throw new BadRequestException('至少一条出库明细');
    if (outType !== 3 && !b.planId)
      throw new BadRequestException('BOM出库和临时补料必须关联生产计划');
    if (outType === 3 && b.planId) throw new BadRequestException('实验室出库不得关联生产计划');
    if (outType === 3 && ![1, 2].includes(Number(b.destinationType)))
      throw new BadRequestException('临时出库必须选择有效的出库去向');
    let plan: any = null;
    if (b.planId) {
      plan = await this.plan(String(b.planId));
      if (Number(plan.approveStatus) !== 1) throw new BadRequestException('仅已审批计划可出库');
    }
    if (outType === 1 && plan)
      this.assertFormalOutputReady(
        Number(plan.planStatus),
        Number(plan.materialStatus),
        Number(plan.stockCheckStatus),
      );
    for (const line of lines) {
      this.qty(line.quantity, '出库数量');
      if (!(outType === 1 && !id) && !String(line.batchNo ?? '').trim())
        throw new BadRequestException('出库批号必填');
    }
    if (plan) {
      const allowed = new Set(plan.details.map((x: B) => `${x.goodsId}-${x.skuId}`));
      for (const line of lines)
        if (!allowed.has(`${line.goodsId}-${line.skuId}`))
          throw new BadRequestException('出库物料必须来自计划BOM');
    }
    await this.masterData.assertGoodsLines(
      b.orgId ?? plan?.orgId,
      b.warehouseId ?? plan?.warehouseId,
      lines,
    );
    if (outType === 1 && plan) {
      const existing = await this.p.hspsi_production_material_out.findFirst({
        where: {
          plan_id: BigInt(plan.id),
          out_type: 1,
          deleted_at: null,
          ...(id ? { out_id: { not: Number(id) } } : {}),
        },
      });
      if (existing) throw new BadRequestException('一个生产计划只能生成一张正式BOM出库单');
      if (id) {
        for (const material of plan.details) {
          const actual = lines
              .filter(
                (line: B) =>
                  String(line.goodsId) === String(material.goodsId) &&
                  String(line.skuId) === String(material.skuId),
              )
              .reduce((sum: number, line: B) => sum + Number(line.quantity), 0),
            planned = Number(material.planOutQty);
          if (actual > planned + 0.0001)
            throw new BadRequestException(
              `原料 ${material.goodsName || material.goodsId} 各批号合计 ${actual} 不能超过计划出库量 ${planned}`,
            );
        }
      }
    }
    if (!id)
      return this.createOutput(
        {
          ...b,
          outType,
          orgId: b.orgId ?? plan?.orgId,
          warehouseId: b.warehouseId ?? plan?.warehouseId,
        },
        u,
      );
    const old = await this.output(id);
    if (Number(old.confirmStatus) === 1) throw new BadRequestException('已确认出库不可编辑');
    await this.guardedTransaction(async (t) => {
      const outId = Number(id);
      await t.$queryRaw`SELECT out_id FROM hspsi_production_material_out WHERE out_id=${outId} FOR UPDATE`;
      const locked = await t.hspsi_production_material_out.findFirst({
        where: { out_id: outId, deleted_at: null },
      });
      if (!locked || locked.confirm_tag === 1)
        throw new BadRequestException('已确认或已删除出库单不可编辑');
      if (locked.out_type !== outType) throw new BadRequestException('出库单类型创建后不可变更');
      if (outType !== 3) {
        const planId = BigInt(b.planId);
        await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
        const currentPlan = await t.hspsi_production_plan.findFirst({
          where: { plan_id: planId, deleted_at: null },
        });
        if (!currentPlan || currentPlan.approve_status !== 1)
          throw new BadRequestException('来源生产计划不存在或未审批');
        if (Number(locked.plan_id) !== Number(currentPlan.plan_id))
          throw new BadRequestException('出库单创建后不可更换生产计划');
        if (outType === 1) {
          this.assertFormalOutputReady(
            currentPlan.plan_status,
            currentPlan.material_status,
            currentPlan.stock_check_status,
          );
          const duplicate = await t.hspsi_production_material_out.count({
            where: {
              plan_id: currentPlan.plan_id,
              out_type: 1,
              deleted_at: null,
              NOT: { out_id: outId },
            },
          });
          if (duplicate) throw new BadRequestException('该生产计划已存在其他有效正式BOM出库单');
          if (
            currentPlan.outbound_status !== PRODUCTION_OUTBOUND_STATUS.NOT_STARTED &&
            currentPlan.outbound_status !== PRODUCTION_OUTBOUND_STATUS.PENDING
          )
            throw new BadRequestException('当前生产计划状态不能编辑正式BOM出库');
          await this.assertFormalBatchStockReady(
            t,
            currentPlan.org_id,
            currentPlan.warehouse_id,
            lines,
          );
          await t.hspsi_production_plan.update({
            where: { plan_id: currentPlan.plan_id },
            data: { outbound_status: PRODUCTION_OUTBOUND_STATUS.PENDING, updated_by: Number(u) },
          });
        } else if (currentPlan.outbound_status !== PRODUCTION_OUTBOUND_STATUS.COMPLETED)
          throw new BadRequestException('正式BOM尚未确认出库，不能编辑临时补料');
      }
      await t.hspsi_production_material_out.update({
        where: { out_id: outId },
        data: {
          out_date: new Date(b.outDate ?? Date.now()),
          destination_type: outType === 3 ? Number(b.destinationType) : null,
          remark: String(b.remark ?? ''),
          updated_by: Number(u),
          updated_date: new Date(),
        },
      });
      await t.hspsi_production_material_out_detail.deleteMany({ where: { out_id: outId } });
      await t.hspsi_production_material_out_detail.createMany({
        data: lines.map((l: B) => ({
          out_id: outId,
          goods_id: Number(l.goodsId),
          sku_id: Number(l.skuId),
          unit_type: Number(l.unitType),
          out_qty: this.qty(l.quantity, '出库数量'),
          batch_no: String(l.batchNo),
          remark: String(l.remark ?? ''),
        })),
      });
    });
    return { id, message: '出库草稿已更新' };
  }

  async exportPlans(q: B, u: string) {
    const plans = await this.plans(q);
    const header =
      '计划号,BOM编号,生产成品,生产数量,累计入库,交付进度,原料仓库,计划日期,计划状态,物料状态,出库状态,业务状态\n';
    const rows = plans.items
      .map((p: B) => {
        const bs = [
          p.planStatusName ?? '',
          p.materialStatusName ?? '',
          p.outboundStatusName ?? '',
        ].join('/');
        return [
          `"${p.planNo}"`,
          `"${p.bomNo}"`,
          `"${p.goodsName}"`,
          p.planQty,
          p.deliveredQty,
          `${p.deliveryProgress}%`,
          `"${p.warehouseName}"`,
          p.planDate ? String(p.planDate).slice(0, 10) : '',
          `"${p.planStatusName}"`,
          `"${p.materialStatusName}"`,
          `"${p.outboundStatusName}"`,
          `"${bs}"`,
        ].join(',');
      })
      .join('\n');
    return header + rows;
  }
  async deleteOutput(id: string, u: string) {
    const outId = Number(id);
    await this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT out_id FROM hspsi_production_material_out WHERE out_id=${outId} FOR UPDATE`;
      const output = await t.hspsi_production_material_out.findFirst({
        where: { out_id: outId, deleted_at: null },
      });
      if (!output) throw new NotFoundException('生产出库单不存在');
      if (output.confirm_tag === 1) throw new BadRequestException('已确认出库不可删除');
      let safeReset = false;
      if (output.plan_id) {
        const planId = BigInt(output.plan_id);
        await t.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
        const plan = await t.hspsi_production_plan.findFirst({
          where: { plan_id: planId, deleted_at: null },
        });
        if (output.out_type === 1 && plan) {
          const [otherFormal, confirmedFormal, inputCount] = await Promise.all([
            t.hspsi_production_material_out.count({
              where: {
                plan_id: output.plan_id,
                out_type: 1,
                deleted_at: null,
                NOT: { out_id: outId },
              },
            }),
            t.hspsi_production_material_out.count({
              where: {
                plan_id: output.plan_id,
                out_type: 1,
                confirm_tag: 1,
                deleted_at: null,
                NOT: { out_id: outId },
              },
            }),
            t.hspsi_production_plan_input.count({ where: { plan_id: planId, deleted_at: null } }),
          ]);
          safeReset =
            plan.outbound_status === PRODUCTION_OUTBOUND_STATUS.PENDING &&
            otherFormal === 0 &&
            confirmedFormal === 0 &&
            inputCount === 0 &&
            Number(plan.delivered_qty) === 0;
        }
      }
      await t.hspsi_production_material_out.update({
        where: { out_id: outId },
        data: { deleted_at: new Date(), updated_by: Number(u), updated_date: new Date() },
      });
      if (safeReset && output.plan_id)
        await t.hspsi_production_plan.update({
          where: { plan_id: BigInt(output.plan_id) },
          data: { outbound_status: PRODUCTION_OUTBOUND_STATUS.NOT_STARTED, updated_by: Number(u) },
        });
      await this.documentTrace.removeForDocument('production_material_output', id, t);
    });
    return { id, message: '出库草稿已删除' };
  }

  private async materialReturnQty(
    db: Prisma.TransactionClient | PrismaService,
    sourceOutId: number,
    statuses: number[] = [1],
    excludeReturnId?: bigint,
  ) {
    const returns = await db.hspsi_production_material_return.findMany({
      where: {
        source_out_id: sourceOutId,
        status: { in: statuses },
        deleted_at: null,
        ...(excludeReturnId ? { return_id: { not: excludeReturnId } } : {}),
      },
      select: { return_id: true },
    });
    if (!returns.length) return new Map<number, number>();
    const totals = await db.hspsi_production_material_return_detail.groupBy({
      by: ['source_out_detail_id'],
      where: { return_id: { in: returns.map((item) => item.return_id) } },
      _sum: { return_qty: true },
    });
    return new Map(
      totals.map((item) => [item.source_out_detail_id, Number(item._sum.return_qty ?? 0)]),
    );
  }

  private assertMaterialReturnSource(output: {
    out_type: number;
    confirm_tag: number;
    warehouse_id: number | null;
    org_id: number | null;
  }) {
    if (![1, 2].includes(output.out_type))
      throw new BadRequestException('仅正式BOM整单出库或临时补料出库可以退库');
    if (output.confirm_tag !== 1) throw new BadRequestException('原BOM出库尚未确认，不能退库');
    if (!output.warehouse_id || !output.org_id)
      throw new BadRequestException('原BOM出库缺少组织或仓库，不能退库');
  }

  async materialReturnAvailable(outId: string) {
    const sourceOutId = Number(outId);
    if (!Number.isSafeInteger(sourceOutId) || sourceOutId <= 0)
      throw new BadRequestException('原BOM出库单ID无效');
    const output = await this.p.hspsi_production_material_out.findFirst({
      where: { out_id: sourceOutId, deleted_at: null },
    });
    if (!output) throw new NotFoundException('原BOM出库单不存在');
    this.assertMaterialReturnSource(output);
    const [details, returned, occupied, warehouse, histories] = await Promise.all([
      this.p.hspsi_production_material_out_detail.findMany({
        where: { out_id: sourceOutId },
        orderBy: { serial_number: 'asc' },
      }),
      this.materialReturnQty(this.p, sourceOutId, [1]),
      this.materialReturnQty(this.p, sourceOutId, [0]),
      this.p.hspsi_basic_warehouse.findFirst({
        where: { warehouse_id: BigInt(output.warehouse_id!) },
      }),
      this.p.hspsi_production_material_return.findMany({
        where: { source_out_id: sourceOutId, deleted_at: null },
        orderBy: { return_id: 'desc' },
      }),
    ]);
    const enriched = await this.refs.enrich(
      details.map((line) => {
        const returnedQty = returned.get(line.serial_number) ?? 0;
        const occupiedQty = occupied.get(line.serial_number) ?? 0;
        return {
          id: line.serial_number,
          sourceOutDetailId: line.serial_number,
          goodsId: line.goods_id,
          skuId: line.sku_id,
          unitType: line.unit_type,
          batchNo: line.batch_no,
          sourceOutputQty: Number(line.out_qty ?? 0),
          returnedQty,
          occupiedQty,
          remainingQty: Math.max(0, Number(line.out_qty ?? 0) - returnedQty - occupiedQty),
          remark: line.remark,
        };
      }),
    );
    return {
      id: output.out_id,
      outNo: output.out_no,
      planId: output.plan_id,
      orgId: output.org_id,
      warehouseId: output.warehouse_id,
      warehouseName: warehouse?.name ?? '',
      outDate: output.out_date,
      details: enriched,
      returnableQty: enriched.reduce((sum, line) => sum + Number(line.remainingQty), 0),
      histories: await this.refs.enrich(
        histories.map((item) => ({
          id: item.return_id,
          returnNo: item.return_no,
          returnDate: item.return_date,
          totalQty: item.total_qty,
          returnReason: item.return_reason,
          reversalReason: item.reversal_reason,
          status: item.status,
          reversedBy: item.reversed_by,
          reversedAt: item.reversed_at,
          createdBy: item.created_by,
          createdAt: item.created_at,
        })),
        { status: 'bom_return_status' },
      ),
    };
  }

  async materialReturns(q: B) {
    const { page, pageSize } = this.pg(q);
    const where: Prisma.hspsi_production_material_returnWhereInput = { deleted_at: null };
    if (q.sourceOutId) where.source_out_id = Number(q.sourceOutId);
    if (q.status !== undefined && q.status !== '') where.status = Number(q.status);
    const [records, total] = await this.p.$transaction([
      this.p.hspsi_production_material_return.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { return_id: 'desc' },
      }),
      this.p.hspsi_production_material_return.count({ where }),
    ]);
    const sourceIds = [...new Set(records.map((item) => item.source_out_id))];
    const outputs = sourceIds.length
      ? await this.p.hspsi_production_material_out.findMany({
          where: { out_id: { in: sourceIds } },
          select: { out_id: true, out_no: true },
        })
      : [];
    const outputNo = new Map(outputs.map((item) => [item.out_id, item.out_no]));
    const items = await this.refs.enrich(
      records.map((item) => ({
        id: item.return_id,
        returnNo: item.return_no,
        sourceOutId: item.source_out_id,
        sourceOutNo: outputNo.get(item.source_out_id) ?? '',
        planId: item.plan_id,
        orgId: item.org_id,
        warehouseId: item.warehouse_id,
        returnDate: item.return_date,
        totalQty: item.total_qty,
        returnReason: item.return_reason,
        remark: item.remark,
        status: item.status,
        reversalReason: item.reversal_reason,
        reversedBy: item.reversed_by,
        reversedAt: item.reversed_at,
        createdBy: item.created_by,
        updatedBy: item.updated_by,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
      { status: 'bom_return_status' },
    );
    return { items, total, page, pageSize };
  }

  async materialReturn(id: string) {
    const returnId = BigInt(id);
    const item = await this.p.hspsi_production_material_return.findFirst({
      where: { return_id: returnId, deleted_at: null },
    });
    if (!item) throw new NotFoundException('BOM退库单不存在');
    const [details, source, returned] = await Promise.all([
      this.p.hspsi_production_material_return_detail.findMany({
        where: { return_id: returnId },
        orderBy: { detail_id: 'asc' },
      }),
      this.p.hspsi_production_material_out.findFirst({ where: { out_id: item.source_out_id } }),
      this.materialReturnQty(this.p, item.source_out_id, [1]),
    ]);
    const [header] = await this.refs.enrich(
      [
        {
          id: item.return_id,
          returnNo: item.return_no,
          sourceOutId: item.source_out_id,
          sourceOutNo: source?.out_no ?? '',
          planId: item.plan_id,
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          returnDate: item.return_date,
          totalQty: item.total_qty,
          returnReason: item.return_reason,
          remark: item.remark,
          status: item.status,
          reversalReason: item.reversal_reason,
          reversedBy: item.reversed_by,
          reversedAt: item.reversed_at,
          createdBy: item.created_by,
          updatedBy: item.updated_by,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        },
      ],
      { status: 'bom_return_status' },
    );
    return {
      ...header,
      details: await this.refs.enrich(
        details.map((line) => ({
          id: line.detail_id,
          sourceOutDetailId: line.source_out_detail_id,
          goodsId: line.goods_id,
          skuId: line.sku_id,
          batchNo: line.batch_no,
          unitType: line.unit_type,
          sourceOutputQty: line.source_output_qty,
          returnQty: line.return_qty,
          completedReturnedQty: returned.get(line.source_out_detail_id) ?? 0,
          storageLocation: line.storage_location,
          remark: line.remark,
        })),
      ),
    };
  }

  async saveMaterialReturn(id: string | null, b: B, u: string) {
    const requestKey = String(b.requestKey ?? '').trim();
    if (!id && (requestKey.length < 8 || requestKey.length > 64))
      throw new BadRequestException('请求幂等键长度必须为8至64位');
    const sourceOutId = Number(b.sourceOutId);
    if (!Number.isSafeInteger(sourceOutId) || sourceOutId <= 0)
      throw new BadRequestException('原BOM出库单ID无效');
    const returnReason = String(b.returnReason ?? '').trim();
    if (!returnReason) throw new BadRequestException('退库原因必填');
    const rawLines = Array.isArray(b.details) ? b.details : [];
    const lines = rawLines.filter((line: B) => Number(line.returnQty) > 0);
    if (!lines.length) throw new BadRequestException('至少填写一条退库数量');
    const lineIds = lines.map((line: B) => Number(line.sourceOutDetailId));
    if (lineIds.some((value) => !Number.isSafeInteger(value) || value <= 0))
      throw new BadRequestException('退库明细来源无效');
    if (new Set(lineIds).size !== lineIds.length) throw new BadRequestException('退库明细不能重复');
    for (const line of lines) this.qty(line.returnQty, '退库数量');

    return this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT out_id FROM hspsi_production_material_out WHERE out_id=${sourceOutId} FOR UPDATE`;
      const output = await t.hspsi_production_material_out.findFirst({
        where: { out_id: sourceOutId, deleted_at: null },
      });
      if (!output) throw new NotFoundException('原BOM出库单不存在');
      this.assertMaterialReturnSource(output);
      if (!id) {
        const duplicate = await t.hspsi_production_material_return.findFirst({
          where: { request_key: requestKey },
        });
        if (duplicate) return { id: duplicate.return_id, message: 'BOM退库草稿已存在' };
      }
      let current: Awaited<ReturnType<typeof t.hspsi_production_material_return.findFirst>> = null;
      if (id) {
        const returnId = BigInt(id);
        await t.$queryRaw`SELECT return_id FROM hspsi_production_material_return WHERE return_id=${returnId} FOR UPDATE`;
        current = await t.hspsi_production_material_return.findFirst({
          where: { return_id: returnId, deleted_at: null },
        });
        if (!current) throw new NotFoundException('BOM退库单不存在');
        if (current.status !== 0) throw new BadRequestException('仅草稿BOM退库单可以编辑');
        if (current.source_out_id !== sourceOutId)
          throw new BadRequestException('退库单创建后不能更换原BOM出库单');
      }
      const sourceLines = await t.hspsi_production_material_out_detail.findMany({
        where: { out_id: sourceOutId, serial_number: { in: lineIds } },
      });
      if (sourceLines.length !== lines.length)
        throw new BadRequestException('退库明细不属于原BOM出库单');
      const returned = await this.materialReturnQty(t, sourceOutId, [0, 1], current?.return_id);
      const detailData = lines.map((line: B) => {
        const source = sourceLines.find(
          (item) => item.serial_number === Number(line.sourceOutDetailId),
        )!;
        const returnQty = this.qty(line.returnQty, '退库数量');
        const remaining = Number(source.out_qty ?? 0) - (returned.get(source.serial_number) ?? 0);
        if (returnQty > remaining)
          throw new BadRequestException(
            `物料 ${source.goods_id ?? ''} 批号 ${source.batch_no || '无批号'} 当前最多可退 ${remaining}`,
          );
        return {
          source_out_detail_id: source.serial_number,
          goods_id: BigInt(source.goods_id ?? 0),
          sku_id: BigInt(source.sku_id ?? 0),
          batch_no: source.batch_no,
          unit_type: Number(source.unit_type ?? 0),
          source_output_qty: Number(source.out_qty ?? 0),
          return_qty: returnQty,
          storage_location: String(line.storageLocation ?? '').trim(),
          remark: String(line.remark ?? ''),
          updated_at: new Date(),
        };
      });
      const totalQty = detailData.reduce((sum, line) => sum + line.return_qty, 0);
      let saved;
      if (current) {
        saved = await t.hspsi_production_material_return.update({
          where: { return_id: current.return_id },
          data: {
            return_date: new Date(b.returnDate ?? Date.now()),
            total_qty: totalQty,
            return_reason: returnReason,
            remark: String(b.remark ?? ''),
            updated_by: BigInt(u),
            updated_at: new Date(),
          },
        });
        await t.hspsi_production_material_return_detail.deleteMany({
          where: { return_id: current.return_id },
        });
      } else {
        const returnNo = await this.businessNumber.generate(
          BUSINESS_PREFIX.PRODUCTION_MATERIAL_RETURN,
        );
        saved = await t.hspsi_production_material_return.create({
          data: {
            return_no: returnNo,
            request_key: requestKey,
            source_out_id: sourceOutId,
            plan_id: output.plan_id,
            org_id: BigInt(output.org_id!),
            warehouse_id: BigInt(output.warehouse_id!),
            return_date: new Date(b.returnDate ?? Date.now()),
            total_qty: totalQty,
            status: 0,
            return_reason: returnReason,
            remark: String(b.remark ?? ''),
            created_by: BigInt(u),
            updated_by: BigInt(u),
          },
        });
      }
      await t.hspsi_production_material_return_detail.createMany({
        data: detailData.map((line) => ({ ...line, return_id: saved.return_id })),
      });
      await this.documentTrace.link(
        {
          upstreamType: 'production_material_output',
          upstreamId: output.out_id,
          upstreamNo: output.out_no,
          downstreamType: 'production_material_return',
          downstreamId: saved.return_id,
          downstreamNo: saved.return_no,
          relationKind: 'bom_return',
          createdBy: u,
        },
        t,
      );
      return { id: saved.return_id, message: current ? 'BOM退库草稿已更新' : 'BOM退库草稿已保存' };
    });
  }

  async confirmMaterialReturn(id: string, u: string) {
    const returnId = BigInt(id);
    const candidate = await this.p.hspsi_production_material_return.findFirst({
      where: { return_id: returnId, deleted_at: null },
      select: { source_out_id: true },
    });
    if (!candidate) throw new NotFoundException('BOM退库单不存在');
    return this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT out_id FROM hspsi_production_material_out WHERE out_id=${candidate.source_out_id} FOR UPDATE`;
      await t.$queryRaw`SELECT return_id FROM hspsi_production_material_return WHERE return_id=${returnId} FOR UPDATE`;
      const item = await t.hspsi_production_material_return.findFirst({
        where: { return_id: returnId, deleted_at: null },
      });
      if (!item) throw new NotFoundException('BOM退库单不存在');
      if (item.status === 1) return { id: item.return_id, message: 'BOM退库单已完成' };
      if (item.status !== 0) throw new BadRequestException('已作废BOM退库单不能完成');
      const output = await t.hspsi_production_material_out.findFirst({
        where: { out_id: item.source_out_id, deleted_at: null },
      });
      if (!output) throw new NotFoundException('原BOM出库单不存在');
      this.assertMaterialReturnSource(output);
      if (
        BigInt(output.org_id!) !== item.org_id ||
        BigInt(output.warehouse_id!) !== item.warehouse_id
      )
        throw new BadRequestException('退回组织或仓库与原BOM出库不一致');
      const details = await t.hspsi_production_material_return_detail.findMany({
        where: { return_id: item.return_id },
      });
      if (!details.length) throw new BadRequestException('BOM退库单没有明细');
      const sourceLines = await t.hspsi_production_material_out_detail.findMany({
        where: {
          out_id: output.out_id,
          serial_number: { in: details.map((line) => line.source_out_detail_id) },
        },
      });
      if (sourceLines.length !== details.length)
        throw new BadRequestException('原BOM出库明细已发生变化');
      const returned = await this.materialReturnQty(t, output.out_id, [0, 1], item.return_id);
      for (const line of details) {
        const source = sourceLines.find(
          (sourceLine) => sourceLine.serial_number === line.source_out_detail_id,
        )!;
        const remaining = Number(source.out_qty ?? 0) - (returned.get(source.serial_number) ?? 0);
        if (line.return_qty > remaining)
          throw new BadRequestException(
            `物料 ${source.goods_id ?? ''} 批号 ${source.batch_no || '无批号'} 当前最多可退 ${remaining}`,
          );
      }
      const goods = await t.hspsi_goods_info.findMany({
        where: { goods_id: { in: details.map((line) => line.goods_id) } },
        select: { goods_id: true, const_price: true },
      });
      const cost = new Map(
        goods.map((goodsItem) => [String(goodsItem.goods_id), Number(goodsItem.const_price)]),
      );
      const nextVersion = item.posting_version + 1;
      await this.posting.post(
        {
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          direction: 1,
          operationType: 1,
          inventoryMode: INVENTORY_BUSINESS_MODE.BOM_RETURN,
          sourceId: item.return_id,
          sourceType: 'production_material_return',
          sourceNo: item.return_no,
          operationBy: u,
          idempotencyKey: `production-material-return:${item.return_id}:confirm:v${nextVersion}`,
          remark: item.return_reason || 'BOM物料退库',
          lines: details.map((line) => ({
            goodsId: line.goods_id,
            skuId: line.sku_id,
            batchNo: line.batch_no,
            unitType: line.unit_type,
            quantity: line.return_qty,
            amount: (cost.get(String(line.goods_id)) ?? 0) * line.return_qty,
          })),
        },
        t,
      );
      await t.hspsi_production_material_return.update({
        where: { return_id: item.return_id },
        data: {
          status: 1,
          posting_version: nextVersion,
          completed_by: BigInt(u),
          completed_at: new Date(),
          updated_by: BigInt(u),
          updated_at: new Date(),
        },
      });
      return { id: item.return_id, message: 'BOM退库已完成，库存已入账' };
    });
  }

  async voidMaterialReturn(id: string, u: string) {
    const returnId = BigInt(id);
    return this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT return_id FROM hspsi_production_material_return WHERE return_id=${returnId} FOR UPDATE`;
      const item = await t.hspsi_production_material_return.findFirst({
        where: { return_id: returnId, deleted_at: null },
      });
      if (!item) throw new NotFoundException('BOM退库单不存在');
      if (item.status !== 0) throw new BadRequestException('仅未过账草稿可以作废');
      await t.hspsi_production_material_return.update({
        where: { return_id: returnId },
        data: {
          status: 2,
          voided_by: BigInt(u),
          voided_at: new Date(),
          updated_by: BigInt(u),
          updated_at: new Date(),
        },
      });
      return { id: returnId, message: 'BOM退库草稿已作废' };
    });
  }

  async reverseMaterialReturn(id: string, b: B, u: string) {
    const returnId = BigInt(id);
    const reversalReason = String(b.reversalReason ?? '').trim();
    if (!reversalReason) throw new BadRequestException('冲正原因必填');
    const candidate = await this.p.hspsi_production_material_return.findFirst({
      where: { return_id: returnId, deleted_at: null },
      select: { source_out_id: true },
    });
    if (!candidate) throw new NotFoundException('BOM退库单不存在');
    return this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT out_id FROM hspsi_production_material_out WHERE out_id=${candidate.source_out_id} FOR UPDATE`;
      await t.$queryRaw`SELECT return_id FROM hspsi_production_material_return WHERE return_id=${returnId} FOR UPDATE`;
      const item = await t.hspsi_production_material_return.findFirst({
        where: { return_id: returnId, deleted_at: null },
      });
      if (!item) throw new NotFoundException('BOM退库单不存在');
      if (item.status === 3) return { id: item.return_id, message: 'BOM退库单已经冲正' };
      if (item.status !== 1) throw new BadRequestException('仅已完成BOM退库单可以冲正');
      const details = await t.hspsi_production_material_return_detail.findMany({
        where: { return_id: item.return_id },
      });
      if (!details.length) throw new BadRequestException('BOM退库单没有明细');
      const nextVersion = item.posting_version + 1;
      await this.posting.post(
        {
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          direction: -1,
          operationType: 2,
          inventoryMode: INVENTORY_BUSINESS_MODE.BOM_RETURN,
          sourceId: item.return_id,
          sourceType: 'production_material_return_reversal',
          sourceNo: item.return_no,
          operationBy: u,
          idempotencyKey: `production-material-return:${item.return_id}:reverse:v${nextVersion}`,
          remark: `BOM退库冲正：${reversalReason}`,
          lines: details.map((line) => ({
            goodsId: line.goods_id,
            skuId: line.sku_id,
            batchNo: line.batch_no,
            unitType: line.unit_type,
            quantity: line.return_qty,
          })),
        },
        t,
      );
      await t.hspsi_production_material_return.update({
        where: { return_id: item.return_id },
        data: {
          status: 3,
          posting_version: nextVersion,
          reversal_reason: reversalReason,
          reversed_by: BigInt(u),
          reversed_at: new Date(),
          updated_by: BigInt(u),
          updated_at: new Date(),
        },
      });
      return { id: item.return_id, message: 'BOM退库已冲正，库存已反向扣减' };
    });
  }

  async createInputChecked(b: B, u: string) {
    const plan = await this.plan(String(b.planId)),
      qty = this.qty(b.quantity, '本次入库数量'),
      remaining = Number(plan.planQty) - Number(plan.deliveredQty);
    if (Number(plan.outboundStatus) !== PRODUCTION_OUTBOUND_STATUS.COMPLETED)
      throw new BadRequestException('原料尚未正式出库，不能进行成品入库');
    if (qty > remaining)
      throw new BadRequestException(`本次入库数量不能超过剩余可入数量 ${remaining}`);
    if (!String(b.batchNo ?? '').trim()) b.batchNo = generateBatchNo();
    await this.masterData.assertGoodsLines(plan.orgId, b.warehouseId, [
      { goodsId: plan.goodsId, skuId: plan.skuId },
    ]);
    return this.createInput(b, u);
  }
}
