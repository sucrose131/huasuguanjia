import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { InventoryPostingService } from '../inventory/inventory-posting.service';
import { InventoryAlertService } from '../inventory/inventory-alert.service';
import { INVENTORY_BUSINESS_MODE } from '../inventory/inventory-dictionary';
import { DocumentTraceService } from '../document-trace/document-trace.service';
import { BusinessNumberService } from '../business-number/business-number.service';
import { generateBatchNo } from '../common/batch-number';
import { BUSINESS_PREFIX } from '../business-number/business-number.constants';

type Body = Record<string, any>;
type PurchaseDb = Prisma.TransactionClient | PrismaService;
type OperationHistoryItem = {
  key: string;
  action: string;
  result: string;
  operatorId: string;
  operatorName?: string;
  occurredAt: Date | null;
  detail?: string;
  timeNote?: string;
};
@Injectable()
export class PurchaseService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(InventoryPostingService) private inventoryPosting: InventoryPostingService,
    @Inject(InventoryAlertService) private inventoryAlerts: InventoryAlertService,
    @Inject(DocumentTraceService) private documentTrace: DocumentTraceService,
    @Inject(BusinessNumberService) private businessNumber: BusinessNumberService,
  ) {}
  private guardedTransaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }
  private paging(query: Body) {
    return {
      page: Math.max(1, Number(query.page ?? 1)),
      pageSize: Math.min(100, Math.max(1, Number(query.pageSize ?? 20))),
    };
  }
  private details(input: unknown) {
    if (!Array.isArray(input) || !input.length) throw new BadRequestException('至少需要一条明细');
    return input as Body[];
  }
  private quantity(value: unknown, label = '数量', allowZero = false) {
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || (allowZero ? quantity < 0 : quantity <= 0))
      throw new BadRequestException(`${label}必须为${allowZero ? '非负' : '正'}整数`);
    return quantity;
  }
  private orderLineUnitPrice(line: {
    qty: number;
    unit_price: Prisma.Decimal | number;
    total_amout?: Prisma.Decimal | number | null;
  }) {
    const quantity = Number(line.qty);
    const total = line.total_amout == null ? null : new Prisma.Decimal(line.total_amout);
    return quantity > 0 && total ? total.div(quantity) : new Prisma.Decimal(line.unit_price);
  }
  private date(value: unknown, label: string) {
    const result = new Date(String(value ?? ''));
    if (Number.isNaN(result.getTime())) throw new BadRequestException(`${label}格式无效`);
    return result;
  }
  private optionalDate(value: unknown, label: string) {
    if (
      value === null ||
      value === undefined ||
      String(value).trim() === '' ||
      String(value).trim() === '—'
    )
      return null;
    return this.date(value, label);
  }
  private async resolveProductionPurchaseDepartment(tx: Prisma.TransactionClient, orgId: bigint) {
    const preferred = await tx.hspsi_basic_dept.findFirst({
      where: { org_id: orgId, status: 1, deleted_at: null, name: { contains: '采购' } },
      orderBy: [{ sort: 'asc' }, { dept_id: 'asc' }],
      select: { dept_id: true },
    });
    const fallback =
      preferred ??
      (await tx.hspsi_basic_dept.findFirst({
        where: { org_id: orgId, status: 1, deleted_at: null },
        orderBy: [{ sort: 'asc' }, { dept_id: 'asc' }],
        select: { dept_id: true },
      }));
    if (!fallback) throw new BadRequestException('当前组织没有可用部门，不能审批缺料采购申请');
    return fallback.dept_id;
  }
  private lineGoodsId(line: Body) {
    return BigInt(String(line.goodsId ?? line.goods_id ?? 0));
  }
  private async materializeQuickCatalog(
    tx: Prisma.TransactionClient,
    lines: Body[],
    userId: string,
  ) {
    for (const [index, line] of lines.entries()) {
      if (line.newGoods) {
        const input = line.newGoods as Body;
        const goodsName = String(input.goodsName ?? '').trim();
        if (!goodsName) throw new BadRequestException(`第 ${index + 1} 行新商品名称必填`);
        const existing = await tx.hspsi_goods_info.findFirst({
          where: { goods_name: goodsName },
          select: { goods_id: true },
        });
        if (existing)
          throw new BadRequestException(
            `商品“${goodsName}”已存在，请取消快捷新建并选择已有商品档案`,
          );
        const categoryId = BigInt(String(input.categoryId ?? 0));
        const category = await tx.hspsi_goods_info_category.findFirst({
          where: { goods_catg_id: categoryId, status: 1, deleted_at: null },
        });
        if (!category || category.warehouse_type <= 0)
          throw new BadRequestException(`第 ${index + 1} 行新商品分类无效或未绑定仓库类型`);
        const unitType = Number(input.unitType);
        if (!Number.isSafeInteger(unitType) || unitType <= 0)
          throw new BadRequestException(`第 ${index + 1} 行新商品基础单位必填`);
        const goods = await tx.hspsi_goods_info.create({
          data: {
            org_id: 0n,
            query_code: String(input.queryCode ?? ''),
            goods_name: goodsName,
            short_name: String(input.shortName ?? ''),
            brand_name: String(input.brandName ?? ''),
            spec_models: String(input.specModels ?? ''),
            unit_type: unitType,
            goods_catg_id: categoryId,
            supply_type: Number(input.supplyType ?? 2),
            goods_type: Number(input.goodsType ?? 1),
            const_price: new Prisma.Decimal(String(input.costPrice ?? 0)),
            sale_price: new Prisma.Decimal(String(input.salePrice ?? 0)),
            vendor_id: 0n,
            warehouse_id: 0n,
            status: 1,
            created_by: BigInt(userId),
            updated_by: BigInt(userId),
          },
        });
        line.goodsId = goods.goods_id;
        line.newSku = line.newSku ?? {
          specModels: String(input.specModels ?? '').trim() || '默认规格',
          unitType,
          pcsQty: 1,
          costPrice: Number(input.costPrice ?? 0),
          salePrice: Number(input.salePrice ?? 0),
        };
      }
      if (line.newSku) {
        const input = line.newSku as Body;
        const goodsId = BigInt(String(line.goodsId ?? 0));
        const specModels = String(input.specModels ?? '').trim() || '默认规格';
        const duplicate = await tx.hspsi_goods_info_sku.findFirst({
          where: { good_id: goodsId, spec_models: specModels },
          select: { sku_id: true },
        });
        if (duplicate)
          throw new BadRequestException(
            `第 ${index + 1} 行 SKU“${specModels}”已存在，请选择已有 SKU`,
          );
        const unitType = Number(input.unitType ?? line.unitType);
        const pcsQty = Number(input.pcsQty ?? 1);
        if (!Number.isSafeInteger(unitType) || unitType <= 0)
          throw new BadRequestException(`第 ${index + 1} 行新 SKU 单位必填`);
        if (!Number.isSafeInteger(pcsQty) || pcsQty <= 0)
          throw new BadRequestException(`第 ${index + 1} 行新 SKU 基础件数必须为正整数`);
        const existingDefault = await tx.hspsi_goods_info_sku.count({
          where: { good_id: goodsId, is_default: 1, deleted_at: null },
        });
        const sku = await tx.hspsi_goods_info_sku.create({
          data: {
            good_id: goodsId,
            spec_models: specModels,
            pcs_qty: pcsQty,
            unit_type: unitType,
            const_price: new Prisma.Decimal(String(input.costPrice ?? 0)),
            sale_price: new Prisma.Decimal(String(input.salePrice ?? 0)),
            is_default: existingDefault ? 0 : 1,
            status: 1,
            created_by: BigInt(userId),
            updated_by: BigInt(userId),
          },
        });
        line.skuId = sku.sku_id;
        line.unitType = unitType;
      }
    }
  }
  private async requiredWarehouseType(db: PurchaseDb, orgId: bigint, lines: Body[]) {
    const goodsIds = [
      ...new Set(lines.map((line) => this.lineGoodsId(line)).filter((id) => id > 0n)),
    ];
    if (
      !goodsIds.length ||
      goodsIds.length !== new Set(lines.map((line) => String(this.lineGoodsId(line)))).size
    )
      throw new BadRequestException('采购明细商品无效');
    const goods = await db.hspsi_goods_info.findMany({
      where: { goods_id: { in: goodsIds }, status: 1, deleted_at: null },
      select: { goods_id: true, goods_name: true, goods_catg_id: true },
    });
    if (goods.length !== goodsIds.length)
      throw new BadRequestException('采购明细包含无效或已停用商品');
    const categories = await db.hspsi_goods_info_category.findMany({
      where: {
        goods_catg_id: { in: [...new Set(goods.map((item) => item.goods_catg_id))] },
        status: 1,
        deleted_at: null,
      },
      select: { goods_catg_id: true, goods_name: true, warehouse_type: true },
    });
    const missing = goods.find(
      (item) => !categories.some((category) => category.goods_catg_id === item.goods_catg_id),
    );
    if (missing) throw new BadRequestException(`${missing.goods_name} 的商品分类不存在或已停用`);
    const invalid = goods.find(
      (item) =>
        Number(
          categories.find((category) => category.goods_catg_id === item.goods_catg_id)
            ?.warehouse_type ?? 0,
        ) <= 0,
    );
    if (invalid) throw new BadRequestException(`${invalid.goods_name} 的商品分类未配置仓库类型`);
    const types = [
      ...new Set(
        goods.map((item) =>
          Number(
            categories.find((category) => category.goods_catg_id === item.goods_catg_id)!
              .warehouse_type,
          ),
        ),
      ),
    ];
    if (types.length !== 1)
      throw new BadRequestException('同一采购单据只能包含相同仓库类型的商品，请拆分单据');
    return types[0]!;
  }
  private async assertPurchaseWarehouse(
    tx: PurchaseDb,
    orgId: bigint,
    warehouseId: bigint,
    lines: Body[],
  ) {
    const requiredType = await this.requiredWarehouseType(tx, orgId, lines);
    const warehouse = await tx.hspsi_basic_warehouse.findFirst({
      where: { warehouse_id: warehouseId, org_id: orgId, status: 1, deleted_at: null },
      select: { name: true, warehouse_type: true },
    });
    if (!warehouse) throw new BadRequestException('所选仓库不属于当前组织，或仓库已停用');
    if (warehouse.warehouse_type !== requiredType)
      throw new BadRequestException(`所选仓库“${warehouse.name}”的类型与商品分类要求不一致`);
    return requiredType;
  }
  private async resolvePurchaseWarehouse(
    tx: PurchaseDb,
    orgId: bigint,
    preferredWarehouseId: bigint,
    lines: Body[],
    strictPreferred = false,
  ) {
    const requiredType = await this.requiredWarehouseType(tx, orgId, lines);
    if (preferredWarehouseId > 0n) {
      const preferred = await tx.hspsi_basic_warehouse.findFirst({
        where: {
          warehouse_id: preferredWarehouseId,
          org_id: orgId,
          warehouse_type: requiredType,
          status: 1,
          deleted_at: null,
        },
        select: { warehouse_id: true },
      });
      if (preferred) return preferred.warehouse_id;
      if (strictPreferred)
        throw new BadRequestException('所选仓库不属于当前组织、已停用，或仓库属性与商品分类不一致');
    }
    const fallback = await tx.hspsi_basic_warehouse.findFirst({
      where: { org_id: orgId, warehouse_type: requiredType, status: 1, deleted_at: null },
      orderBy: [{ sort: 'asc' }, { warehouse_id: 'asc' }],
      select: { warehouse_id: true },
    });
    if (!fallback) throw new BadRequestException('当前组织没有与商品分类仓库属性匹配的启用仓库');
    return fallback.warehouse_id;
  }
  private async assertOrganizationScope(
    tx: Prisma.TransactionClient,
    orgId: bigint,
    deptId: bigint,
    warehouseId: bigint,
  ) {
    if (orgId <= 0n || deptId <= 0n || warehouseId <= 0n)
      throw new BadRequestException('组织、部门和仓库不能为空');
    const [organization, department, warehouse] = await Promise.all([
      tx.hspsi_basic_organization.findFirst({
        where: { org_id: orgId, deleted_at: null },
        select: { org_id: true },
      }),
      tx.hspsi_basic_dept.findFirst({
        where: { dept_id: deptId, status: 1, deleted_at: null },
        select: { org_id: true },
      }),
      tx.hspsi_basic_warehouse.findFirst({
        where: { warehouse_id: warehouseId, status: 1, deleted_at: null },
        select: { org_id: true },
      }),
    ]);
    if (!organization) throw new BadRequestException('所选组织不存在或已停用');
    if (!department || department.org_id !== orgId)
      throw new BadRequestException('所选部门不属于当前组织');
    if (!warehouse || warehouse.org_id !== orgId)
      throw new BadRequestException('所选仓库不属于当前组织');
  }
  private async recalcOrderStatus(tx: Prisma.TransactionClient, poId: bigint) {
    const order = await tx.hspsi_purchase_order.findUniqueOrThrow({
      where: { po_id: poId },
      select: { po_id: true, pcs_qty: true, arrival_qty: true, is_all_arrival: true, status: true },
    });
    const details = await tx.hspsi_purchase_order_detail.findMany({
      where: { po_id: poId },
      select: { qty: true, actual_qty: true, cancel_qty: true },
    });
    const returnHeaders = await tx.hspsi_purchase_order_input_exit.findMany({
      where: { po_id: poId, po_input_id: { gt: 0n }, approve_status: 1, deleted_at: null },
      select: { po_exit_id: true },
    });
    const returnDetails = returnHeaders.length
      ? await tx.hspsi_purchase_order_input_exit_detail.aggregate({
          where: { po_exit_id: { in: returnHeaders.map((h) => h.po_exit_id) }, deleted_at: null },
          _sum: { exit_qty: true },
        })
      : { _sum: { exit_qty: null } };
    const confirmedReturnQty = Number(returnDetails._sum.exit_qty ?? 0);
    const totalQty = details.reduce((s, l) => s + l.qty, 0);
    const confirmedQty = details.reduce((s, l) => s + l.actual_qty, 0);
    const cancelledQty = details.reduce((s, l) => s + l.cancel_qty, 0);
    const netRemaining = totalQty - cancelledQty;
    let newStatus: number;
    if (confirmedQty === 0 && confirmedReturnQty === 0) {
      newStatus = order.status === 1 ? 1 : 2;
    } else if (confirmedQty >= netRemaining && confirmedReturnQty === 0) {
      newStatus = 4;
    } else if (confirmedReturnQty > 0 && confirmedQty > confirmedReturnQty) {
      newStatus = 5;
    } else if (confirmedReturnQty > 0 && confirmedQty === 0) {
      newStatus = 6;
    } else if (confirmedQty >= confirmedReturnQty && confirmedQty >= netRemaining) {
      newStatus = 6;
    } else {
      newStatus = 3;
    }
    await tx.hspsi_purchase_order.update({ where: { po_id: poId }, data: { status: newStatus } });
  }
  private async assertDictionaryValue(tx: PurchaseDb, code: string, value: number, label: string) {
    const category = await tx.hspsi_sys_dictionary_category.findFirst({
      where: { dict_catg_code: code, deleted_at: null },
      select: { dict_catg_id: true },
    });
    const item = category
      ? await tx.hspsi_sys_dictionary.findFirst({
          where: {
            dict_catg_id: category.dict_catg_id,
            dict_value: String(value),
            deleted_at: null,
          },
          select: { dict_id: true },
        })
      : null;
    if (!item) throw new BadRequestException(`${label}字典值无效`);
  }
  private async dictionaryValue(tx: PurchaseDb, code: string, name: string, label: string) {
    const category = await tx.hspsi_sys_dictionary_category.findFirst({
      where: { dict_catg_code: code, deleted_at: null },
      select: { dict_catg_id: true },
    });
    const item = category
      ? await tx.hspsi_sys_dictionary.findFirst({
          where: { dict_catg_id: category.dict_catg_id, dict_name: name, deleted_at: null },
          select: { dict_value: true },
        })
      : null;
    const value = Number(item?.dict_value);
    if (!item || !Number.isFinite(value))
      throw new BadRequestException(`${label}字典未配置“${name}”`);
    return value;
  }
  private async createRefundTask(tx: Prisma.TransactionClient, exitId: bigint, userId: string) {
    const existing = await tx.hspsi_purchase_refund.findUnique({ where: { po_exit_id: exitId } });
    if (existing && !existing.deleted_at) return existing;
    const sourceReturn = await tx.hspsi_purchase_order_input_exit.findFirst({
      where: { po_exit_id: exitId, approve_status: 1, deleted_at: null },
    });
    if (!sourceReturn) throw new BadRequestException('仅已生效采购退货可生成退款任务');
    const sourceType = sourceReturn.po_input_id > 0n ? 2 : 1;
    await this.assertDictionaryValue(tx, 'purchase_refund_source', sourceType, '采购退款来源');
    await this.assertDictionaryValue(
      tx,
      'purchase_return_type',
      sourceReturn.exit_type,
      '采购退货类型',
    );
    const [order, orderLines, returnLines, paid] = await Promise.all([
      tx.hspsi_purchase_order.findFirst({ where: { po_id: sourceReturn.po_id, deleted_at: null } }),
      tx.hspsi_purchase_order_detail.findMany({ where: { po_id: sourceReturn.po_id } }),
      tx.hspsi_purchase_order_input_exit_detail.findMany({
        where: { po_exit_id: exitId, deleted_at: null },
      }),
      tx.hspsi_purchase_order_payment.aggregate({
        where: { po_id: sourceReturn.po_id, deleted_at: null },
        _sum: { fact_pay_amount: true },
      }),
    ]);
    if (!order) throw new NotFoundException('采购订单不存在');
    const priceByGoods = new Map(
      orderLines.map((line) => [`${line.goods_id}:${line.sku_id}`, this.orderLineUnitPrice(line)]),
    );
    const amountOf = (lines: Array<{ goods_id: bigint; sku_id: bigint; exit_qty: number }>) =>
      lines.reduce((sum, line) => {
        const price = priceByGoods.get(`${line.goods_id}:${line.sku_id}`);
        if (!price)
          throw new BadRequestException(
            `采购退货明细 ${line.goods_id}/${line.sku_id} 缺少来源订单单价`,
          );
        return sum.plus(price.mul(line.exit_qty));
      }, new Prisma.Decimal(0));
    const returnAmount = amountOf(returnLines);
    const effectiveReturns = await tx.hspsi_purchase_order_input_exit.findMany({
      where: { po_id: sourceReturn.po_id, exit_type: 1, approve_status: 1, deleted_at: null },
      select: { po_exit_id: true },
    });
    const effectiveReturnLines = effectiveReturns.length
      ? await tx.hspsi_purchase_order_input_exit_detail.findMany({
          where: {
            po_exit_id: { in: effectiveReturns.map((item) => item.po_exit_id) },
            deleted_at: null,
          },
          select: { goods_id: true, sku_id: true, exit_qty: true },
        })
      : [];
    const totalReturnAmount = amountOf(effectiveReturnLines);
    const effectivePayableRaw = new Prisma.Decimal(order.pay_amout).minus(totalReturnAmount);
    const effectivePayable = effectivePayableRaw.lessThan(0)
      ? new Prisma.Decimal(0)
      : effectivePayableRaw;
    const obligationRaw = new Prisma.Decimal(paid._sum.fact_pay_amount ?? 0).minus(
      effectivePayable,
    );
    const totalObligation = obligationRaw.lessThan(0) ? new Prisma.Decimal(0) : obligationRaw;
    const assigned = await tx.hspsi_purchase_refund.aggregate({
      where: { po_id: sourceReturn.po_id, deleted_at: null },
      _sum: { refundable_amount: true },
    });
    const availableRaw = totalObligation.minus(assigned._sum.refundable_amount ?? 0);
    const available = availableRaw.lessThan(0) ? new Prisma.Decimal(0) : availableRaw;
    const refundableAmount =
      sourceReturn.exit_type === 1
        ? available.greaterThan(returnAmount)
          ? returnAmount
          : available
        : new Prisma.Decimal(0);
    if (refundableAmount.lessThanOrEqualTo(0)) {
      await this.recalcPayment(tx, sourceReturn.po_id);
      return null;
    }
    const refundStatus = 0;
    await this.assertDictionaryValue(tx, 'purchase_refund_status', refundStatus, '采购退款状态');
    const refundNo =
      existing?.refund_no || (await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_REFUND));
    const task = existing
      ? await tx.hspsi_purchase_refund.update({
          where: { refund_id: existing.refund_id },
          data: {
            po_id: sourceReturn.po_id,
            po_input_id: sourceReturn.po_input_id,
            org_id: order.org_id,
            dept_id: order.dept_id,
            vendor_id: order.vendor_id,
            source_type: sourceType,
            return_type: sourceReturn.exit_type,
            return_amount: returnAmount,
            refundable_amount: refundableAmount,
            refunded_amount: new Prisma.Decimal(0),
            refund_status: refundStatus,
            remark: sourceReturn.exit_reson,
            deleted_at: null,
            updated_by: BigInt(userId),
            updated_at: new Date(),
          },
        })
      : await tx.hspsi_purchase_refund.create({
          data: {
            refund_no: refundNo,
            po_exit_id: exitId,
            po_id: sourceReturn.po_id,
            po_input_id: sourceReturn.po_input_id,
            org_id: order.org_id,
            dept_id: order.dept_id,
            vendor_id: order.vendor_id,
            source_type: sourceType,
            return_type: sourceReturn.exit_type,
            return_amount: returnAmount,
            refundable_amount: refundableAmount,
            refunded_amount: new Prisma.Decimal(0),
            refund_status: refundStatus,
            remark: sourceReturn.exit_reson,
            created_by: BigInt(userId),
            updated_by: BigInt(userId),
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
    await this.recalcPayment(tx, sourceReturn.po_id);
    await this.documentTrace.link(
      {
        upstreamType: 'purchase_return',
        upstreamId: sourceReturn.po_exit_id,
        upstreamNo: sourceReturn.po_exit_no,
        downstreamType: 'purchase_refund',
        downstreamId: task.refund_id,
        downstreamNo: refundNo,
        relationKind: 'refund_task',
        createdBy: userId,
      },
      tx,
    );
    return task;
  }
  private async syncProductionShortageState(
    tx: Prisma.TransactionClient,
    purId: bigint,
    userId: string,
  ) {
    if (purId <= 0n) return;
    const applicationLines = await tx.hspsi_purchase_approve_detail.findMany({
      where: { pur_id: purId, source_shortage_id: { gt: 0n } },
      orderBy: { id: 'asc' },
    });
    if (!applicationLines.length) return;
    const orders = await tx.hspsi_purchase_order.findMany({
      where: { pur_id: purId, deleted_at: null },
      select: { po_id: true },
    });
    const orderLines = orders.length
      ? await tx.hspsi_purchase_order_detail.findMany({
          where: { po_id: { in: orders.map((order) => order.po_id) } },
          orderBy: { id: 'asc' },
        })
      : [];
    const receivedByGoods = new Map<string, number>();
    for (const line of orderLines) {
      const key = `${line.goods_id}:${line.sku_id}`;
      receivedByGoods.set(key, (receivedByGoods.get(key) ?? 0) + Number(line.actual_qty));
    }
    const shortages = await tx.hspsi_production_shortage.findMany({
      where: {
        shortage_id: { in: applicationLines.map((line) => line.source_shortage_id) },
        deleted_at: null,
      },
    });
    const planIds = new Set<bigint>();
    for (const applicationLine of applicationLines) {
      const shortage = shortages.find(
        (item) => item.shortage_id === applicationLine.source_shortage_id,
      );
      if (!shortage || ![1, 2].includes(shortage.status)) continue;
      const key = `${applicationLine.goods_id}:${applicationLine.sku_id}`;
      const available = receivedByGoods.get(key) ?? 0;
      const allocated = Math.min(available, Number(applicationLine.qty));
      receivedByGoods.set(key, Math.max(0, available - allocated));
      const purchaseGap = Number(shortage.suggest_purchase_qty);
      const resolved = allocated + 0.000001 >= purchaseGap;
      const originalStock = Math.max(0, Number(shortage.require_qty) - purchaseGap);
      await tx.hspsi_production_shortage.update({
        where: { shortage_id: shortage.shortage_id },
        data: {
          status: resolved ? 2 : 1,
          fact_qty: Math.min(Number(shortage.require_qty), originalStock + allocated),
          updated_by: BigInt(userId),
        },
      });
      planIds.add(shortage.plan_id);
    }
    for (const planId of planIds) {
      const [plan, activeShortages, confirmedOutputCount, productionInputCount] = await Promise.all(
        [
          tx.hspsi_production_plan.findFirst({ where: { plan_id: planId, deleted_at: null } }),
          tx.hspsi_production_shortage.findMany({
            where: { plan_id: planId, status: { in: [0, 1, 2] }, deleted_at: null },
          }),
          tx.hspsi_production_material_out.count({
            where: { plan_id: planId, confirm_tag: 1, deleted_at: null },
          }),
          tx.hspsi_production_plan_input.count({ where: { plan_id: planId, deleted_at: null } }),
        ],
      );
      if (!plan || [5, 6].includes(plan.plan_status) || !activeShortages.length) continue;
      const allResolved = activeShortages.every((shortage) => shortage.status === 2);
      const unexecuted =
        confirmedOutputCount === 0 &&
        productionInputCount === 0 &&
        Number(plan.delivered_qty) === 0;
      await tx.hspsi_production_plan.update({
        where: { plan_id: plan.plan_id },
        data: {
          material_status: allResolved ? 4 : 3,
          stock_check_status: allResolved ? 0 : 2,
          ...(unexecuted
            ? {
                plan_status: 7,
                approve_status: 0,
                approve_comment: '',
                approve_by: 0n,
                approve_date: null,
              }
            : {}),
          updated_by: Number(userId),
        },
      });
    }
  }
  private async rollbackProductionShortageApplication(
    tx: Prisma.TransactionClient,
    purId: bigint,
    userId: string,
  ) {
    const application = await tx.hspsi_purchase_approve.findUnique({
      where: { pur_id: purId },
      select: { source_type: true },
    });
    if (!application || application.source_type !== 'production_plan') return;
    const applicationLines = await tx.hspsi_purchase_approve_detail.findMany({
      where: { pur_id: purId, source_shortage_id: { gt: 0n } },
      select: { source_shortage_id: true },
    });
    const shortageIds = [...new Set(applicationLines.map((line) => line.source_shortage_id))];
    if (!shortageIds.length) return;
    const shortages = await tx.hspsi_production_shortage.findMany({
      where: {
        shortage_id: { in: shortageIds },
        pur_id: purId,
        status: { in: [1, 2] },
        deleted_at: null,
      },
      select: { shortage_id: true, plan_id: true },
    });
    if (!shortages.length) return;
    await tx.hspsi_production_shortage.updateMany({
      where: { shortage_id: { in: shortages.map((item) => item.shortage_id) } },
      data: { status: 0, pur_id: 0n, updated_by: BigInt(userId), updated_at: new Date() },
    });
    const planIds = [...new Set(shortages.map((item) => item.plan_id))];
    for (const planId of planIds) {
      await tx.$queryRaw`SELECT plan_id FROM hspsi_production_plan WHERE plan_id=${planId} FOR UPDATE`;
      const plan = await tx.hspsi_production_plan.findFirst({
        where: { plan_id: planId, deleted_at: null },
        select: { plan_status: true, outbound_status: true, delivered_qty: true },
      });
      if (!plan || [5, 6].includes(plan.plan_status)) continue;
      const [confirmedOutputCount, productionInputCount] = await Promise.all([
        tx.hspsi_production_material_out.count({
          where: { plan_id: planId, confirm_tag: 1, deleted_at: null },
        }),
        tx.hspsi_production_plan_input.count({ where: { plan_id: planId, deleted_at: null } }),
      ]);
      if (confirmedOutputCount || productionInputCount || Number(plan.delivered_qty) > 0) {
        throw new BadRequestException('生产计划已执行，不能退回缺料采购申请');
      }
      await tx.hspsi_production_plan.update({
        where: { plan_id: planId },
        data: {
          plan_status: 7,
          material_status: 2,
          stock_check_status: 2,
          approve_status: 0,
          approve_comment: '',
          approve_by: 0n,
          approve_date: null,
          updated_by: Number(userId),
        },
      });
    }
  }
  private async assertProductionShortageOrderCapacity(tx: Prisma.TransactionClient, purId: bigint) {
    if (purId <= 0n) return;
    const applicationLines = await tx.hspsi_purchase_approve_detail.findMany({
      where: { pur_id: purId, source_shortage_id: { gt: 0n } },
      select: { source_shortage_id: true, goods_id: true, sku_id: true },
    });
    if (!applicationLines.length) return;
    const shortages = await tx.hspsi_production_shortage.findMany({
      where: {
        shortage_id: { in: applicationLines.map((line) => line.source_shortage_id) },
        pur_id: purId,
        status: { in: [1, 2] },
        deleted_at: null,
      },
      select: { shortage_id: true, suggest_purchase_qty: true },
    });
    if (!shortages.length) return;
    const shortageMap = new Map(shortages.map((item) => [String(item.shortage_id), item]));
    const requiredByGoods = new Map<string, number>();
    for (const line of applicationLines) {
      const shortage = shortageMap.get(String(line.source_shortage_id));
      if (!shortage) continue;
      const key = `${line.goods_id}:${line.sku_id}`;
      requiredByGoods.set(
        key,
        (requiredByGoods.get(key) ?? 0) + Number(shortage.suggest_purchase_qty),
      );
    }
    await tx.$queryRaw`SELECT po_id FROM hspsi_purchase_order WHERE pur_id=${purId} AND deleted_at IS NULL FOR UPDATE`;
    const orders = await tx.hspsi_purchase_order.findMany({
      where: { pur_id: purId, deleted_at: null },
      select: { po_id: true },
    });
    const orderLines = orders.length
      ? await tx.hspsi_purchase_order_detail.findMany({
          where: { po_id: { in: orders.map((order) => order.po_id) } },
          select: { goods_id: true, sku_id: true, qty: true, cancel_qty: true },
        })
      : [];
    const capacityByGoods = new Map<string, number>();
    for (const line of orderLines) {
      const key = `${line.goods_id}:${line.sku_id}`;
      capacityByGoods.set(
        key,
        (capacityByGoods.get(key) ?? 0) + Number(line.qty) - Number(line.cancel_qty),
      );
    }
    for (const [key, required] of requiredByGoods) {
      if ((capacityByGoods.get(key) ?? 0) + 0.000001 < required) {
        throw new BadRequestException('生产缺料采购的有效数量不能低于尚未解决的缺料数量');
      }
    }
  }

  async applications(query: Body) {
    const { page, pageSize } = this.paging(query);
    const where: Prisma.hspsi_purchase_approveWhereInput = { deleted_at: null };
    if (query.orgId) where.org_id = BigInt(query.orgId);
    if (query.warehouseId) where.warehouse_id = BigInt(query.warehouseId);
    if (query.approveStatus !== undefined) where.approve_status = Number(query.approveStatus);
    if (query.keyword) where.pur_reson = { contains: String(query.keyword) };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.hspsi_purchase_approve.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { pur_id: 'desc' },
      }),
      this.prisma.hspsi_purchase_approve.count({ where }),
    ]);
    const lines = records.length
      ? await this.prisma.hspsi_purchase_approve_detail.findMany({
          where: { pur_id: { in: records.map((item) => item.pur_id) } },
          select: { pur_id: true, qty: true },
        })
      : [];
    const items = records.map((item) => {
      const itemLines = lines.filter((line) => line.pur_id === item.pur_id);
      return {
        id: item.pur_id,
        applicationNo: item.pur_no,
        orgId: item.org_id,
        deptId: item.dept_id,
        reason: item.pur_reson,
        warehouseId: item.warehouse_id,
        quantity: itemLines.reduce((sum, line) => sum + line.qty, 0),
        status: item.status,
        approveStatus: item.approve_status,
        approveComment: item.approve_comment,
        approveBy: item.approve_by,
        approveDate: item.approve_date,
        remark: item.remark,
        createdBy: item.created_by,
        createdAt: item.created_at,
      };
    });
    return { items, total, page, pageSize };
  }
  async application(id: string) {
    const header = await this.prisma.hspsi_purchase_approve.findFirst({
      where: { pur_id: BigInt(id), deleted_at: null },
    });
    if (!header) throw new NotFoundException('采购申请不存在');
    const details = await this.prisma.hspsi_purchase_approve_detail.findMany({
      where: { pur_id: header.pur_id },
    });
    return {
      id: header.pur_id,
      applicationNo: header.pur_no,
      orgId: header.org_id,
      deptId: header.dept_id,
      reason: header.pur_reson,
      sourceType: header.source_type,
      sourceId: header.source_id,
      warehouseId: header.warehouse_id,
      status: header.status,
      approveStatus: header.approve_status,
      approveComment: header.approve_comment,
      approveBy: header.approve_by,
      approveDate: header.approve_date,
      remark: header.remark,
      createdBy: header.created_by,
      createdAt: header.created_at,
      details: details.map((item) => ({
        id: item.id,
        goodsId: item.goods_id,
        skuId: item.sku_id,
        sourceShortageId: item.source_shortage_id,
        quantity: item.qty,
        unitType: item.unit_type,
        remark: item.remark,
      })),
    };
  }
  async saveApplication(id: string | null, body: Body, userId: string, submit = false) {
    const lines = this.details(body.details);
    let purId = id ? BigInt(id) : 0n;
    let businessNo = '';
    for (const line of lines) this.quantity(line.quantity, '采购申请数量');
    const data = {
      org_id: BigInt(String(body.orgId)),
      dept_id: BigInt(String(body.deptId)),
      pur_reson: String(body.reason ?? ''),
      warehouse_id: BigInt(String(body.warehouseId)),
      status: submit ? 1 : 0,
      approve_status: 0,
      approve_comment: '',
      approve_by: 0n,
      approve_date: null,
      remark: String(body.remark ?? ''),
      updated_by: BigInt(userId),
      updated_at: new Date(),
    };
    return this.guardedTransaction(async (tx) => {
      await this.materializeQuickCatalog(tx, lines, userId);
      if (id) {
        await tx.$queryRaw`SELECT pur_id FROM hspsi_purchase_approve WHERE pur_id=${purId} FOR UPDATE`;
        const existing = await tx.hspsi_purchase_approve.findFirst({
          where: { pur_id: purId, deleted_at: null },
        });
        if (!existing) throw new NotFoundException('采购申请不存在');
        businessNo = existing.pur_no;
        if (existing.source_type === 'production_plan')
          throw new BadRequestException('生产缺料采购申请由系统生成，不允许手工编辑');
        if (!([0, 2].includes(Number(existing.status)) || Number(existing.approve_status) === 2))
          throw new BadRequestException('当前状态不能编辑');
        await this.assertOrganizationScope(tx, data.org_id, data.dept_id, data.warehouse_id);
        await this.assertPurchaseWarehouse(tx, data.org_id, data.warehouse_id, lines);
        await tx.hspsi_purchase_approve.update({ where: { pur_id: purId }, data });
      } else {
        await this.assertOrganizationScope(tx, data.org_id, data.dept_id, data.warehouse_id);
        await this.assertPurchaseWarehouse(tx, data.org_id, data.warehouse_id, lines);
        businessNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_APPLICATION);
        const application = await tx.hspsi_purchase_approve.create({
          data: {
            pur_no: businessNo,
            ...data,
            created_by: BigInt(userId),
            created_at: new Date(),
          },
        });
        purId = application.pur_id;
      }
      await tx.hspsi_purchase_approve_detail.deleteMany({ where: { pur_id: purId } });
      await tx.hspsi_purchase_approve_detail.createMany({
        data: lines.map((line) => ({
          pur_id: purId,
          goods_id: BigInt(String(line.goodsId)),
          sku_id: BigInt(String(line.skuId)),
          qty: Number(line.quantity),
          unit_type: Number(line.unitType),
          reference_price: new Prisma.Decimal(0),
          remark: String(line.remark ?? ''),
        })),
      });
      return {
        id: purId,
        businessNo,
        message: submit ? '已提交审批' : id ? '更新成功' : '草稿已保存',
      };
    });
  }
  async submitApplication(id: string, userId: string) {
    const purId = BigInt(id);
    await this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT pur_id FROM hspsi_purchase_approve WHERE pur_id=${purId} FOR UPDATE`;
      const application = await tx.hspsi_purchase_approve.findFirst({
        where: { pur_id: purId, deleted_at: null },
      });
      if (!application) throw new NotFoundException('采购申请不存在');
      if (application.source_type === 'production_plan')
        throw new BadRequestException('生产缺料采购申请已由系统提交，不允许手工再次提交');
      if (![0, 2].includes(Number(application.status)) && Number(application.approve_status) !== 2)
        throw new BadRequestException('当前状态不能提交');
      await tx.hspsi_purchase_approve.update({
        where: { pur_id: purId },
        data: {
          status: 1,
          approve_status: 0,
          approve_comment: '',
          updated_by: BigInt(userId),
          updated_at: new Date(),
        },
      });
    });
    return { id, message: '已提交审批' };
  }
  async approveApplication(id: string, approved: boolean, comment: string, userId: string) {
    const purId = BigInt(id);
    return this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT pur_id FROM hspsi_purchase_approve WHERE pur_id=${purId} FOR UPDATE`;
      const app = await tx.hspsi_purchase_approve.findFirst({
        where: { pur_id: purId, deleted_at: null },
      });
      if (!app) throw new NotFoundException('采购申请不存在');
      if (app.status !== 1 || app.approve_status !== 0)
        throw new BadRequestException('仅待审批申请可执行此操作');
      let effectiveDeptId = app.dept_id;
      if (approved && app.source_type === 'production_plan' && effectiveDeptId <= 0n) {
        effectiveDeptId = await this.resolveProductionPurchaseDepartment(tx, app.org_id);
        await tx.hspsi_purchase_approve.update({
          where: { pur_id: purId },
          data: { dept_id: effectiveDeptId, updated_by: BigInt(userId), updated_at: new Date() },
        });
      }
      if (approved)
        await this.assertOrganizationScope(tx, app.org_id, effectiveDeptId, app.warehouse_id);
      if (!approved) {
        await tx.hspsi_purchase_approve.update({
          where: { pur_id: purId },
          data: {
            approve_status: 2,
            approve_comment: comment,
            approve_by: BigInt(userId),
            approve_date: new Date(),
            updated_by: BigInt(userId),
          },
        });
        await this.rollbackProductionShortageApplication(tx, purId, userId);
        return { id, message: '已驳回，生产缺料已退回待处理' };
      }
      const existing = await tx.hspsi_purchase_order.count({
        where: { pur_id: purId, deleted_at: null },
      });
      if (existing) throw new BadRequestException('该申请已生成采购订单');
      const appLines = await tx.hspsi_purchase_approve_detail.findMany({
        where: { pur_id: purId },
      });
      if (approved) await this.assertPurchaseWarehouse(tx, app.org_id, app.warehouse_id, appLines);
      const quantity = appLines.reduce((s, l) => s + l.qty, 0);
      const orderNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_ORDER);
      const order = await tx.hspsi_purchase_order.create({
        data: {
          po_no: orderNo,
          pur_id: purId,
          org_id: app.org_id,
          warehouse_id: app.warehouse_id,
          dept_id: effectiveDeptId,
          receiver_id: BigInt(userId),
          vendor_id: 0n,
          pcs_qty: quantity,
          arrival_type: 1,
          plan_arrival_date: new Date(),
          delivery_type: 1,
          delivery_no: '',
          arrival_qty: 0,
          is_all_arrival: 0,
          pay_amout: new Prisma.Decimal(0),
          pay_type: 1,
          plan_pay_date: null,
          pay_amount_done: 0,
          pay_status: 0,
          status: 1,
          approve_status: 0,
          approve_comment: '',
          approve_by: 0n,
          remark: String(app.remark ?? ''),
          created_by: BigInt(userId),
          updated_by: BigInt(userId),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      const poId = order.po_id;
      await tx.hspsi_purchase_order_detail.createMany({
        data: appLines.map((line) => ({
          po_id: poId,
          goods_id: line.goods_id,
          sku_id: line.sku_id,
          qty: line.qty,
          actual_qty: 0,
          cancel_qty: 0,
          unit_type: line.unit_type,
          unit_price: new Prisma.Decimal(0),
          total_amout: new Prisma.Decimal(0),
          remark: line.remark,
        })),
      });
      await this.assertProductionShortageOrderCapacity(tx, purId);
      await this.documentTrace.link(
        {
          upstreamType: 'purchase_application',
          upstreamId: id,
          upstreamNo: app.pur_no,
          downstreamType: 'purchase_order',
          downstreamId: poId,
          downstreamNo: orderNo,
          createdBy: userId,
        },
        tx,
      );
      await tx.hspsi_purchase_approve.update({
        where: { pur_id: purId },
        data: {
          approve_status: 1,
          approve_comment: comment,
          approve_by: BigInt(userId),
          approve_date: new Date(),
          updated_by: BigInt(userId),
        },
      });
      return { id, orderId: poId, orderNo, message: '审批通过，已自动生成采购订单' };
    });
  }
  async removeApplication(id: string, userId: string) {
    const purId = BigInt(id);
    await this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT pur_id FROM hspsi_purchase_approve WHERE pur_id=${purId} FOR UPDATE`;
      const item = await tx.hspsi_purchase_approve.findFirst({
        where: { pur_id: purId, deleted_at: null },
      });
      if (!item) throw new NotFoundException('采购申请不存在');
      if (item.status === 1 && item.approve_status !== 2)
        throw new BadRequestException('已提交申请不能删除');
      if (await tx.hspsi_purchase_order.count({ where: { pur_id: purId, deleted_at: null } }))
        throw new BadRequestException('申请已生成采购订单');
      await this.rollbackProductionShortageApplication(tx, purId, userId);
      await tx.hspsi_purchase_approve.update({
        where: { pur_id: purId },
        data: { deleted_at: new Date(), updated_by: BigInt(userId) },
      });
      await this.documentTrace.removeForDocument('purchase_application', id, tx);
    });
    return { id, message: '删除成功' };
  }

  async orders(query: Body) {
    const { page, pageSize } = this.paging(query);
    const where: Prisma.hspsi_purchase_orderWhereInput = { deleted_at: null };
    if (query.vendorId) where.vendor_id = BigInt(query.vendorId);
    if (query.orderStatus) where.status = Number(query.orderStatus);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_purchase_order.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { po_id: 'desc' },
      }),
      this.prisma.hspsi_purchase_order.count({ where }),
    ]);
    const [details, vendors, positions] = await Promise.all([
      items.length
        ? this.prisma.hspsi_purchase_order_detail.findMany({
            where: { po_id: { in: items.map((item) => item.po_id) } },
          })
        : [],
      items.length
        ? this.prisma.hspsi_basic_vendor.findMany({
            where: { vendor_id: { in: items.map((item) => item.vendor_id).filter((v) => v > 0n) } },
            select: { vendor_id: true, conpany_name: true },
          })
        : [],
      Promise.all(
        items.map(
          async (item) =>
            [
              String(item.po_id),
              await this.purchaseMoneyPosition(this.prisma, item.po_id),
            ] as const,
        ),
      ),
    ]);
    const positionMap = new Map(positions);
    return {
      items: items.map((item) => {
        const lines = details.filter((line) => line.po_id === item.po_id);
        const detailAmount = lines.reduce((sum, line) => sum + Number(line.total_amout), 0);
        const totalCancelQty = lines.reduce((sum, line) => sum + Number(line.cancel_qty), 0);
        const vendor = vendors.find((v) => v.vendor_id === item.vendor_id);
        const position = positionMap.get(String(item.po_id));
        const progressPct =
          item.pcs_qty > 0 ? Math.round((Number(item.arrival_qty) / item.pcs_qty) * 100) : 0;
        return {
          id: item.po_id,
          orderNo: item.po_no,
          applicationId: item.pur_id || null,
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          deptId: item.dept_id,
          receiverId: item.receiver_id,
          vendorId: item.vendor_id,
          vendorName: vendor?.conpany_name ?? '',
          pcsQty: item.pcs_qty,
          quantity: lines.reduce((sum, line) => sum + Number(line.qty), 0),
          cancelQty: totalCancelQty,
          arrivalType: item.arrival_type,
          planArrivalDate: item.plan_arrival_date,
          deliveryType: item.delivery_type,
          deliveryNo: item.delivery_no,
          arrivedQuantity: item.arrival_qty,
          isAllArrived: item.is_all_arrival,
          arrivalProgress: progressPct,
          totalAmount: detailAmount,
          payableAmount: Number(position?.originalPayable ?? detailAmount),
          returnAmount: Number(position?.returnAmount ?? 0),
          effectivePayable: Number(position?.effectivePayable ?? detailAmount),
          paidAmount: Number(position?.grossPaid ?? item.pay_amount_done),
          refundedAmount: Number(position?.grossRefunded ?? 0),
          netPaidAmount: Number(position?.netPaid ?? item.pay_amount_done),
          remainingPayable: Number(position?.remainingPayable ?? detailAmount),
          paymentProgressStatus: position?.paymentProgressStatus ?? 0,
          paymentType: item.pay_type,
          planPayDate: item.plan_pay_date,
          paymentStatus: item.pay_status,
          orderStatus: item.status,
          remark: item.remark,
          createdBy: item.created_by,
          createdAt: item.created_at,
        };
      }),
      total,
      page,
      pageSize,
    };
  }
  async order(id: string) {
    const header = await this.prisma.hspsi_purchase_order.findFirst({
      where: { po_id: BigInt(id), deleted_at: null },
    });
    if (!header) throw new NotFoundException('采购订单不存在');
    const details = await this.prisma.hspsi_purchase_order_detail.findMany({
      where: { po_id: header.po_id },
    });
    const [goods, receiptHeads, sourceApplication] = await Promise.all([
      details.length
        ? this.prisma.hspsi_goods_info.findMany({
            where: { goods_id: { in: details.map((line) => line.goods_id) } },
          })
        : [],
      this.prisma.hspsi_purchase_order_input.findMany({
        where: { po_id: header.po_id, comfirm_status: { in: [0, 1] }, deleted_at: null },
        select: { po_input_id: true, comfirm_status: true },
      }),
      header.pur_id > 0n
        ? this.prisma.hspsi_purchase_approve.findFirst({
            where: { pur_id: header.pur_id, deleted_at: null },
            select: { pur_no: true },
          })
        : null,
    ]);
    const [categories, receiptDetails] = await Promise.all([
      goods.length
        ? this.prisma.hspsi_goods_info_category.findMany({
            where: {
              goods_catg_id: { in: goods.map((item) => item.goods_catg_id) },
              deleted_at: null,
            },
          })
        : [],
      receiptHeads.length
        ? this.prisma.hspsi_purchase_order_input_detail.findMany({
            where: {
              po_input_id: { in: receiptHeads.map((item) => item.po_input_id) },
              deleted_at: null,
            },
          })
        : [],
    ]);
    const confirmedIds = new Set(
      receiptHeads
        .filter((item) => item.comfirm_status === 1)
        .map((item) => String(item.po_input_id)),
    );
    const detailAmount = details.reduce((sum, line) => sum + Number(line.total_amout), 0);
    const position = await this.purchaseMoneyPosition(this.prisma, header.po_id);
    return {
      ...header,
      orderNo: header.po_no,
      applicationId: header.pur_id || null,
      applicationNo: sourceApplication?.pur_no ?? null,
      totalAmount: detailAmount,
      payableAmount: Number(position.originalPayable),
      returnAmount: Number(position.returnAmount),
      effectivePayable: Number(position.effectivePayable),
      paidAmount: Number(position.grossPaid),
      refundedAmount: Number(position.grossRefunded),
      netPaidAmount: Number(position.netPaid),
      remainingPayable: Number(position.remainingPayable),
      paymentProgressStatus: position.paymentProgressStatus,
      details: details.map((line) => {
        const product = goods.find((item) => item.goods_id === line.goods_id);
        const received = receiptDetails.filter(
          (item) => item.goods_id === line.goods_id && item.sku_id === line.sku_id,
        );
        const arrivedQuantity = received.reduce((sum, item) => sum + Number(item.input_qty), 0);
        const inputtedQuantity = received
          .filter((item) => confirmedIds.has(String(item.po_input_id)))
          .reduce((sum, item) => sum + Number(item.input_qty), 0);
        const latestArrivalDate =
          received
            .map((item) => item.arrive_at)
            .filter(Boolean)
            .sort((a, b) => Number(b) - Number(a))[0] ?? null;
        const canceledQuantity = Number(line.cancel_qty);
        const category = categories.find((item) => item.goods_catg_id === product?.goods_catg_id);
        return {
          id: line.id,
          goodsId: line.goods_id,
          goodsCode: product?.query_code ?? '',
          goodsName: product?.goods_name ?? '',
          categoryId: product?.goods_catg_id ?? 0,
          categoryName: category?.goods_name ?? '',
          categoryWarehouseType: category?.warehouse_type ?? 0,
          skuId: line.sku_id,
          quantity: line.qty,
          canceledQuantity,
          arrivedQuantity,
          unarrivedQuantity: Math.max(0, Number(line.qty) - canceledQuantity - arrivedQuantity),
          inputtedQuantity,
          uninputtedQuantity: Math.max(0, arrivedQuantity - inputtedQuantity),
          remainingQuantity: Math.max(0, Number(line.qty) - canceledQuantity - arrivedQuantity),
          latestArrivalDate,
          unitType: line.unit_type,
          unitPrice: line.unit_price,
          totalAmount: Number(line.total_amout),
          remark: line.remark,
        };
      }),
    };
  }
  async saveOrder(id: string | null, body: Body, userId: string) {
    const lines = this.details(body.details);
    let poId = id ? BigInt(id) : 0n;
    const existingOrder = id ? await this.order(id) : null;
    let orderNo = String(existingOrder?.orderNo ?? '');
    if (existingOrder && Number(existingOrder.status) !== 1)
      throw new BadRequestException('仅待采购订单可以编辑');
    const existingApplicationId = existingOrder?.applicationId
      ? BigInt(String(existingOrder.applicationId))
      : 0n;
    const requestedApplicationId = body.applicationId ? BigInt(String(body.applicationId)) : 0n;
    if (id && existingApplicationId !== requestedApplicationId && requestedApplicationId !== 0n)
      throw new BadRequestException('采购订单创建后不允许更换来源采购申请');
    const effectiveApplicationId =
      id && existingApplicationId > 0n ? existingApplicationId : requestedApplicationId;
    let sourceApplication: Body | null = null;
    if (effectiveApplicationId > 0n) {
      sourceApplication = await this.application(String(effectiveApplicationId));
      if (Number(sourceApplication.approveStatus) !== 1)
        throw new BadRequestException('仅审批通过的采购申请可生成订单');
      const used = await this.prisma.hspsi_purchase_order.count({
        where: {
          pur_id: effectiveApplicationId,
          deleted_at: null,
          NOT: id ? { po_id: poId } : undefined,
        },
      });
      if (used) throw new BadRequestException('采购申请已生成订单');
    }
    const authoritativeApplication =
      sourceApplication?.sourceType === 'direct_order' ? null : sourceApplication;
    let effectiveLines = lines;
    if (authoritativeApplication) {
      const sourceLines = authoritativeApplication.details ?? [];
      if (lines.length !== sourceLines.length)
        throw new BadRequestException('申请转入订单不允许增删采购明细');
      effectiveLines = sourceLines.map((sourceLine: Body) => {
        const submitted = lines.find(
          (line) =>
            String(line.goodsId) === String(sourceLine.goodsId) &&
            String(line.skuId) === String(sourceLine.skuId),
        );
        if (!submitted) throw new BadRequestException('申请转入订单不允许更换商品或规格');
        return {
          ...submitted,
          goodsId: sourceLine.goodsId,
          skuId: sourceLine.skuId,
          quantity: sourceLine.quantity,
          unitType: sourceLine.unitType,
        };
      });
    }
    const pricedLines: Body[] = effectiveLines.map((line) => {
      const quantity = this.quantity(line.quantity, '采购数量');
      const totalAmount = new Prisma.Decimal(String(line.totalAmount ?? 0));
      if (!totalAmount.isFinite() || totalAmount.lessThanOrEqualTo(0))
        throw new BadRequestException('采购明细总价必须大于0');
      return {
        ...line,
        quantity,
        totalAmount,
        unitPrice: totalAmount.div(quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      };
    });
    const quantity = pricedLines.reduce((sum, line) => sum + line.quantity, 0);
    const total = pricedLines.reduce<Prisma.Decimal>(
      (sum, line) => sum.plus(line.totalAmount as Prisma.Decimal),
      new Prisma.Decimal(0),
    );
    const currentPaymentAmount = new Prisma.Decimal(String(body.currentPaymentAmount ?? 0));
    if (currentPaymentAmount.lessThan(0)) throw new BadRequestException('本次付款金额不能小于 0');
    if (id && currentPaymentAmount.greaterThan(0))
      throw new BadRequestException('已有采购订单请通过订单付款入口登记新付款');
    if (currentPaymentAmount.greaterThan(total))
      throw new BadRequestException('本次付款金额不能超过订单总金额');
    if (currentPaymentAmount.greaterThan(0) && !body.vendorId)
      throw new BadRequestException('登记本次付款前必须选择供应商');
    const data = {
      pur_id: effectiveApplicationId,
      org_id: BigInt(String(authoritativeApplication?.orgId ?? body.orgId)),
      warehouse_id: BigInt(String(authoritativeApplication?.warehouseId ?? body.warehouseId)),
      dept_id: BigInt(String(authoritativeApplication?.deptId ?? body.deptId)),
      receiver_id: BigInt(String(body.receiverId)),
      vendor_id: body.vendorId ? BigInt(String(body.vendorId)) : 0n,
      pcs_qty: quantity,
      arrival_type: Number(body.arrivalType),
      plan_arrival_date: this.date(body.planArrivalDate, '计划到货日'),
      delivery_type: Number(body.deliveryType),
      delivery_no: String(body.deliveryNo ?? ''),
      pay_amout: total,
      pay_type: Number(body.paymentType),
      plan_pay_date: this.optionalDate(body.planPayDate, '计划付款日'),
      status: 1,
      remark: String(body.remark ?? ''),
      updated_by: BigInt(userId),
      updated_at: new Date(),
    };
    return this.guardedTransaction(async (tx) => {
      await this.materializeQuickCatalog(tx, pricedLines, userId);
      await this.assertOrganizationScope(tx, data.org_id, data.dept_id, data.warehouse_id);
      await this.assertPurchaseWarehouse(tx, data.org_id, data.warehouse_id, pricedLines);
      await this.assertDictionaryValue(tx, 'purchase_settlement_type', data.pay_type, '结算方式');
      if (id) {
        await tx.$queryRaw`SELECT po_id FROM hspsi_purchase_order WHERE po_id=${poId} FOR UPDATE`;
        const locked = await tx.hspsi_purchase_order.findFirst({
          where: { po_id: poId, deleted_at: null },
          select: { pur_id: true },
        });
        if (!locked) throw new NotFoundException('采购订单不存在');
        if (locked.pur_id !== effectiveApplicationId)
          throw new BadRequestException('采购订单来源已变化，请刷新后重试');
      }
      if (effectiveApplicationId > 0n) {
        await tx.$queryRaw`SELECT pur_id FROM hspsi_purchase_approve WHERE pur_id=${effectiveApplicationId} FOR UPDATE`;
        const lockedApplication = await tx.hspsi_purchase_approve.findFirst({
          where: { pur_id: effectiveApplicationId, deleted_at: null },
          select: { approve_status: true },
        });
        if (!lockedApplication || lockedApplication.approve_status !== 1)
          throw new BadRequestException('来源采购申请已删除或不再是审批通过状态');
        const used = await tx.hspsi_purchase_order.count({
          where: {
            pur_id: effectiveApplicationId,
            deleted_at: null,
            NOT: id ? { po_id: poId } : undefined,
          },
        });
        if (used) throw new BadRequestException('采购申请已生成订单');
      }
      if (id) {
        if (await tx.hspsi_purchase_order_input.count({ where: { po_id: poId, deleted_at: null } }))
          throw new BadRequestException('订单已有入库，不能编辑关键内容');
        await tx.hspsi_purchase_order.update({ where: { po_id: poId }, data });
      } else {
        orderNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_ORDER);
        const order = await tx.hspsi_purchase_order.create({
          data: {
            po_no: orderNo,
            ...data,
            arrival_qty: 0,
            is_all_arrival: 0,
            pay_amount_done: 0,
            pay_status: 0,
            approve_status: 0,
            approve_comment: '',
            approve_by: 0,
            created_by: BigInt(userId),
            created_at: new Date(),
          },
        });
        poId = order.po_id;
      }
      await tx.hspsi_purchase_order_detail.deleteMany({ where: { po_id: poId } });
      await tx.hspsi_purchase_order_detail.createMany({
        data: pricedLines.map((line) => ({
          po_id: poId,
          goods_id: BigInt(String(line.goodsId)),
          sku_id: BigInt(String(line.skuId)),
          qty: Number(line.quantity),
          actual_qty: 0,
          unit_type: Number(line.unitType),
          unit_price: line.unitPrice,
          total_amout: line.totalAmount,
          remark: String(line.remark ?? ''),
        })),
      });
      let paymentNo = '';
      if (currentPaymentAmount.greaterThan(0)) {
        const paymentChannel = Number(body.currentPaymentChannel);
        await this.assertDictionaryValue(tx, 'payment_channel', paymentChannel, '付款渠道');
        paymentNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_PAYMENT);
        const payment = await tx.hspsi_purchase_order_payment.create({
          data: {
            org_id: data.org_id,
            dept_id: data.dept_id,
            pay_no: paymentNo,
            po_id: poId,
            pay_type: paymentChannel,
            fact_pay_amount: currentPaymentAmount,
            pay_date: this.date(
              body.currentPaymentDate ?? body.businessDate ?? new Date(),
              '付款日期',
            ),
            remark: String(body.currentPaymentRemark ?? '采购订单提交时登记付款'),
            created_by: BigInt(userId),
            updated_by: BigInt(userId),
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        await this.documentTrace.link(
          {
            upstreamType: 'purchase_order',
            upstreamId: poId,
            upstreamNo: orderNo,
            downstreamType: 'purchase_payment',
            downstreamId: payment.pay_id,
            downstreamNo: payment.pay_no,
            relationKind: 'payment',
            createdBy: userId,
          },
          tx,
        );
      }
      const paymentPosition = await this.purchaseMoneyPosition(tx, poId);
      if (paymentPosition.netPaid.greaterThan(paymentPosition.effectivePayable))
        throw new BadRequestException('订单金额不能小于当前净已付金额');
      await this.recalcPayment(tx, poId);
      let applicationId = sourceApplication ? BigInt(String(sourceApplication.id)) : 0n;
      let applicationNo = sourceApplication ? String(sourceApplication.applicationNo) : '';
      if (id && sourceApplication?.sourceType === 'direct_order') {
        await tx.hspsi_purchase_approve.update({
          where: { pur_id: applicationId },
          data: {
            org_id: data.org_id,
            dept_id: data.dept_id,
            warehouse_id: data.warehouse_id,
            updated_by: BigInt(userId),
            updated_at: new Date(),
          },
        });
        await tx.hspsi_purchase_approve_detail.deleteMany({ where: { pur_id: applicationId } });
        await tx.hspsi_purchase_approve_detail.createMany({
          data: effectiveLines.map((line) => ({
            pur_id: applicationId,
            goods_id: BigInt(String(line.goodsId)),
            sku_id: BigInt(String(line.skuId)),
            qty: Number(line.quantity),
            unit_type: Number(line.unitType),
            reference_price: new Prisma.Decimal(0),
            remark: String(line.remark ?? ''),
          })),
        });
      }
      if (sourceApplication) await this.assertProductionShortageOrderCapacity(tx, applicationId);
      if (applicationId > 0n)
        await this.documentTrace.link(
          {
            upstreamType: 'purchase_application',
            upstreamId: applicationId,
            upstreamNo: applicationNo,
            downstreamType: 'purchase_order',
            downstreamId: poId,
            downstreamNo: orderNo,
            createdBy: userId,
          },
          tx,
        );
      return {
        id: poId,
        businessNo: orderNo,
        paymentNo: paymentNo || null,
        message: id
          ? '更新成功'
          : currentPaymentAmount.greaterThan(0)
            ? '采购订单及本次付款已创建'
            : '采购订单已创建',
      };
    });
  }
  async startOrder(id: string, userId: string) {
    const poId = BigInt(id);
    return this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT po_id FROM hspsi_purchase_order WHERE po_id=${poId} FOR UPDATE`;
      const order = await tx.hspsi_purchase_order.findFirst({
        where: { po_id: poId, deleted_at: null },
      });
      if (!order) throw new NotFoundException('采购订单不存在');
      if (order.status !== 1) throw new BadRequestException('仅待采购订单可以开始采购');
      if (order.vendor_id <= 0n) throw new BadRequestException('请先选择供应商并保存采购订单');
      const vendor = await tx.hspsi_basic_vendor.findFirst({
        where: { vendor_id: order.vendor_id, deleted_at: null },
        select: { vendor_id: true },
      });
      if (!vendor) throw new BadRequestException('所选供应商不存在或已停用');
      const lines = await tx.hspsi_purchase_order_detail.findMany({ where: { po_id: poId } });
      if (!lines.length) throw new BadRequestException('采购订单至少需要一条明细');
      if (lines.some((line) => Number(line.total_amout) <= 0))
        throw new BadRequestException('请先填写所有采购明细总价并保存订单');
      await this.assertOrganizationScope(tx, order.org_id, order.dept_id, order.warehouse_id);
      await this.assertPurchaseWarehouse(tx, order.org_id, order.warehouse_id, lines);
      let applicationId = order.pur_id;
      let applicationNo = '';
      if (applicationId > 0n) {
        const application = await tx.hspsi_purchase_approve.findFirst({
          where: { pur_id: applicationId, deleted_at: null },
          select: { approve_status: true, pur_no: true },
        });
        if (!application || application.approve_status !== 1)
          throw new BadRequestException('来源采购申请不存在或未审批通过');
        applicationNo = application.pur_no || applicationNo;
      } else {
        applicationNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_APPLICATION);
        const application = await tx.hspsi_purchase_approve.create({
          data: {
            pur_no: applicationNo,
            org_id: order.org_id,
            dept_id: order.dept_id,
            pur_reson: `由直接采购订单 ${order.po_no} 系统反向生成`,
            source_type: 'direct_order',
            source_id: poId,
            warehouse_id: order.warehouse_id,
            status: 1,
            approve_status: 1,
            approve_comment: '直接采购订单开始采购，系统自动完成申请',
            approve_by: BigInt(userId),
            approve_date: new Date(),
            remark: String(order.remark ?? ''),
            created_by: BigInt(userId),
            updated_by: BigInt(userId),
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        applicationId = application.pur_id;
        await tx.hspsi_purchase_approve_detail.createMany({
          data: lines.map((line) => ({
            pur_id: applicationId,
            goods_id: line.goods_id,
            sku_id: line.sku_id,
            qty: line.qty,
            unit_type: line.unit_type,
            reference_price: new Prisma.Decimal(0),
            remark: line.remark,
          })),
        });
      }
      await tx.hspsi_purchase_order.update({
        where: { po_id: poId },
        data: {
          pur_id: applicationId,
          status: 2,
          updated_by: BigInt(userId),
          updated_at: new Date(),
        },
      });
      await this.documentTrace.link(
        {
          upstreamType: 'purchase_application',
          upstreamId: applicationId,
          upstreamNo: applicationNo,
          downstreamType: 'purchase_order',
          downstreamId: poId,
          downstreamNo: order.po_no,
          createdBy: userId,
        },
        tx,
      );
      return { id, applicationId, applicationNo, message: '采购订单已开始采购' };
    });
  }
  async removeOrder(id: string, userId: string) {
    const poId = BigInt(id);
    await this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT po_id FROM hspsi_purchase_order WHERE po_id=${poId} FOR UPDATE`;
      const order = await tx.hspsi_purchase_order.findFirst({
        where: { po_id: poId, deleted_at: null },
        select: { pur_id: true },
      });
      if (!order) throw new NotFoundException('采购订单不存在');
      const [inputs, payments, shortageLines] = await Promise.all([
        tx.hspsi_purchase_order_input.count({ where: { po_id: poId, deleted_at: null } }),
        tx.hspsi_purchase_order_payment.count({ where: { po_id: poId, deleted_at: null } }),
        tx.hspsi_purchase_approve_detail.count({
          where: { pur_id: order.pur_id, source_shortage_id: { gt: 0n } },
        }),
      ]);
      if (inputs || payments) throw new BadRequestException('订单已有入库或付款，不能删除');
      if (shortageLines)
        throw new BadRequestException('生产缺料采购订单不能直接删除，请从生产计划处理');
      const directApplication = await tx.hspsi_purchase_approve.findFirst({
        where: {
          pur_id: order.pur_id,
          source_type: 'direct_order',
          source_id: poId,
          deleted_at: null,
        },
        select: { pur_id: true },
      });
      await tx.hspsi_purchase_order.update({
        where: { po_id: poId },
        data: { deleted_at: new Date(), updated_by: BigInt(userId) },
      });
      if (directApplication) {
        await tx.hspsi_purchase_approve.update({
          where: { pur_id: directApplication.pur_id },
          data: { deleted_at: new Date(), updated_by: BigInt(userId), updated_at: new Date() },
        });
        await this.documentTrace.removeForDocument(
          'purchase_application',
          directApplication.pur_id,
          tx,
        );
      }
      await this.documentTrace.removeForDocument('purchase_order', poId, tx);
    });
    return { id, message: '删除成功' };
  }
  async cancelOrderPending(id: string, body: Body, userId: string) {
    const lines = (body.details ?? []) as Body[];
    if (!lines.length) throw new BadRequestException('至少需要一条取消明细');
    const poId = BigInt(id);
    return this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT po_id FROM hspsi_purchase_order WHERE po_id=${poId} FOR UPDATE`;
      const order = await tx.hspsi_purchase_order.findFirst({
        where: { po_id: poId, deleted_at: null },
      });
      if (!order) throw new NotFoundException('采购订单不存在');
      if (![2, 3].includes(order.status))
        throw new BadRequestException('仅采购中或部分入库订单可退回未到货数量');
      const orderLines = await tx.hspsi_purchase_order_detail.findMany({
        where: { po_id: BigInt(id) },
      });
      const receiptHeaders = await tx.hspsi_purchase_order_input.findMany({
        where: { po_id: poId, comfirm_status: { in: [0, 1] }, deleted_at: null },
        select: { po_input_id: true },
      });
      const receiptDetails = receiptHeaders.length
        ? await tx.hspsi_purchase_order_input_detail.findMany({
            where: {
              po_input_id: { in: receiptHeaders.map((item) => item.po_input_id) },
              deleted_at: null,
            },
          })
        : [];
      const allocatedByGoods = new Map<string, number>();
      for (const line of receiptDetails) {
        const key = `${line.goods_id}:${line.sku_id}`;
        allocatedByGoods.set(key, (allocatedByGoods.get(key) ?? 0) + Number(line.input_qty));
      }
      const returnLines: Array<{ orderLine: (typeof orderLines)[number]; quantity: number }> = [];
      for (const line of lines) {
        const cancelQty = Number(line.cancelQuantity);
        if (!(cancelQty > 0)) throw new BadRequestException('退回数量必须大于 0');
        const orderLine = orderLines.find(
          (ol) =>
            String(ol.goods_id) === String(line.goodsId) &&
            String(ol.sku_id) === String(line.skuId),
        );
        if (!orderLine) throw new BadRequestException('商品不在订单中');
        const key = `${orderLine.goods_id}:${orderLine.sku_id}`;
        const maxCancel = Math.max(
          0,
          Number(orderLine.qty) - Number(orderLine.cancel_qty) - (allocatedByGoods.get(key) ?? 0),
        );
        if (cancelQty > maxCancel)
          throw new BadRequestException(`可退未到货数量不足 (最大 ${maxCancel})`);
        await tx.hspsi_purchase_order_detail.update({
          where: { id: orderLine.id },
          data: { cancel_qty: { increment: cancelQty } },
        });
        orderLine.cancel_qty += cancelQty;
        returnLines.push({ orderLine, quantity: cancelQty });
      }
      await this.assertProductionShortageOrderCapacity(tx, order.pur_id);
      const businessNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_RETURN);
      const header = await tx.hspsi_purchase_order_input_exit.create({
        data: {
          po_exit_no: businessNo,
          po_input_id: 0n,
          po_id: poId,
          exit_reson: String(body.reason ?? '采购订单未到货退回'),
          exit_date: new Date(),
          exit_type: Number(body.returnType ?? 1),
          status: true,
          approve_status: 1,
          approve_comment: '采购订单未到货退回，系统自动完成',
          approve_by: BigInt(userId),
          approve_date: new Date(),
          remark: String(body.remark ?? ''),
          created_by: BigInt(userId),
          updated_by: BigInt(userId),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      await tx.hspsi_purchase_order_input_exit_detail.createMany({
        data: returnLines.map(({ orderLine, quantity }) => ({
          po_exit_id: header.po_exit_id,
          po_input_id: 0n,
          po_id: poId,
          goods_id: orderLine.goods_id,
          sku_id: orderLine.sku_id,
          batch_no: '',
          unit_type: BigInt(orderLine.unit_type),
          po_qty: orderLine.qty,
          input_qty: 0,
          exit_qty: quantity,
          remark: '未入库退货',
          created_at: new Date(),
          updated_at: new Date(),
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: 'purchase_order',
          upstreamId: poId,
          upstreamNo: order.po_no,
          downstreamType: 'purchase_return',
          downstreamId: header.po_exit_id,
          downstreamNo: businessNo,
          createdBy: userId,
        },
        tx,
      );
      await this.createRefundTask(tx, header.po_exit_id, userId);
      await this.recalcOrderStatus(tx, poId);
      await tx.hspsi_purchase_order.update({
        where: { po_id: poId },
        data: { updated_by: BigInt(userId), updated_at: new Date() },
      });
      return { id: header.po_exit_id, businessNo, message: '未到货数量已退回，退货记录已生成' };
    });
  }

  async generateReceipt(id: string, userId: string, warehouseId?: unknown) {
    const order = await this.order(id);
    if (Number(order.status) === 1) throw new BadRequestException('请先开始采购，再生成采购入库单');
    const existing = await this.prisma.hspsi_purchase_order_input.findFirst({
      where: { po_id: BigInt(id), comfirm_status: 0, deleted_at: null },
      orderBy: { po_input_id: 'desc' },
    });
    if (existing) {
      await this.documentTrace.link({
        upstreamType: 'purchase_order',
        upstreamId: order.po_id,
        upstreamNo: order.orderNo,
        downstreamType: 'purchase_receipt',
        downstreamId: existing.po_input_id,
        downstreamNo: existing.po_input_no,
        createdBy: userId,
      });
      return {
        id: existing.po_input_id,
        businessNo: existing.po_input_no,
        created: false,
        message: '该订单已有待办理入库单',
      };
    }
    const lines = order.details.filter((line: Body) => Number(line.remainingQuantity ?? 0) > 0);
    if (!lines.length) throw new BadRequestException('该订单没有剩余可入库商品');
    const quantity = lines.reduce(
      (sum: number, line: Body) => sum + Number(line.remainingQuantity),
      0,
    );
    return this.prisma.$transaction(async (tx) => {
      const requestedWarehouseId = warehouseId ? BigInt(String(warehouseId)) : 0n;
      const targetWarehouseId = await this.resolvePurchaseWarehouse(
        tx,
        order.org_id,
        requestedWarehouseId || order.warehouse_id,
        lines,
        requestedWarehouseId > 0n,
      );
      await this.assertPurchaseWarehouse(tx, order.org_id, targetWarehouseId, lines);
      const businessNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_RECEIPT);
      const header = await tx.hspsi_purchase_order_input.create({
        data: {
          po_input_no: businessNo,
          po_id: order.po_id,
          org_id: order.org_id,
          warehouse_id: targetWarehouseId,
          dept_id: order.dept_id,
          input_type: 1,
          po_qty: order.pcs_qty,
          input_qty: quantity,
          remark: '',
          receiver_id: order.receiver_id,
          comfirm_status: 0,
          comfirm_comment: '',
          created_by: BigInt(userId),
          updated_by: BigInt(userId),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      await tx.hspsi_purchase_order_input_detail.createMany({
        data: lines.map((line: Body) => ({
          po_input_id: header.po_input_id,
          batch_no: '',
          po_id: order.po_id,
          goods_id: BigInt(String(line.goodsId)),
          sku_id: BigInt(String(line.skuId)),
          po_qty: Number(line.quantity),
          input_qty: Number(line.remainingQuantity),
          unit_type: Number(line.unitType),
          input_position: '',
          produce_period: null,
          validity_period: null,
          remark: String(line.remark ?? ''),
          arrive_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: 'purchase_order',
          upstreamId: order.po_id,
          upstreamNo: order.orderNo,
          downstreamType: 'purchase_receipt',
          downstreamId: header.po_input_id,
          downstreamNo: businessNo,
          createdBy: userId,
        },
        tx,
      );
      return {
        id: header.po_input_id,
        businessNo,
        created: true,
        message: '采购入库单已生成，请补充验收及批次信息',
      };
    });
  }

  async receipts(query: Body) {
    const { page, pageSize } = this.paging(query);
    const where: Prisma.hspsi_purchase_order_inputWhereInput = { deleted_at: null };
    if (query.confirmStatus !== undefined) where.comfirm_status = Number(query.confirmStatus);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_purchase_order_input.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { po_input_id: 'desc' },
      }),
      this.prisma.hspsi_purchase_order_input.count({ where }),
    ]);
    const poIds = [...new Set(items.map((i) => i.po_id).filter(Boolean))];
    const orders = poIds.length
      ? await this.prisma.hspsi_purchase_order.findMany({
          where: { po_id: { in: poIds } },
          select: { po_id: true, po_no: true, pur_id: true },
        })
      : [];
    const purIds = [...new Set(orders.map((item) => item.pur_id).filter((id) => id > 0n))];
    const applications = purIds.length
      ? await this.prisma.hspsi_purchase_approve.findMany({
          where: { pur_id: { in: purIds } },
          select: { pur_id: true, pur_no: true },
        })
      : [];
    return {
      items: items.map((item) => {
        const ord = orders.find((o) => o.po_id === item.po_id);
        return {
          id: item.po_input_id,
          receiptNo: item.po_input_no,
          orderId: item.po_id,
          orderNo: ord?.po_no ?? null,
          applicationNo:
            applications.find((application) => application.pur_id === ord?.pur_id)?.pur_no ?? null,
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          deptId: item.dept_id,
          receiverId: item.receiver_id,
          inputType: item.input_type,
          orderQuantity: item.po_qty,
          inputQuantity: item.input_qty,
          confirmStatus: item.comfirm_status,
          confirmComment: item.comfirm_comment,
          remark: item.remark,
          createdAt: item.created_at,
        };
      }),
      total,
      page,
      pageSize,
    };
  }
  async receipt(id: string) {
    const header = await this.prisma.hspsi_purchase_order_input.findFirst({
      where: { po_input_id: BigInt(id), deleted_at: null },
    });
    if (!header) throw new NotFoundException('采购入库单不存在');
    const details = await this.prisma.hspsi_purchase_order_input_detail.findMany({
      where: { po_input_id: header.po_input_id, deleted_at: null },
    });
    const order = await this.order(String(header.po_id));
    return {
      ...header,
      id: header.po_input_id,
      receiptNo: header.po_input_no,
      orderId: header.po_id,
      orderNo: order.orderNo,
      applicationNo: order.applicationNo,
      orgId: header.org_id,
      warehouseId: header.warehouse_id,
      deptId: header.dept_id,
      receiverId: header.receiver_id,
      inputType: header.input_type,
      confirmStatus: header.comfirm_status,
      details: details.map((line) => {
        const source = order.details.find(
          (item: Body) =>
            String(item.goodsId) === String(line.goods_id) &&
            String(item.skuId) === String(line.sku_id),
        );
        const pendingQuantity = header.comfirm_status === 0 ? Number(line.input_qty) : 0;
        return {
          id: line.id,
          batchNo: line.batch_no,
          goodsId: line.goods_id,
          goodsCode: source?.goodsCode ?? '',
          goodsName: source?.goodsName ?? '',
          categoryName: source?.categoryName ?? '',
          skuId: line.sku_id,
          orderQuantity: line.po_qty,
          arrivedQuantity: source?.arrivedQuantity ?? line.input_qty,
          unarrivedQuantity: source?.unarrivedQuantity ?? 0,
          inputtedQuantity: source?.inputtedQuantity ?? 0,
          uninputtedQuantity: source?.uninputtedQuantity ?? 0,
          baseArrivedQuantity: Math.max(
            0,
            Number(source?.arrivedQuantity ?? line.input_qty) - pendingQuantity,
          ),
          baseUnarrivedQuantity: Number(source?.unarrivedQuantity ?? 0) + pendingQuantity,
          baseUninputtedQuantity: Math.max(
            0,
            Number(source?.uninputtedQuantity ?? 0) - pendingQuantity,
          ),
          remainingQuantity: Number(source?.remainingQuantity ?? 0) + Number(line.input_qty),
          latestArrivalDate: source?.latestArrivalDate ?? line.arrive_at,
          inputQuantity: line.input_qty,
          unitType: line.unit_type,
          unitPrice: source?.unitPrice ?? 0,
          amount: Number(line.input_qty) * Number(source?.unitPrice ?? 0),
          position: line.input_position,
          productionDate: line.produce_period,
          validityPeriod: line.validity_period,
          arrivalDate: line.arrive_at,
          remark: line.remark,
        };
      }),
    };
  }
  async saveReceipt(id: string | null, body: Body, userId: string) {
    const lines = this.details(body.details);
    const isDirect = !body.orderId;
    const receiptId = id ? BigInt(id) : undefined;
    const oldReceipt = id ? await this.receipt(id) : null;
    if (oldReceipt && oldReceipt.comfirm_status !== 0)
      throw new BadRequestException('已确认入库单不能编辑');
    for (const line of lines) this.quantity(line.inputQuantity, '采购入库数量');
    if (!isDirect) {
      const order = await this.order(String(body.orderId));
      for (const line of lines) {
        const orderLine = order.details.find(
          (item: Body) =>
            String(item.goodsId) === String(line.goodsId) &&
            String(item.skuId) === String(line.skuId),
        );
        const currentQuantity = Number(
          oldReceipt?.details.find(
            (item: Body) =>
              String(item.goodsId) === String(line.goodsId) &&
              String(item.skuId) === String(line.skuId),
          )?.inputQuantity ?? 0,
        );
        const remaining = Number(orderLine?.remainingQuantity ?? 0) + currentQuantity;
        if (!orderLine || Number(line.inputQuantity) <= 0 || Number(line.inputQuantity) > remaining)
          throw new BadRequestException('入库数量超过订单扣除已确认及未确认占用后的剩余可入数量');
      }
    }
    for (const line of lines)
      if (!String(line.batchNo ?? '').trim()) line.batchNo = generateBatchNo();
    const qty = lines.reduce((sum, line) => sum + Number(line.inputQuantity), 0);
    return this.guardedTransaction(async (tx) => {
      if (isDirect) await this.materializeQuickCatalog(tx, lines, userId);
      let finalPoId = BigInt(0);
      let finalOrgId = BigInt(0);
      let finalWhId = BigInt(0);
      let pcsQty = 0;
      let finalPoNo = '';
      let generatedPurId = 0n;
      let lockedReceipt: null | Awaited<
        ReturnType<typeof tx.hspsi_purchase_order_input.findFirst>
      > = null;
      if (receiptId) {
        await tx.$queryRaw`SELECT po_input_id FROM hspsi_purchase_order_input WHERE po_input_id=${receiptId} FOR UPDATE`;
        lockedReceipt = await tx.hspsi_purchase_order_input.findFirst({
          where: { po_input_id: receiptId, deleted_at: null },
        });
        if (!lockedReceipt) throw new NotFoundException('采购入库单不存在');
        if (lockedReceipt.comfirm_status !== 0)
          throw new BadRequestException('已确认采购入库单不能编辑');
        if (body.orderId && lockedReceipt.po_id !== BigInt(String(body.orderId)))
          throw new BadRequestException('采购入库单创建后不可更换来源采购订单');
      }
      if (isDirect && !id) {
        const total = lines.reduce(
          (s, l) => s + Number(l.inputQuantity) * Number(l.unitPrice ?? 0),
          0,
        );
        const purNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_APPLICATION);
        const orderNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_ORDER);
        const otherSettlementType = await this.dictionaryValue(
          tx,
          'purchase_settlement_type',
          '其他',
          '采购结算方式',
        );
        finalOrgId = body.orgId ? BigInt(String(body.orgId)) : BigInt(0);
        finalWhId = body.warehouseId ? BigInt(String(body.warehouseId)) : BigInt(0);
        const deptId = body.deptId ? BigInt(String(body.deptId)) : BigInt(0);
        const resolvedVendorId = body.vendorId
          ? BigInt(String(body.vendorId))
          : await (async () => {
              if (!lines.length) return 0n;
              const firstGoodsId = lines[0]!.goodsId;
              if (!firstGoodsId) return 0n;
              return (
                (
                  await tx.hspsi_goods_info.findFirst({
                    where: { goods_id: BigInt(String(firstGoodsId)) },
                    select: { vendor_id: true },
                  })
                )?.vendor_id ?? 0n
              );
            })();
        const application = await tx.hspsi_purchase_approve.create({
          data: {
            pur_no: purNo,
            org_id: finalOrgId,
            dept_id: deptId,
            pur_reson: `由采购入库单系统生成`,
            source_type: 'temporary_receipt',
            source_id: 0n,
            warehouse_id: finalWhId,
            status: 1,
            approve_status: 1,
            approve_comment: '',
            approve_by: BigInt(userId),
            approve_date: new Date(),
            remark: '',
            created_by: BigInt(userId),
            updated_by: BigInt(userId),
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        const purId = application.pur_id;
        generatedPurId = purId;
        await tx.hspsi_purchase_approve_detail.createMany({
          data: lines.map((line) => ({
            pur_id: purId,
            goods_id: BigInt(String(line.goodsId)),
            sku_id: BigInt(String(line.skuId)),
            qty: Number(line.inputQuantity),
            unit_type: Number(line.unitType),
            reference_price: new Prisma.Decimal(0),
            remark: String(line.remark ?? ''),
          })),
        });
        const order = await tx.hspsi_purchase_order.create({
          data: {
            po_no: orderNo,
            pur_id: purId,
            org_id: finalOrgId,
            warehouse_id: finalWhId,
            dept_id: deptId,
            receiver_id: BigInt(userId),
            vendor_id: resolvedVendorId,
            pcs_qty: qty,
            arrival_type: 1,
            plan_arrival_date: new Date(),
            delivery_type: 1,
            delivery_no: '',
            arrival_qty: 0,
            is_all_arrival: 0,
            pay_amout: new Prisma.Decimal(total),
            pay_type: otherSettlementType,
            plan_pay_date: null,
            pay_amount_done: 0,
            pay_status: 0,
            status: 1,
            approve_status: 0,
            approve_comment: '',
            approve_by: 0n,
            remark: '',
            created_by: BigInt(userId),
            updated_by: BigInt(userId),
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        const newPoId = order.po_id;
        await tx.hspsi_purchase_order_detail.createMany({
          data: lines.map((line) => ({
            po_id: newPoId,
            goods_id: BigInt(String(line.goodsId)),
            sku_id: BigInt(String(line.skuId)),
            qty: Number(line.inputQuantity),
            actual_qty: 0,
            cancel_qty: 0,
            unit_type: Number(line.unitType),
            unit_price: new Prisma.Decimal(String(line.unitPrice ?? 0)),
            total_amout: new Prisma.Decimal(
              Number(line.inputQuantity) * Number(line.unitPrice ?? 0),
            ),
            remark: String(line.remark ?? ''),
          })),
        });
        finalPoId = newPoId;
        finalPoNo = orderNo;
        pcsQty = qty;
        await this.documentTrace.link(
          {
            upstreamType: 'purchase_application',
            upstreamId: purId,
            upstreamNo: purNo,
            downstreamType: 'purchase_order',
            downstreamId: newPoId,
            downstreamNo: finalPoNo,
            createdBy: userId,
          },
          tx,
        );
      } else {
        const sourceOrderId = lockedReceipt?.po_id ?? BigInt(String(body.orderId));
        await tx.$queryRaw`SELECT po_id FROM hspsi_purchase_order WHERE po_id=${sourceOrderId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM hspsi_purchase_order_detail WHERE po_id=${sourceOrderId} FOR UPDATE`;
        const ord = await tx.hspsi_purchase_order.findFirst({
          where: { po_id: sourceOrderId, deleted_at: null },
        });
        if (!ord) throw new NotFoundException('采购订单不存在');
        finalPoId = ord.po_id;
        finalPoNo = ord.po_no;
        finalOrgId = ord.org_id;
        finalWhId = body.warehouseId
          ? BigInt(String(body.warehouseId))
          : (lockedReceipt?.warehouse_id ?? ord.warehouse_id);
        pcsQty = ord.pcs_qty;
      }
      const receiptDeptId = BigInt(String(body.deptId ?? 0));
      await this.assertOrganizationScope(tx, finalOrgId, receiptDeptId, finalWhId);
      await this.assertPurchaseWarehouse(tx, finalOrgId, finalWhId, lines);
      const data = {
        po_id: finalPoId,
        org_id: finalOrgId,
        warehouse_id: finalWhId,
        dept_id: receiptDeptId,
        input_type: Number(body.inputType),
        po_qty: pcsQty,
        input_qty: qty,
        receiver_id: BigInt(String(body.receiverId)),
        remark: String(body.remark ?? ''),
        updated_by: BigInt(userId),
        updated_at: new Date(),
      };
      const receiptNo = receiptId
        ? String(lockedReceipt!.po_input_no)
        : await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_RECEIPT);
      const header = receiptId
        ? await tx.hspsi_purchase_order_input.update({ where: { po_input_id: receiptId }, data })
        : await tx.hspsi_purchase_order_input.create({
            data: {
              ...data,
              po_input_no: receiptNo,
              comfirm_status: 0,
              comfirm_comment: '',
              created_by: BigInt(userId),
              created_at: new Date(),
            },
          });
      if (generatedPurId > 0n)
        await tx.hspsi_purchase_approve.update({
          where: { pur_id: generatedPurId },
          data: { source_id: header.po_input_id },
        });
      await tx.hspsi_purchase_order_input_detail.deleteMany({
        where: { po_input_id: header.po_input_id },
      });
      await tx.hspsi_purchase_order_input_detail.createMany({
        data: lines.map((line) => ({
          po_input_id: header.po_input_id,
          batch_no: String(line.batchNo),
          po_id: finalPoId,
          goods_id: BigInt(String(line.goodsId)),
          sku_id: BigInt(String(line.skuId)),
          po_qty: Number(line.inputQuantity),
          input_qty: Number(line.inputQuantity),
          unit_type: Number(line.unitType),
          input_position: String(line.position ?? ''),
          produce_period: line.productionDate ? new Date(String(line.productionDate)) : null,
          validity_period: line.validityPeriod ? new Date(String(line.validityPeriod)) : null,
          arrive_at: line.arrivalDate ? new Date(String(line.arrivalDate)) : null,
          remark: String(line.remark ?? ''),
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: 'purchase_order',
          upstreamId: finalPoId,
          upstreamNo: finalPoNo,
          downstreamType: 'purchase_receipt',
          downstreamId: header.po_input_id,
          downstreamNo: receiptNo,
          createdBy: userId,
        },
        tx,
      );
      return {
        id: header.po_input_id,
        businessNo: receiptNo,
        message: id ? '更新成功' : '入库单已创建',
      };
    });
  }
  private async postReceipt(
    tx: Prisma.TransactionClient,
    receipt: Body,
    direction: 1 | -1,
    userId: string,
    postingVersion: number,
  ) {
    const orderLines = await tx.hspsi_purchase_order_detail.findMany({
      where: { po_id: receipt.po_id },
      orderBy: { id: 'asc' },
    });
    const action = direction > 0 ? 'confirm' : 'undo';
    await this.inventoryPosting.post(
      {
        orgId: receipt.org_id,
        warehouseId: receipt.warehouse_id,
        direction,
        operationType: direction > 0 ? 1 : 2,
        inventoryMode: INVENTORY_BUSINESS_MODE.PURCHASE_RECEIPT,
        sourceId: receipt.po_input_id,
        sourceType: direction > 0 ? 'purchase_receipt' : 'purchase_receipt_undo',
        sourceNo: receipt.receiptNo,
        operationBy: userId,
        idempotencyKey: `receipt:${receipt.po_input_id}:v${postingVersion}:${action}`,
        remark: direction > 0 ? '采购入库确认' : '采购入库撤销',
        lines: receipt.details.map((line: Body) => {
          const orderLine = orderLines.find(
            (o) => o.goods_id === line.goodsId && o.sku_id === line.skuId,
          );
          return {
            goodsId: line.goodsId,
            skuId: line.skuId,
            batchNo: line.batchNo,
            unitType: line.unitType,
            quantity: String(line.inputQuantity),
            amount: String(Number(orderLine?.unit_price ?? 0) * Number(line.inputQuantity)),
          };
        }),
      },
      tx,
    );
    const otherHeaders = await tx.hspsi_purchase_order_input.findMany({
      where: {
        po_id: receipt.po_id,
        comfirm_status: 1,
        deleted_at: null,
        NOT: { po_input_id: receipt.po_input_id },
      },
      select: { po_input_id: true },
    });
    const otherDetails = otherHeaders.length
      ? await tx.hspsi_purchase_order_input_detail.findMany({
          where: {
            po_input_id: { in: otherHeaders.map((item) => item.po_input_id) },
            deleted_at: null,
          },
        })
      : [];
    const effective: Body[] = otherDetails.map((line) => ({
      goodsId: line.goods_id,
      skuId: line.sku_id,
      inputQuantity: line.input_qty,
    }));
    if (direction > 0) effective.push(...receipt.details);
    const receivedByKey = new Map<string, number>();
    for (const line of effective) {
      const key = `${line.goodsId}:${line.skuId}`;
      receivedByKey.set(key, (receivedByKey.get(key) ?? 0) + Number(line.inputQuantity));
    }
    for (const line of orderLines) {
      const key = `${line.goods_id}:${line.sku_id}`,
        remaining = receivedByKey.get(key) ?? 0,
        capacity = Math.max(0, Number(line.qty) - Number(line.cancel_qty));
      const assigned = Math.min(capacity, remaining);
      await tx.hspsi_purchase_order_detail.update({
        where: { id: line.id },
        data: { actual_qty: assigned },
      });
      receivedByKey.set(key, Math.max(0, remaining - assigned));
    }
    const arrived = effective.reduce((sum, line) => sum + Number(line.inputQuantity), 0);
    const receivable = orderLines.reduce(
      (sum, line) => sum + Math.max(0, Number(line.qty) - Number(line.cancel_qty)),
      0,
    );
    await tx.hspsi_purchase_order.update({
      where: { po_id: receipt.po_id },
      data: { arrival_qty: arrived, is_all_arrival: arrived >= receivable ? 1 : 0 },
    });
    await this.recalcOrderStatus(tx, receipt.po_id);
  }
  async confirmReceipt(id: string, confirmed: boolean, comment: string, userId: string) {
    if (!confirmed) throw new BadRequestException('已入库单不能撤销，请从采购入库单发起采购退货');
    const receiptId = BigInt(id);
    let alreadyConfirmed = false;
    await this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT po_input_id FROM hspsi_purchase_order_input WHERE po_input_id=${receiptId} FOR UPDATE`;
      const header = await tx.hspsi_purchase_order_input.findFirst({
        where: { po_input_id: receiptId, deleted_at: null },
      });
      if (!header) throw new NotFoundException('采购入库单不存在');
      if (confirmed && header.comfirm_status === 1) {
        alreadyConfirmed = true;
        return;
      }
      if (confirmed && header.comfirm_status !== 0)
        throw new BadRequestException('仅待确认入库单可确认');
      if (!confirmed && header.comfirm_status !== 1)
        throw new BadRequestException('仅已确认入库单可撤销');
      await tx.$queryRaw`SELECT po_id FROM hspsi_purchase_order WHERE po_id=${header.po_id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM hspsi_purchase_order_detail WHERE po_id=${header.po_id} FOR UPDATE`;
      const sourceOrder = await tx.hspsi_purchase_order.findUniqueOrThrow({
        where: { po_id: header.po_id },
      });
      const orderDetails = await tx.hspsi_purchase_order_detail.findMany({
        where: { po_id: header.po_id },
      });
      const details = await tx.hspsi_purchase_order_input_detail.findMany({
        where: { po_input_id: receiptId, deleted_at: null },
      });
      const postingReceipt: Body = {
        ...header,
        receiptNo: header.po_input_no,
        details: details.map((line) => ({
          goodsId: line.goods_id,
          skuId: line.sku_id,
          batchNo: line.batch_no,
          unitType: line.unit_type,
          inputQuantity: line.input_qty,
          validityPeriod: line.validity_period,
        })),
      };
      if (
        confirmed &&
        postingReceipt.details.some((line: Body) => !String(line.batchNo ?? '').trim())
      )
        throw new BadRequestException('请先办理入库并填写全部商品批号，再执行确认入库');
      if (confirmed) {
        const confirmedHeaders = await tx.hspsi_purchase_order_input.findMany({
          where: { po_id: header.po_id, comfirm_status: 1, deleted_at: null },
          select: { po_input_id: true },
        });
        const confirmedDetails = confirmedHeaders.length
          ? await tx.hspsi_purchase_order_input_detail.findMany({
              where: {
                po_input_id: { in: confirmedHeaders.map((item) => item.po_input_id) },
                deleted_at: null,
              },
            })
          : [];
        const allowedQty = new Map<string, number>(),
          confirmedQty = new Map<string, number>(),
          currentQty = new Map<string, number>();
        for (const line of orderDetails) {
          const key = `${line.goods_id}:${line.sku_id}`;
          allowedQty.set(
            key,
            (allowedQty.get(key) ?? 0) + Math.max(0, Number(line.qty) - Number(line.cancel_qty)),
          );
        }
        for (const line of confirmedDetails) {
          const key = `${line.goods_id}:${line.sku_id}`;
          confirmedQty.set(key, (confirmedQty.get(key) ?? 0) + Number(line.input_qty));
        }
        for (const line of details) {
          const key = `${line.goods_id}:${line.sku_id}`,
            qty = Number(line.input_qty);
          if (!(qty > 0)) throw new BadRequestException('采购入库数量必须大于0');
          currentQty.set(key, (currentQty.get(key) ?? 0) + qty);
        }
        for (const [key, qty] of currentQty) {
          const allowed = allowedQty.get(key);
          if (allowed === undefined)
            throw new BadRequestException('采购入库明细不属于来源采购订单');
          if ((confirmedQty.get(key) ?? 0) + qty > allowed + 0.000001)
            throw new BadRequestException('累计确认入库数量超过采购订单可收数量');
        }
      }
      await this.documentTrace.link(
        {
          upstreamType: 'purchase_order',
          upstreamId: sourceOrder.po_id,
          upstreamNo: sourceOrder.po_no,
          downstreamType: 'purchase_receipt',
          downstreamId: header.po_input_id,
          downstreamNo: header.po_input_no,
          createdBy: userId,
        },
        tx,
      );
      if (!confirmed) {
        if (
          await tx.hspsi_purchase_order_input_exit.count({
            where: { po_input_id: receiptId, approve_status: 1, deleted_at: null },
          })
        )
          throw new BadRequestException('已有审批通过的采购退货，不能撤销入库');
        for (const line of postingReceipt.details as Body[]) {
          const batch = await tx.hspsi_inventory_batch_total.findUnique({
            where: {
              goods_id_sku_id_warehouse_id_batch_no: {
                goods_id: BigInt(String(line.goodsId)),
                sku_id: BigInt(String(line.skuId)),
                warehouse_id: header.warehouse_id,
                batch_no: String(line.batchNo ?? ''),
              },
            },
          });
          if (!batch || Number(batch.inventory_qty) < Number(line.inputQuantity))
            throw new BadRequestException(
              `商品 ${line.goodsId} 库存不足，已被下游出库消耗，无法撤销入库`,
            );
        }
      }
      const postingVersion = confirmed ? header.posting_version + 1 : header.posting_version;
      await this.postReceipt(tx, postingReceipt, confirmed ? 1 : -1, userId, postingVersion);
      if (confirmed) {
        for (const line of postingReceipt.details as Body[]) {
          await this.inventoryAlerts.syncExpiryAlert(tx, {
            goodsId: line.goodsId,
            skuId: line.skuId,
            warehouseId: header.warehouse_id,
            batchNo: String(line.batchNo ?? ''),
            endDay: line.validityPeriod,
          });
        }
      }
      await this.syncProductionShortageState(tx, sourceOrder.pur_id, userId);
      await tx.hspsi_purchase_order_input.update({
        where: { po_input_id: receiptId },
        data: {
          comfirm_status: confirmed ? 1 : 0,
          comfirm_comment: comment,
          ...(confirmed ? { posting_version: postingVersion } : {}),
          updated_by: BigInt(userId),
          updated_at: new Date(),
        },
      });
    });
    return {
      id,
      message: alreadyConfirmed
        ? '入库已确认'
        : confirmed
          ? '入库已确认，库存已增加'
          : '已撤销确认，库存已回退',
    };
  }
  async cancelReceipt(id: string, comment: string, userId: string) {
    const receiptId = BigInt(id);
    await this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT po_input_id FROM hspsi_purchase_order_input WHERE po_input_id=${receiptId} FOR UPDATE`;
      const receipt = await tx.hspsi_purchase_order_input.findFirst({
        where: { po_input_id: receiptId, deleted_at: null },
      });
      if (!receipt) throw new NotFoundException('采购入库单不存在');
      if (receipt.comfirm_status !== 0) throw new BadRequestException('仅待入库单可以撤销');
      await tx.hspsi_purchase_order_input.update({
        where: { po_input_id: receiptId },
        data: {
          comfirm_status: 2,
          comfirm_comment: comment || '待入库单已撤销',
          updated_by: BigInt(userId),
          updated_at: new Date(),
        },
      });
      await this.recalcOrderStatus(tx, receipt.po_id);
    });
    return { id, message: '待入库单已撤销，锁定数量已释放' };
  }
  async removeReceipt(id: string, userId: string) {
    return this.cancelReceipt(id, '待入库单已撤销', userId);
  }

  async returns(query: Body) {
    const { page, pageSize } = this.paging(query);
    const where: Prisma.hspsi_purchase_order_input_exitWhereInput = { deleted_at: null };
    if (query.approveStatus !== undefined) where.approve_status = Number(query.approveStatus);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_purchase_order_input_exit.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { po_exit_id: 'desc' },
      }),
      this.prisma.hspsi_purchase_order_input_exit.count({ where }),
    ]);
    const poIds = [...new Set(items.map((i) => i.po_id).filter(Boolean))];
    const orders = poIds.length
      ? await this.prisma.hspsi_purchase_order.findMany({
          where: { po_id: { in: poIds } },
          select: { po_id: true, po_no: true },
        })
      : [];
    const exitIds = items.map((i) => i.po_exit_id);
    const qtySums = exitIds.length
      ? await this.prisma.hspsi_purchase_order_input_exit_detail.groupBy({
          by: ['po_exit_id'],
          where: { po_exit_id: { in: exitIds }, deleted_at: null },
          _sum: { exit_qty: true },
        })
      : [];
    return {
      items: items.map((item) => {
        const ord = orders.find((o) => o.po_id === item.po_id);
        const qty = qtySums.find((q) => q.po_exit_id === item.po_exit_id);
        const fromReceipt = item.po_input_id > 0n;
        return {
          id: item.po_exit_id,
          returnNo: item.po_exit_no,
          receiptId: item.po_input_id,
          orderId: item.po_id,
          orderNo: ord?.po_no ?? null,
          sourceType: fromReceipt ? 'receipt' : 'order',
          sourceTypeLabel: fromReceipt ? '已入库退货' : '未入库退货',
          affectsInventory: fromReceipt,
          reason: item.exit_reson,
          returnDate: item.exit_date,
          returnType: item.exit_type,
          returnQty: Number(qty?._sum.exit_qty ?? 0),
          status: Number(item.status),
          approveStatus: item.approve_status,
          confirmStatus: item.approve_status,
          approveComment: item.approve_comment,
          autoCreated: item.auto_created === 1,
          sourceDocumentType: item.source_document_type,
          sourceDocumentId: item.source_document_id,
          createdBy: item.created_by,
          createdAt: item.created_at,
        };
      }),
      total,
      page,
      pageSize,
    };
  }
  async returnDetail(id: string) {
    const header = await this.prisma.hspsi_purchase_order_input_exit.findFirst({
      where: { po_exit_id: BigInt(id), deleted_at: null },
    });
    if (!header) throw new NotFoundException('采购退货不存在');
    const details = await this.prisma.hspsi_purchase_order_input_exit_detail.findMany({
      where: { po_exit_id: header.po_exit_id, deleted_at: null },
    });
    const fromReceipt = header.po_input_id > 0n;
    return {
      ...header,
      returnNo: header.po_exit_no,
      sourceType: fromReceipt ? 'receipt' : 'order',
      sourceTypeLabel: fromReceipt ? '已入库退货' : '未入库退货',
      affectsInventory: fromReceipt,
      autoCreated: header.auto_created === 1,
      sourceDocumentType: header.source_document_type,
      sourceDocumentId: header.source_document_id,
      details: details.map((line) => ({
        id: line.serial_number,
        goodsId: line.goods_id,
        skuId: line.sku_id,
        batchNo: line.batch_no,
        unitType: line.unit_type,
        orderQuantity: line.po_qty,
        inputQuantity: line.input_qty,
        returnQuantity: line.exit_qty,
        remark: line.remark,
      })),
    };
  }
  async saveReturn(id: string | null, body: Body, userId: string, submit = false) {
    const lines = this.details(body.details);
    const receipt = await this.receipt(String(body.receiptId));
    if (receipt.comfirm_status !== 1) throw new BadRequestException('仅已确认入库单可退货');
    const exitId = id ? BigInt(id) : undefined;
    if (id) {
      const old = await this.returnDetail(id);
      if (old.approve_status === 1) throw new BadRequestException('已审批退货不能编辑');
    }
    return this.guardedTransaction(async (tx) => {
      if (exitId) {
        await tx.$queryRaw`SELECT po_exit_id FROM hspsi_purchase_order_input_exit WHERE po_exit_id=${exitId} FOR UPDATE`;
        const lockedReturn = await tx.hspsi_purchase_order_input_exit.findFirst({
          where: { po_exit_id: exitId, deleted_at: null },
        });
        if (!lockedReturn || lockedReturn.approve_status === 1)
          throw new BadRequestException('已审批或已删除退货不能编辑');
      }
      await tx.$queryRaw`SELECT po_input_id FROM hspsi_purchase_order_input WHERE po_input_id=${receipt.po_input_id} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM hspsi_purchase_order_input_detail WHERE po_input_id=${receipt.po_input_id} FOR UPDATE`;
      const sourceHeader = await tx.hspsi_purchase_order_input.findFirst({
        where: { po_input_id: receipt.po_input_id, comfirm_status: 1, deleted_at: null },
      });
      if (!sourceHeader) throw new BadRequestException('来源采购入库单不存在或已撤销确认');
      const sourceDetails = await tx.hspsi_purchase_order_input_detail.findMany({
        where: { po_input_id: receipt.po_input_id, deleted_at: null },
      });
      const approvedHeaders = await tx.hspsi_purchase_order_input_exit.findMany({
        where: {
          po_input_id: receipt.po_input_id,
          approve_status: 1,
          deleted_at: null,
          ...(exitId ? { NOT: { po_exit_id: exitId } } : {}),
        },
        select: { po_exit_id: true },
      });
      const approvedDetails = approvedHeaders.length
        ? await tx.hspsi_purchase_order_input_exit_detail.findMany({
            where: {
              po_exit_id: { in: approvedHeaders.map((item) => item.po_exit_id) },
              deleted_at: null,
            },
          })
        : [];
      const sourceQty = new Map<string, number>(),
        approvedQty = new Map<string, number>(),
        currentQty = new Map<string, number>();
      for (const line of sourceDetails) {
        const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`;
        sourceQty.set(key, (sourceQty.get(key) ?? 0) + Number(line.input_qty));
      }
      for (const line of approvedDetails) {
        const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`;
        approvedQty.set(key, (approvedQty.get(key) ?? 0) + Number(line.exit_qty));
      }
      for (const line of lines) {
        const key = `${line.goodsId}:${line.skuId}:${String(line.batchNo ?? '')}`,
          qty = this.quantity(line.returnQuantity, '采购退货数量');
        currentQty.set(key, (currentQty.get(key) ?? 0) + qty);
      }
      for (const [key, qty] of currentQty) {
        const allowed = sourceQty.get(key);
        if (allowed === undefined)
          throw new BadRequestException('采购退货商品、SKU及批次必须来自来源入库单');
        if ((approvedQty.get(key) ?? 0) + qty > allowed + 0.000001)
          throw new BadRequestException('累计采购退货数量超过来源确认入库数量');
      }
      const data = {
        po_input_id: receipt.po_input_id,
        po_id: receipt.po_id,
        exit_reson: String(body.reason ?? ''),
        exit_date: body.returnDate ? new Date(String(body.returnDate)) : new Date(),
        exit_type: Number(body.returnType),
        status: submit,
        approve_status: 0,
        approve_comment: '',
        approve_by: 0n,
        approve_date: null,
        remark: String(body.remark ?? ''),
        updated_by: BigInt(userId),
        updated_at: new Date(),
      };
      const newReturnNo = exitId
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_RETURN);
      const header = exitId
        ? await tx.hspsi_purchase_order_input_exit.update({ where: { po_exit_id: exitId }, data })
        : await tx.hspsi_purchase_order_input_exit.create({
            data: {
              ...data,
              po_exit_no: newReturnNo,
              created_by: BigInt(userId),
              created_at: new Date(),
            },
          });
      await tx.hspsi_purchase_order_input_exit_detail.deleteMany({
        where: { po_exit_id: header.po_exit_id },
      });
      await tx.hspsi_purchase_order_input_exit_detail.createMany({
        data: lines.map((line) => ({
          po_exit_id: header.po_exit_id,
          po_input_id: receipt.po_input_id,
          po_id: receipt.po_id,
          goods_id: BigInt(String(line.goodsId)),
          sku_id: BigInt(String(line.skuId)),
          batch_no: String(line.batchNo ?? ''),
          unit_type: BigInt(String(line.unitType)),
          po_qty: Number(line.orderQuantity),
          input_qty: Number(line.inputQuantity),
          exit_qty: Number(line.returnQuantity),
          remark: String(line.remark ?? ''),
          created_at: new Date(),
          updated_at: new Date(),
        })),
      });
      const businessNo = header.po_exit_no;
      await this.documentTrace.link(
        {
          upstreamType: 'purchase_receipt',
          upstreamId: receipt.po_input_id,
          upstreamNo: receipt.receiptNo,
          downstreamType: 'purchase_return',
          downstreamId: header.po_exit_id,
          downstreamNo: businessNo,
          createdBy: userId,
        },
        tx,
      );
      return {
        id: header.po_exit_id,
        businessNo,
        message: submit ? '已提交审批' : '退货草稿已保存',
      };
    });
  }
  async approveReturn(id: string, approved: boolean, comment: string, userId: string) {
    const exitId = BigInt(id);
    await this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT po_exit_id FROM hspsi_purchase_order_input_exit WHERE po_exit_id=${exitId} FOR UPDATE`;
      const item = await tx.hspsi_purchase_order_input_exit.findFirst({
        where: { po_exit_id: exitId, deleted_at: null },
      });
      if (!item || !item.status || item.approve_status !== 0)
        throw new BadRequestException('仅待审批退货可操作');
      const returnNo = item.po_exit_no;
      if (approved) {
        await tx.$queryRaw`SELECT po_input_id FROM hspsi_purchase_order_input WHERE po_input_id=${item.po_input_id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM hspsi_purchase_order_input_detail WHERE po_input_id=${item.po_input_id} FOR UPDATE`;
        const receipt = await tx.hspsi_purchase_order_input.findFirst({
          where: { po_input_id: item.po_input_id, deleted_at: null },
        });
        if (!receipt || receipt.comfirm_status !== 1)
          throw new BadRequestException('来源采购入库单不存在或已撤销确认');
        const details = await tx.hspsi_purchase_order_input_exit_detail.findMany({
          where: { po_exit_id: exitId, deleted_at: null },
        });
        const sourceDetails = await tx.hspsi_purchase_order_input_detail.findMany({
          where: { po_input_id: item.po_input_id, deleted_at: null },
        });
        const approvedHeaders = await tx.hspsi_purchase_order_input_exit.findMany({
          where: {
            po_input_id: item.po_input_id,
            approve_status: 1,
            deleted_at: null,
            NOT: { po_exit_id: exitId },
          },
          select: { po_exit_id: true },
        });
        const approvedDetails = approvedHeaders.length
          ? await tx.hspsi_purchase_order_input_exit_detail.findMany({
              where: {
                po_exit_id: { in: approvedHeaders.map((header) => header.po_exit_id) },
                deleted_at: null,
              },
            })
          : [];
        const sourceQty = new Map<string, number>(),
          approvedQty = new Map<string, number>(),
          currentQty = new Map<string, number>();
        for (const line of sourceDetails) {
          const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`;
          sourceQty.set(key, (sourceQty.get(key) ?? 0) + Number(line.input_qty));
        }
        for (const line of approvedDetails) {
          const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`;
          approvedQty.set(key, (approvedQty.get(key) ?? 0) + Number(line.exit_qty));
        }
        for (const line of details) {
          const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`,
            qty = Number(line.exit_qty);
          if (!(qty > 0)) throw new BadRequestException('采购退货数量必须大于0');
          currentQty.set(key, (currentQty.get(key) ?? 0) + qty);
        }
        for (const [key, qty] of currentQty) {
          const allowed = sourceQty.get(key);
          if (allowed === undefined)
            throw new BadRequestException('采购退货商品、SKU及批次必须来自来源入库单');
          if ((approvedQty.get(key) ?? 0) + qty > allowed + 0.000001)
            throw new BadRequestException('累计采购退货数量超过来源确认入库数量');
        }
        await this.documentTrace.link(
          {
            upstreamType: 'purchase_receipt',
            upstreamId: receipt.po_input_id,
            upstreamNo: receipt.po_input_no,
            downstreamType: 'purchase_return',
            downstreamId: item.po_exit_id,
            downstreamNo: returnNo,
            createdBy: userId,
          },
          tx,
        );
        await this.inventoryPosting.post(
          {
            orgId: receipt.org_id,
            warehouseId: receipt.warehouse_id,
            direction: -1,
            operationType: 2,
            inventoryMode: INVENTORY_BUSINESS_MODE.PURCHASE_RETURN,
            sourceId: item.po_exit_id,
            sourceType: 'purchase_return',
            sourceNo: returnNo,
            operationBy: userId,
            idempotencyKey: `purchase-return:${id}`,
            remark: '采购退货审批过账',
            lines: details.map((line) => ({
              goodsId: line.goods_id,
              skuId: line.sku_id,
              batchNo: line.batch_no,
              unitType: Number(line.unit_type),
              quantity: String(line.exit_qty),
            })),
          },
          tx,
        );
      }
      await tx.hspsi_purchase_order_input_exit.update({
        where: { po_exit_id: item.po_exit_id },
        data: {
          approve_status: approved ? 1 : 2,
          approve_comment: comment,
          approve_by: BigInt(userId),
          approve_date: new Date(),
          updated_by: BigInt(userId),
        },
      });
      if (
        !approved &&
        item.auto_created === 1 &&
        item.source_document_type === 'inventory_loss' &&
        item.source_document_id
      ) {
        await tx.hspsi_inventory_loss.updateMany({
          where: { loss_id: item.source_document_id, deleted_at: null },
          data: {
            status: 1,
            approve_status: 0,
            approve_comment: `自动采购退货单${returnNo}被驳回，已恢复待审批`,
            updated_by: BigInt(userId),
          },
        });
      }
      if (approved) {
        await this.recalcOrderStatus(tx, item.po_id);
        await this.createRefundTask(tx, item.po_exit_id, userId);
      }
    });
    return { id, message: approved ? '退货审批通过，库存已扣减' : '退货已驳回' };
  }
  async removeReturn(id: string, userId: string) {
    const item = await this.returnDetail(id);
    if (item.approve_status === 1 || (item.status && item.approve_status === 0))
      throw new BadRequestException('仅草稿或已驳回退货单可删除');
    await this.prisma.$transaction(async (tx) => {
      if (
        item.auto_created === 1 &&
        item.source_document_type === 'inventory_loss' &&
        item.source_document_id
      ) {
        await tx.$queryRaw`SELECT loss_id FROM hspsi_inventory_loss WHERE loss_id=${item.source_document_id} FOR UPDATE`;
        await tx.hspsi_inventory_loss.updateMany({
          where: { loss_id: item.source_document_id, deleted_at: null },
          data: {
            status: 1,
            approve_status: 0,
            approve_comment: `自动采购退货草稿${item.po_exit_no}已删除，已恢复待审批`,
            updated_by: BigInt(userId),
          },
        });
      }
      await tx.hspsi_purchase_order_input_exit.update({
        where: { po_exit_id: item.po_exit_id },
        data: {
          deleted_at: new Date(),
          generation_key: null,
          updated_by: BigInt(userId),
          updated_at: new Date(),
        },
      });
      await this.documentTrace.removeForDocument('purchase_return', item.po_exit_id, tx);
    });
    return { id, message: '退货单已删除' };
  }

  async refunds(query: Body) {
    const { page, pageSize } = this.paging(query);
    const where: Prisma.hspsi_purchase_refundWhereInput = { deleted_at: null };
    if (query.orderId) where.po_id = BigInt(String(query.orderId));
    if (query.vendorId) where.vendor_id = BigInt(String(query.vendorId));
    if (query.refundStatus !== undefined && query.refundStatus !== '')
      where.refund_status = Number(query.refundStatus);
    if (query.sourceType !== undefined && query.sourceType !== '')
      where.source_type = Number(query.sourceType);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_purchase_refund.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { refund_id: 'desc' },
      }),
      this.prisma.hspsi_purchase_refund.count({ where }),
    ]);
    const orderIds = [...new Set(items.map((item) => item.po_id))];
    const exitIds = [...new Set(items.map((item) => item.po_exit_id))];
    const vendorIds = [...new Set(items.map((item) => item.vendor_id).filter((id) => id > 0n))];
    const [orders, returns, vendors] = await Promise.all([
      orderIds.length
        ? this.prisma.hspsi_purchase_order.findMany({
            where: { po_id: { in: orderIds } },
            select: { po_id: true, po_no: true, pay_amout: true },
          })
        : [],
      exitIds.length
        ? this.prisma.hspsi_purchase_order_input_exit.findMany({
            where: { po_exit_id: { in: exitIds } },
            select: { po_exit_id: true, po_exit_no: true, exit_date: true, exit_reson: true },
          })
        : [],
      vendorIds.length
        ? this.prisma.hspsi_basic_vendor.findMany({
            where: { vendor_id: { in: vendorIds } },
            select: { vendor_id: true, conpany_name: true },
          })
        : [],
    ]);
    return {
      items: items.map((item) => ({
        id: item.refund_id,
        refundNo: item.refund_no,
        returnId: item.po_exit_id,
        returnNo: returns.find((row) => row.po_exit_id === item.po_exit_id)?.po_exit_no ?? '',
        orderId: item.po_id,
        orderNo: orders.find((row) => row.po_id === item.po_id)?.po_no ?? '',
        receiptId: item.po_input_id || null,
        orgId: item.org_id,
        deptId: item.dept_id,
        vendorId: item.vendor_id,
        vendorName: vendors.find((row) => row.vendor_id === item.vendor_id)?.conpany_name ?? '',
        sourceType: item.source_type,
        returnType: item.return_type,
        returnAmount: Number(item.return_amount),
        refundableAmount: Number(item.refundable_amount),
        refundedAmount: Number(item.refunded_amount),
        remainingAmount: Math.max(0, Number(item.refundable_amount) - Number(item.refunded_amount)),
        refundStatus: item.refund_status,
        returnDate: returns.find((row) => row.po_exit_id === item.po_exit_id)?.exit_date ?? null,
        reason:
          returns.find((row) => row.po_exit_id === item.po_exit_id)?.exit_reson ?? item.remark,
        remark: item.remark,
        createdBy: item.created_by,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      })),
      total,
      page,
      pageSize,
    };
  }
  async refund(id: string) {
    const task = await this.prisma.hspsi_purchase_refund.findFirst({
      where: { refund_id: BigInt(id), deleted_at: null },
    });
    if (!task) throw new NotFoundException('采购退款任务不存在');
    const [list, flows] = await Promise.all([
      this.refunds({ page: 1, pageSize: 100, orderId: String(task.po_id) }),
      this.prisma.hspsi_purchase_refund_flow.findMany({
        where: { refund_id: task.refund_id, deleted_at: null },
        orderBy: { flow_id: 'asc' },
      }),
    ]);
    const base = list.items.find((item) => String(item.id) === id) ?? {
      id: task.refund_id,
      refundNo: task.refund_no,
      returnId: task.po_exit_id,
      orderId: task.po_id,
      receiptId: task.po_input_id || null,
      orgId: task.org_id,
      deptId: task.dept_id,
      vendorId: task.vendor_id,
      sourceType: task.source_type,
      returnType: task.return_type,
      returnAmount: Number(task.return_amount),
      refundableAmount: Number(task.refundable_amount),
      refundedAmount: Number(task.refunded_amount),
      remainingAmount: Math.max(0, Number(task.refundable_amount) - Number(task.refunded_amount)),
      refundStatus: task.refund_status,
      remark: task.remark,
    };
    return {
      ...base,
      flows: flows.map((flow) => ({
        id: flow.flow_id,
        flowNo: flow.flow_no,
        refundAmount: Number(flow.refund_amount),
        refundChannel: flow.refund_channel,
        refundDate: flow.refund_date,
        supplierSerialNo: flow.supplier_serial_no,
        receiveAccount: flow.receive_account,
        requestKey: flow.request_key,
        remark: flow.remark,
        createdBy: flow.created_by,
        createdAt: flow.created_at,
      })),
    };
  }
  private async recalcRefundTask(tx: Prisma.TransactionClient, refundId: bigint, userId: string) {
    const task = await tx.hspsi_purchase_refund.findFirst({
      where: { refund_id: refundId, deleted_at: null },
    });
    if (!task) throw new NotFoundException('采购退款任务不存在');
    const total = await tx.hspsi_purchase_refund_flow.aggregate({
      where: { refund_id: refundId, deleted_at: null },
      _sum: { refund_amount: true },
    });
    const refunded = total._sum.refund_amount ?? new Prisma.Decimal(0);
    let status = task.refund_status === 3 ? 3 : 0;
    if (status !== 3) {
      if (task.refundable_amount.lessThanOrEqualTo(0))
        throw new BadRequestException('退款任务应退金额必须大于0');
      if (refunded.lessThanOrEqualTo(0)) status = 0;
      else if (refunded.lessThan(task.refundable_amount)) status = 1;
      else status = 2;
    }
    await this.assertDictionaryValue(tx, 'purchase_refund_status', status, '采购退款状态');
    return tx.hspsi_purchase_refund.update({
      where: { refund_id: refundId },
      data: {
        refunded_amount: refunded,
        refund_status: status,
        updated_by: BigInt(userId),
        updated_at: new Date(),
      },
    });
  }
  async createRefundFlow(id: string, body: Body, userId: string) {
    const refundId = BigInt(id);
    const amount = new Prisma.Decimal(String(body.refundAmount ?? 0));
    if (amount.lessThanOrEqualTo(0)) throw new BadRequestException('本次退款金额必须大于0');
    const channel = Number(body.refundChannel);
    const refundDate = this.date(body.refundDate, '退款日期');
    const requestKey = String(body.requestKey ?? '').trim();
    if (!requestKey || requestKey.length > 80) throw new BadRequestException('退款幂等请求号无效');
    return this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT refund_id FROM hspsi_purchase_refund WHERE refund_id=${refundId} FOR UPDATE`;
      const task = await tx.hspsi_purchase_refund.findFirst({
        where: { refund_id: refundId, deleted_at: null },
      });
      if (!task) throw new NotFoundException('采购退款任务不存在');
      if (![0, 1].includes(task.refund_status))
        throw new BadRequestException('当前退款状态不允许继续退款');
      await this.assertDictionaryValue(tx, 'payment_channel', channel, '退款渠道');
      const duplicate = await tx.hspsi_purchase_refund_flow.findUnique({
        where: { request_key: requestKey },
      });
      if (duplicate) {
        if (
          duplicate.refund_id === refundId &&
          duplicate.refund_amount.equals(amount) &&
          !duplicate.deleted_at
        )
          return { id: duplicate.flow_id, businessNo: duplicate.flow_no, message: '退款已记录' };
        throw new ConflictException('退款幂等请求号已被其他记录使用');
      }
      const total = await tx.hspsi_purchase_refund_flow.aggregate({
        where: { refund_id: refundId, deleted_at: null },
        _sum: { refund_amount: true },
      });
      const remaining = task.refundable_amount.minus(total._sum.refund_amount ?? 0);
      if (amount.greaterThan(remaining))
        throw new BadRequestException(`本次退款超过剩余应退款 ${remaining.toFixed(2)} 元`);
      const flowNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_REFUND_FLOW);
      const flow = await tx.hspsi_purchase_refund_flow.create({
        data: {
          flow_no: flowNo,
          refund_id: refundId,
          refund_amount: amount,
          refund_channel: channel,
          refund_date: refundDate,
          supplier_serial_no: String(body.supplierSerialNo ?? '').trim(),
          receive_account: String(body.receiveAccount ?? '').trim(),
          request_key: requestKey,
          remark: String(body.remark ?? '').trim(),
          created_by: BigInt(userId),
          updated_by: BigInt(userId),
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
      await this.recalcRefundTask(tx, refundId, userId);
      await this.recalcPayment(tx, task.po_id);
      await this.documentTrace.link(
        {
          upstreamType: 'purchase_refund',
          upstreamId: task.refund_id,
          upstreamNo: task.refund_no,
          downstreamType: 'purchase_refund_flow',
          downstreamId: flow.flow_id,
          downstreamNo: flowNo,
          relationKind: 'refund',
          createdBy: userId,
        },
        tx,
      );
      return { id: flow.flow_id, businessNo: flowNo, message: '采购退款已记录' };
    });
  }
  async voidRefundFlow(id: string, userId: string) {
    const flowId = BigInt(id);
    await this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT flow_id FROM hspsi_purchase_refund_flow WHERE flow_id=${flowId} FOR UPDATE`;
      const flow = await tx.hspsi_purchase_refund_flow.findFirst({
        where: { flow_id: flowId, deleted_at: null },
      });
      if (!flow) throw new NotFoundException('采购退款流水不存在');
      await tx.$queryRaw`SELECT refund_id FROM hspsi_purchase_refund WHERE refund_id=${flow.refund_id} FOR UPDATE`;
      await tx.hspsi_purchase_refund_flow.update({
        where: { flow_id: flowId },
        data: { deleted_at: new Date(), updated_by: BigInt(userId), updated_at: new Date() },
      });
      await this.recalcRefundTask(tx, flow.refund_id, userId);
      const task = await tx.hspsi_purchase_refund.findUniqueOrThrow({
        where: { refund_id: flow.refund_id },
      });
      await this.recalcPayment(tx, task.po_id);
      await this.documentTrace.removeForDocument('purchase_refund_flow', flowId, tx);
    });
    return { id, message: '采购退款流水已作废，任务状态已重算' };
  }
  async closeRefund(id: string, reason: string, userId: string) {
    const refundId = BigInt(id);
    if (!reason.trim()) throw new BadRequestException('关闭原因必填');
    await this.guardedTransaction(async (tx) => {
      await tx.$queryRaw`SELECT refund_id FROM hspsi_purchase_refund WHERE refund_id=${refundId} FOR UPDATE`;
      const task = await tx.hspsi_purchase_refund.findFirst({
        where: { refund_id: refundId, deleted_at: null },
      });
      if (!task) throw new NotFoundException('采购退款任务不存在');
      if (![0, 1].includes(task.refund_status))
        throw new BadRequestException('当前退款状态不允许关闭');
      await this.assertDictionaryValue(tx, 'purchase_refund_status', 3, '采购退款状态');
      await tx.hspsi_purchase_refund.update({
        where: { refund_id: refundId },
        data: {
          refund_status: 3,
          remark: `${task.remark}${task.remark ? '；' : ''}关闭原因：${reason.trim()}`,
          updated_by: BigInt(userId),
          updated_at: new Date(),
        },
      });
    });
    return { id, message: '采购退款任务已关闭' };
  }
  async backfillRefundTasks(userId = '1') {
    const returns = await this.prisma.hspsi_purchase_order_input_exit.findMany({
      where: { approve_status: 1, deleted_at: null },
      orderBy: [{ po_id: 'asc' }, { po_exit_id: 'asc' }],
      select: { po_exit_id: true },
    });
    let created = 0;
    let skipped = 0;
    for (const item of returns) {
      const existed = await this.prisma.hspsi_purchase_refund.findUnique({
        where: { po_exit_id: item.po_exit_id },
        select: { refund_id: true, deleted_at: true },
      });
      const task = await this.guardedTransaction((tx) =>
        this.createRefundTask(tx, item.po_exit_id, userId),
      );
      if (!task || (existed && !existed.deleted_at)) skipped += 1;
      else created += 1;
    }
    return { scanned: returns.length, created, skipped };
  }

  private async purchaseMoneyPosition(tx: PurchaseDb, poId: bigint) {
    const [order, orderLines, returns, paid, tasks] = await Promise.all([
      tx.hspsi_purchase_order.findFirst({ where: { po_id: poId, deleted_at: null } }),
      tx.hspsi_purchase_order_detail.findMany({ where: { po_id: poId } }),
      tx.hspsi_purchase_order_input_exit.findMany({
        where: { po_id: poId, exit_type: 1, approve_status: 1, deleted_at: null },
        select: { po_exit_id: true },
      }),
      tx.hspsi_purchase_order_payment.aggregate({
        where: { po_id: poId, deleted_at: null },
        _sum: { fact_pay_amount: true },
      }),
      tx.hspsi_purchase_refund.findMany({
        where: { po_id: poId, deleted_at: null },
        select: { refund_id: true },
      }),
    ]);
    if (!order) throw new NotFoundException('采购订单不存在');
    const priceByGoods = new Map(
      orderLines.map((line) => [`${line.goods_id}:${line.sku_id}`, this.orderLineUnitPrice(line)]),
    );
    const returnLines = returns.length
      ? await tx.hspsi_purchase_order_input_exit_detail.findMany({
          where: { po_exit_id: { in: returns.map((item) => item.po_exit_id) }, deleted_at: null },
          select: { goods_id: true, sku_id: true, exit_qty: true },
        })
      : [];
    const totalReturnAmount = returnLines.reduce((sum, line) => {
      const price = priceByGoods.get(`${line.goods_id}:${line.sku_id}`);
      if (!price)
        throw new BadRequestException(
          `采购退货明细 ${line.goods_id}/${line.sku_id} 缺少来源订单单价`,
        );
      return sum.plus(price.mul(line.exit_qty));
    }, new Prisma.Decimal(0));
    const refunded = tasks.length
      ? await tx.hspsi_purchase_refund_flow.aggregate({
          where: { refund_id: { in: tasks.map((item) => item.refund_id) }, deleted_at: null },
          _sum: { refund_amount: true },
        })
      : { _sum: { refund_amount: null } };
    const originalPayable = new Prisma.Decimal(order.pay_amout);
    const effectiveRaw = originalPayable.minus(totalReturnAmount);
    const effectivePayable = effectiveRaw.lessThan(0) ? new Prisma.Decimal(0) : effectiveRaw;
    const grossPaid = paid._sum.fact_pay_amount ?? new Prisma.Decimal(0);
    const grossRefunded = refunded._sum.refund_amount ?? new Prisma.Decimal(0);
    const netPaid = grossPaid.minus(grossRefunded);
    const remainingRaw = effectivePayable.minus(netPaid);
    const remainingPayable = remainingRaw.lessThan(0) ? new Prisma.Decimal(0) : remainingRaw;
    const paymentProgressStatus = originalPayable.lessThanOrEqualTo(0)
      ? 0
      : effectivePayable.lessThanOrEqualTo(0) || netPaid.greaterThanOrEqualTo(effectivePayable)
        ? 2
        : netPaid.greaterThan(0)
          ? 1
          : 0;
    return {
      order,
      originalPayable,
      returnAmount: totalReturnAmount,
      effectivePayable,
      grossPaid,
      grossRefunded,
      netPaid,
      remainingPayable,
      paymentProgressStatus,
    };
  }
  async payments(query: Body) {
    const { page, pageSize } = this.paging(query);
    const where: Prisma.hspsi_purchase_order_paymentWhereInput = { deleted_at: null };
    if (query.orderId) where.po_id = BigInt(query.orderId);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_purchase_order_payment.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { pay_id: 'desc' },
      }),
      this.prisma.hspsi_purchase_order_payment.count({ where }),
    ]);
    const poIds = [...new Set(items.map((item) => item.po_id))];
    const positions = await Promise.all(
      poIds.map(
        async (poId) => [poId, await this.purchaseMoneyPosition(this.prisma, poId)] as const,
      ),
    );
    const positionMap = new Map(positions.map(([poId, position]) => [String(poId), position]));
    const vendorIds = [
      ...new Set(positions.map(([, position]) => position.order.vendor_id).filter((id) => id > 0n)),
    ];
    const vendors = vendorIds.length
      ? await this.prisma.hspsi_basic_vendor.findMany({
          where: { vendor_id: { in: vendorIds } },
          select: { vendor_id: true, conpany_name: true },
        })
      : [];
    return {
      items: items.map((item) => {
        const position = positionMap.get(String(item.po_id));
        const vendor = position
          ? vendors.find((row) => row.vendor_id === position.order.vendor_id)
          : null;
        return {
          id: item.pay_id,
          paymentNo: item.pay_no,
          orgId: item.org_id,
          deptId: item.dept_id,
          orderId: item.po_id,
          orderNo: position?.order.po_no ?? null,
          vendorId: position?.order.vendor_id ?? null,
          vendorName: vendor?.conpany_name ?? '',
          paymentChannel: item.pay_type,
          paymentAmount: Number(item.fact_pay_amount),
          paymentDate: item.pay_date,
          orderPayable: Number(position?.originalPayable ?? 0),
          returnAmount: Number(position?.returnAmount ?? 0),
          effectivePayable: Number(position?.effectivePayable ?? 0),
          orderPaid: Number(position?.grossPaid ?? 0),
          orderRefunded: Number(position?.grossRefunded ?? 0),
          netPaid: Number(position?.netPaid ?? 0),
          orderRemaining: Number(position?.remainingPayable ?? 0),
          remark: item.remark,
          createdBy: item.created_by,
          createdAt: item.created_at,
        };
      }),
      total,
      page,
      pageSize,
    };
  }
  async payment(id: string) {
    const item = await this.prisma.hspsi_purchase_order_payment.findFirst({
      where: { pay_id: BigInt(id), deleted_at: null },
    });
    if (!item) throw new NotFoundException('采购付款记录不存在');
    const position = await this.purchaseMoneyPosition(this.prisma, item.po_id);
    const vendor = position.order.vendor_id
      ? await this.prisma.hspsi_basic_vendor.findFirst({
          where: { vendor_id: position.order.vendor_id },
          select: { conpany_name: true },
        })
      : null;
    return {
      id: item.pay_id,
      paymentNo: item.pay_no,
      orgId: item.org_id,
      deptId: item.dept_id,
      orderId: item.po_id,
      orderNo: position.order.po_no,
      vendorName: vendor?.conpany_name ?? '',
      paymentChannel: item.pay_type,
      paymentAmount: Number(item.fact_pay_amount),
      paymentDate: item.pay_date,
      orderPayable: Number(position.originalPayable),
      returnAmount: Number(position.returnAmount),
      effectivePayable: Number(position.effectivePayable),
      orderPaid: Number(position.grossPaid),
      orderRefunded: Number(position.grossRefunded),
      netPaid: Number(position.netPaid),
      orderRemaining: Number(position.remainingPayable),
      remark: item.remark,
      createdBy: item.created_by,
      createdAt: item.created_at,
    };
  }
  private async recalcPayment(tx: Prisma.TransactionClient, poId: bigint) {
    const position = await this.purchaseMoneyPosition(tx, poId);
    await tx.hspsi_purchase_order.update({
      where: { po_id: poId },
      data: {
        pay_amount_done: position.grossPaid,
        pay_status: position.netPaid.greaterThanOrEqualTo(position.effectivePayable) ? 1 : 0,
      },
    });
  }
  async savePayment(id: string | null, body: Body, userId: string) {
    const poId = BigInt(String(body.orderId));
    const amount = new Prisma.Decimal(String(body.paymentAmount));
    if (amount.lessThanOrEqualTo(0)) throw new BadRequestException('付款金额必须大于 0');
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT po_id FROM hspsi_purchase_order WHERE po_id=${poId} FOR UPDATE`;
      const order = await tx.hspsi_purchase_order.findFirst({
        where: { po_id: poId, deleted_at: null },
      });
      if (!order) throw new NotFoundException('采购订单不存在');
      const current = id
        ? await tx.hspsi_purchase_order_payment.findFirst({
            where: { pay_id: BigInt(id), po_id: poId, deleted_at: null },
          })
        : null;
      if (id && !current) throw new NotFoundException('采购付款记录不存在');
      const paymentChannel = Number(body.paymentChannel);
      await this.assertDictionaryValue(tx, 'payment_channel', paymentChannel, '付款渠道');
      const position = await this.purchaseMoneyPosition(tx, poId);
      const baseGrossPaid = position.grossPaid.minus(current?.fact_pay_amount ?? 0);
      const baseNetPaid = baseGrossPaid.minus(position.grossRefunded);
      const remainingRaw = position.effectivePayable.minus(baseNetPaid);
      const remaining = remainingRaw.lessThan(0) ? new Prisma.Decimal(0) : remainingRaw;
      if (amount.greaterThan(remaining)) throw new BadRequestException('付款金额超过剩余应付');
      const data = {
        org_id: order.org_id,
        dept_id: BigInt(String(body.deptId ?? order.dept_id)),
        po_id: poId,
        pay_type: paymentChannel,
        fact_pay_amount: amount,
        pay_date: this.date(body.paymentDate, '付款日期'),
        remark: String(body.remark ?? ''),
        updated_by: BigInt(userId),
        updated_at: new Date(),
      };
      const newPaymentNo = id
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_PAYMENT);
      const payment = id
        ? await tx.hspsi_purchase_order_payment.update({ where: { pay_id: BigInt(id) }, data })
        : await tx.hspsi_purchase_order_payment.create({
            data: {
              ...data,
              pay_no: newPaymentNo,
              created_by: BigInt(userId),
              created_at: new Date(),
            },
          });
      await this.recalcPayment(tx, poId);
      await this.documentTrace.link(
        {
          upstreamType: 'purchase_order',
          upstreamId: poId,
          upstreamNo: order.po_no,
          downstreamType: 'purchase_payment',
          downstreamId: payment.pay_id,
          downstreamNo: payment.pay_no,
          relationKind: 'payment',
          createdBy: userId,
        },
        tx,
      );
      return {
        id: payment.pay_id,
        businessNo: payment.pay_no,
        message: id ? '付款已更新' : '付款已生效',
      };
    });
  }
  async removePayment(id: string, userId: string) {
    const payment = await this.prisma.hspsi_purchase_order_payment.findFirst({
      where: { pay_id: BigInt(id), deleted_at: null },
    });
    if (!payment) throw new NotFoundException('付款记录不存在');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT po_id FROM hspsi_purchase_order WHERE po_id=${payment.po_id} FOR UPDATE`;
      await tx.hspsi_purchase_order_payment.update({
        where: { pay_id: payment.pay_id },
        data: { deleted_at: new Date(), updated_by: BigInt(userId) },
      });
      await this.recalcPayment(tx, payment.po_id);
      await this.documentTrace.removeForDocument('purchase_payment', payment.pay_id, tx);
    });
    return { id, message: '付款已撤销，订单累计已付已重算' };
  }
  async operationHistory(resource: string, id: string) {
    const documentId = BigInt(id);
    const items: OperationHistoryItem[] = [];
    let documentNo = '';
    const add = (
      key: string,
      action: string,
      result: string,
      operatorId: bigint | number | null | undefined,
      occurredAt: Date | null | undefined,
      detail = '',
      timeNote = '',
    ) =>
      items.push({
        key,
        action,
        result,
        operatorId: String(operatorId ?? 0),
        occurredAt: occurredAt ?? null,
        ...(detail ? { detail } : {}),
        ...(timeNote ? { timeNote } : {}),
      });

    if (resource === 'applications') {
      const row = await this.prisma.hspsi_purchase_approve.findFirst({
        where: { pur_id: documentId, deleted_at: null },
      });
      if (!row) throw new NotFoundException('采购申请不存在');
      documentNo = row.pur_no;
      add('created', '创建采购申请', '创建成功', row.created_by, row.created_at);
      if (row.status) {
        add(
          'submitted',
          '提交审批',
          row.approve_status === 0 ? '等待审批' : '已提交',
          row.updated_by,
          row.approve_status === 0 ? row.updated_at : null,
          '',
          row.approve_status === 0 ? '' : '历史表未单独保存提交时间',
        );
      }
      if ([1, 2].includes(row.approve_status)) {
        add(
          'approved',
          '审批采购申请',
          row.approve_status === 1 ? '审批通过' : '审批驳回',
          row.approve_by,
          row.approve_date,
          row.approve_comment ?? '',
        );
      }
    } else if (resource === 'orders') {
      const row = await this.prisma.hspsi_purchase_order.findFirst({
        where: { po_id: documentId, deleted_at: null },
      });
      if (!row) throw new NotFoundException('采购订单不存在');
      documentNo = row.po_no;
      add('created', '创建采购订单', '创建成功', row.created_by, row.created_at);
      const [receipts, returns, payments] = await Promise.all([
        this.prisma.hspsi_purchase_order_input.findMany({
          where: { po_id: row.po_id, deleted_at: null },
          select: { po_input_id: true, po_input_no: true, created_by: true, created_at: true },
        }),
        this.prisma.hspsi_purchase_order_input_exit.findMany({
          where: { po_id: row.po_id, deleted_at: null },
          select: { po_exit_id: true, po_exit_no: true, created_by: true, created_at: true },
        }),
        this.prisma.hspsi_purchase_order_payment.findMany({
          where: { po_id: row.po_id, deleted_at: null },
          select: {
            pay_id: true,
            pay_no: true,
            fact_pay_amount: true,
            created_by: true,
            created_at: true,
          },
        }),
      ]);
      receipts.forEach((item) =>
        add(
          `receipt-${item.po_input_id}`,
          '生成采购入库单',
          item.po_input_no,
          item.created_by,
          item.created_at,
        ),
      );
      returns.forEach((item) =>
        add(
          `return-${item.po_exit_id}`,
          '生成采购退货单',
          item.po_exit_no,
          item.created_by,
          item.created_at,
        ),
      );
      payments.forEach((item) =>
        add(
          `payment-${item.pay_id}`,
          '登记采购付款',
          item.pay_no,
          item.created_by,
          item.created_at,
          `付款金额 ¥${Number(item.fact_pay_amount).toFixed(2)}`,
        ),
      );
    } else if (resource === 'receipts') {
      const row = await this.prisma.hspsi_purchase_order_input.findFirst({
        where: { po_input_id: documentId, deleted_at: null },
      });
      if (!row) throw new NotFoundException('采购入库单不存在');
      documentNo = row.po_input_no;
      add('created', '创建采购入库单', '创建成功', row.created_by, row.created_at);
      if ([1, 2].includes(row.comfirm_status)) {
        add(
          'confirmed',
          row.comfirm_status === 1 ? '确认采购入库' : '撤销待入库单',
          row.comfirm_status === 1 ? '库存已增加' : '待入库单已撤销',
          row.updated_by,
          row.updated_at,
          row.comfirm_comment ?? '',
        );
      }
      const returns = await this.prisma.hspsi_purchase_order_input_exit.findMany({
        where: { po_input_id: row.po_input_id, deleted_at: null },
        select: { po_exit_id: true, po_exit_no: true, created_by: true, created_at: true },
      });
      returns.forEach((item) =>
        add(
          `return-${item.po_exit_id}`,
          '发起采购退货',
          item.po_exit_no,
          item.created_by,
          item.created_at,
        ),
      );
    } else if (resource === 'returns') {
      const row = await this.prisma.hspsi_purchase_order_input_exit.findFirst({
        where: { po_exit_id: documentId, deleted_at: null },
      });
      if (!row) throw new NotFoundException('采购退货单不存在');
      documentNo = row.po_exit_no;
      add('created', '创建采购退货单', '创建成功', row.created_by, row.created_at);
      if (row.status) {
        add(
          'submitted',
          '提交退货审批',
          row.approve_status === 0 ? '等待审批' : '已提交',
          row.updated_by,
          row.approve_status === 0 ? row.updated_at : null,
          '',
          row.approve_status === 0 ? '' : '历史表未单独保存提交时间',
        );
      }
      if ([1, 2].includes(row.approve_status)) {
        add(
          'approved',
          '审批采购退货',
          row.approve_status === 1 ? '审批通过，库存已扣减' : '审批驳回',
          row.approve_by,
          row.approve_date,
          row.approve_comment ?? '',
        );
      }
      const refund = await this.prisma.hspsi_purchase_refund.findFirst({
        where: { po_exit_id: row.po_exit_id, deleted_at: null },
        select: { refund_id: true, refund_no: true, created_by: true, created_at: true },
      });
      if (refund)
        add(
          `refund-${refund.refund_id}`,
          '生成采购退款任务',
          refund.refund_no,
          refund.created_by,
          refund.created_at,
        );
    } else if (resource === 'payments') {
      const row = await this.prisma.hspsi_purchase_order_payment.findFirst({
        where: { pay_id: documentId, deleted_at: null },
      });
      if (!row) throw new NotFoundException('采购付款记录不存在');
      documentNo = row.pay_no;
      add(
        'created',
        '登记采购付款',
        '付款已生效',
        row.created_by,
        row.created_at,
        `付款金额 ¥${Number(row.fact_pay_amount).toFixed(2)}`,
      );
    } else if (resource === 'refunds') {
      const row = await this.prisma.hspsi_purchase_refund.findFirst({
        where: { refund_id: documentId, deleted_at: null },
      });
      if (!row) throw new NotFoundException('采购退款任务不存在');
      documentNo = row.refund_no;
      add('created', '生成采购退款任务', '创建成功', row.created_by, row.created_at);
      const flows = await this.prisma.hspsi_purchase_refund_flow.findMany({
        where: { refund_id: row.refund_id, deleted_at: null },
        orderBy: { flow_id: 'asc' },
      });
      flows.forEach((flow) =>
        add(
          `flow-${flow.flow_id}`,
          '登记采购退款',
          flow.flow_no,
          flow.created_by,
          flow.created_at,
          `退款金额 ¥${Number(flow.refund_amount).toFixed(2)}`,
        ),
      );
      if (row.refund_status === 3) {
        add('closed', '关闭采购退款任务', '已关闭', row.updated_by, row.updated_at, row.remark);
      }
    } else {
      throw new BadRequestException('不支持的采购单据类型');
    }

    const userIds = [
      ...new Set(items.map((item) => item.operatorId).filter((userId) => userId !== '0')),
    ].map(BigInt);
    const users = userIds.length
      ? await this.prisma.hspsi_sys_user.findMany({
          where: { id: { in: userIds }, deleted_at: null },
          select: { id: true, username: true, nickname: true },
        })
      : [];
    const userMap = new Map(
      users.map((user) => [String(user.id), user.nickname || user.username] as const),
    );
    items.forEach((item) => {
      item.operatorName =
        item.operatorId === '0'
          ? '系统'
          : (userMap.get(item.operatorId) ?? `用户ID ${item.operatorId}`);
    });
    items.sort((left, right) => {
      if (!left.occurredAt && !right.occurredAt) return 0;
      if (!left.occurredAt) return 1;
      if (!right.occurredAt) return -1;
      return left.occurredAt.getTime() - right.occurredAt.getTime();
    });
    return { resource, documentId: id, documentNo, items };
  }
  async submitReturn(id: string, userId: string) {
    const item = await this.returnDetail(id);
    if (item.status || ![0, 2].includes(item.approve_status))
      throw new BadRequestException('当前退货状态不能提交');
    await this.prisma.hspsi_purchase_order_input_exit.update({
      where: { po_exit_id: item.po_exit_id },
      data: {
        status: true,
        approve_status: 0,
        approve_comment: '',
        updated_by: BigInt(userId),
        updated_at: new Date(),
      },
    });
    return { id, message: '退货已提交审批' };
  }
}
