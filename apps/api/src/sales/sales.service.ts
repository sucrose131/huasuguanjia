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
import { INVENTORY_BUSINESS_MODE } from '../inventory/inventory-dictionary';
import { ProductionService } from '../production/production.service';
import { BusinessReferenceService } from '../database/business-reference.service';
import { DocumentTraceService } from '../document-trace/document-trace.service';
import { BUSINESS_PREFIX } from '../business-number/business-number.constants';
import { BusinessNumberService } from '../business-number/business-number.service';
type B = Record<string, any>;

import {
  DiscountSourceLine,
  assertDiscountOrderMatchesSource,
  assertDiscountOutputWithinSource,
  calculateDiscountSourceRemaining,
  discountGoodsKey,
} from './sales-helpers';

export type { DiscountSourceLine };
export {
  assertDiscountOrderMatchesSource,
  assertDiscountOutputWithinSource,
  calculateDiscountSourceRemaining,
};

const SALES_OUTPUT_DESTINATION = { SALE: 1, DISCOUNT: 2, EXCHANGE: 3 } as const;

@Injectable()
export class SalesService {
  constructor(
    @Inject(PrismaService) private readonly p: PrismaService,
    @Inject(InventoryPostingService) private readonly posting: InventoryPostingService,
    @Inject(ProductionService) private readonly production: ProductionService,
    @Inject(BusinessReferenceService) private readonly refs: BusinessReferenceService,
    @Inject(DocumentTraceService) private readonly documentTrace: DocumentTraceService,
    @Inject(BusinessNumberService) private readonly businessNumber: BusinessNumberService,
  ) {}
  private d(v: any) {
    return new Prisma.Decimal(String(v ?? 0));
  }
  private qty(v: any, label = '数量') {
    const quantity = Number(v);
    if (!Number.isSafeInteger(quantity) || quantity <= 0)
      throw new BadRequestException(`${label}必须为正整数`);
    return quantity;
  }
  private pg(q: B) {
    return { page: Math.max(1, +q.page || 1), pageSize: Math.min(100, +q.pageSize || 20) };
  }
  private lines(v: any) {
    if (!Array.isArray(v) || !v.length) throw new BadRequestException('至少一条商品明细');
    return v as B[];
  }
  private guardedTransaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.p.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }
  private trustedDiscountSource(type: unknown) {
    return type === 'inventory_loss' || type === 'sales_return';
  }
  private async discountSource(t: any, type: string, id: bigint, lock = false) {
    if (!this.trustedDiscountSource(type) || id <= 0n)
      throw new BadRequestException('折价销售来源无效');
    if (type === 'inventory_loss') {
      if (lock)
        await t.$queryRaw`SELECT loss_id FROM hspsi_inventory_loss WHERE loss_id=${id} FOR UPDATE`;
      const header = await t.hspsi_inventory_loss.findFirst({
        where: { loss_id: id, business_kind: 2, go_where: 1, approve_status: 1, deleted_at: null },
      });
      if (!header) throw new BadRequestException('库存报损来源不存在、未审批或不是折价出售');
      const details = await t.hspsi_inventory_loss_detail.findMany({ where: { loss_id: id } });
      return {
        type,
        id,
        sourceNo: header.loss_no,
        orgId: header.org_id,
        warehouseId: header.warehouse_id,
        lines: details.map((line: B) => ({
          goodsId: line.goods_id,
          skuId: line.sku_id,
          batchNo: String(line.batch_no ?? ''),
          unitType: Number(line.unit_type),
          quantity: Number(line.loss_qty),
        })) as DiscountSourceLine[],
      };
    }
    if (lock)
      await t.$queryRaw`SELECT so_exit_id FROM hspsi_sale_order_exit WHERE so_exit_id=${id} FOR UPDATE`;
    const header = await t.hspsi_sale_order_exit.findFirst({
      where: { so_exit_id: id, disposal_type: 3, comfirm_status: 1, deleted_at: null },
    });
    if (!header) throw new BadRequestException('销售退货来源不存在、未确认或不是折价出售');
    const details = await t.hspsi_sale_order_exit_detail.findMany({ where: { so_exit_id: id } });
    return {
      type,
      id,
      sourceNo: header.so_exit_no,
      orgId: header.org_id,
      warehouseId: header.warehouse_id,
      lines: details.map((line: B) => ({
        goodsId: line.goods_id,
        skuId: line.sku_id,
        batchNo: String(line.batch_no ?? ''),
        unitType: Number(line.unit_type),
        quantity: Number(line.exit_qty),
      })) as DiscountSourceLine[],
    };
  }
  private async confirmedDiscountSourceLines(t: any, type: string, id: bigint) {
    const orders = await t.hspsi_sale_order.findMany({
      where: {
        so_property_type: 2,
        business_source_type: type,
        business_source_id: id,
        deleted_at: null,
      },
      select: { so_id: true },
    });
    if (!orders.length) return [];
    const outputs = await t.hspsi_sale_order_output.findMany({
      where: {
        so_id: { in: orders.map((order: B) => order.so_id) },
        comfirm_status: 1,
        deleted_at: null,
      },
      select: { so_output_id: true },
    });
    if (!outputs.length) return [];
    return t.hspsi_sale_order_output_detail.findMany({
      where: { so_output_id: { in: outputs.map((output: B) => output.so_output_id) } },
    });
  }
  private discountSourceRemaining(sourceLines: DiscountSourceLine[], confirmedLines: B[]) {
    return calculateDiscountSourceRemaining(sourceLines, confirmedLines);
  }
  private async assertWholeOrderStockReady(
    t: Prisma.TransactionClient,
    order: { org_id: bigint; warehouse_id: bigint },
    orderQty: Map<string, number>,
    confirmedQty: Map<string, number>,
  ) {
    for (const [key, qty] of [...orderQty.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const [goodsIdRaw, skuIdRaw] = key.split(':'),
        goodsId = BigInt(goodsIdRaw!),
        skuId = BigInt(skuIdRaw!);
      const remaining = Math.max(0, qty - (confirmedQty.get(key) ?? 0));
      if (!remaining) continue;
      await t.$queryRaw`SELECT id FROM hspsi_inventory_total WHERE org_id=${order.org_id} AND warehouse_id=${order.warehouse_id} AND goods_id=${goodsId} AND sku_id=${skuId} FOR UPDATE`;
      const stock = await t.hspsi_inventory_total.findUnique({
        where: {
          org_id_warehouse_id_goods_id_sku_id: {
            org_id: order.org_id,
            warehouse_id: order.warehouse_id,
            goods_id: goodsId,
            sku_id: skuId,
          },
        },
        select: { inventory_qty: true },
      });
      if (Number(stock?.inventory_qty ?? 0) + 0.000001 < remaining)
        throw new BadRequestException('当前订单存在库存缺口，请先执行缺口分析并完成生产入库');
    }
  }
  private positiveId(v: any, label: string) {
    const raw = String(v ?? '').trim();
    if (!/^[1-9]\d*$/.test(raw)) throw new BadRequestException(`${label}必须是有效的正整数`);
    try {
      return BigInt(raw);
    } catch {
      throw new BadRequestException(`${label}必须是有效的正整数`);
    }
  }
  private positiveInt(v: any, label: string, max = Number.MAX_SAFE_INTEGER) {
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n <= 0 || n > max)
      throw new BadRequestException(`${label}必须是有效的正整数`);
    return n;
  }
  private money(v: any) {
    const raw = String(v ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw))
      throw new BadRequestException('金额必须是最多两位小数的有效数字');
    const amount = this.d(raw);
    if (amount.lessThanOrEqualTo(0)) throw new BadRequestException('金额必须大于0');
    if (amount.greaterThan(this.d('99999999.99')))
      throw new BadRequestException('金额超过系统允许的最大值');
    return amount;
  }
  private paymentRequestKey(v: any) {
    const key = String(v ?? '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/.test(key))
      throw new BadRequestException('requestKey 必填，且必须为 8-80 位字母、数字或 . _ : -');
    return key;
  }
  private paymentDate(v: any) {
    const raw = String(v ?? '').trim(),
      match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) throw new BadRequestException('收退款日期必须是 YYYY-MM-DD 格式');
    const year = Number(match[1]),
      month = Number(match[2]),
      day = Number(match[3]),
      date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
      throw new BadRequestException('收退款日期无效');
    return date;
  }
  private paymentTotals(flows: Array<{ so_pay_type: number; fact_pay_amount: Prisma.Decimal }>) {
    return flows.reduce(
      (result, item) => {
        if (item.so_pay_type === 1) result.received = result.received.plus(item.fact_pay_amount);
        else if (item.so_pay_type === 2)
          result.refunded = result.refunded.plus(item.fact_pay_amount);
        return result;
      },
      { received: this.d(0), refunded: this.d(0) },
    );
  }
  private async assertDictionaryValue(t: any, code: string, value: number, label: string) {
    const category = await t.hspsi_sys_dictionary_category.findFirst({
      where: { dict_catg_code: code, deleted_at: null },
      select: { dict_catg_id: true },
    });
    const option = category
      ? await t.hspsi_sys_dictionary.findFirst({
          where: {
            dict_catg_id: category.dict_catg_id,
            dict_value: String(value),
            deleted_at: null,
          },
          select: { dict_id: true },
        })
      : null;
    if (!option) throw new BadRequestException(`${label}无效`);
  }
  private async confirmedOutput(t: any, soId: bigint, goodsId?: bigint, skuId?: bigint) {
    const h = await t.hspsi_sale_order_output.findMany({
      where: {
        so_id: soId,
        comfirm_status: 1,
        go_where: { not: SALES_OUTPUT_DESTINATION.EXCHANGE },
        deleted_at: null,
      },
      select: { so_output_id: true },
    });
    return t.hspsi_sale_order_output_detail.aggregate({
      _sum: { output_qty: true },
      where: {
        so_output_id: { in: h.map((x: B) => x.so_output_id) },
        ...(goodsId ? { goods_id: goodsId } : {}),
        ...(skuId ? { sku_id: skuId } : {}),
      },
    });
  }
  private async confirmedReturn(t: any, soId: bigint, goodsId?: bigint, skuId?: bigint) {
    const h = await t.hspsi_sale_order_exit.findMany({
      where: { so_id: soId, comfirm_status: 1, deleted_at: null },
      select: { so_exit_id: true },
    });
    return t.hspsi_sale_order_exit_detail.aggregate({
      _sum: { exit_qty: true },
      where: {
        so_exit_id: { in: h.map((x: B) => x.so_exit_id) },
        ...(goodsId ? { goods_id: goodsId } : {}),
        ...(skuId ? { sku_id: skuId } : {}),
      },
    });
  }
  private async refreshOrderLifecycle(t: any, soId: bigint) {
    const order = await t.hspsi_sale_order.findFirst({ where: { so_id: soId, deleted_at: null } });
    if (!order) return;
    const [confirmed, flows] = await Promise.all([
      this.confirmedOutput(t, soId),
      t.hspsi_sales_order_payment.findMany({
        where: { so_id: soId, deleted_at: null },
        select: { so_pay_type: true, fact_pay_amount: true },
      }),
    ]);
    const delivered = Number(confirmed._sum.output_qty ?? 0),
      { received, refunded } = this.paymentTotals(flows),
      netReceived = received.minus(refunded);
    const deliveryStatus =
      delivered <= 0 ? 1 : delivered + 0.000001 >= Number(order.so_qty) ? 3 : 2;
    const financiallySettled =
      Number(order.fact_amount) <= 0 || netReceived.greaterThanOrEqualTo(order.fact_amount);
    const orderStatus =
      order.approve_status === 2
        ? 3
        : order.approve_status === 1 && deliveryStatus === 3 && financiallySettled
          ? 2
          : 1;
    await t.hspsi_sale_order.update({
      where: { so_id: soId },
      data: { delivery_status: deliveryStatus, order_status: orderStatus },
    });
  }
  private async refreshOrderServiceStatus(t: any, soId: bigint) {
    const [active, total] = await Promise.all([
      t.hspsi_sale_order_service.count({
        where: { so_id: soId, event_status: 1, deleted_at: null },
      }),
      t.hspsi_sale_order_service.count({ where: { so_id: soId, deleted_at: null } }),
    ]);
    await t.hspsi_sale_order.update({
      where: { so_id: soId },
      data: { service_status: active ? 1 : total ? 2 : 3 },
    });
  }
  async orders(q: B, propertyType: 1 | 2 = 1) {
    const { page, pageSize } = this.pg(q),
      where: Prisma.hspsi_sale_orderWhereInput = {
        deleted_at: null,
        so_property_type: propertyType,
      };
    if (q.orderStatus !== undefined && q.orderStatus !== '')
      where.order_status = Number(q.orderStatus);
    if (q.deliveryStatus !== undefined && q.deliveryStatus !== '')
      where.delivery_status = Number(q.deliveryStatus);
    if (q.keyword)
      where.OR = [
        { so_no: { contains: String(q.keyword) } },
        { customer_name: { contains: String(q.keyword) } },
        { customer_mobile: { contains: String(q.keyword) } },
      ];
    const [records, total] = await this.p.$transaction([
      this.p.hspsi_sale_order.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { so_id: 'desc' },
      }),
      this.p.hspsi_sale_order.count({ where }),
    ]);
    const ids = records.map((i) => i.so_id),
      [pays, details, outputs] = await Promise.all([
        ids.length
          ? this.p.hspsi_sales_order_payment.findMany({
              where: { so_id: { in: ids }, deleted_at: null },
            })
          : [],
        ids.length
          ? this.p.hspsi_sale_order_detail.findMany({ where: { so_id: { in: ids } } })
          : [],
        ids.length
          ? this.p.hspsi_sale_order_output.findMany({
              where: {
                so_id: { in: ids },
                comfirm_status: 1,
                go_where: { not: SALES_OUTPUT_DESTINATION.EXCHANGE },
                deleted_at: null,
              },
              select: { so_id: true, so_output_id: true },
            })
          : [],
      ]),
      outDetails = outputs.length
        ? await this.p.hspsi_sale_order_output_detail.findMany({
            where: { so_output_id: { in: outputs.map((i) => i.so_output_id) } },
          })
        : [];
    const items = await this.refs.enrich(
      records.map((i) => {
        const received = pays
            .filter((x) => x.so_id === i.so_id && x.so_pay_type === 1)
            .reduce((s, x) => s + Number(x.fact_pay_amount), 0),
          refunded = pays
            .filter((x) => x.so_id === i.so_id && x.so_pay_type === 2)
            .reduce((s, x) => s + Number(x.fact_pay_amount), 0),
          goodsNames = [
            ...new Set(details.filter((x) => x.so_id === i.so_id).map((x) => String(x.goods_id))),
          ],
          outputQty = outDetails
            .filter((x) =>
              outputs.some((h) => h.so_id === i.so_id && h.so_output_id === x.so_output_id),
            )
            .reduce((s, x) => s + Number(x.output_qty), 0),
          receivable = Number(i.fact_amount),
          paymentStatus =
            received === 0 ? 0 : refunded >= received ? 3 : received >= receivable ? 2 : 1;
        return {
          ...i,
          id: i.so_id,
          orderNo: i.so_no,
          customerId: i.customer_id,
          customerName: i.customer_name,
          customerMobile: i.customer_mobile,
          orgId: i.org_id,
          warehouseId: i.warehouse_id,
          orderDate: i.order_date,
          orderType: i.so_type,
          sourceType: i.so_source,
          propertyType: i.so_property_type,
          businessSourceType: i.business_source_type,
          businessSourceId: i.business_source_id,
          businessSourceNo: i.business_source_no,
          quantity: i.so_qty,
          orderAmount: i.so_amount,
          amount: i.fact_amount,
          discountAmount: i.priceoff_amount,
          goodsIds: goodsNames,
          goodsNames: '',
          receivedAmount: received,
          refundedAmount: refunded,
          netAmount: received - refunded,
          unreceivedAmount: Math.max(0, receivable - received),
          paymentStatus,
          deliveryQty: outputQty,
          deliveryProgress:
            Number(i.so_qty) > 0 ? Math.min(100, (outputQty * 100) / Number(i.so_qty)) : 0,
          orderStatus: i.order_status,
          deliveryStatus: i.delivery_status,
          serviceStatus: i.service_status,
          status: i.status,
          createdBy: i.created_by,
          updatedBy: i.updated_by,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
        };
      }),
      {
        orderType: 'sales_order_type',
        sourceType: 'sales_order_source',
        propertyType: 'sales_order_property',
        orderStatus: 'sales_order_status',
        deliveryStatus: 'sales_delivery_status',
        serviceStatus: 'sales_service_status',
      },
    );
    const allGoods = [...new Set(items.flatMap((i) => i.goodsIds))].map(BigInt),
      goods = allGoods.length
        ? await this.p.hspsi_goods_info.findMany({ where: { goods_id: { in: allGoods } } })
        : [],
      goodsMap = new Map(goods.map((i) => [String(i.goods_id), i.goods_name]));
    for (const item of items)
      item.goodsNames = item.goodsIds
        .map((id: string) => goodsMap.get(id))
        .filter(Boolean)
        .join('、');
    return { items, total, page, pageSize };
  }
  async orderOptions(q: B) {
    return (await this.orders({ ...q, page: 1, pageSize: 50 }, 1)).items;
  }
  async moneyOrderOptions(q: B) {
    const [ordinary, discount] = await Promise.all([
      this.orders({ ...q, page: 1, pageSize: 50 }, 1),
      this.orders({ ...q, page: 1, pageSize: 50 }, 2),
    ]);
    return [...ordinary.items, ...discount.items]
      .sort((a: B, b: B) => Number(BigInt(b.id) - BigInt(a.id)))
      .slice(0, 100);
  }
  async outputOptions(orderId?: string) {
    const where: Prisma.hspsi_sale_order_outputWhereInput = { comfirm_status: 1, deleted_at: null };
    if (orderId) where.so_id = BigInt(orderId);
    const rows = await this.p.hspsi_sale_order_output.findMany({
      where,
      orderBy: { so_output_id: 'desc' },
      take: 100,
    });
    return rows.map((i) => ({
      id: i.so_output_id,
      outputNo: i.so_output_no,
      orderId: i.so_id,
      warehouseId: i.warehouse_id,
      outputDate: i.output_date,
    }));
  }
  async order(id: string) {
    const i = await this.p.hspsi_sale_order.findFirst({
      where: { so_id: BigInt(id), deleted_at: null },
    });
    if (!i) throw new NotFoundException('销售订单不存在');
    const [details, outHeads, returnHeads] = await Promise.all([
      this.p.hspsi_sale_order_detail.findMany({ where: { so_id: i.so_id } }),
      this.p.hspsi_sale_order_output.findMany({
        where: {
          so_id: i.so_id,
          go_where: { not: SALES_OUTPUT_DESTINATION.EXCHANGE },
          deleted_at: null,
        },
        select: { so_output_id: true, comfirm_status: true },
      }),
      this.p.hspsi_sale_order_exit.findMany({
        where: { so_id: i.so_id, comfirm_status: 1, deleted_at: null },
        select: { so_exit_id: true },
      }),
    ]);
    const [out, returns] = await Promise.all([
      this.p.hspsi_sale_order_output_detail.findMany({
        where: { so_output_id: { in: outHeads.map((x) => x.so_output_id) } },
      }),
      this.p.hspsi_sale_order_exit_detail.findMany({
        where: { so_exit_id: { in: returnHeads.map((x) => x.so_exit_id) } },
      }),
    ]);
    const sourceLocked =
      i.so_property_type === 2 &&
      this.trustedDiscountSource(i.business_source_type) &&
      i.business_source_id > 0n;
    let sourceDisposalLines: B[] = [];
    if (sourceLocked) {
      const source = await this.discountSource(
        this.p,
        i.business_source_type,
        i.business_source_id,
      );
      const confirmed = await this.confirmedDiscountSourceLines(
        this.p,
        i.business_source_type,
        i.business_source_id,
      );
      sourceDisposalLines = this.discountSourceRemaining(source.lines, confirmed);
    }
    return {
      ...i,
      id: i.so_id,
      orderNo: i.so_no,
      orgId: i.org_id,
      warehouseId: i.warehouse_id,
      orderDate: i.order_date,
      orderType: i.so_type,
      sourceType: i.so_source,
      sourceId: i.so_source_id,
      businessSourceType: i.business_source_type,
      businessSourceId: i.business_source_id,
      businessSourceNo: i.business_source_no,
      propertyType: i.so_property_type,
      customerId: i.customer_id,
      customerName: i.customer_name,
      customerMobile: i.customer_mobile,
      customerAddress: i.customer_address,
      salesName: i.sales_name,
      salesMobile: i.sales_mobile,
      status: i.status,
      sourceLocked,
      sourceDisposalLines,
      details: details.map((d) => ({
        id: d.id,
        goodsId: d.goods_id,
        skuId: d.sku_id,
        unitType: d.unit_type,
        quantity: d.sale_qty,
        price: d.sale_price,
        amount: d.sale_amount,
        factAmount: d.fact_sale_amount,
        allocatedOutputQty: out
          .filter((x) => x.goods_id === d.goods_id && x.sku_id === d.sku_id)
          .reduce((s, x) => s + Number(x.output_qty), 0),
        confirmedOutputQty: out
          .filter(
            (x) =>
              outHeads.some(
                (head) => head.so_output_id === x.so_output_id && head.comfirm_status === 1,
              ) &&
              x.goods_id === d.goods_id &&
              x.sku_id === d.sku_id,
          )
          .reduce((s, x) => s + Number(x.output_qty), 0),
        confirmedReturnQty: returns
          .filter((x) => x.goods_id === d.goods_id && x.sku_id === d.sku_id)
          .reduce((s, x) => s + Number(x.exit_qty), 0),
      })),
    };
  }
  async saveOrder(id: string | null, b: B, u: string, propertyType: 1 | 2 = 1) {
    const ls = this.lines(b.details),
      customer = await this.p.hspsi_basic_customer.findUnique({
        where: { customer_id: BigInt(b.customerId) },
      });
    if (!customer) throw new BadRequestException('客户不存在');
    const detailKeys = new Set<string>();
    for (const line of ls) {
      this.qty(line.quantity, '销售数量');
      const key = discountGoodsKey(line);
      if (detailKeys.has(key)) throw new BadRequestException('同一商品和SKU不能重复录入销售订单');
      detailKeys.add(key);
    }
    let old: B | null = null;
    if (id) {
      old = await this.order(id);
      if (Number(old.approve_status) === 1)
        throw new BadRequestException('已审批销售订单不允许修改');
      if (Number(old.propertyType) !== propertyType)
        throw new BadRequestException('销售订单创建后不允许改变订单属性');
      for (const l of ls) {
        const o = old.details.find(
          (x: B) => String(x.goodsId) === String(l.goodsId) && String(x.skuId) === String(l.skuId),
        );
        if (Number(l.quantity) < Number(o?.allocatedOutputQty ?? o?.confirmedOutputQty ?? 0))
          throw new BadRequestException('销售数量不得低于有效销售出库单已分配数量');
      }
    }
    const oldSourceType = String(old?.businessSourceType ?? '');
    const oldSourceId = BigInt(old?.businessSourceId ?? 0);
    const oldSourceNo = String(old?.businessSourceNo ?? '');
    const suppliedSourceType = String(b.businessSourceType ?? '');
    let suppliedSourceId: bigint;
    try {
      suppliedSourceId = BigInt(b.businessSourceId ?? 0);
    } catch {
      throw new BadRequestException('折价销售业务来源ID无效');
    }
    const suppliedSourceNo = String(b.businessSourceNo ?? '');
    if (!id && (suppliedSourceType || suppliedSourceId > 0n || suppliedSourceNo)) {
      throw new BadRequestException('手工新增折价销售单不允许伪造业务来源');
    }
    if (
      id &&
      (suppliedSourceType !== oldSourceType ||
        suppliedSourceId !== oldSourceId ||
        suppliedSourceNo !== oldSourceNo)
    ) {
      throw new BadRequestException('系统生成折价销售单的来源类型、来源ID和来源单号不允许修改');
    }
    const sourceLocked =
      propertyType === 2 && this.trustedDiscountSource(oldSourceType) && oldSourceId > 0n;
    const idv = await this.p.$transaction(async (t) => {
      const lineAmount = (line: B) => this.d(line.quantity).times(this.d(line.price));
      // factAmount=0 是合法的显式零价/全额折扣；仅 null/undefined 才回退到数量×单价。
      // 折价销售的 sale_price 就是最终成交单价，编辑单价后实际成交金额必须同步重算。
      const lineFactAmount = (line: B) =>
        propertyType === 2
          ? lineAmount(line)
          : line.factAmount === null || line.factAmount === undefined
            ? lineAmount(line)
            : String(line.factAmount).trim() === ''
              ? this.d(0)
              : this.d(line.factAmount);
      const qty = ls.reduce((sum, line) => sum + Number(line.quantity), 0),
        amount = ls.reduce<Prisma.Decimal>((sum, line) => sum.plus(lineAmount(line)), this.d(0)),
        factAmount = ls.reduce<Prisma.Decimal>(
          (sum, line) => sum.plus(lineFactAmount(line)),
          this.d(0),
        ),
        discount = amount.minus(factAmount),
        priceoffAmount = discount.greaterThan(0) ? discount : this.d(0);
      if (id) {
        const orderId = BigInt(id);
        await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${orderId} FOR UPDATE`;
        const locked = await t.hspsi_sale_order.findFirst({
          where: { so_id: orderId, deleted_at: null },
          select: { approve_status: true, so_property_type: true },
        });
        if (!locked) throw new NotFoundException('销售订单不存在');
        if (locked.approve_status === 1) throw new BadRequestException('已审批销售订单不允许修改');
        if (locked.so_property_type !== propertyType)
          throw new BadRequestException('销售订单创建后不允许改变订单属性');
        const received = await t.hspsi_sales_order_payment.aggregate({
            where: { so_id: orderId, so_pay_type: 1, deleted_at: null },
            _sum: { fact_pay_amount: true },
          }),
          receivedAmount = received._sum.fact_pay_amount ?? this.d(0);
        if (factAmount.lessThan(receivedAmount))
          throw new BadRequestException('订单实付金额不得低于有效累计收款');
      }
      let orgId = BigInt(b.orgId ?? customer.org_id),
        warehouseId = BigInt(b.warehouseId ?? 0);
      if (sourceLocked) {
        const source = await this.discountSource(t, oldSourceType, oldSourceId, true);
        if (orgId !== source.orgId || warehouseId !== source.warehouseId)
          throw new BadRequestException('系统生成折价销售单不允许更换来源组织或仓库');
        assertDiscountOrderMatchesSource(source.lines, ls);
        const duplicate = await t.hspsi_sale_order.findFirst({
          where: {
            so_property_type: 2,
            business_source_type: oldSourceType,
            business_source_id: oldSourceId,
            deleted_at: null,
            so_id: { not: BigInt(id!) },
          },
          select: { so_id: true },
        });
        if (duplicate) throw new BadRequestException('该来源单据已经存在另一张有效折价销售单');
        orgId = source.orgId;
        warehouseId = source.warehouseId;
      }
      const data = {
        org_id: orgId,
        warehouse_id: warehouseId,
        so_type: Number(b.orderType ?? 1),
        so_source: Number(b.sourceType ?? 4),
        so_source_id: BigInt(b.sourceId ?? 0),
        business_source_type: id ? oldSourceType : '',
        business_source_id: id ? oldSourceId : 0n,
        business_source_no: id ? oldSourceNo : '',
        so_property_type: propertyType,
        customer_id: customer.customer_id,
        customer_name: customer.name.slice(0, 30),
        customer_mobile: String(b.customerMobile ?? customer.mobile),
        customer_address: String(b.customerAddress ?? customer.address).slice(0, 100),
        order_date: new Date(b.orderDate ?? Date.now()),
        sales_name: String(b.salesName ?? customer.referrer_name).slice(0, 30),
        sales_mobile: String(b.salesMobile ?? customer.referrer_mobile),
        so_qty: qty,
        so_amount: amount,
        fact_amount: factAmount,
        priceoff_amount: priceoffAmount,
        order_status: 1,
        delivery_status: 1,
        service_status: 3,
        shipper: '',
        status: 1,
        approve_status: 0,
        approve_comment: '',
        remark: String(b.remark ?? ''),
        updated_by: BigInt(u),
      };
      const newOrderNo = id
        ? ''
        : await this.businessNumber.generate(
            propertyType === 2 ? BUSINESS_PREFIX.DISCOUNT_SALES_ORDER : BUSINESS_PREFIX.SALES_ORDER,
          );
      const h = id
        ? await t.hspsi_sale_order.update({ where: { so_id: BigInt(id) }, data })
        : await t.hspsi_sale_order.create({
            data: { ...data, so_no: newOrderNo, created_by: BigInt(u) },
          });
      await t.hspsi_sale_order_detail.deleteMany({ where: { so_id: h.so_id } });
      await t.hspsi_sale_order_detail.createMany({
        data: ls.map((line) => ({
          so_id: h.so_id,
          goods_id: BigInt(line.goodsId),
          sku_id: BigInt(line.skuId),
          unit_type: Number(line.unitType),
          sale_qty: Number(line.quantity),
          sale_price: this.d(line.price),
          sale_amount: lineAmount(line),
          fact_sale_amount: lineFactAmount(line),
        })),
      });
      return h.so_id;
    });
    return { id: idv, message: '销售订单已保存' };
  }
  private async allocateApprovedOrdinaryOrder(t: Prisma.TransactionClient, order: B, u: string) {
    const details = await t.hspsi_sale_order_detail.findMany({ where: { so_id: order.so_id } });
    const goodsIds = [...new Set(details.map((line) => line.goods_id))];
    const batches = goodsIds.length
      ? await t.hspsi_inventory_batch_total.findMany({
          where: {
            org_id: order.org_id,
            warehouse_id: order.warehouse_id,
            goods_id: { in: goodsIds },
            inventory_qty: { gt: 0 },
          },
          orderBy: [{ batch_no: 'asc' }],
        })
      : [];
    for (const batch of batches)
      await t.$queryRaw`SELECT goods_id FROM hspsi_inventory_batch_total WHERE warehouse_id=${batch.warehouse_id} AND goods_id=${batch.goods_id} AND sku_id=${batch.sku_id} AND batch_no=${batch.batch_no} FOR UPDATE`;
    const pendingHeads = await t.hspsi_sale_order_output.findMany({
      where: {
        org_id: order.org_id,
        warehouse_id: order.warehouse_id,
        comfirm_status: 0,
        deleted_at: null,
      },
      select: { so_output_id: true },
    });
    const pendingDetails = pendingHeads.length
      ? await t.hspsi_sale_order_output_detail.findMany({
          where: { so_output_id: { in: pendingHeads.map((item) => item.so_output_id) } },
        })
      : [];
    const reserved = new Map<string, number>();
    for (const line of pendingDetails) {
      const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`;
      reserved.set(key, (reserved.get(key) ?? 0) + Number(line.output_qty));
    }
    const outputLines: B[] = [],
      shortages: B[] = [];
    for (const line of details) {
      let remaining = Number(line.sale_qty);
      for (const batch of batches.filter(
        (item) => item.goods_id === line.goods_id && item.sku_id === line.sku_id,
      )) {
        if (remaining <= 0.000001) break;
        const key = `${batch.goods_id}:${batch.sku_id}:${batch.batch_no}`,
          available = Math.max(0, Number(batch.inventory_qty) - (reserved.get(key) ?? 0));
        const quantity = Math.min(remaining, available);
        if (quantity <= 0.000001) continue;
        outputLines.push({
          goodsId: line.goods_id,
          skuId: line.sku_id,
          batchNo: batch.batch_no,
          unitType: line.unit_type,
          orderQty: line.sale_qty,
          quantity,
        });
        reserved.set(key, (reserved.get(key) ?? 0) + quantity);
        remaining -= quantity;
      }
      if (remaining > 0.000001)
        shortages.push({
          goodsId: line.goods_id,
          skuId: line.sku_id,
          unitType: line.unit_type,
          quantity: remaining,
        });
    }
    let outputId: bigint | undefined, outputNo: string | undefined;
    if (outputLines.length) {
      outputNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_OUTPUT);
      const output = await t.hspsi_sale_order_output.create({
        data: {
          so_output_no: outputNo,
          so_id: order.so_id,
          org_id: order.org_id,
          warehouse_id: order.warehouse_id,
          output_date: new Date(),
          go_where: 1,
          dept_id: 0n,
          receiver_id: BigInt(u),
          output_sku_qty: new Set(outputLines.map((line) => `${line.goodsId}:${line.skuId}`)).size,
          status: true,
          comfirm_status: 0,
          comfirm_comment: '',
          comfirm_by: 0n,
          posting_version: 0,
          remark: `销售订单 ${order.so_no} 审核后按可用库存自动生成`,
          created_by: BigInt(u),
          updated_by: BigInt(u),
        },
      });
      outputId = output.so_output_id;
      await t.hspsi_sale_order_output_detail.createMany({
        data: outputLines.map((line) => ({
          so_output_id: output.so_output_id,
          so_id: order.so_id,
          goods_id: line.goodsId,
          sku_id: line.skuId,
          batch_no: String(line.batchNo),
          unit_type: Number(line.unitType),
          sale_qty: Number(line.orderQty),
          output_qty: Number(line.quantity),
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: 'sales_order',
          upstreamId: order.so_id,
          upstreamNo: order.so_no,
          downstreamType: 'sales_output',
          downstreamId: output.so_output_id,
          downstreamNo: outputNo,
          relationKind: 'fulfillment',
          createdBy: u,
        },
        t,
      );
    }
    const plans: B[] = [];
    for (const shortage of shortages) {
      const goods = await t.hspsi_goods_info.findUnique({ where: { goods_id: shortage.goodsId } });
      if (!goods) throw new BadRequestException('销售订单存在无效成品，不能生成生产计划');
      const bom = await t.hspsi_production_bom.findFirst({
        where: {
          org_id: order.org_id,
          goods_id: shortage.goodsId,
          sku_id: shortage.skuId,
          status: 1,
          deleted_at: null,
        },
      });
      if (!bom)
        throw new BadRequestException(
          `${goods.goods_name} 没有当前订单组织下启用的BOM，不能生成生产计划`,
        );
      const result = await this.production.createPlanFromSalesGap(
        t,
        {
          bomId: bom.bom_id,
          orgId: order.org_id,
          warehouseId: bom.warehouse_id,
          productWarehouseId: order.warehouse_id,
          planQty: shortage.quantity,
          sourceType: 'sales_order',
          sourceId: order.so_id,
          sourceNo: order.so_no,
        },
        u,
      );
      if (result.created !== false) plans.push(result);
    }
    return {
      outputId,
      outputNo,
      outputQty: outputLines.reduce((sum, line) => sum + Number(line.quantity), 0),
      plans,
    };
  }
  async approveOrder(id: string, approved: boolean, comment: string, u: string) {
    const orderId = BigInt(id),
      snapshot = await this.order(id);
    const isTrustedDiscount =
      Number(snapshot.propertyType) === 2 &&
      this.trustedDiscountSource(snapshot.businessSourceType) &&
      BigInt(snapshot.businessSourceId ?? 0) > 0n;
    if (!isTrustedDiscount && Number(snapshot.approve_status) !== 0)
      throw new BadRequestException('仅待确认销售订单可操作');
    if (
      isTrustedDiscount &&
      (Number(snapshot.approve_status) === 2 || Number(snapshot.delivery_status) === 3)
    )
      throw new BadRequestException('该折价销售单已经完成处置，请勿重复操作');
    if (!isTrustedDiscount) {
      const isDiscount = Number(snapshot.propertyType) === 2;
      if (isDiscount || !approved) {
        await this.p.hspsi_sale_order.update({
          where: { so_id: orderId },
          data: {
            approve_status: approved ? 1 : 2,
            approve_comment: comment,
            approve_by: BigInt(u),
            approve_date: new Date(),
            order_status: approved ? 1 : 3,
            updated_by: BigInt(u),
          },
        });
        return { id, message: approved ? '折价销售已通过，待生成折价销售出库' : '已驳回并关闭' };
      }
      const allocation = await this.guardedTransaction(async (t) => {
        await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${orderId} FOR UPDATE`;
        const locked = await t.hspsi_sale_order.findFirst({
          where: { so_id: orderId, so_property_type: 1, deleted_at: null },
        });
        if (!locked) throw new NotFoundException('销售订单不存在');
        if (locked.approve_status !== 0)
          throw new BadRequestException('该销售订单已经处理，请勿重复审核');
        await t.hspsi_sale_order.update({
          where: { so_id: orderId },
          data: {
            approve_status: 1,
            approve_comment: comment,
            approve_by: BigInt(u),
            approve_date: new Date(),
            order_status: 1,
            updated_by: BigInt(u),
          },
        });
        return this.allocateApprovedOrdinaryOrder(t, locked, u);
      });
      return {
        id,
        ...allocation,
        message: `审批通过${allocation.outputId ? `，已生成待出库销售出库单 ${allocation.outputNo}` : ''}${allocation.plans.length ? `，已生成 ${allocation.plans.length} 张缺口生产计划` : ''}`,
      };
    }

    let outputNo = '';
    await this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${orderId} FOR UPDATE`;
      const locked = await t.hspsi_sale_order.findFirst({
        where: { so_id: orderId, deleted_at: null },
      });
      if (!locked) throw new NotFoundException('折价销售单不存在');
      if (
        locked.so_property_type !== 2 ||
        !this.trustedDiscountSource(locked.business_source_type) ||
        locked.business_source_id <= 0n
      )
        throw new BadRequestException('当前记录不是盘点报损或退货生成的折价销售单');
      if (locked.approve_status === 2 || locked.delivery_status === 3)
        throw new BadRequestException('该折价销售单已经完成处置，请勿重复确认');
      if (!approved) {
        await t.hspsi_sale_order.update({
          where: { so_id: orderId },
          data: {
            approve_status: 2,
            approve_comment: comment,
            approve_by: BigInt(u),
            approve_date: new Date(),
            order_status: 3,
            updated_by: BigInt(u),
          },
        });
        return;
      }
      if (Number(locked.fact_amount) <= 0)
        throw new BadRequestException('确认售出前必须填写大于0的最终销售价格');

      const orderDetails = await t.hspsi_sale_order_detail.findMany({ where: { so_id: orderId } });
      const source = await this.discountSource(
        t,
        locked.business_source_type,
        locked.business_source_id,
        true,
      );
      assertDiscountOrderMatchesSource(
        source.lines,
        orderDetails.map((line: B) => ({
          goodsId: line.goods_id,
          skuId: line.sku_id,
          quantity: Number(line.sale_qty),
        })),
      );
      const confirmed = await this.confirmedDiscountSourceLines(
        t,
        locked.business_source_type,
        locked.business_source_id,
      );
      const remaining = this.discountSourceRemaining(source.lines, confirmed).filter(
        (line: B) => Number(line.remainingQuantity) > 0,
      );
      if (!remaining.length) {
        await t.hspsi_sale_order.update({
          where: { so_id: orderId },
          data: {
            approve_status: 1,
            approve_comment: comment,
            approve_by: BigInt(u),
            approve_date: new Date(),
            order_status: 2,
            delivery_status: 3,
            delivery_date: new Date(),
            updated_by: BigInt(u),
          },
        });
        return;
      }

      const draft = await t.hspsi_sale_order_output.findFirst({
        where: { so_id: orderId, comfirm_status: 0, deleted_at: null },
        orderBy: { so_output_id: 'asc' },
      });
      const outputData = {
        so_id: orderId,
        org_id: locked.org_id,
        warehouse_id: locked.warehouse_id,
        output_date: new Date(),
        go_where: 2,
        dept_id: 0n,
        receiver_id: 0n,
        output_sku_qty: remaining.length,
        status: true,
        remark: `折价销售单 ${locked.so_no} 确认售出自动出库`,
        updated_by: BigInt(u),
      };
      const newOutputNo = draft
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.DISCOUNT_SALES_OUTPUT);
      const output = draft
        ? await t.hspsi_sale_order_output.update({
            where: { so_output_id: draft.so_output_id },
            data: outputData,
          })
        : await t.hspsi_sale_order_output.create({
            data: {
              ...outputData,
              so_output_no: newOutputNo,
              comfirm_status: 0,
              comfirm_comment: '',
              comfirm_by: 0n,
              posting_version: 0,
              created_by: BigInt(u),
            },
          });
      outputNo = output.so_output_no;
      await t.hspsi_sale_order_output_detail.deleteMany({
        where: { so_output_id: output.so_output_id },
      });
      await t.hspsi_sale_order_output_detail.createMany({
        data: remaining.map((line: B) => ({
          so_output_id: output.so_output_id,
          so_id: orderId,
          goods_id: line.goodsId,
          sku_id: line.skuId,
          batch_no: line.batchNo,
          unit_type: line.unitType,
          sale_qty: Number(line.remainingQuantity),
          output_qty: Number(line.remainingQuantity),
        })),
      });
      const postingVersion = Number(output.posting_version ?? 0) + 1;
      await this.posting.post(
        {
          orgId: locked.org_id,
          warehouseId: locked.warehouse_id,
          direction: -1,
          operationType: 2,
          inventoryMode: INVENTORY_BUSINESS_MODE.DISCOUNT_SALES_OUTPUT,
          sourceId: output.so_output_id,
          sourceType: 'discount_sale_output',
          sourceNo: outputNo,
          operationBy: u,
          idempotencyKey: `discount-order:${id}:v${postingVersion}:confirm-sale`,
          remark: comment || '折价销售确认售出',
          lines: remaining.map((line: B) => ({
            goodsId: line.goodsId,
            skuId: line.skuId,
            batchNo: line.batchNo,
            unitType: line.unitType,
            quantity: String(line.remainingQuantity),
          })),
        },
        t,
      );
      await t.hspsi_sale_order_output.update({
        where: { so_output_id: output.so_output_id },
        data: {
          comfirm_status: 1,
          comfirm_comment: comment,
          comfirm_by: BigInt(u),
          comfirm_date: new Date(),
          posting_version: postingVersion,
          updated_by: BigInt(u),
        },
      });
      await t.hspsi_sale_order.update({
        where: { so_id: orderId },
        data: {
          approve_status: 1,
          approve_comment: comment,
          approve_by: BigInt(u),
          approve_date: new Date(),
          order_status: 2,
          delivery_status: 3,
          delivery_date: new Date(),
          shipper: u,
          updated_by: BigInt(u),
        },
      });
      await this.documentTrace.link(
        {
          upstreamType: 'discount_sale_order',
          upstreamId: orderId,
          upstreamNo: locked.so_no,
          downstreamType: 'discount_sale_output',
          downstreamId: output.so_output_id,
          downstreamNo: outputNo,
          relationKind: 'fulfillment',
          createdBy: u,
        },
        t,
      );
    });
    return {
      id,
      outputNo: outputNo || undefined,
      inventoryPosted: approved,
      message: approved
        ? '折价销售已确认售出，库存已按全部来源批次一次性扣减'
        : '折价销售已确认未售出，库存未变动',
    };
  }
  async deleteOrder(id: string, u: string) {
    const orderId = BigInt(id);
    await this.p.$transaction(async (t) => {
      await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${orderId} FOR UPDATE`;
      const order = await t.hspsi_sale_order.findFirst({
        where: { so_id: orderId, deleted_at: null },
      });
      if (!order) throw new NotFoundException('销售订单不存在');
      if (
        order.so_property_type === 2 &&
        this.trustedDiscountSource(order.business_source_type) &&
        order.business_source_id > 0n
      ) {
        const sourceValid =
          order.business_source_type === 'inventory_loss'
            ? await t.hspsi_inventory_loss.count({
                where: {
                  loss_id: order.business_source_id,
                  business_kind: 2,
                  go_where: 1,
                  approve_status: 1,
                  deleted_at: null,
                },
              })
            : await t.hspsi_sale_order_exit.count({
                where: {
                  so_exit_id: order.business_source_id,
                  disposal_type: 3,
                  comfirm_status: 1,
                  deleted_at: null,
                },
              });
        if (sourceValid)
          throw new BadRequestException(
            '系统生成的来源折价销售单不可直接删除，请完成处置或按上游专用流程撤销',
          );
      }
      if (
        await t.hspsi_production_plan.count({
          where: {
            source_type: { in: ['sales_order', '4'] },
            source_id: orderId,
            deleted_at: null,
          },
        })
      ) {
        throw new BadRequestException('销售订单已关联生产计划，不可删除');
      }
      if (
        (await t.hspsi_sale_order_output.count({
          where: { so_id: orderId, comfirm_status: 1, deleted_at: null },
        })) ||
        (await t.hspsi_sale_order_exit.count({
          where: { so_id: orderId, comfirm_status: 1, deleted_at: null },
        })) ||
        (await t.hspsi_sales_order_payment.count({ where: { so_id: orderId, deleted_at: null } }))
      )
        throw new BadRequestException('订单已有确认业务，不可删除');
      const outputs = await t.hspsi_sale_order_output.findMany({
        where: { so_id: order.so_id, comfirm_status: 0, deleted_at: null },
        select: { so_output_id: true },
      });
      const returns = await t.hspsi_sale_order_exit.findMany({
        where: { so_id: order.so_id, comfirm_status: 0, deleted_at: null },
        select: { so_exit_id: true },
      });
      await t.hspsi_sale_order.update({
        where: { so_id: order.so_id },
        data: { deleted_at: new Date(), updated_by: BigInt(u) },
      });
      await t.hspsi_sale_order_output.updateMany({
        where: { so_id: order.so_id, comfirm_status: 0 },
        data: { deleted_at: new Date() },
      });
      await t.hspsi_sale_order_exit.updateMany({
        where: { so_id: order.so_id, comfirm_status: 0 },
        data: { deleted_at: new Date() },
      });
      await t.hspsi_sale_order_service.updateMany({
        where: { so_id: order.so_id },
        data: { deleted_at: new Date() },
      });
      for (const output of outputs)
        await this.documentTrace.removeForDocument(
          order.so_property_type === 2 ? 'discount_sale_output' : 'sales_output',
          output.so_output_id,
          t,
        );
      for (const ret of returns)
        await this.documentTrace.removeForDocument('sales_return', ret.so_exit_id, t);
      await this.documentTrace.removeForDocument(
        order.so_property_type === 2 ? 'discount_sale_order' : 'sales_order',
        order.so_id,
        t,
      );
    });
    return { id, message: '删除成功' };
  }
  async analyze(id: string, u: string) {
    const orderId = BigInt(id);
    const result: B[] = [];
    await this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${orderId} FOR UPDATE`;
      const order = await t.hspsi_sale_order.findFirst({
        where: { so_id: orderId, deleted_at: null },
      });
      if (!order) throw new NotFoundException('销售订单不存在');
      if (order.so_property_type !== 1)
        throw new BadRequestException('仅普通销售订单可执行缺口分析');
      if (order.approve_status !== 1)
        throw new BadRequestException('仅审批通过的销售订单可执行缺口分析');
      const details = await t.hspsi_sale_order_detail.findMany({ where: { so_id: orderId } });
      const aggregated = new Map<string, B>();
      for (const row of details) {
        const line = {
          goodsId: row.goods_id,
          skuId: row.sku_id,
          unitType: row.unit_type,
          quantity: Number(row.sale_qty),
        };
        const key = discountGoodsKey(line);
        const existing = aggregated.get(key);
        if (existing) existing.quantity = Number(existing.quantity) + Number(line.quantity);
        else aggregated.set(key, { ...line, quantity: Number(line.quantity) });
      }
      for (const l of aggregated.values()) {
        const outputHeads = await t.hspsi_sale_order_output.findMany({
          where: {
            so_id: orderId,
            go_where: { not: SALES_OUTPUT_DESTINATION.EXCHANGE },
            deleted_at: null,
          },
          select: { so_output_id: true },
        });
        const allocated = outputHeads.length
          ? await t.hspsi_sale_order_output_detail.aggregate({
              _sum: { output_qty: true },
              where: {
                so_output_id: { in: outputHeads.map((item) => item.so_output_id) },
                goods_id: BigInt(l.goodsId),
                sku_id: BigInt(l.skuId),
              },
            })
          : null;
        const planned = await t.hspsi_production_plan.aggregate({
          _sum: { plan_qty: true },
          where: {
            source_type: { in: ['sales_order', '4'] },
            source_id: orderId,
            goods_id: BigInt(l.goodsId),
            sku_id: BigInt(l.skuId),
            plan_status: { not: 6 },
            deleted_at: null,
          },
        });
        const remaining = Math.max(
          0,
          Number(l.quantity) -
            Number(allocated?._sum.output_qty ?? 0) -
            Number(planned._sum.plan_qty ?? 0),
        );
        if (!remaining) continue;
        const stock = await t.hspsi_inventory_total.aggregate({
          _sum: { inventory_qty: true },
          where: {
            org_id: order.org_id,
            warehouse_id: order.warehouse_id,
            goods_id: BigInt(l.goodsId),
            sku_id: BigInt(l.skuId),
            deleted_at: null,
          },
        });
        const gap = Math.max(0, remaining - Number(stock._sum.inventory_qty ?? 0));
        if (!gap) continue;
        const goods = await t.hspsi_goods_info.findUniqueOrThrow({
          where: { goods_id: BigInt(l.goodsId) },
        });
        const bom = await t.hspsi_production_bom.findFirst({
          where: {
            org_id: order.org_id,
            goods_id: goods.goods_id,
            sku_id: BigInt(l.skuId),
            status: 1,
            deleted_at: null,
          },
        });
        if (!bom)
          throw new BadRequestException(
            `${goods.goods_name} 没有当前订单组织下启用的BOM，不能绕过生产计划直接采购`,
          );
        result.push(
          await this.production.createPlanFromSalesGap(
            t,
            {
              bomId: bom.bom_id,
              orgId: order.org_id,
              warehouseId: bom.warehouse_id,
              productWarehouseId: order.warehouse_id,
              planQty: gap,
              sourceType: 'sales_order',
              sourceId: order.so_id,
              sourceNo: order.so_no,
            },
            u,
          ),
        );
      }
    });
    const created = result.filter((item) => item.created !== false).length;
    return {
      items: result,
      message: created
        ? `已生成 ${created} 张生产计划`
        : '当前库存充足或生产计划已存在，本次未重复生成',
    };
  }
  async outputs(q: B) {
    return this.docList('output', q);
  }
  async returns(q: B) {
    return this.docList('return', q);
  }
  private async docList(type: 'output' | 'return', q: B) {
    const { page, pageSize } = this.pg(q),
      m: any = type === 'output' ? this.p.hspsi_sale_order_output : this.p.hspsi_sale_order_exit,
      key = type === 'output' ? 'so_output_id' : 'so_exit_id',
      where: B = { deleted_at: null };
    if (q.status !== undefined && q.status !== '') where.comfirm_status = Number(q.status);
    const [records, total] = await Promise.all([
        m.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { [key]: 'desc' },
        }),
        m.count({ where }),
      ]),
      orderIds = records.map((i: B) => BigInt(i.so_id)),
      orders = orderIds.length
        ? await this.p.hspsi_sale_order.findMany({ where: { so_id: { in: orderIds } } })
        : [],
      orderMap = new Map(orders.map((i) => [String(i.so_id), i])),
      outputDetails =
        type === 'output' && records.length
          ? await this.p.hspsi_sale_order_output_detail.groupBy({
              by: ['so_output_id'],
              where: { so_output_id: { in: records.map((i: B) => BigInt(i[key])) } },
              _sum: { output_qty: true },
            })
          : [];
    const sourceOutputIds: bigint[] =
      type === 'return'
        ? records
            .map((i: B) => BigInt(i.source_output_id ?? 0))
            .filter((id: bigint) => id > 0n)
            .filter((id: bigint, i: number, arr: bigint[]) => arr.indexOf(id) === i)
        : [];
    const sourceOutputs = sourceOutputIds.length
      ? await this.p.hspsi_sale_order_output.findMany({
          where: { so_output_id: { in: sourceOutputIds } },
        })
      : [];
    const items = await this.refs.enrich(
      records.map((i: B) => {
        const order = orderMap.get(String(i.so_id)),
          quantity =
            type === 'output'
              ? (outputDetails.find((d) => String(d.so_output_id) === String(i[key]))?._sum
                  .output_qty ?? 0)
              : i.exit_qty,
          srcOut = sourceOutputs.find((o) => o.so_output_id === i.source_output_id);
        return {
          ...i,
          id: i[key],
          businessNo: type === 'output' ? i.so_output_no : i.so_exit_no,
          orderId: i.so_id,
          orderNo: order?.so_no ?? '',
          propertyType: order?.so_property_type ?? 1,
          customerName: order?.customer_name ?? '',
          orgId: i.org_id,
          warehouseId: i.warehouse_id,
          deptId: i.dept_id,
          receiverId: i.receiver_id,
          date: type === 'output' ? i.output_date : i.return_date,
          sourceOutputId: type === 'return' ? i.source_output_id : undefined,
          sourceOutputNo: type === 'return' ? (srcOut?.so_output_no ?? '') : undefined,
          destination: type === 'output' ? i.go_where : undefined,
          disposalType: type === 'return' ? i.disposal_type : undefined,
          orderQty: order?.so_qty ?? 0,
          quantity,
          confirmStatus: i.comfirm_status,
          createdBy: i.created_by,
          updatedBy: i.updated_by,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
        };
      }),
      type === 'output'
        ? { destination: 'sales_output_destination', confirmStatus: 'confirm_status' }
        : { disposalType: 'sales_return_disposal', confirmStatus: 'confirm_status' },
    );
    return { items, total, page, pageSize };
  }
  async output(id: string) {
    const i = await this.p.hspsi_sale_order_output.findFirst({
      where: { so_output_id: BigInt(id), deleted_at: null },
    });
    if (!i) throw new NotFoundException('销售出库单不存在');
    const [d, order, returnHeads] = await Promise.all([
      this.p.hspsi_sale_order_output_detail.findMany({ where: { so_output_id: i.so_output_id } }),
      this.p.hspsi_sale_order.findUnique({ where: { so_id: i.so_id } }),
      this.p.hspsi_sale_order_exit.findMany({
        where: { source_output_id: i.so_output_id, comfirm_status: 1, deleted_at: null },
        select: { so_exit_id: true },
      }),
    ]);
    const returned = returnHeads.length
      ? await this.p.hspsi_sale_order_exit_detail.findMany({
          where: { so_exit_id: { in: returnHeads.map((item) => item.so_exit_id) } },
        })
      : [];
    const sourceLocked =
      !!order &&
      order.so_property_type === 2 &&
      this.trustedDiscountSource(order.business_source_type) &&
      order.business_source_id > 0n;
    return {
      ...i,
      id: i.so_output_id,
      businessNo: i.so_output_no,
      orderId: i.so_id,
      warehouseId: i.warehouse_id,
      destination: i.go_where,
      outDate: i.output_date,
      confirmStatus: i.comfirm_status,
      sourceLocked,
      details: d.map((x) => {
        const returnedQuantity = returned
          .filter(
            (line) =>
              line.goods_id === x.goods_id &&
              line.sku_id === x.sku_id &&
              line.batch_no === x.batch_no,
          )
          .reduce((sum, line) => sum + Number(line.exit_qty), 0);
        return {
          id: x.id,
          goodsId: x.goods_id,
          skuId: x.sku_id,
          batchNo: x.batch_no,
          unitType: x.unit_type,
          orderQty: x.sale_qty,
          quantity: x.output_qty,
          returnedQuantity,
          remainingReturnQuantity: Math.max(0, Number(x.output_qty) - returnedQuantity),
          sourceLocked,
        };
      }),
    };
  }
  async removeDocument(type: 'output' | 'return', id: string, u: string) {
    const documentId = BigInt(id);
    await this.p.$transaction(async (t) => {
      if (type === 'output') {
        await t.$queryRaw`SELECT so_output_id FROM hspsi_sale_order_output WHERE so_output_id=${documentId} FOR UPDATE`;
        const output = await t.hspsi_sale_order_output.findFirst({
          where: { so_output_id: documentId, deleted_at: null },
        });
        if (!output) throw new NotFoundException('销售出库单不存在');
        if (output.comfirm_status === 1) throw new BadRequestException('已确认单据不可删除');
        if (output.go_where === SALES_OUTPUT_DESTINATION.EXCHANGE)
          throw new BadRequestException('售后换货生成的出库单不可删除，请编辑后继续完成换货');
        await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${output.so_id} FOR UPDATE`;
        const order = await t.hspsi_sale_order.findUniqueOrThrow({
          where: { so_id: output.so_id },
        });
        await t.hspsi_sale_order_output.update({
          where: { so_output_id: documentId },
          data: { deleted_at: new Date(), updated_by: BigInt(u) },
        });
        await this.documentTrace.removeForDocument(
          order.so_property_type === 2 ? 'discount_sale_output' : 'sales_output',
          documentId,
          t,
        );
      } else {
        await t.$queryRaw`SELECT so_exit_id FROM hspsi_sale_order_exit WHERE so_exit_id=${documentId} FOR UPDATE`;
        const ret = await t.hspsi_sale_order_exit.findFirst({
          where: { so_exit_id: documentId, deleted_at: null },
        });
        if (!ret) throw new NotFoundException('销售退货单不存在');
        if (ret.comfirm_status === 1) throw new BadRequestException('已确认单据不可删除');
        await t.hspsi_sale_order_exit.update({
          where: { so_exit_id: documentId },
          data: { deleted_at: new Date(), updated_by: BigInt(u) },
        });
        await this.documentTrace.removeForDocument('sales_return', documentId, t);
      }
    });
    return { id, message: '删除成功' };
  }
  async saveOutput(id: string | null, b: B, u: string) {
    const orderId = BigInt(b.orderId),
      ls = this.lines(b.details);
    let isDiscount = false,
      isExchange = false;
    const oid = await this.guardedTransaction(async (t) => {
      let lockedOutput: null | Awaited<ReturnType<typeof t.hspsi_sale_order_output.findFirst>> =
        null;
      if (id) {
        const outputId = BigInt(id);
        await t.$queryRaw`SELECT so_output_id FROM hspsi_sale_order_output WHERE so_output_id=${outputId} FOR UPDATE`;
        lockedOutput = await t.hspsi_sale_order_output.findFirst({
          where: { so_output_id: outputId, deleted_at: null },
        });
        if (!lockedOutput) throw new NotFoundException('销售出库单不存在');
        if (lockedOutput.comfirm_status === 1)
          throw new BadRequestException('已确认销售出库单不能编辑');
        if (lockedOutput.so_id !== orderId)
          throw new BadRequestException('销售出库单创建后不可更换来源订单');
      }
      await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${orderId} FOR UPDATE`;
      await t.$queryRaw`SELECT id FROM hspsi_sale_order_detail WHERE so_id=${orderId} FOR UPDATE`;
      const order = await t.hspsi_sale_order.findFirst({
        where: { so_id: orderId, deleted_at: null },
      });
      if (!order) throw new NotFoundException('销售订单不存在');
      if (order.so_type === 2) throw new BadRequestException('虚拟订单不能创建实物出库');
      if (order.approve_status !== 1)
        throw new BadRequestException('仅审批通过的销售订单可创建出库单');
      isDiscount = order.so_property_type === 2;
      isExchange = lockedOutput?.go_where === SALES_OUTPUT_DESTINATION.EXCHANGE;
      if (!id && Number(b.destination) === SALES_OUTPUT_DESTINATION.EXCHANGE)
        throw new BadRequestException('换货出库只能由售后换货流程生成');
      const orderDetails = await t.hspsi_sale_order_detail.findMany({ where: { so_id: orderId } });
      const allocatedHeads = await t.hspsi_sale_order_output.findMany({
        where: {
          so_id: orderId,
          go_where: { not: SALES_OUTPUT_DESTINATION.EXCHANGE },
          deleted_at: null,
          ...(id ? { so_output_id: { not: BigInt(id) } } : {}),
        },
        select: { so_output_id: true },
      });
      const allocatedDetails = allocatedHeads.length
        ? await t.hspsi_sale_order_output_detail.findMany({
            where: { so_output_id: { in: allocatedHeads.map((item) => item.so_output_id) } },
          })
        : [];
      const orderQty = new Map<string, number>(),
        allocatedQty = new Map<string, number>(),
        currentQty = new Map<string, number>();
      for (const line of orderDetails) {
        const key = `${line.goods_id}:${line.sku_id}`;
        orderQty.set(key, (orderQty.get(key) ?? 0) + Number(line.sale_qty));
      }
      for (const line of allocatedDetails) {
        const key = `${line.goods_id}:${line.sku_id}`;
        allocatedQty.set(key, (allocatedQty.get(key) ?? 0) + Number(line.output_qty));
      }
      for (const line of ls) {
        const key = `${line.goodsId}:${line.skuId}`,
          qty = this.qty(line.quantity, '销售出库数量');
        currentQty.set(key, (currentQty.get(key) ?? 0) + qty);
      }
      if (isExchange) {
        const planned = await t.hspsi_sale_order_output_detail.findMany({
            where: { so_output_id: lockedOutput!.so_output_id },
          }),
          plannedQty = new Map<string, number>();
        for (const line of planned) {
          const key = `${line.goods_id}:${line.sku_id}`;
          plannedQty.set(key, (plannedQty.get(key) ?? 0) + Number(line.sale_qty));
        }
        for (const [key, qty] of currentQty) {
          const allowed = plannedQty.get(key);
          if (allowed === undefined)
            throw new BadRequestException('换货出库商品必须与售后换货商品一致');
          if (qty > allowed + 0.000001)
            throw new BadRequestException('换货出库数量不能超过售后换货数量');
        }
        for (const [key, qty] of plannedQty)
          if (Math.abs((currentQty.get(key) ?? 0) - qty) > 0.000001)
            throw new BadRequestException('换货出库必须完整保留售后换货商品和数量');
      } else {
        for (const [key, qty] of currentQty) {
          const allowed = orderQty.get(key);
          if (allowed === undefined) throw new BadRequestException('销售出库明细不属于来源订单');
          if ((allocatedQty.get(key) ?? 0) + qty > allowed + 0.000001)
            throw new BadRequestException('本次出库超过订单剩余可分配数量');
        }
      }
      if (
        isDiscount &&
        this.trustedDiscountSource(order.business_source_type) &&
        order.business_source_id > 0n
      ) {
        const source = await this.discountSource(
          t,
          order.business_source_type,
          order.business_source_id,
          true,
        );
        if (source.orgId !== order.org_id || source.warehouseId !== order.warehouse_id)
          throw new BadRequestException('折价销售订单组织或仓库与来源处置单不一致');
        const sourceConfirmed = await this.confirmedDiscountSourceLines(
          t,
          order.business_source_type,
          order.business_source_id,
        );
        assertDiscountOutputWithinSource(source.lines, sourceConfirmed, ls);
      }
      const batchQty = new Map<string, number>();
      for (const line of ls) {
        const batchNo = String(line.batchNo ?? '').trim();
        const trustedSourceOutput =
          isDiscount &&
          this.trustedDiscountSource(order.business_source_type) &&
          order.business_source_id > 0n;
        if (!batchNo && !trustedSourceOutput) throw new BadRequestException('销售出库批号必填');
        const key = `${line.goodsId}:${line.skuId}:${batchNo}`;
        batchQty.set(key, (batchQty.get(key) ?? 0) + Number(line.quantity));
      }
      const pendingHeads = await t.hspsi_sale_order_output.findMany({
        where: {
          org_id: order.org_id,
          warehouse_id: order.warehouse_id,
          comfirm_status: 0,
          deleted_at: null,
          ...(id ? { so_output_id: { not: BigInt(id) } } : {}),
        },
        select: { so_output_id: true },
      });
      const pendingDetails = pendingHeads.length
        ? await t.hspsi_sale_order_output_detail.findMany({
            where: { so_output_id: { in: pendingHeads.map((item) => item.so_output_id) } },
          })
        : [];
      const pendingBatchQty = new Map<string, number>();
      for (const line of pendingDetails) {
        const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`;
        pendingBatchQty.set(key, (pendingBatchQty.get(key) ?? 0) + Number(line.output_qty));
      }
      for (const [key, qty] of batchQty) {
        const [goodsId, skuId, ...batchParts] = key.split(':');
        const batchNo = batchParts.join(':');
        const stock = await t.hspsi_inventory_batch_total.findUnique({
          where: {
            goods_id_sku_id_warehouse_id_batch_no: {
              goods_id: BigInt(goodsId!),
              sku_id: BigInt(skuId!),
              warehouse_id: order.warehouse_id,
              batch_no: batchNo,
            },
          },
        });
        if (
          !stock ||
          stock.org_id !== order.org_id ||
          Number(stock.inventory_qty) - (pendingBatchQty.get(key) ?? 0) + 0.000001 < qty
        )
          throw new BadRequestException(
            `批号 ${batchNo} 可用库存不足或已被其他待出库单占用，不能保存销售出库草稿`,
          );
      }
      const data = {
        so_id: order.so_id,
        org_id: order.org_id,
        warehouse_id: order.warehouse_id,
        output_date: new Date(b.outDate ?? Date.now()),
        go_where: isExchange
          ? SALES_OUTPUT_DESTINATION.EXCHANGE
          : isDiscount
            ? SALES_OUTPUT_DESTINATION.DISCOUNT
            : Number(b.destination ?? SALES_OUTPUT_DESTINATION.SALE),
        dept_id: BigInt(b.deptId ?? 0),
        receiver_id: BigInt(b.receiverId ?? 0),
        output_sku_qty: ls.length,
        status: true,
        remark: String(b.remark ?? ''),
        updated_by: BigInt(u),
      };
      const newOutputNo = id
        ? ''
        : await this.businessNumber.generate(
            isExchange
              ? BUSINESS_PREFIX.SALES_EXCHANGE_OUTPUT
              : isDiscount
                ? BUSINESS_PREFIX.DISCOUNT_SALES_OUTPUT
                : BUSINESS_PREFIX.SALES_OUTPUT,
          );
      const h = id
        ? await t.hspsi_sale_order_output.update({
            where: { so_output_id: lockedOutput!.so_output_id },
            data,
          })
        : await t.hspsi_sale_order_output.create({
            data: {
              ...data,
              so_output_no: newOutputNo,
              comfirm_status: 0,
              comfirm_comment: '',
              comfirm_by: 0n,
              created_by: BigInt(u),
            },
          });
      const businessNo = h.so_output_no;
      await t.hspsi_sale_order_output_detail.deleteMany({
        where: { so_output_id: h.so_output_id },
      });
      await t.hspsi_sale_order_output_detail.createMany({
        data: ls.map((l) => ({
          so_output_id: h.so_output_id,
          so_id: h.so_id,
          goods_id: BigInt(l.goodsId),
          sku_id: BigInt(l.skuId),
          batch_no: String(l.batchNo),
          unit_type: Number(l.unitType),
          sale_qty: Number(l.orderQty),
          output_qty: Number(l.quantity),
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: isDiscount ? 'discount_sale_order' : 'sales_order',
          upstreamId: order.so_id,
          upstreamNo: order.so_no,
          downstreamType: isDiscount ? 'discount_sale_output' : 'sales_output',
          downstreamId: h.so_output_id,
          downstreamNo: businessNo,
          createdBy: u,
        },
        t,
      );
      if (!isDiscount) {
        const plans = await t.hspsi_production_plan.findMany({
          where: {
            source_type: 'sales_order',
            source_id: order.so_id,
            deleted_at: null,
            OR: ls.map((line) => ({ goods_id: BigInt(line.goodsId), sku_id: BigInt(line.skuId) })),
          },
          select: { plan_id: true, plan_no: true },
        });
        for (const plan of plans)
          await this.documentTrace.link(
            {
              upstreamType: 'production_plan',
              upstreamId: plan.plan_id,
              upstreamNo: plan.plan_no,
              downstreamType: 'sales_output',
              downstreamId: h.so_output_id,
              downstreamNo: businessNo,
              relationKind: 'fulfillment',
              createdBy: u,
            },
            t,
          );
      }
      return h.so_output_id;
    });
    return {
      id: oid,
      message: isExchange
        ? '换货出库单已保存'
        : isDiscount
          ? '折价销售出库单已保存'
          : '销售出库单已保存',
    };
  }
  async confirmOutput(id: string, comment: string, u: string) {
    const outputId = BigInt(id);
    let isDiscount = false,
      isExchange = false,
      alreadyConfirmed = false;
    await this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT so_output_id FROM hspsi_sale_order_output WHERE so_output_id=${outputId} FOR UPDATE`;
      const header = await t.hspsi_sale_order_output.findFirst({
        where: { so_output_id: outputId, deleted_at: null },
      });
      if (!header) throw new NotFoundException('销售出库单不存在');
      if (header.comfirm_status === 1) {
        alreadyConfirmed = true;
        return;
      }
      await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${header.so_id} FOR UPDATE`;
      await t.$queryRaw`SELECT id FROM hspsi_sale_order_detail WHERE so_id=${header.so_id} FOR UPDATE`;
      const details = await t.hspsi_sale_order_output_detail.findMany({
        where: { so_output_id: outputId },
      });
      const order = await t.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: header.so_id } });
      isExchange = header.go_where === SALES_OUTPUT_DESTINATION.EXCHANGE;
      const orderDetails = await t.hspsi_sale_order_detail.findMany({
        where: { so_id: header.so_id },
      });
      const confirmedHeads = await t.hspsi_sale_order_output.findMany({
        where: {
          so_id: header.so_id,
          comfirm_status: 1,
          go_where: { not: SALES_OUTPUT_DESTINATION.EXCHANGE },
          deleted_at: null,
        },
        select: { so_output_id: true },
      });
      const confirmedDetails = confirmedHeads.length
        ? await t.hspsi_sale_order_output_detail.findMany({
            where: { so_output_id: { in: confirmedHeads.map((item) => item.so_output_id) } },
          })
        : [];
      const orderQty = new Map<string, number>(),
        confirmedQty = new Map<string, number>(),
        currentQty = new Map<string, number>();
      for (const line of orderDetails) {
        const key = `${line.goods_id}:${line.sku_id}`;
        orderQty.set(key, (orderQty.get(key) ?? 0) + Number(line.sale_qty));
      }
      for (const line of confirmedDetails) {
        const key = `${line.goods_id}:${line.sku_id}`;
        confirmedQty.set(key, (confirmedQty.get(key) ?? 0) + Number(line.output_qty));
      }
      for (const line of details) {
        const key = `${line.goods_id}:${line.sku_id}`,
          qty = Number(line.output_qty);
        if (!(qty > 0)) throw new BadRequestException('销售出库数量必须大于0');
        currentQty.set(key, (currentQty.get(key) ?? 0) + qty);
      }
      if (!isExchange)
        for (const [key, qty] of currentQty) {
          const allowed = orderQty.get(key);
          if (allowed === undefined) throw new BadRequestException('销售出库明细不属于来源订单');
          if ((confirmedQty.get(key) ?? 0) + qty > allowed + 0.000001)
            throw new BadRequestException('累计确认出库数量超过销售订单数量');
        }
      if (header.warehouse_id !== order.warehouse_id)
        throw new BadRequestException('销售出库仓库必须与订单仓库一致');
      isDiscount = order.so_property_type === 2;
      if (
        isDiscount &&
        this.trustedDiscountSource(order.business_source_type) &&
        order.business_source_id > 0n
      ) {
        const source = await this.discountSource(
          t,
          order.business_source_type,
          order.business_source_id,
          true,
        );
        if (source.orgId !== order.org_id || source.warehouseId !== order.warehouse_id)
          throw new BadRequestException('折价销售订单组织或仓库与来源处置单不一致');
        const sourceConfirmed = await this.confirmedDiscountSourceLines(
          t,
          order.business_source_type,
          order.business_source_id,
        );
        assertDiscountOutputWithinSource(source.lines, sourceConfirmed, details);
      }
      const postingVersion = header.posting_version + 1;
      await this.posting.post(
        {
          orgId: header.org_id,
          warehouseId: header.warehouse_id,
          direction: -1,
          operationType: 2,
          inventoryMode: isDiscount
            ? INVENTORY_BUSINESS_MODE.DISCOUNT_SALES_OUTPUT
            : INVENTORY_BUSINESS_MODE.SALES_OUTPUT,
          sourceId: header.so_output_id,
          sourceType: isExchange
            ? 'sales_exchange_output'
            : isDiscount
              ? 'discount_sale_output'
              : 'sales_output',
          sourceNo: header.so_output_no,
          operationBy: u,
          idempotencyKey: `sales-output:${id}:v${postingVersion}:confirm`,
          remark:
            comment || (isExchange ? '售后换货出库' : isDiscount ? '折价销售出库' : '销售出库'),
          lines: details.map((l) => ({
            goodsId: l.goods_id,
            skuId: l.sku_id,
            batchNo: l.batch_no,
            unitType: l.unit_type,
            quantity: String(l.output_qty),
          })),
        },
        t,
      );
      await this.documentTrace.link(
        {
          upstreamType: isDiscount ? 'discount_sale_order' : 'sales_order',
          upstreamId: order.so_id,
          upstreamNo: order.so_no,
          downstreamType: isDiscount ? 'discount_sale_output' : 'sales_output',
          downstreamId: header.so_output_id,
          downstreamNo: header.so_output_no,
          createdBy: u,
        },
        t,
      );
      if (!isDiscount) {
        const plans = await t.hspsi_production_plan.findMany({
          where: {
            source_type: 'sales_order',
            source_id: order.so_id,
            deleted_at: null,
            OR: details.map((line) => ({ goods_id: line.goods_id, sku_id: line.sku_id })),
          },
          select: { plan_id: true, plan_no: true },
        });
        for (const plan of plans)
          await this.documentTrace.link(
            {
              upstreamType: 'production_plan',
              upstreamId: plan.plan_id,
              upstreamNo: plan.plan_no,
              downstreamType: 'sales_output',
              downstreamId: header.so_output_id,
              downstreamNo: header.so_output_no,
              relationKind: 'fulfillment',
              createdBy: u,
            },
            t,
          );
      }
      await t.hspsi_sale_order_output.update({
        where: { so_output_id: outputId },
        data: {
          comfirm_status: 1,
          comfirm_comment: comment,
          comfirm_by: BigInt(u),
          comfirm_date: new Date(),
          posting_version: postingVersion,
          updated_by: BigInt(u),
        },
      });
      await t.hspsi_sale_order.update({
        where: { so_id: header.so_id },
        data: { delivery_date: new Date(), shipper: u },
      });
      if (isExchange) {
        const service = await t.hspsi_sale_order_service.findFirst({
          where: {
            so_id: header.so_id,
            event_type: 5,
            next_document_type: 'sales_exchange_output',
            next_document_id: header.so_output_id,
            event_status: 1,
            deleted_at: null,
          },
        });
        if (!service) throw new BadRequestException('换货出库缺少有效售后换货来源');
        await t.hspsi_sale_order_service.update({
          where: { service_id: service.service_id },
          data: { event_status: 2, updated_by: BigInt(u) },
        });
        await this.refreshOrderServiceStatus(t, header.so_id);
      }
      await this.refreshOrderLifecycle(t, header.so_id);
    });
    return {
      id,
      message: alreadyConfirmed
        ? '已确认'
        : isExchange
          ? '换货出库确认成功，售后换货已完成'
          : isDiscount
            ? '折价销售出库确认成功'
            : '销售出库确认成功',
    };
  }
  async undoOutput(id: string, comment: string, u: string) {
    const outputId = BigInt(id);
    await this.p.$transaction(async (t) => {
      await t.$queryRaw`SELECT so_output_id FROM hspsi_sale_order_output WHERE so_output_id=${outputId} FOR UPDATE`;
      const header = await t.hspsi_sale_order_output.findFirst({
        where: { so_output_id: outputId, deleted_at: null },
      });
      if (!header) throw new NotFoundException('销售出库单不存在');
      if (header.comfirm_status !== 1) throw new BadRequestException('仅已确认销售出库可撤销');
      if (
        await t.hspsi_sale_order_exit.count({
          where: { source_output_id: outputId, comfirm_status: 1, deleted_at: null },
        })
      )
        throw new BadRequestException('该出库单已有确认退货，不能撤销');
      const details = await t.hspsi_sale_order_output_detail.findMany({
        where: { so_output_id: outputId },
      });
      const order = await t.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: header.so_id } }),
        isDiscount = order.so_property_type === 2,
        isExchange = header.go_where === SALES_OUTPUT_DESTINATION.EXCHANGE;
      await this.posting.post(
        {
          orgId: header.org_id,
          warehouseId: header.warehouse_id,
          direction: 1,
          operationType: 1,
          inventoryMode: isDiscount
            ? INVENTORY_BUSINESS_MODE.DISCOUNT_SALES_OUTPUT
            : INVENTORY_BUSINESS_MODE.SALES_OUTPUT,
          sourceId: header.so_output_id,
          sourceType: isExchange
            ? 'sales_exchange_output_undo'
            : isDiscount
              ? 'discount_sale_output_undo'
              : 'sales_output_undo',
          sourceNo: header.so_output_no,
          operationBy: u,
          idempotencyKey: `sales-output:${id}:v${header.posting_version}:undo`,
          remark:
            comment ||
            (isExchange ? '撤销换货出库' : isDiscount ? '撤销折价销售出库' : '撤销销售出库'),
          lines: details.map((l) => ({
            goodsId: l.goods_id,
            skuId: l.sku_id,
            batchNo: l.batch_no,
            unitType: l.unit_type,
            quantity: String(l.output_qty),
          })),
        },
        t,
      );
      await t.hspsi_sale_order_output.update({
        where: { so_output_id: outputId },
        data: {
          comfirm_status: 0,
          comfirm_comment: comment,
          comfirm_by: BigInt(u),
          comfirm_date: new Date(),
          updated_by: BigInt(u),
        },
      });
      if (isExchange) {
        const service = await t.hspsi_sale_order_service.findFirst({
          where: {
            so_id: header.so_id,
            event_type: 5,
            next_document_type: 'sales_exchange_output',
            next_document_id: header.so_output_id,
            deleted_at: null,
          },
        });
        if (service)
          await t.hspsi_sale_order_service.update({
            where: { service_id: service.service_id },
            data: { event_status: 1, updated_by: BigInt(u) },
          });
        await this.refreshOrderServiceStatus(t, header.so_id);
      }
      await this.refreshOrderLifecycle(t, header.so_id);
    });
    return { id, message: '销售出库已撤销确认，库存已反向返还' };
  }
  async returnOne(id: string) {
    const i = await this.p.hspsi_sale_order_exit.findFirst({
      where: { so_exit_id: BigInt(id), deleted_at: null },
    });
    if (!i) throw new NotFoundException('销售退货单不存在');
    const d = await this.p.hspsi_sale_order_exit_detail.findMany({
      where: { so_exit_id: i.so_exit_id },
    });
    return {
      ...i,
      id: i.so_exit_id,
      businessNo: i.so_exit_no,
      orderId: i.so_id,
      warehouseId: i.warehouse_id,
      confirmStatus: i.comfirm_status,
      details: d.map((x) => ({
        id: x.id,
        goodsId: x.goods_id,
        skuId: x.sku_id,
        batchNo: x.batch_no,
        unitType: x.unit_type,
        orderQty: x.so_qty,
        quantity: x.exit_qty,
        remark: x.remark,
      })),
    };
  }
  async saveReturn(id: string | null, b: B, u: string) {
    if (!b.sourceOutputId) throw new BadRequestException('来源已确认销售出库单必填');
    const reason = String(b.reason ?? '').trim();
    if (!reason) throw new BadRequestException('退货原因必填');
    if (reason.length > 255) throw new BadRequestException('退货原因不能超过255个字符');
    const orderId = BigInt(b.orderId),
      sourceOutputId = BigInt(b.sourceOutputId),
      ls = this.lines(b.details);
    const rid = await this.guardedTransaction(async (t) => {
      let lockedReturn: null | Awaited<ReturnType<typeof t.hspsi_sale_order_exit.findFirst>> = null;
      if (id) {
        const returnId = BigInt(id);
        await t.$queryRaw`SELECT so_exit_id FROM hspsi_sale_order_exit WHERE so_exit_id=${returnId} FOR UPDATE`;
        lockedReturn = await t.hspsi_sale_order_exit.findFirst({
          where: { so_exit_id: returnId, deleted_at: null },
        });
        if (!lockedReturn) throw new NotFoundException('销售退货单不存在');
        if (lockedReturn.comfirm_status === 1)
          throw new BadRequestException('已确认销售退货单不能编辑');
        if (lockedReturn.source_output_id !== sourceOutputId || lockedReturn.so_id !== orderId)
          throw new BadRequestException('销售退货单创建后不可更换来源订单或来源出库单');
      }
      await t.$queryRaw`SELECT so_output_id FROM hspsi_sale_order_output WHERE so_output_id=${sourceOutputId} FOR UPDATE`;
      await t.$queryRaw`SELECT id FROM hspsi_sale_order_output_detail WHERE so_output_id=${sourceOutputId} FOR UPDATE`;
      const source = await t.hspsi_sale_order_output.findFirst({
        where: { so_output_id: sourceOutputId, deleted_at: null },
      });
      if (!source || source.comfirm_status !== 1 || source.so_id !== orderId)
        throw new BadRequestException('来源出库单必须是当前订单的已确认出库单');
      const order = await t.hspsi_sale_order.findFirst({
        where: { so_id: orderId, deleted_at: null },
      });
      if (!order) throw new NotFoundException('销售订单不存在');
      const disposalType = Number(b.disposalType ?? 1);
      await this.assertDictionaryValue(t, 'sales_return_disposal', disposalType, '退货后处理方式');
      const returnWarehouseId = BigInt(b.warehouseId);
      const returnWarehouse = await t.hspsi_basic_warehouse.findFirst({
        where: { warehouse_id: returnWarehouseId, org_id: order.org_id, deleted_at: null },
        select: { warehouse_id: true },
      });
      if (!returnWarehouse) throw new BadRequestException('退货仓库不存在或不属于销售订单组织');
      const sourceDetails = await t.hspsi_sale_order_output_detail.findMany({
        where: { so_output_id: sourceOutputId },
      });
      const confirmedHeads = await t.hspsi_sale_order_exit.findMany({
        where: { source_output_id: sourceOutputId, comfirm_status: 1, deleted_at: null },
        select: { so_exit_id: true },
      });
      const confirmedDetails = confirmedHeads.length
        ? await t.hspsi_sale_order_exit_detail.findMany({
            where: { so_exit_id: { in: confirmedHeads.map((item) => item.so_exit_id) } },
          })
        : [];
      const sourceQty = new Map<string, number>(),
        confirmedQty = new Map<string, number>(),
        currentQty = new Map<string, number>();
      for (const line of sourceDetails) {
        const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`;
        sourceQty.set(key, (sourceQty.get(key) ?? 0) + Number(line.output_qty));
      }
      for (const line of confirmedDetails) {
        const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`;
        confirmedQty.set(key, (confirmedQty.get(key) ?? 0) + Number(line.exit_qty));
      }
      for (const line of ls) {
        const key = `${line.goodsId}:${line.skuId}:${String(line.batchNo ?? '')}`,
          qty = this.qty(line.quantity, '销售退货数量');
        currentQty.set(key, (currentQty.get(key) ?? 0) + qty);
      }
      for (const [key, qty] of currentQty) {
        const allowed = sourceQty.get(key);
        if (allowed === undefined)
          throw new BadRequestException('退货商品、SKU及批次必须来自所选销售出库单');
        if ((confirmedQty.get(key) ?? 0) + qty > allowed + 0.000001)
          throw new BadRequestException('退货数量超过来源出库单可退数量');
      }
      const qty = ls.reduce((s, l) => s + Number(l.quantity), 0);
      const data = {
        so_id: order.so_id,
        source_output_id: source.so_output_id,
        exit_reson: reason,
        exit_qty: qty,
        disposal_type: disposalType,
        org_id: order.org_id,
        warehouse_id: returnWarehouseId,
        exit_date: new Date(b.returnDate ?? Date.now()),
        dept_id: BigInt(b.deptId ?? 0),
        receiver_id: BigInt(b.receiverId ?? 0),
        customer_id: order.customer_id,
        customer_name: order.customer_name,
        customer_mobile: order.customer_mobile,
        customer_address: order.customer_address,
        sales_name: order.sales_name,
        sales_mobile: order.sales_mobile,
        status: true,
        remark: String(b.remark ?? ''),
        updated_by: BigInt(u),
      };
      const newReturnNo = id
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.SALES_RETURN);
      const h = id
        ? await t.hspsi_sale_order_exit.update({
            where: { so_exit_id: lockedReturn!.so_exit_id },
            data,
          })
        : await t.hspsi_sale_order_exit.create({
            data: {
              ...data,
              so_exit_no: newReturnNo,
              comfirm_status: 0,
              comfirm_comment: '',
              comfirm_by: 0n,
              created_by: BigInt(u),
            },
          });
      const businessNo = h.so_exit_no;
      await t.hspsi_sale_order_exit_detail.deleteMany({ where: { so_exit_id: h.so_exit_id } });
      await t.hspsi_sale_order_exit_detail.createMany({
        data: ls.map((l) => ({
          so_exit_id: h.so_exit_id,
          so_id: h.so_id,
          goods_id: BigInt(l.goodsId),
          sku_id: BigInt(l.skuId),
          batch_no: String(l.batchNo),
          unit_type: Number(l.unitType),
          so_qty: Number(l.orderQty),
          exit_qty: Number(l.quantity),
          remark: String(l.remark ?? ''),
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: order.so_property_type === 2 ? 'discount_sale_output' : 'sales_output',
          upstreamId: source.so_output_id,
          upstreamNo: source.so_output_no,
          downstreamType: 'sales_return',
          downstreamId: h.so_exit_id,
          downstreamNo: businessNo,
          createdBy: u,
        },
        t,
      );
      return h.so_exit_id;
    });
    return { id: rid, message: '销售退货单已保存' };
  }
  async confirmReturn(id: string, comment: string, u: string) {
    const i = await this.returnOne(id);
    if (Number(i.confirmStatus) === 1) return { id, message: '已确认' };
    let successor: B = {};
    await this.guardedTransaction(async (t) => {
      const exitId = BigInt(id);
      await t.$queryRaw`SELECT so_exit_id FROM hspsi_sale_order_exit WHERE so_exit_id=${exitId} FOR UPDATE`;
      const locked = await t.hspsi_sale_order_exit.findFirst({
        where: { so_exit_id: exitId, deleted_at: null },
      });
      if (!locked) throw new NotFoundException('销售退货单不存在');
      if (locked.comfirm_status === 1) return;
      await t.$queryRaw`SELECT so_output_id FROM hspsi_sale_order_output WHERE so_output_id=${locked.source_output_id} FOR UPDATE`;
      await t.$queryRaw`SELECT id FROM hspsi_sale_order_output_detail WHERE so_output_id=${locked.source_output_id} FOR UPDATE`;
      const details = await t.hspsi_sale_order_exit_detail.findMany({
        where: { so_exit_id: exitId },
      });
      const order = await t.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: locked.so_id } });
      const sourceOutput = await t.hspsi_sale_order_output.findUniqueOrThrow({
        where: { so_output_id: locked.source_output_id },
      });
      if (sourceOutput.comfirm_status !== 1 || sourceOutput.so_id !== locked.so_id)
        throw new BadRequestException('来源销售出库单不存在、已撤销或不属于当前订单');
      const sourceDetails = await t.hspsi_sale_order_output_detail.findMany({
        where: { so_output_id: sourceOutput.so_output_id },
      });
      const confirmedHeads = await t.hspsi_sale_order_exit.findMany({
        where: { source_output_id: sourceOutput.so_output_id, comfirm_status: 1, deleted_at: null },
        select: { so_exit_id: true },
      });
      const confirmedDetails = confirmedHeads.length
        ? await t.hspsi_sale_order_exit_detail.findMany({
            where: { so_exit_id: { in: confirmedHeads.map((item) => item.so_exit_id) } },
          })
        : [];
      const sourceQty = new Map<string, number>(),
        confirmedQty = new Map<string, number>(),
        currentQty = new Map<string, number>();
      for (const line of sourceDetails) {
        const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`;
        sourceQty.set(key, (sourceQty.get(key) ?? 0) + Number(line.output_qty));
      }
      for (const line of confirmedDetails) {
        const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`;
        confirmedQty.set(key, (confirmedQty.get(key) ?? 0) + Number(line.exit_qty));
      }
      for (const line of details) {
        const key = `${line.goods_id}:${line.sku_id}:${line.batch_no}`,
          qty = Number(line.exit_qty);
        if (!(qty > 0)) throw new BadRequestException('销售退货数量必须大于0');
        currentQty.set(key, (currentQty.get(key) ?? 0) + qty);
      }
      for (const [key, qty] of currentQty) {
        const allowed = sourceQty.get(key);
        if (allowed === undefined)
          throw new BadRequestException('销售退货商品、SKU及批次必须来自来源出库单');
        if ((confirmedQty.get(key) ?? 0) + qty > allowed + 0.000001)
          throw new BadRequestException('累计确认退货数量超过来源销售出库数量');
      }
      const postingVersion = locked.posting_version + 1;
      await this.posting.post(
        {
          orgId: locked.org_id,
          warehouseId: locked.warehouse_id,
          direction: 1,
          operationType: 1,
          inventoryMode: INVENTORY_BUSINESS_MODE.SALES_RETURN,
          sourceId: locked.so_exit_id,
          sourceType: 'sales_return',
          sourceNo: locked.so_exit_no,
          operationBy: u,
          idempotencyKey: `sales-return:${id}:v${postingVersion}:confirm`,
          remark: comment || '销售退货返库',
          lines: details.map((l) => ({
            goodsId: l.goods_id,
            skuId: l.sku_id,
            batchNo: l.batch_no,
            unitType: l.unit_type,
            quantity: String(l.exit_qty),
          })),
        },
        t,
      );
      await t.hspsi_sale_order_exit.update({
        where: { so_exit_id: exitId },
        data: {
          comfirm_status: 1,
          comfirm_comment: comment,
          comfirm_by: BigInt(u),
          comfirm_date: new Date(),
          posting_version: postingVersion,
        },
      });
      await this.documentTrace.link(
        {
          upstreamType: order.so_property_type === 2 ? 'discount_sale_output' : 'sales_output',
          upstreamId: sourceOutput.so_output_id,
          upstreamNo: sourceOutput.so_output_no,
          downstreamType: 'sales_return',
          downstreamId: locked.so_exit_id,
          downstreamNo: locked.so_exit_no,
          createdBy: u,
        },
        t,
      );
      const disposal = Number(locked.disposal_type);
      if (disposal === 2) {
        const created = [];
        for (const line of details) {
          const no = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_SERVICE);
          const service = await t.hspsi_sale_order_service.create({
            data: {
              service_no: no,
              so_id: locked.so_id,
              customer_id: Number(order.customer_id),
              goods_id: Number(line.goods_id),
              sku_id: Number(line.sku_id),
              event_type: 4,
              event_content: `销售退货单 ${locked.so_exit_no} 转售后处理`,
              event_status: 1,
              handler_id: BigInt(u),
              event_date: new Date(),
              next_document_type: 'sales_return',
              next_document_id: locked.so_exit_id,
              next_document_no: locked.so_exit_no,
              remark: '销售退货返库后自动生成',
              created_by: BigInt(u),
              updated_by: BigInt(u),
            },
          });
          created.push(service.service_id);
        }
        await t.hspsi_sale_order.update({
          where: { so_id: locked.so_id },
          data: { service_status: 1 },
        });
        successor = { successorType: 'after_sales', successorIds: created };
      } else if (disposal === 3) {
        const existing = await t.hspsi_sale_order.findFirst({
          where: {
            business_source_type: 'sales_return',
            business_source_id: exitId,
            so_property_type: 2,
            deleted_at: null,
          },
        });
        if (existing) {
          await this.documentTrace.link(
            {
              upstreamType: 'sales_return',
              upstreamId: exitId,
              upstreamNo: locked.so_exit_no,
              downstreamType: 'discount_sale_order',
              downstreamId: existing.so_id,
              downstreamNo: existing.so_no,
              createdBy: u,
            },
            t,
          );
          successor = { successorType: 'discount_order', successorId: existing.so_id };
        } else {
          const goods = await t.hspsi_goods_info.findMany({
            where: { goods_id: { in: details.map((l) => l.goods_id) } },
          });
          const amount = details.reduce(
            (sum, line) =>
              sum +
              Number(line.exit_qty) *
                Number(goods.find((g) => g.goods_id === line.goods_id)?.sale_price ?? 0),
            0,
          );
          const no = await this.businessNumber.generate(BUSINESS_PREFIX.DISCOUNT_SALES_ORDER);
          const order2 = await t.hspsi_sale_order.create({
            data: {
              org_id: locked.org_id,
              warehouse_id: locked.warehouse_id,
              so_no: no,
              so_type: 1,
              so_source: 4,
              so_source_id: exitId,
              business_source_type: 'sales_return',
              business_source_id: exitId,
              business_source_no: locked.so_exit_no,
              so_property_type: 2,
              customer_id: order.customer_id,
              customer_name: order.customer_name,
              customer_mobile: order.customer_mobile,
              customer_address: order.customer_address,
              order_date: new Date(),
              sales_name: order.sales_name,
              sales_mobile: order.sales_mobile,
              so_qty: details.reduce((sum, line) => sum + Number(line.exit_qty), 0),
              so_amount: this.d(amount),
              fact_amount: this.d(amount),
              priceoff_amount: this.d(0),
              order_status: 1,
              delivery_status: 1,
              service_status: 3,
              status: 1,
              approve_status: 0,
              remark: `销售退货单 ${locked.so_exit_no} 返库后转折价销售`,
              created_by: BigInt(u),
              updated_by: BigInt(u),
            },
          });
          const grouped = new Map<string, B>();
          for (const line of details) {
            const key = `${line.goods_id}:${line.sku_id}`,
              current = grouped.get(key) ?? {
                goods_id: line.goods_id,
                sku_id: line.sku_id,
                unit_type: line.unit_type,
                quantity: 0,
              };
            current.quantity += Number(line.exit_qty);
            grouped.set(key, current);
          }
          await t.hspsi_sale_order_detail.createMany({
            data: [...grouped.values()].map((line) => {
              const price = Number(
                goods.find((g) => g.goods_id === line.goods_id)?.sale_price ?? 0,
              );
              return {
                so_id: order2.so_id,
                goods_id: line.goods_id,
                sku_id: line.sku_id,
                unit_type: line.unit_type,
                sale_qty: Number(line.quantity),
                sale_price: this.d(price),
                sale_amount: this.d(Number(line.quantity) * price),
                fact_sale_amount: this.d(Number(line.quantity) * price),
              };
            }),
          });
          await this.documentTrace.link(
            {
              upstreamType: 'sales_return',
              upstreamId: exitId,
              upstreamNo: locked.so_exit_no,
              downstreamType: 'discount_sale_order',
              downstreamId: order2.so_id,
              downstreamNo: no,
              createdBy: u,
            },
            t,
          );
          successor = { successorType: 'discount_order', successorId: order2.so_id };
        }
      } else if (disposal === 4) {
        const no = await this.businessNumber.generate(BUSINESS_PREFIX.INVENTORY_DAMAGE_OUTPUT);
        const loss = await t.hspsi_inventory_loss.create({
          data: {
            loss_no: no,
            business_kind: 2,
            loss_type: 1,
            loss_reson: `销售退货单 ${locked.so_exit_no} 返库后报废`,
            org_id: locked.org_id,
            warehouse_id: locked.warehouse_id,
            dept_id: locked.dept_id,
            loss_date: new Date(),
            source_check_id: 0n,
            loss_qty: details.reduce((sum, line) => sum + Number(line.exit_qty), 0),
            loss_total_amount: this.d(0),
            go_where: 0,
            status: 1,
            approve_status: 0,
            remark: `来源销售退货单 ${locked.so_exit_no}`,
            created_by: BigInt(u),
            updated_by: BigInt(u),
          },
        });
        await t.hspsi_inventory_loss_detail.createMany({
          data: details.map((line) => ({
            loss_id: loss.loss_id,
            goods_id: line.goods_id,
            sku_id: line.sku_id,
            batch_no: line.batch_no,
            unit_type: Number(line.unit_type),
            loss_qty: Number(line.exit_qty),
            loss_amount: this.d(0),
          })),
        });
        await this.documentTrace.link(
          {
            upstreamType: 'sales_return',
            upstreamId: exitId,
            upstreamNo: locked.so_exit_no,
            downstreamType: 'inventory_loss',
            downstreamId: loss.loss_id,
            downstreamNo: no,
            createdBy: u,
          },
          t,
        );
        successor = { successorType: 'inventory_loss', successorId: loss.loss_id };
      }
    });
    return { id, ...successor, message: '退货已先确认返库，后继业务已按处理方式生成' };
  }
  async undoReturn(id: string, comment: string, u: string) {
    const item = await this.returnOne(id);
    if (Number(item.disposal_type) !== 1)
      throw new BadRequestException('该退货已生成后继业务，不能撤销确认');
    await this.p.$transaction(async (t) => {
      const exitId = BigInt(id);
      await t.$queryRaw`SELECT so_exit_id FROM hspsi_sale_order_exit WHERE so_exit_id=${exitId} FOR UPDATE`;
      const locked = await t.hspsi_sale_order_exit.findUniqueOrThrow({
        where: { so_exit_id: exitId },
      });
      if (locked.comfirm_status !== 1) throw new BadRequestException('仅已确认销售退货可撤销');
      const exchangeRelations = await t.hspsi_business_document_relation.findMany({
        where: {
          upstream_type: 'sales_return',
          upstream_id: exitId,
          downstream_type: 'sales_output',
          deleted_at: null,
        },
        select: { downstream_id: true },
      });
      if (exchangeRelations.length) {
        const exchangeCount = await t.hspsi_sale_order_output.count({
          where: {
            so_output_id: { in: exchangeRelations.map((relation) => relation.downstream_id) },
            go_where: SALES_OUTPUT_DESTINATION.EXCHANGE,
            deleted_at: null,
          },
        });
        if (exchangeCount) throw new BadRequestException('该退货已经生成换货出库单，不能撤销确认');
      }
      await this.posting.post(
        {
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          direction: -1,
          operationType: 2,
          inventoryMode: INVENTORY_BUSINESS_MODE.SALES_RETURN,
          sourceId: item.id,
          sourceType: 'sales_return_undo',
          sourceNo: item.businessNo,
          operationBy: u,
          idempotencyKey: `sales-return:${id}:v${locked.posting_version}:undo`,
          remark: comment || '撤销销售退货',
          lines: item.details.map((line: B) => ({
            goodsId: line.goodsId,
            skuId: line.skuId,
            batchNo: line.batchNo,
            unitType: line.unitType,
            quantity: String(line.quantity),
          })),
        },
        t,
      );
      await t.hspsi_sale_order_exit.update({
        where: { so_exit_id: exitId },
        data: {
          comfirm_status: 0,
          comfirm_comment: comment,
          comfirm_by: BigInt(u),
          comfirm_date: new Date(),
          updated_by: BigInt(u),
        },
      });
    });
    return { id, message: '销售退货已撤销确认，返库库存已反向扣回' };
  }
  async payments(q: B, type: number) {
    const { page, pageSize } = this.pg(q),
      where: Prisma.hspsi_sales_order_paymentWhereInput = { so_pay_type: type, deleted_at: null };
    if (q.orderId) where.so_id = BigInt(q.orderId);
    if (q.paymentMode !== undefined && q.paymentMode !== '') where.pay_mode = Number(q.paymentMode);
    const [records, total] = await this.p.$transaction([
        this.p.hspsi_sales_order_payment.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { pay_id: 'desc' },
        }),
        this.p.hspsi_sales_order_payment.count({ where }),
      ]),
      orderIds = [...new Set(records.map((i) => String(i.so_id)))].map(BigInt),
      orders = orderIds.length
        ? await this.p.hspsi_sale_order.findMany({ where: { so_id: { in: orderIds } } })
        : [],
      allFlows = orderIds.length
        ? await this.p.hspsi_sales_order_payment.findMany({
            where: { so_id: { in: orderIds }, deleted_at: null },
          })
        : [],
      orderMap = new Map(orders.map((i) => [String(i.so_id), i]));
    const items = await this.refs.enrich(
      records.map((i) => {
        const order = orderMap.get(String(i.so_id)),
          flows = allFlows.filter((f) => f.so_id === i.so_id),
          received = flows
            .filter((f) => f.so_pay_type === 1)
            .reduce((s, f) => s + Number(f.fact_pay_amount), 0),
          refunded = flows
            .filter((f) => f.so_pay_type === 2)
            .reduce((s, f) => s + Number(f.fact_pay_amount), 0),
          actual = Number(order?.fact_amount ?? 0),
          netAmount = received - refunded;
        return {
          ...i,
          id: i.pay_id,
          paymentNo: i.pay_no,
          orderId: i.so_id,
          orderNo: order?.so_no ?? '',
          customerName: order?.customer_name ?? '',
          orderDate: order?.order_date,
          orderActualAmount: actual,
          receivedAmount: received,
          refundedAmount: refunded,
          netAmount,
          availableAmount: type === 1 ? Math.max(0, actual - netAmount) : Math.max(0, netAmount),
          amount: i.fact_pay_amount,
          paymentType: i.so_pay_type,
          paymentMode: i.pay_mode,
          paymentDate: i.pay_date,
          orgId: i.org_id,
          deptId: i.dept_id,
          createdBy: i.created_by,
          updatedBy: i.updated_by,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
          status: 1,
        };
      }),
      { paymentType: 'sales_payment_type', paymentMode: 'payment_channel' },
    );
    return {
      items,
      total,
      page,
      pageSize,
      summary: {
        periodAmount: items.reduce((s, i) => s + Number(i.amount), 0),
        receivedAmount: allFlows
          .filter((i) => i.so_pay_type === 1)
          .reduce((s, i) => s + Number(i.fact_pay_amount), 0),
        refundedAmount: allFlows
          .filter((i) => i.so_pay_type === 2)
          .reduce((s, i) => s + Number(i.fact_pay_amount), 0),
      },
    };
  }
  async paymentSummary(id: string) {
    const order = await this.p.hspsi_sale_order.findFirst({
      where: { so_id: BigInt(id), deleted_at: null },
    });
    if (!order) throw new NotFoundException('销售订单不存在');
    const flows = await this.p.hspsi_sales_order_payment.findMany({
        where: { so_id: order.so_id, deleted_at: null },
      }),
      received = flows
        .filter((i) => i.so_pay_type === 1)
        .reduce((s, i) => s + Number(i.fact_pay_amount), 0),
      refunded = flows
        .filter((i) => i.so_pay_type === 2)
        .reduce((s, i) => s + Number(i.fact_pay_amount), 0),
      actual = Number(order.fact_amount),
      netAmount = received - refunded;
    return {
      orderId: order.so_id,
      orderNo: order.so_no,
      customerId: order.customer_id,
      customerName: order.customer_name,
      customerMobile: order.customer_mobile,
      orderDate: order.order_date,
      orgId: order.org_id,
      orderAmount: order.so_amount,
      actualAmount: actual,
      receivedAmount: received,
      refundedAmount: refunded,
      netAmount,
      unreceivedAmount: Math.max(0, actual - netAmount),
      refundableAmount: Math.max(0, netAmount),
    };
  }
  async payment(id: string, type?: number) {
    const item = await this.p.hspsi_sales_order_payment.findFirst({
      where: { pay_id: BigInt(id), deleted_at: null, ...(type ? { so_pay_type: type } : {}) },
    });
    if (!item) throw new NotFoundException('资金流水不存在');
    const result = (
      await this.payments({ orderId: String(item.so_id), page: 1, pageSize: 100 }, item.so_pay_type)
    ).items.find((i) => String(i.id) === id);
    return result;
  }
  async createPayment(b: B, type: number, u: string) {
    if (type !== 1 && type !== 2) throw new BadRequestException('资金流水类型无效');
    const orderId = this.positiveId(b.orderId, '销售订单'),
      deptId = this.positiveId(b.deptId, '所属部门'),
      paymentMode = this.positiveInt(b.paymentMode, '收退款方式', 255),
      paymentDate = this.paymentDate(b.paymentDate),
      amount = this.money(b.amount),
      key = this.paymentRequestKey(b.requestKey),
      remark = String(b.remark ?? '').trim();
    if (type === 2 && !remark) throw new BadRequestException('退款原因必填');
    if (remark.length > 255)
      throw new BadRequestException(
        type === 2 ? '退款原因不能超过255个字符' : '备注不能超过255个字符',
      );
    try {
      return await this.p.$transaction(async (t) => {
        await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${orderId} FOR UPDATE`;
        const old = await t.hspsi_sales_order_payment.findUnique({ where: { request_key: key } });
        if (old) {
          if (
            old.so_id !== orderId ||
            old.so_pay_type !== type ||
            !old.fact_pay_amount.equals(amount)
          )
            throw new ConflictException('requestKey 已被其他收退款请求使用');
          const linkedOrder = await t.hspsi_sale_order.findUniqueOrThrow({
            where: { so_id: orderId },
          });
          await this.documentTrace.link(
            {
              upstreamType:
                linkedOrder.so_property_type === 2 ? 'discount_sale_order' : 'sales_order',
              upstreamId: linkedOrder.so_id,
              upstreamNo: linkedOrder.so_no,
              downstreamType: type === 1 ? 'sales_payment' : 'sales_refund',
              downstreamId: old.pay_id,
              downstreamNo: old.pay_no,
              relationKind: type === 1 ? 'payment' : 'refund',
              createdBy: u,
            },
            t,
          );
          return { id: old.pay_id, message: '请求已处理' };
        }
        const order = await t.hspsi_sale_order.findFirst({
          where: { so_id: orderId, deleted_at: null },
        });
        if (!order) throw new NotFoundException('销售订单不存在');
        if (order.approve_status !== 1)
          throw new BadRequestException('仅审批通过的销售订单可收退款');
        if (type === 1 && order.so_property_type === 2) {
          if (order.delivery_status !== 3)
            throw new BadRequestException('折价销售单必须先确认销售并完成出库，才能登记收款');
          const confirmedOutput = await t.hspsi_sale_order_output.count({
            where: {
              so_id: order.so_id,
              go_where: SALES_OUTPUT_DESTINATION.DISCOUNT,
              comfirm_status: 1,
              deleted_at: null,
            },
          });
          if (!confirmedOutput)
            throw new BadRequestException('折价销售单缺少已确认的折价销售出库记录，不能登记收款');
        }
        const dept = await t.hspsi_basic_dept.findFirst({
          where: { dept_id: deptId, org_id: order.org_id, deleted_at: null },
          select: { dept_id: true },
        });
        if (!dept) throw new BadRequestException('所属部门不存在或不属于订单组织');
        const paymentCategory = await t.hspsi_sys_dictionary_category.findFirst({
          where: { dict_catg_code: 'payment_channel', deleted_at: null },
          select: { dict_catg_id: true },
        });
        const channel = paymentCategory
          ? await t.hspsi_sys_dictionary.findFirst({
              where: {
                dict_catg_id: paymentCategory.dict_catg_id,
                dict_value: String(paymentMode),
                deleted_at: null,
              },
              select: { dict_id: true },
            })
          : null;
        if (!channel) throw new BadRequestException('收退款方式无效');
        const flows = await t.hspsi_sales_order_payment.findMany({
            where: { so_id: order.so_id, deleted_at: null },
            select: { so_pay_type: true, fact_pay_amount: true },
          }),
          { received, refunded } = this.paymentTotals(flows);
        if (type === 1 && received.minus(refunded).plus(amount).greaterThan(order.fact_amount))
          throw new BadRequestException('当前净收款加本次收款不能超过订单实际金额');
        if (type === 2 && refunded.plus(amount).greaterThan(received))
          throw new BadRequestException('累计退款不能超过累计收款');
        const businessNo = await this.businessNumber.generate(
          type === 1 ? BUSINESS_PREFIX.SALES_RECEIPT : BUSINESS_PREFIX.SALES_REFUND,
        );
        const h = await t.hspsi_sales_order_payment.create({
          data: {
            org_id: order.org_id,
            dept_id: deptId,
            pay_no: businessNo,
            so_id: order.so_id,
            so_pay_type: type,
            pay_mode: paymentMode,
            fact_pay_amount: amount,
            pay_date: paymentDate,
            request_key: key,
            remark,
            created_by: BigInt(u),
            updated_by: BigInt(u),
          },
        });
        await this.documentTrace.link(
          {
            upstreamType: order.so_property_type === 2 ? 'discount_sale_order' : 'sales_order',
            upstreamId: order.so_id,
            upstreamNo: order.so_no,
            downstreamType: type === 1 ? 'sales_payment' : 'sales_refund',
            downstreamId: h.pay_id,
            downstreamNo: businessNo,
            relationKind: type === 1 ? 'payment' : 'refund',
            createdBy: u,
          },
          t,
        );
        await this.refreshOrderLifecycle(t, order.so_id);
        return { id: h.pay_id, message: type === 1 ? '收款成功' : '退款成功' };
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const old = await this.p.hspsi_sales_order_payment.findUnique({
          where: { request_key: key },
        });
        if (old) {
          if (
            old.so_id !== orderId ||
            old.so_pay_type !== type ||
            !old.fact_pay_amount.equals(amount)
          )
            throw new ConflictException('requestKey 已被其他收退款请求使用');
          return { id: old.pay_id, message: '请求已处理' };
        }
      }
      throw error;
    }
  }
  async voidPayment(id: string, type: number, u: string) {
    if (type !== 1 && type !== 2) throw new BadRequestException('资金流水类型无效');
    const payId = this.positiveId(id, '资金流水');
    const initial = await this.p.hspsi_sales_order_payment.findFirst({
      where: { pay_id: payId, so_pay_type: type, deleted_at: null },
      select: { so_id: true },
    });
    if (!initial) throw new NotFoundException('资金流水不存在');
    return this.p.$transaction(async (t) => {
      await t.$queryRaw`SELECT so_id FROM hspsi_sale_order WHERE so_id=${initial.so_id} FOR UPDATE`;
      const item = await t.hspsi_sales_order_payment.findFirst({
        where: { pay_id: payId, so_pay_type: type, deleted_at: null },
      });
      if (!item) throw new NotFoundException('资金流水不存在');
      const flows = await t.hspsi_sales_order_payment.findMany({
          where: { so_id: item.so_id, deleted_at: null },
          select: { so_pay_type: true, fact_pay_amount: true },
        }),
        { received, refunded } = this.paymentTotals(flows);
      if (type === 1 && received.minus(item.fact_pay_amount).lessThan(refunded))
        throw new BadRequestException('该收款已有对应退款，不能作废');
      await t.hspsi_sales_order_payment.update({
        where: { pay_id: item.pay_id },
        data: { deleted_at: new Date(), updated_by: BigInt(u), updated_at: new Date() },
      });
      await this.documentTrace.removeForDocument(
        type === 1 ? 'sales_payment' : 'sales_refund',
        item.pay_id,
        t,
      );
      await this.refreshOrderLifecycle(t, item.so_id);
      return { id, message: '已作废' };
    });
  }
  async services(q: B) {
    const { page, pageSize } = this.pg(q),
      where: Prisma.hspsi_sale_order_serviceWhereInput = { deleted_at: null };
    if (q.status !== undefined && q.status !== '') where.event_status = Number(q.status);
    const [records, total] = await this.p.$transaction([
        this.p.hspsi_sale_order_service.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { service_id: 'desc' },
        }),
        this.p.hspsi_sale_order_service.count({ where }),
      ]),
      orders = records.length
        ? await this.p.hspsi_sale_order.findMany({
            where: { so_id: { in: records.map((i) => i.so_id) } },
          })
        : [],
      orderMap = new Map(orders.map((i) => [String(i.so_id), i]));
    const items = await this.refs.enrich(
      records.map((i) => {
        const order = orderMap.get(String(i.so_id));
        return {
          ...i,
          id: i.service_id,
          serviceNo: i.service_no,
          orderId: i.so_id,
          orderNo: order?.so_no ?? '',
          customerName: order?.customer_name ?? '',
          goodsId: BigInt(i.goods_id),
          skuId: BigInt(i.sku_id),
          eventType: i.event_type,
          eventContent: i.event_content,
          eventStatus: i.event_status,
          handlerId: i.handler_id,
          successorType: i.next_document_type,
          successorId: i.next_document_id,
          eventDate: i.event_date,
          createdBy: i.created_by,
          updatedBy: i.updated_by,
          createdAt: i.created_at,
          updatedAt: i.updated_at,
        };
      }),
      { eventType: 'after_sale_event_type', eventStatus: 'after_sale_event_status' },
    );
    return { items, total, page, pageSize };
  }
  async serviceSourceOptions(q: B) {
    const orderId = this.positiveId(q.orderId, '销售订单'),
      goodsId = this.positiveId(q.goodsId, '售后商品'),
      skuId = this.positiveId(q.skuId, '售后SKU');
    const excludeServiceId = q.excludeServiceId
      ? this.positiveId(q.excludeServiceId, '售后记录')
      : 0n;
    const outputs = await this.p.hspsi_sale_order_output.findMany({
      where: { so_id: orderId, comfirm_status: 1, deleted_at: null },
      orderBy: { so_output_id: 'desc' },
    });
    if (!outputs.length) return [];
    const outputIds = outputs.map((item) => item.so_output_id);
    const [outputDetails, returnHeads, activeServices] = await Promise.all([
      this.p.hspsi_sale_order_output_detail.findMany({
        where: { so_output_id: { in: outputIds }, goods_id: goodsId, sku_id: skuId },
      }),
      this.p.hspsi_sale_order_exit.findMany({
        where: { source_output_id: { in: outputIds }, comfirm_status: 1, deleted_at: null },
        select: { so_exit_id: true, source_output_id: true },
      }),
      this.p.hspsi_sale_order_service.findMany({
        where: {
          so_id: orderId,
          event_status: 1,
          deleted_at: null,
          ...(excludeServiceId ? { service_id: { not: excludeServiceId } } : {}),
        },
        select: { service_id: true },
      }),
    ]);
    const [returnDetails, reservedDetails] = await Promise.all([
      returnHeads.length
        ? this.p.hspsi_sale_order_exit_detail.findMany({
            where: {
              so_exit_id: { in: returnHeads.map((item) => item.so_exit_id) },
              goods_id: goodsId,
              sku_id: skuId,
            },
          })
        : [],
      activeServices.length
        ? this.p.hspsi_sale_order_service_detail.findMany({
            where: {
              service_id: { in: activeServices.map((item) => item.service_id) },
              goods_id: goodsId,
              sku_id: skuId,
            },
          })
        : [],
    ]);
    const returnOutput = new Map(
        returnHeads.map((item) => [String(item.so_exit_id), item.source_output_id]),
      ),
      returned = new Map<string, number>(),
      reserved = new Map<string, number>();
    for (const line of returnDetails) {
      const sourceOutputId = returnOutput.get(String(line.so_exit_id));
      if (!sourceOutputId) continue;
      const key = `${sourceOutputId}:${line.batch_no}`;
      returned.set(key, (returned.get(key) ?? 0) + Number(line.exit_qty));
    }
    for (const line of reservedDetails) {
      const key = `${line.source_output_id}:${line.batch_no}`;
      reserved.set(key, (reserved.get(key) ?? 0) + Number(line.service_qty));
    }
    return outputs
      .map((output) => {
        const grouped = new Map<string, B>();
        for (const line of outputDetails.filter(
          (item) => item.so_output_id === output.so_output_id,
        )) {
          const old = grouped.get(line.batch_no);
          grouped.set(line.batch_no, {
            sourceOutputId: output.so_output_id,
            goodsId: line.goods_id,
            skuId: line.sku_id,
            batchNo: line.batch_no,
            unitType: line.unit_type,
            sourceQuantity: Number(old?.sourceQuantity ?? 0) + Number(line.output_qty),
          });
        }
        const details = [...grouped.values()]
          .map((line) => {
            const key = `${output.so_output_id}:${line.batchNo}`;
            return {
              ...line,
              remainingQuantity: Math.max(
                0,
                Number(line.sourceQuantity) - (returned.get(key) ?? 0) - (reserved.get(key) ?? 0),
              ),
            };
          })
          .filter((line) => line.remainingQuantity > 0.000001);
        return {
          id: output.so_output_id,
          outputNo: output.so_output_no,
          warehouseId: output.warehouse_id,
          outputDate: output.output_date,
          details,
        };
      })
      .filter((output) => output.details.length);
  }
  async service(id: string) {
    const result = (await this.services({ page: 1, pageSize: 100 })).items.find(
      (i) => String(i.id) === id,
    );
    if (!result) throw new NotFoundException('售后记录不存在');
    const [order, details] = await Promise.all([
      this.order(String(result.orderId)),
      this.p.hspsi_sale_order_service_detail.findMany({
        where: { service_id: BigInt(id) },
        orderBy: { id: 'asc' },
      }),
    ]);
    const sourceOutputIds = [...new Set(details.map((item) => String(item.source_output_id)))].map(
        BigInt,
      ),
      outputs = sourceOutputIds.length
        ? await this.p.hspsi_sale_order_output.findMany({
            where: { so_output_id: { in: sourceOutputIds } },
          })
        : [];
    const sourceDetails = sourceOutputIds.length
      ? await this.p.hspsi_sale_order_output_detail.findMany({
          where: { so_output_id: { in: sourceOutputIds } },
        })
      : [];
    return {
      ...result,
      order,
      orderDate: order.orderDate,
      orderAmount: order.fact_amount,
      orderGoodsIds: order.details.map((line: B) => line.goodsId),
      sourceOutputId: details[0]?.source_output_id ?? 0n,
      details: details.map((line) => ({
        id: line.id,
        sourceOutputId: line.source_output_id,
        sourceOutputNo:
          outputs.find((output) => output.so_output_id === line.source_output_id)?.so_output_no ??
          '',
        goodsId: line.goods_id,
        skuId: line.sku_id,
        batchNo: line.batch_no,
        unitType: line.unit_type,
        sourceQuantity: sourceDetails
          .filter(
            (source) =>
              source.so_output_id === line.source_output_id &&
              source.goods_id === line.goods_id &&
              source.sku_id === line.sku_id &&
              source.batch_no === line.batch_no,
          )
          .reduce((sum, source) => sum + Number(source.output_qty), 0),
        remainingQty: line.service_qty,
        quantity: line.service_qty,
        remark: line.remark,
      })),
    };
  }
  async saveService(id: string | null, b: B, u: string) {
    const orderId = this.positiveId(b.orderId, '销售订单'),
      goodsId = this.positiveId(b.goodsId, '售后商品'),
      skuId = this.positiveId(b.skuId, '售后SKU');
    return this.p.$transaction(async (t) => {
      const order = await t.hspsi_sale_order.findFirst({
        where: { so_id: orderId, deleted_at: null },
      });
      if (!order) throw new NotFoundException('销售订单不存在');
      const orderLine = await t.hspsi_sale_order_detail.findFirst({
        where: { so_id: orderId, goods_id: goodsId, sku_id: skuId },
      });
      if (!orderLine) throw new BadRequestException('售后商品和SKU必须属于所选销售订单');
      const eventType = Number(b.eventType),
        eventContent = String(b.eventContent ?? '').trim();
      await this.assertDictionaryValue(t, 'after_sale_event_type', eventType, '售后事件类型');
      if (!eventContent) throw new BadRequestException('售后事件内容必填');
      const requiresGoodsReturn = [4, 5].includes(eventType),
        serviceLines = (Array.isArray(b.details) ? b.details : []).filter(
          (line: B) => Number(line.quantity) > 0,
        );
      if (requiresGoodsReturn && !serviceLines.length)
        throw new BadRequestException(
          eventType === 4
            ? '退货售后必须填写来源出库批次和本次退货数量'
            : '换货售后必须填写来源出库批次和本次换货数量',
        );
      let existing: null | Awaited<ReturnType<typeof t.hspsi_sale_order_service.findFirst>> = null;
      if (id) {
        existing = await t.hspsi_sale_order_service.findFirst({
          where: { service_id: BigInt(id), deleted_at: null },
        });
        if (!existing) throw new NotFoundException('售后记录不存在');
        if (existing.event_status !== 1)
          throw new BadRequestException('仅进行中的售后记录可以编辑');
        if (existing.so_id !== orderId)
          throw new BadRequestException('售后记录创建后不可更换销售订单');
        if (existing.next_document_id > 0n)
          throw new BadRequestException('售后记录已经生成后继单据，不能编辑');
      }
      if (requiresGoodsReturn) {
        const sourceOutputIds = [
          ...new Set(serviceLines.map((line: B) => String(line.sourceOutputId ?? ''))),
        ];
        if (sourceOutputIds.length !== 1 || !sourceOutputIds[0])
          throw new BadRequestException('一次售后退换货必须关联同一张来源销售出库单');
        const sourceOutputId = this.positiveId(sourceOutputIds[0], '来源销售出库单');
        await t.$queryRaw`SELECT so_output_id FROM hspsi_sale_order_output WHERE so_output_id=${sourceOutputId} FOR UPDATE`;
        await t.$queryRaw`SELECT id FROM hspsi_sale_order_output_detail WHERE so_output_id=${sourceOutputId} FOR UPDATE`;
        const sourceOutput = await t.hspsi_sale_order_output.findFirst({
          where: {
            so_output_id: sourceOutputId,
            so_id: orderId,
            comfirm_status: 1,
            deleted_at: null,
          },
        });
        if (!sourceOutput)
          throw new BadRequestException('来源销售出库单不存在、未确认或不属于当前销售订单');
        const sourceDetails = await t.hspsi_sale_order_output_detail.findMany({
          where: { so_output_id: sourceOutputId, goods_id: goodsId, sku_id: skuId },
        });
        const returnHeads = await t.hspsi_sale_order_exit.findMany({
          where: { source_output_id: sourceOutputId, comfirm_status: 1, deleted_at: null },
          select: { so_exit_id: true },
        });
        const returned = returnHeads.length
          ? await t.hspsi_sale_order_exit_detail.findMany({
              where: {
                so_exit_id: { in: returnHeads.map((item) => item.so_exit_id) },
                goods_id: goodsId,
                sku_id: skuId,
              },
            })
          : [];
        const activeServices = await t.hspsi_sale_order_service.findMany({
          where: {
            so_id: orderId,
            event_status: 1,
            deleted_at: null,
            ...(existing ? { service_id: { not: existing.service_id } } : {}),
          },
          select: { service_id: true },
        });
        const reserved = activeServices.length
          ? await t.hspsi_sale_order_service_detail.findMany({
              where: {
                service_id: { in: activeServices.map((item) => item.service_id) },
                source_output_id: sourceOutputId,
                goods_id: goodsId,
                sku_id: skuId,
              },
            })
          : [];
        const sourceQty = new Map<string, number>(),
          returnedQty = new Map<string, number>(),
          reservedQty = new Map<string, number>(),
          currentQty = new Map<string, number>();
        for (const line of sourceDetails)
          sourceQty.set(
            line.batch_no,
            (sourceQty.get(line.batch_no) ?? 0) + Number(line.output_qty),
          );
        for (const line of returned)
          returnedQty.set(
            line.batch_no,
            (returnedQty.get(line.batch_no) ?? 0) + Number(line.exit_qty),
          );
        for (const line of reserved)
          reservedQty.set(
            line.batch_no,
            (reservedQty.get(line.batch_no) ?? 0) + Number(line.service_qty),
          );
        for (const line of serviceLines) {
          if (String(line.goodsId) !== String(goodsId) || String(line.skuId) !== String(skuId))
            throw new BadRequestException('售后批次明细必须与所选售后商品和SKU一致');
          const batchNo = String(line.batchNo ?? '').trim(),
            quantity = Number(line.quantity);
          if (!batchNo || !Number.isSafeInteger(quantity) || quantity <= 0)
            throw new BadRequestException('售后批号必填且本次数量必须为正整数');
          if (currentQty.has(batchNo))
            throw new BadRequestException(`批号 ${batchNo} 不允许重复录入售后明细`);
          currentQty.set(batchNo, quantity);
        }
        for (const [batchNo, quantity] of currentQty) {
          const available =
            (sourceQty.get(batchNo) ?? 0) -
            (returnedQty.get(batchNo) ?? 0) -
            (reservedQty.get(batchNo) ?? 0);
          if (available <= 0 || quantity > available + 0.000001)
            throw new BadRequestException(
              `批号 ${batchNo} 的本次售后数量超过来源出库剩余可退换数量`,
            );
        }
      }
      const data = {
        so_id: orderId,
        customer_id: Number(order.customer_id),
        goods_id: Number(goodsId),
        sku_id: Number(skuId),
        event_type: eventType,
        event_content: eventContent,
        event_status: 1,
        handler_id: BigInt(b.handlerId ?? u),
        event_date: new Date(b.eventDate ?? Date.now()),
        remark: String(b.remark ?? ''),
        updated_by: BigInt(u),
      };
      const newServiceNo = existing
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.SALES_SERVICE);
      const h = existing
        ? await t.hspsi_sale_order_service.update({
            where: { service_id: existing.service_id },
            data,
          })
        : await t.hspsi_sale_order_service.create({
            data: { ...data, service_no: newServiceNo, created_by: BigInt(u) },
          });
      await t.hspsi_sale_order_service_detail.deleteMany({ where: { service_id: h.service_id } });
      if (requiresGoodsReturn)
        await t.hspsi_sale_order_service_detail.createMany({
          data: serviceLines.map((line: B) => ({
            service_id: h.service_id,
            source_output_id: BigInt(line.sourceOutputId),
            goods_id: goodsId,
            sku_id: skuId,
            batch_no: String(line.batchNo).trim(),
            unit_type: Number(line.unitType),
            service_qty: Number(line.quantity),
            remark: String(line.remark ?? ''),
          })),
        });
      await this.refreshOrderServiceStatus(t, orderId);
      return { id: h.service_id, message: '售后记录已保存' };
    });
  }
  async deleteService(id: string, u: string) {
    const serviceId = BigInt(id);
    return this.p.$transaction(async (t) => {
      const item = await t.hspsi_sale_order_service.findFirst({
        where: { service_id: serviceId, deleted_at: null },
      });
      if (!item) throw new NotFoundException('售后记录不存在');
      if (item.event_status === 2) throw new BadRequestException('已完成售后不可删除');
      if (item.next_document_id > 0n)
        throw new BadRequestException('售后记录已经生成后继单据，不能删除');
      await t.hspsi_sale_order_service.update({
        where: { service_id: item.service_id },
        data: { deleted_at: new Date(), updated_by: BigInt(u) },
      });
      await this.refreshOrderServiceStatus(t, item.so_id);
      return { id, message: '删除成功' };
    });
  }
  async processService(id: string, u: string) {
    const serviceId = BigInt(id);
    return this.guardedTransaction(async (t) => {
      await t.$queryRaw`SELECT service_id FROM hspsi_sale_order_service WHERE service_id=${serviceId} FOR UPDATE`;
      const service = await t.hspsi_sale_order_service.findFirst({
        where: { service_id: serviceId, deleted_at: null },
      });
      if (!service || service.event_status !== 1)
        throw new BadRequestException('仅进行中的售后可处理');
      if (
        service.event_type === 4 &&
        service.next_document_type === 'sales_return' &&
        service.next_document_id > 0n
      ) {
        await t.hspsi_sale_order_service.update({
          where: { service_id: service.service_id },
          data: { event_status: 2, updated_by: BigInt(u) },
        });
        await this.refreshOrderServiceStatus(t, service.so_id);
        return {
          id,
          returnId: service.next_document_id,
          message: '退货返库后的售后事项已处理完成',
        };
      }
      if (
        service.event_type === 5 &&
        service.next_document_type === 'sales_exchange_output' &&
        service.next_document_id > 0n
      ) {
        return {
          id,
          outputId: service.next_document_id,
          message: '换货出库单已经生成，请在销售出库单中继续办理',
        };
      }

      const order = await t.hspsi_sale_order.findFirst({
        where: { so_id: service.so_id, deleted_at: null },
      });
      if (!order) throw new NotFoundException('销售订单不存在');
      if (![4, 5].includes(service.event_type)) {
        await t.hspsi_sale_order_service.update({
          where: { service_id: service.service_id },
          data: { event_status: 2, updated_by: BigInt(u) },
        });
        await this.refreshOrderServiceStatus(t, service.so_id);
        return { id, message: '售后事项已处理完成' };
      }
      const requested = await t.hspsi_sale_order_service_detail.findMany({
        where: { service_id: service.service_id },
        orderBy: { id: 'asc' },
      });
      if (!requested.length)
        throw new BadRequestException(
          '当前售后记录没有来源出库批次和本次处理数量，请先编辑补充后再办理',
        );
      const sourceOutputIds = [...new Set(requested.map((line) => String(line.source_output_id)))];
      if (sourceOutputIds.length !== 1)
        throw new BadRequestException('一次售后退换货必须关联同一张来源销售出库单');
      const sourceOutputId = BigInt(sourceOutputIds[0]!);
      await t.$queryRaw`SELECT so_output_id FROM hspsi_sale_order_output WHERE so_output_id=${sourceOutputId} FOR UPDATE`;
      await t.$queryRaw`SELECT id FROM hspsi_sale_order_output_detail WHERE so_output_id=${sourceOutputId} FOR UPDATE`;
      const sourceHead = await t.hspsi_sale_order_output.findFirst({
        where: {
          so_output_id: sourceOutputId,
          so_id: service.so_id,
          comfirm_status: 1,
          deleted_at: null,
        },
      });
      if (!sourceHead)
        throw new BadRequestException('售后来源销售出库单不存在、已撤销或不属于当前订单');
      const sourceDetails = await t.hspsi_sale_order_output_detail.findMany({
        where: {
          so_output_id: sourceOutputId,
          goods_id: BigInt(service.goods_id),
          sku_id: BigInt(service.sku_id),
        },
      });
      const returnHeads = await t.hspsi_sale_order_exit.findMany({
        where: { source_output_id: sourceOutputId, comfirm_status: 1, deleted_at: null },
        select: { so_exit_id: true },
      });
      const returned = returnHeads.length
        ? await t.hspsi_sale_order_exit_detail.findMany({
            where: {
              so_exit_id: { in: returnHeads.map((head) => head.so_exit_id) },
              goods_id: BigInt(service.goods_id),
              sku_id: BigInt(service.sku_id),
            },
          })
        : [];
      const sourceQty = new Map<string, number>(),
        returnedQty = new Map<string, number>();
      for (const line of sourceDetails)
        sourceQty.set(line.batch_no, (sourceQty.get(line.batch_no) ?? 0) + Number(line.output_qty));
      for (const line of returned)
        returnedQty.set(
          line.batch_no,
          (returnedQty.get(line.batch_no) ?? 0) + Number(line.exit_qty),
        );
      const returnLines = requested.map((line) => ({
        goodsId: line.goods_id,
        skuId: line.sku_id,
        batchNo: line.batch_no,
        unitType: line.unit_type,
        sourceQty: sourceQty.get(line.batch_no) ?? 0,
        quantity: Number(line.service_qty),
      }));
      for (const line of returnLines) {
        const available = line.sourceQty - (returnedQty.get(line.batchNo) ?? 0);
        if (line.quantity <= 0 || line.quantity > available + 0.000001)
          throw new BadRequestException(
            `批号 ${line.batchNo} 的售后数量超过来源出库剩余可退换数量`,
          );
      }

      const quantity = returnLines.reduce((sum, line) => sum + line.quantity, 0);
      const no = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_RETURN);
      const exit = await t.hspsi_sale_order_exit.create({
        data: {
          so_exit_no: no,
          so_id: order.so_id,
          source_output_id: sourceHead.so_output_id,
          exit_reson: `售后事件 ${id} 自动退货`,
          exit_qty: quantity,
          disposal_type: 1,
          org_id: order.org_id,
          warehouse_id: sourceHead.warehouse_id,
          dept_id: sourceHead.dept_id,
          receiver_id: BigInt(u),
          customer_id: order.customer_id,
          customer_name: order.customer_name,
          customer_mobile: order.customer_mobile,
          customer_address: order.customer_address,
          sales_name: order.sales_name,
          sales_mobile: order.sales_mobile,
          status: true,
          comfirm_status: 0,
          comfirm_comment: '',
          comfirm_by: 0n,
          remark: '售后自动处理',
          created_by: BigInt(u),
          updated_by: BigInt(u),
        },
      });
      await t.hspsi_sale_order_exit_detail.createMany({
        data: returnLines.map((line) => ({
          so_exit_id: exit.so_exit_id,
          so_id: order.so_id,
          goods_id: line.goodsId,
          sku_id: line.skuId,
          batch_no: line.batchNo,
          unit_type: line.unitType,
          so_qty: Number(line.sourceQty),
          exit_qty: Number(line.quantity),
          remark: '售后自动退货',
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: order.so_property_type === 2 ? 'discount_sale_output' : 'sales_output',
          upstreamId: sourceHead.so_output_id,
          upstreamNo: sourceHead.so_output_no,
          downstreamType: 'sales_return',
          downstreamId: exit.so_exit_id,
          downstreamNo: no,
          createdBy: u,
        },
        t,
      );
      await this.posting.post(
        {
          orgId: order.org_id,
          warehouseId: sourceHead.warehouse_id,
          direction: 1,
          operationType: 1,
          inventoryMode: INVENTORY_BUSINESS_MODE.SALES_RETURN,
          sourceId: exit.so_exit_id,
          sourceType: 'sales_return',
          sourceNo: no,
          operationBy: u,
          idempotencyKey: `after-sales:${id}:return`,
          remark: '售后自动退货返库',
          lines: returnLines.map((line) => ({
            goodsId: line.goodsId,
            skuId: line.skuId,
            batchNo: line.batchNo,
            unitType: line.unitType,
            quantity: String(line.quantity),
          })),
        },
        t,
      );
      await t.hspsi_sale_order_exit.update({
        where: { so_exit_id: exit.so_exit_id },
        data: {
          comfirm_status: 1,
          comfirm_comment: '售后自动确认',
          comfirm_by: BigInt(u),
          comfirm_date: new Date(),
          posting_version: 1,
        },
      });
      if (service.event_type === 5) {
        const exchangeNo = await this.businessNumber.generate(
          BUSINESS_PREFIX.SALES_EXCHANGE_OUTPUT,
        );
        const exchange = await t.hspsi_sale_order_output.create({
          data: {
            so_output_no: exchangeNo,
            so_id: order.so_id,
            org_id: order.org_id,
            warehouse_id: sourceHead.warehouse_id,
            output_date: new Date(),
            go_where: SALES_OUTPUT_DESTINATION.EXCHANGE,
            dept_id: sourceHead.dept_id,
            receiver_id: BigInt(u),
            output_sku_qty: new Set(returnLines.map((line) => `${line.goodsId}:${line.skuId}`))
              .size,
            status: true,
            comfirm_status: 0,
            comfirm_comment: '',
            comfirm_by: 0n,
            posting_version: 0,
            remark: `售后换货 ${service.service_no}；来源退货 ${no}`,
            created_by: BigInt(u),
            updated_by: BigInt(u),
          },
        });
        await t.hspsi_sale_order_output_detail.createMany({
          data: returnLines.map((line) => ({
            so_output_id: exchange.so_output_id,
            so_id: order.so_id,
            goods_id: line.goodsId,
            sku_id: line.skuId,
            batch_no: line.batchNo,
            unit_type: line.unitType,
            sale_qty: Number(line.quantity),
            output_qty: Number(line.quantity),
          })),
        });
        await this.documentTrace.link(
          {
            upstreamType: 'sales_return',
            upstreamId: exit.so_exit_id,
            upstreamNo: no,
            downstreamType: 'sales_output',
            downstreamId: exchange.so_output_id,
            downstreamNo: exchangeNo,
            relationKind: 'exchange',
            createdBy: u,
          },
          t,
        );
        await t.hspsi_sale_order_service.update({
          where: { service_id: service.service_id },
          data: {
            next_document_type: 'sales_exchange_output',
            next_document_id: exchange.so_output_id,
            next_document_no: exchangeNo,
            updated_by: BigInt(u),
          },
        });
        await this.refreshOrderServiceStatus(t, service.so_id);
        return {
          id,
          returnId: exit.so_exit_id,
          outputId: exchange.so_output_id,
          message: `换货退回已确认，待在销售出库单 ${exchangeNo} 选择批号并确认换货出库`,
        };
      }
      await t.hspsi_sale_order_service.update({
        where: { service_id: service.service_id },
        data: {
          event_status: 2,
          next_document_type: 'sales_return',
          next_document_id: exit.so_exit_id,
          next_document_no: no,
          updated_by: BigInt(u),
        },
      });
      await this.refreshOrderServiceStatus(t, service.so_id);
      return { id, returnId: exit.so_exit_id, message: '售后已自动生成并确认退货返库' };
    });
  }
}
