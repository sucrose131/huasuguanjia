import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BUSINESS_PREFIX } from '../../../business-number/business-number.constants';
import { BusinessNumberService } from '../../../business-number/business-number.service';
import { PrismaService } from '../../../database/prisma.service';
import { INVENTORY_BUSINESS_MODE } from '../../../inventory/inventory-dictionary';
import {
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_DATA_SOURCE_NAME,
  HUASU_HOME_GOODS_CATEGORY_ID,
  HUASU_HOME_INSTALLMENT_DEFAULT_PAY_MODE,
  HUASU_HOME_INSTALLMENT_STATUS,
  HUASU_HOME_INSTALLMENT_SYNCABLE_STATUSES,
  HUASU_HOME_MAPPING_STATUS,
  HUASU_HOME_ORDER_SYNC_DEFAULT_PAGE_SIZE,
  HUASU_HOME_ORDER_SYNC_MAX_PAGES,
  HUASU_HOME_ORDER_SYNC_MAX_PAGE_SIZE,
  HUASU_HOME_ORDER_SYNC_STATUS,
  HUASU_HOME_ORDER_TYPE,
  HUASU_HOME_PAY_MODE_MAP,
  HUASU_HOME_SOURCE_TYPE,
} from '../huasu-home.constants';
import { HuasuHomeService } from '../huasu-home.service';
import type {
  HuasuHomeInstallmentAftersale,
  HuasuHomeInstallmentOrder,
  HuasuHomeInstallmentPeriod,
  HuasuHomeInstallmentProduct,
} from '../huasu-home.types';
import { ExternalInventoryPostingService } from '../../common/external-inventory-posting.service';
import { buildCustomerLevels } from './build-customer-levels';
import {
  ensureSyncedSaleOrderServiceDetail,
  hasIncompleteAfterSalesService,
} from '../../common/sync-sale-order-service-detail';
import type { HuasuHomeOrderSyncOptions, HuasuHomeOrderSyncStats } from './order-sync.types';

type Tx = Prisma.TransactionClient;

type ResolvedOrderLine = {
  goodsId: bigint;
  skuId: bigint;
  unitType: number;
  quantity: number;
  price: number;
  amount: number;
  goodsType: number;
  sourceProductId: number;
};

type ShipLine = {
  goodsId: bigint;
  skuId: bigint;
  unitType: number;
  quantity: number;
  batchNo: string;
};

/**
 * 华溯之家分期订单同步
 *
 * 一笔分期订单（OI）对应一张销售单；同一销售单上按期次补收款、按 rights_issue 发放单品出库。
   * 售后来自 aftersale（hszj_order_installment_aftersale）：按 product_id + number 回库；
   * 无已确认出库则只记事件、不加库存。无退款金额则不写退款。
 */
@Injectable()
export class HuasuHomeInstallmentOrderSyncService {
  private static readonly logger = new Logger(HuasuHomeInstallmentOrderSyncService.name);

  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HuasuHomeService) private readonly huasuHome: HuasuHomeService,
    @Inject(BusinessNumberService) private readonly businessNumber: BusinessNumberService,
    @Inject(ExternalInventoryPostingService)
    private readonly externalPosting: ExternalInventoryPostingService,
  ) {}

  async syncInstallmentOrders(
    userId = '0',
    options: HuasuHomeOrderSyncOptions = {},
  ): Promise<HuasuHomeOrderSyncStats> {
    return this.withSyncLock(async () => {
      const stats = this.emptyStats();
      const sourceId = await this.ensureDataSource(userId);
      const updatedAt =
        options.updated_at?.trim() || (await this.resolveListUpdatedAt(sourceId));
      const pageSize = this.normalizePageSize(options.page_size);

      let page = 1;
      let guard = 0;
      let total = 0;
      while (guard < HUASU_HOME_ORDER_SYNC_MAX_PAGES) {
        guard += 1;
        const data = await this.huasuHome.getInstallmentOrderList({
          page,
          page_size: pageSize,
          updated_at: updatedAt,
        });
        const list = data.list ?? [];
        total = Number(data.total) || 0;
        if (list.length === 0) break;

        for (const order of list) {
          stats.fetched += 1;
          await this.applyOrderSafe(order, sourceId, userId, stats);
        }

        if (!this.hasMoreOrderPages(page, pageSize, list.length, data.total)) break;
        page += 1;
      }

      HuasuHomeInstallmentOrderSyncService.logger.log(
        `[huasu-home] installment order sync done: ${JSON.stringify({
          updatedAt,
          pageSize,
          pages: guard,
          total,
          ...stats,
          failures: stats.failures.length,
          warnings: stats.warnings.length,
        })}`,
      );
      return stats;
    });
  }

  private async applyOrderSafe(
    order: HuasuHomeInstallmentOrder,
    sourceId: bigint,
    userId: string,
    stats: HuasuHomeOrderSyncStats,
  ) {
    try {
      await this.applyOrder(order, sourceId, userId, stats);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      stats.failed += 1;
      stats.failures.push({
        sourceOrderId: String(order.id),
        orderSn: String(order.no ?? order.order_sn ?? ''),
        reason,
      });
      await this.markMappingFailed(sourceId, order, reason, userId).catch(() => undefined);
      HuasuHomeInstallmentOrderSyncService.logger.warn(
        `[huasu-home] installment order ${order.id}/${order.no} sync failed: ${reason}`,
      );
    }
  }

  private async applyOrder(
    order: HuasuHomeInstallmentOrder,
    sourceId: bigint,
    userId: string,
    stats: HuasuHomeOrderSyncStats,
  ) {
    if (!HUASU_HOME_INSTALLMENT_SYNCABLE_STATUSES.has(Number(order.status))) {
      stats.skipped += 1;
      return;
    }
    if (!this.paidPeriods(order).length) {
      stats.skipped += 1;
      return;
    }

    const orderType = HUASU_HOME_ORDER_TYPE.INSTALLMENT;
    const sourceOrderId = String(order.id);
    const sourceUpdatedAt = this.parseDate(order.updated_at) ?? this.parseDate(order.created_at);
    const operatorId = BigInt(userId);
    const now = new Date();
    const payload = JSON.stringify(order);

    const existing = await this.prisma.hspsi_sale_order_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_order_type: orderType,
        source_order_id: sourceOrderId,
        deleted_at: null,
      },
    });

    if (
      existing &&
      this.shouldSkipUnchanged(existing, order, sourceUpdatedAt) &&
      !(await hasIncompleteAfterSalesService(this.prisma, existing.so_id))
    ) {
      stats.skipped += 1;
      return;
    }

    const delta = {
      created: 0,
      updated: 0,
      payments: 0,
      outputs: 0,
      exits: 0,
      events: 0,
    };

    await this.prisma.$transaction(
      async (tx) => {
        const orgId = await this.resolveOrgId(tx, sourceId, order);
        const warehouseId = await this.resolveWarehouseId(tx, orgId);
        const customerId = await this.ensureCustomer(tx, {
          sourceId,
          orgId,
          order,
          operatorId,
          now,
        });
        const lines = await this.resolveProductLines(tx, sourceId, order);
        const statusTriple = await this.mapPlatformStatus(
          order,
          existing?.so_id ? existing : null,
          tx,
        );

        let mapping = existing;
        if (!mapping) {
          mapping = await tx.hspsi_sale_order_source_mapping.create({
            data: {
              source_id: sourceId,
              source_order_type: orderType,
              source_order_id: sourceOrderId,
              source_order_no: String(order.no ?? ''),
              so_id: 0n,
              source_status: Number(order.status),
              last_payload: payload,
              sync_status: HUASU_HOME_ORDER_SYNC_STATUS.RETRY,
              last_sync_at: now,
              created_by: operatorId,
              updated_by: operatorId,
              created_at: now,
              updated_at: now,
            },
          });
        } else {
          mapping = await tx.hspsi_sale_order_source_mapping.update({
            where: { id: mapping.id },
            data: {
              source_order_no: String(order.no ?? mapping.source_order_no),
              last_payload: payload,
              updated_by: operatorId,
              updated_at: now,
            },
          });
        }

        const upserted = await this.upsertSaleOrder(tx, {
          mappingId: mapping.id,
          existingSoId: mapping.so_id > 0n ? mapping.so_id : null,
          sourceId,
          orgId,
          warehouseId,
          customerId,
          order,
          lines,
          statusTriple,
          operatorId,
          now,
        });
        const soId = upserted.soId;
        if (upserted.created) delta.created += 1;
        else delta.updated += 1;

        delta.payments += await this.ensurePeriodPayments(tx, {
          soId,
          sourceId,
          orderType,
          order,
          operatorId,
          now,
        });

        if (
          await this.ensureStatusEvent(tx, {
            soId,
            sourceId,
            orderType,
            order,
            lines,
            customerId,
            operatorId,
            now,
          })
        ) {
          delta.events += 1;
        }

        delta.outputs += await this.ensurePeriodShipments(tx, {
          soId,
          sourceId,
          orderType,
          order,
          orgId,
          warehouseId,
          operatorId,
          now,
          userId,
        });

        const aftersales = await this.ensureAfterSales(tx, {
          soId,
          sourceId,
          orderType,
          order,
          lines,
          orgId,
          warehouseId,
          customerId,
          operatorId,
          now,
          userId,
        });
        delta.payments += aftersales.payments;
        delta.exits += aftersales.exits;
        delta.events += aftersales.events;

        await tx.hspsi_sale_order_source_mapping.update({
          where: { id: mapping.id },
          data: {
            so_id: soId,
            source_status: Number(order.status),
            source_updated_at: sourceUpdatedAt,
            last_payload: payload,
            last_error_payload: null,
            sync_status: HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS,
            last_sync_at: now,
            remark: '',
            updated_by: operatorId,
            updated_at: now,
          },
        });
      },
      { timeout: 120_000 },
    );

    stats.created += delta.created;
    stats.updated += delta.updated;
    stats.payments += delta.payments;
    stats.outputs += delta.outputs;
    stats.exits += delta.exits;
    stats.events += delta.events;
  }

  private shouldSkipUnchanged(
    existing: {
      sync_status: number;
      so_id: bigint;
      source_updated_at: Date | null;
      source_status: number | null;
      last_payload: string | null;
    } | null,
    order: HuasuHomeInstallmentOrder,
    sourceUpdatedAt: Date | null,
  ): boolean {
    if (
      !existing ||
      existing.sync_status !== HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS ||
      !(existing.so_id > 0n) ||
      !sourceUpdatedAt ||
      !existing.source_updated_at ||
      existing.source_updated_at.getTime() !== sourceUpdatedAt.getTime() ||
      existing.source_status !== Number(order.status)
    ) {
      return false;
    }
    const last = this.parseLastPayload(existing.last_payload);
    if (!last) return false;
    return (
      Number(last.paid_period ?? 0) === Number(order.paid_period ?? 0) &&
      this.periodFingerprint(last) === this.periodFingerprint(order) &&
      this.aftersaleFingerprint(last) === this.aftersaleFingerprint(order)
    );
  }

  private parseLastPayload(raw: string | null): HuasuHomeInstallmentOrder | null {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as HuasuHomeInstallmentOrder;
    } catch {
      return null;
    }
  }

  private periodFingerprint(order: HuasuHomeInstallmentOrder): string {
    return this.activePeriods(order)
      .map((period) => {
        const issue = period.rights_issue;
        return [
          period.no,
          Number(period.paid_amount ?? 0),
          Number(period.unpaid_amount ?? 0),
          Number(issue?.product_id ?? 0),
          Number(issue?.number ?? 0),
        ].join(':');
      })
      .join('|');
  }

  private aftersaleFingerprint(order: HuasuHomeInstallmentOrder): string {
    return this.normalizeAftersales(order)
      .map((row) => `${row.id ?? 0}:${row.product_id}:${row.number}`)
      .join('|');
  }

  private async upsertSaleOrder(
    tx: Tx,
    input: {
      mappingId: bigint;
      existingSoId: bigint | null;
      sourceId: bigint;
      orgId: bigint;
      warehouseId: bigint;
      customerId: bigint;
      order: HuasuHomeInstallmentOrder;
      lines: ResolvedOrderLine[];
      statusTriple: { orderStatus: number; deliveryStatus: number; serviceStatus: number };
      operatorId: bigint;
      now: Date;
    },
  ): Promise<{ soId: bigint; created: boolean }> {
    const {
      mappingId,
      existingSoId,
      sourceId,
      orgId,
      warehouseId,
      customerId,
      order,
      lines,
      statusTriple,
      operatorId,
      now,
    } = input;
    const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);
    const totalAmount = this.dec(Number(order.package_amount ?? order.amount ?? 0));
    const factAmount = this.dec(Number(order.amount ?? 0));
    const priceoff = this.dec(
      Math.max(Number(order.package_amount ?? order.amount ?? 0) - Number(order.amount ?? 0), 0),
    );
    const soType = this.resolveSoType(lines);
    const customer = await tx.hspsi_basic_customer.findFirstOrThrow({
      where: { customer_id: customerId },
    });
    const latestShipDate = this.latestIssueDate(order);

    const headerData = {
      org_id: orgId,
      warehouse_id: warehouseId,
      so_type: soType,
      so_source: sourceId,
      so_source_id: mappingId,
      business_source_type: '',
      business_source_id: 0n,
      business_source_no: '',
      so_property_type: 1,
      customer_id: customerId,
      customer_name: this.clip(order.user?.nickname || customer.name || '', 30),
      customer_mobile: this.clip(order.user?.mobile || customer.mobile || '', 20),
      customer_address: '',
      order_date: this.parseDate(order.offline_order_time) ?? this.parseDate(order.created_at) ?? now,
      sales_name: '',
      sales_mobile: '',
      so_qty: totalQty,
      so_amount: totalAmount,
      fact_amount: factAmount,
      priceoff_amount: priceoff,
      order_status: statusTriple.orderStatus,
      delivery_status: statusTriple.deliveryStatus,
      service_status: statusTriple.serviceStatus,
      shipper: '',
      delivery_date: statusTriple.deliveryStatus >= 3 ? (latestShipDate ?? now) : null,
      status: 1,
      approve_status: 1,
      approve_comment: '华溯之家分期订单同步',
      approve_by: operatorId,
      approve_date: now,
      remark: this.clip(order.remark ?? '', 255),
      updated_by: operatorId,
      updated_at: now,
    };

    if (existingSoId) {
      const old = await tx.hspsi_sale_order.findFirst({
        where: { so_id: existingSoId, deleted_at: null },
      });
      if (!old) throw new BadRequestException(`映射关联销售单不存在: ${existingSoId}`);
      await tx.hspsi_sale_order.update({
        where: { so_id: existingSoId },
        data: {
          ...headerData,
          delivery_status: Math.max(Number(old.delivery_status), statusTriple.deliveryStatus),
          order_status: this.forwardOrderStatus(Number(old.order_status), statusTriple.orderStatus),
          service_status: this.forwardServiceStatus(
            Number(old.service_status),
            statusTriple.serviceStatus,
          ),
          delivery_date: headerData.delivery_date ?? old.delivery_date,
        },
      });
      const confirmedOutput = await tx.hspsi_sale_order_output.count({
        where: { so_id: existingSoId, comfirm_status: 1, deleted_at: null },
      });
      if (!confirmedOutput) {
        await tx.hspsi_sale_order_detail.deleteMany({ where: { so_id: existingSoId } });
        await tx.hspsi_sale_order_detail.createMany({
          data: lines.map((line) => ({
            so_id: existingSoId,
            goods_id: line.goodsId,
            sku_id: line.skuId,
            unit_type: line.unitType,
            sale_qty: line.quantity,
            sale_price: this.dec(line.price),
            sale_amount: this.dec(line.amount),
            fact_sale_amount: this.dec(line.amount),
          })),
        });
      }
      return { soId: existingSoId, created: false };
    }

    const soNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_ORDER);
    const created = await tx.hspsi_sale_order.create({
      data: {
        ...headerData,
        so_no: soNo,
        created_by: operatorId,
        created_at: now,
      },
    });
    await tx.hspsi_sale_order_detail.createMany({
      data: lines.map((line) => ({
        so_id: created.so_id,
        goods_id: line.goodsId,
        sku_id: line.skuId,
        unit_type: line.unitType,
        sale_qty: line.quantity,
        sale_price: this.dec(line.price),
        sale_amount: this.dec(line.amount),
        fact_sale_amount: this.dec(line.amount),
      })),
    });
    return { soId: created.so_id, created: true };
  }

  private async ensurePeriodPayments(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeInstallmentOrder;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<number> {
    let created = 0;
    const order = await tx.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: input.soId } });
    for (const period of this.paidPeriods(input.order)) {
      const key = this.payKey(input.sourceId, input.orderType, input.order.id, period.no);
      const old = await tx.hspsi_sales_order_payment.findUnique({ where: { request_key: key } });
      if (old) continue;
      const amount = this.dec(Number(period.paid_amount ?? period.amount ?? 0));
      if (amount.lte(0)) continue;
      const payNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_RECEIPT);
      await tx.hspsi_sales_order_payment.create({
        data: {
          org_id: order.org_id,
          dept_id: 0n,
          pay_no: payNo,
          so_id: input.soId,
          so_pay_type: 1,
          pay_mode: this.resolvePayMode(),
          fact_pay_amount: amount,
          pay_date:
            this.parseDate(period.offline_paid_time) ??
            this.parseDate(period.updated_at) ??
            this.parseDate(input.order.created_at) ??
            input.now,
          request_key: key,
          remark: this.clip(period.remark || input.order.remark || '', 255),
          created_by: input.operatorId,
          updated_by: input.operatorId,
          created_at: input.now,
          updated_at: input.now,
        },
      });
      created += 1;
    }
    return created;
  }

  /** 分期售后：无 aftersale 明细时补一条完结记录；有明细则由 AFTERSALE-{id} 写入。不写下单/发货。 */
  private async ensureStatusEvent(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeInstallmentOrder;
      lines: ResolvedOrderLine[];
      customerId: bigint;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<boolean> {
    const status = Number(input.order.status);
    if (status !== HUASU_HOME_INSTALLMENT_STATUS.AFTER_SALES) return false;
    if (this.normalizeAftersales(input.order).length) return false;

    const key = `HH-EVT-${input.sourceId}-${input.orderType}-${input.order.id}-AS-DONE`;
    const old = await tx.hspsi_sale_order_service.findFirst({
      where: { so_id: input.soId, remark: key, deleted_at: null },
    });
    const goods = input.lines[0] ?? null;
    const content = this.clip(input.order.remark ?? '', 255);
    const quantity = Number(goods?.quantity || 0);
    if (old) {
      await this.backfillServiceGoods(tx, old, goods, input.operatorId, input.now);
      await ensureSyncedSaleOrderServiceDetail(tx, {
        serviceId: old.service_id,
        soId: input.soId,
        goodsId: goods?.goodsId,
        skuId: goods?.skuId,
        unitType: goods?.unitType,
        quantity,
        remark: content,
      });
      return false;
    }

    const serviceNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_SERVICE);
    const created = await tx.hspsi_sale_order_service.create({
      data: {
        service_no: serviceNo,
        so_id: input.soId,
        customer_id: Number(input.customerId),
        goods_id: goods ? Number(goods.goodsId) : 0,
        sku_id: goods ? Number(goods.skuId) : 0,
        event_type: 4,
        event_content: content,
        event_status: 2,
        handler_id: input.operatorId,
        event_date: input.now,
        remark: key,
        created_by: input.operatorId,
        updated_by: input.operatorId,
        created_at: input.now,
        updated_at: input.now,
      },
    });
    await ensureSyncedSaleOrderServiceDetail(tx, {
      serviceId: created.service_id,
      soId: input.soId,
      goodsId: goods?.goodsId,
      skuId: goods?.skuId,
      unitType: goods?.unitType,
      quantity,
      remark: content,
    });
    return true;
  }

  private async createServiceEvent(
    tx: Tx,
    input: {
      soId: bigint;
      customerId: bigint;
      operatorId: bigint;
      now: Date;
      order: HuasuHomeInstallmentOrder;
    },
    key: string,
    eventType: number,
    eventDate?: string,
    goods?: ResolvedOrderLine | null,
    quantity?: number,
  ): Promise<boolean> {
    const old = await tx.hspsi_sale_order_service.findFirst({
      where: { so_id: input.soId, remark: key, deleted_at: null },
    });
    const line = goods ?? null;
    const content = this.clip(input.order.remark ?? '', 255);
    const qty = Number(quantity || line?.quantity || 0);
    if (old) {
      await this.backfillServiceGoods(tx, old, line, input.operatorId, input.now);
      await ensureSyncedSaleOrderServiceDetail(tx, {
        serviceId: old.service_id,
        soId: input.soId,
        goodsId: line?.goodsId,
        skuId: line?.skuId,
        unitType: line?.unitType,
        quantity: qty,
        remark: content,
      });
      return false;
    }
    const serviceNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_SERVICE);
    const created = await tx.hspsi_sale_order_service.create({
      data: {
        service_no: serviceNo,
        so_id: input.soId,
        customer_id: Number(input.customerId),
        goods_id: line ? Number(line.goodsId) : 0,
        sku_id: line ? Number(line.skuId) : 0,
        event_type: eventType,
        event_content: content,
        event_status: 2,
        handler_id: input.operatorId,
        event_date: this.parseDate(eventDate) ?? input.now,
        remark: key,
        created_by: input.operatorId,
        updated_by: input.operatorId,
        created_at: input.now,
        updated_at: input.now,
      },
    });
    await ensureSyncedSaleOrderServiceDetail(tx, {
      serviceId: created.service_id,
      soId: input.soId,
      goodsId: line?.goodsId,
      skuId: line?.skuId,
      unitType: line?.unitType,
      quantity: qty,
      remark: content,
    });
    return true;
  }

  private async ensurePeriodShipments(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeInstallmentOrder;
      orgId: bigint;
      warehouseId: bigint;
      operatorId: bigint;
      now: Date;
      userId: string;
    },
  ): Promise<number> {
    let created = 0;
    for (const period of this.shippablePeriods(input.order)) {
      created += await this.ensurePeriodShipment(tx, input, period);
    }
    return created;
  }

  private async ensurePeriodShipment(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeInstallmentOrder;
      orgId: bigint;
      warehouseId: bigint;
      operatorId: bigint;
      now: Date;
      userId: string;
    },
    period: HuasuHomeInstallmentPeriod,
  ): Promise<number> {
    const key = this.shipKey(input.sourceId, input.orderType, period.no);
    const existed = await tx.hspsi_sale_order_output.findFirst({
      where: { so_id: input.soId, remark: key, deleted_at: null },
    });
    if (existed) return 0;

    const issue = period.rights_issue;
    if (!issue) return 0;
    const target = await this.resolveDefaultStandardSku(tx, input.sourceId, Number(issue.product_id));
    const quantity = Number(issue.number);
    if (!(quantity > 0)) return 0;
    const shipLines: ShipLine[] = [
      {
        goodsId: target.goodsId,
        skuId: target.skuId,
        unitType: target.unitType,
        quantity,
        batchNo: '',
      },
    ];

    const outputNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_OUTPUT);
    const outputDate =
      this.parseDate(issue.created_at) ??
      this.parseDate(period.offline_paid_time) ??
      this.parseDate(period.updated_at) ??
      input.now;
    const output = await tx.hspsi_sale_order_output.create({
      data: {
        so_output_no: outputNo,
        so_id: input.soId,
        org_id: input.orgId,
        warehouse_id: input.warehouseId,
        output_date: outputDate,
        go_where: 1,
        dept_id: 0n,
        receiver_id: input.operatorId,
        output_sku_qty: 1,
        status: true,
        comfirm_status: 1,
        comfirm_comment: '华溯之家分期权益发放同步自动确认',
        comfirm_by: input.operatorId,
        comfirm_date: input.now,
        posting_version: 1,
        remark: key,
        created_by: input.operatorId,
        updated_by: input.operatorId,
        created_at: input.now,
        updated_at: input.now,
      },
    });
    await tx.hspsi_sale_order_output_detail.createMany({
      data: shipLines.map((line) => ({
        so_output_id: output.so_output_id,
        so_id: input.soId,
        goods_id: line.goodsId,
        sku_id: line.skuId,
        batch_no: line.batchNo,
        unit_type: line.unitType,
        sale_qty: line.quantity,
        output_qty: line.quantity,
      })),
    });

    await this.externalPosting.post(
      {
        orgId: input.orgId,
        warehouseId: input.warehouseId,
        direction: -1,
        operationType: 2,
        inventoryMode: INVENTORY_BUSINESS_MODE.SALES_OUTPUT,
        sourceId: output.so_output_id,
        sourceType: 'sales_output',
        sourceNo: outputNo,
        operationBy: input.userId,
        idempotencyKey: `huasu-home-output:${key}:v1`,
        remark: this.clip(issue.remark || period.remark || input.order.remark || '', 255),
        lines: shipLines.map((line) => ({
          goodsId: line.goodsId,
          skuId: line.skuId,
          batchNo: line.batchNo,
          unitType: line.unitType,
          quantity: String(line.quantity),
        })),
      },
      tx,
    );

    await tx.hspsi_sale_order.update({
      where: { so_id: input.soId },
      data: {
        delivery_status: 3,
        delivery_date: outputDate,
        updated_by: input.operatorId,
        updated_at: input.now,
      },
    });
    return 1;
  }

  /**
   * 分期售后：aftersale 对应 hszj_order_installment_aftersale。
   * 按 product_id + number 回库；表无退款金额，不写退款 payment。
   */
  private async ensureAfterSales(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeInstallmentOrder;
      lines: ResolvedOrderLine[];
      orgId: bigint;
      warehouseId: bigint;
      customerId: bigint;
      operatorId: bigint;
      now: Date;
      userId: string;
    },
  ): Promise<{ payments: number; exits: number; events: number }> {
    const result = { payments: 0, exits: 0, events: 0 };
    const rows = this.normalizeAftersales(input.order);
    const isAfterSalesStatus =
      Number(input.order.status) === HUASU_HOME_INSTALLMENT_STATUS.AFTER_SALES;
    if (!rows.length && !isAfterSalesStatus) return result;

    if (isAfterSalesStatus || rows.length) {
      await tx.hspsi_sale_order.update({
        where: { so_id: input.soId },
        data: {
          service_status: 2,
          ...(isAfterSalesStatus ? { order_status: 2 } : {}),
          updated_by: input.operatorId,
          updated_at: input.now,
        },
      });
    }

    for (const row of rows) {
      const token = row.id ?? `${row.product_id}-${row.number}`;
      const eventKey = `HH-EVT-${input.sourceId}-${input.orderType}-${input.order.id}-AFTERSALE-${token}`;
      if (
        await this.createServiceEvent(
          tx,
          input,
          eventKey,
          4,
          row.created_at ?? row.updated_at,
          input.lines.find((line) => line.sourceProductId === Number(row.product_id)) ??
            input.lines[0],
          Number(row.number),
        )
      ) {
        result.events += 1;
      }

      const quantity = Number(row.number);
      if (!(Number(row.product_id) > 0) || !(quantity > 0)) continue;

      const exitKey = this.exitKey(input.sourceId, input.orderType, input.order.id, token);
      const existed = await tx.hspsi_sale_order_exit.findFirst({
        where: { so_id: input.soId, remark: exitKey, deleted_at: null },
      });
      if (existed) continue;

      const output = await tx.hspsi_sale_order_output.findFirst({
        where: { so_id: input.soId, comfirm_status: 1, deleted_at: null },
        orderBy: { so_output_id: 'asc' },
      });
      if (!output) continue;

      const target = await this.resolveDefaultStandardSku(tx, input.sourceId, Number(row.product_id));
      const returnLines: ShipLine[] = [
        {
          goodsId: target.goodsId,
          skuId: target.skuId,
          unitType: target.unitType,
          quantity,
          batchNo: '',
        },
      ];
      const exitNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_RETURN);
      const order = await tx.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: input.soId } });
      const exit = await tx.hspsi_sale_order_exit.create({
        data: {
          so_exit_no: exitNo,
          so_id: input.soId,
          source_output_id: output.so_output_id,
          exit_reson: this.clip(row.remark || input.order.remark || '', 255),
          exit_qty: quantity,
          disposal_type: 1,
          org_id: input.orgId,
          warehouse_id: input.warehouseId,
          exit_date: this.parseDate(row.created_at) ?? input.now,
          dept_id: 0n,
          receiver_id: input.operatorId,
          customer_id: order.customer_id,
          customer_name: order.customer_name,
          customer_mobile: order.customer_mobile,
          customer_address: order.customer_address,
          sales_name: order.sales_name,
          sales_mobile: order.sales_mobile,
          status: true,
          comfirm_status: 1,
          comfirm_comment: '华溯之家分期售后退货同步自动确认',
          comfirm_by: input.operatorId,
          comfirm_date: input.now,
          posting_version: 1,
          remark: exitKey,
          created_by: input.operatorId,
          updated_by: input.operatorId,
          created_at: input.now,
          updated_at: input.now,
        },
      });
      await tx.hspsi_sale_order_exit_detail.createMany({
        data: returnLines.map((line) => ({
          so_exit_id: exit.so_exit_id,
          so_id: input.soId,
          goods_id: line.goodsId,
          sku_id: line.skuId,
          batch_no: line.batchNo,
          unit_type: line.unitType,
          so_qty: line.quantity,
          exit_qty: line.quantity,
          remark: this.clip(row.remark || input.order.remark || '', 255),
        })),
      });
      await this.externalPosting.post(
        {
          orgId: input.orgId,
          warehouseId: input.warehouseId,
          direction: 1,
          operationType: 1,
          inventoryMode: INVENTORY_BUSINESS_MODE.SALES_RETURN,
          sourceId: exit.so_exit_id,
          sourceType: 'sales_return',
          sourceNo: exitNo,
          operationBy: input.userId,
          idempotencyKey: `huasu-home-exit:${exitKey}:v1`,
          remark: this.clip(row.remark || input.order.remark || '', 255),
          lines: returnLines.map((line) => ({
            goodsId: line.goodsId,
            skuId: line.skuId,
            batchNo: line.batchNo,
            unitType: line.unitType,
            quantity: String(line.quantity),
          })),
        },
        tx,
      );
      result.exits += 1;
    }

    return result;
  }

  private async resolveProductLines(
    tx: Tx,
    sourceId: bigint,
    order: HuasuHomeInstallmentOrder,
  ): Promise<ResolvedOrderLine[]> {
    const products = (order.products ?? []).filter(
      (row): row is HuasuHomeInstallmentProduct => !!row && Number(row.product_id) > 0,
    );
    if (!products.length) throw new BadRequestException('分期订单商品明细为空');

    const totalQty = products.reduce((sum, row) => sum + Number(row.number || 0), 0);
    const orderAmount = Number(order.amount ?? 0);
    const lines: ResolvedOrderLine[] = [];
    for (const product of products) {
      const quantity = Number(product.number);
      if (!(quantity > 0)) continue;
      const target = await this.resolveDefaultStandardSku(tx, sourceId, Number(product.product_id));
      const goods = await tx.hspsi_goods_info.findFirst({
        where: { goods_id: target.goodsId, deleted_at: null },
      });
      if (!goods) {
        throw new BadRequestException(`映射商品不存在 goods=${target.goodsId}`);
      }
      const price =
        Number(product.original_price || 0) > 0
          ? Number(product.original_price)
          : totalQty > 0
            ? orderAmount / totalQty
            : 0;
      lines.push({
        goodsId: target.goodsId,
        skuId: target.skuId,
        unitType: target.unitType,
        quantity,
        price,
        amount: price * quantity,
        goodsType: Number(goods.goods_type ?? 1),
        sourceProductId: Number(product.product_id),
      });
    }
    if (!lines.length) throw new BadRequestException('分期订单有效商品数量为 0');
    return lines;
  }

  private async backfillServiceGoods(
    tx: Tx,
    existing: { service_id: bigint; goods_id: number },
    goods: ResolvedOrderLine | null,
    operatorId: bigint,
    now: Date,
  ) {
    if (!goods || Number(existing.goods_id) !== 0) return;
    await tx.hspsi_sale_order_service.update({
      where: { service_id: existing.service_id },
      data: {
        goods_id: Number(goods.goodsId),
        sku_id: Number(goods.skuId),
        updated_by: operatorId,
        updated_at: now,
      },
    });
  }

  private async resolveDefaultStandardSku(
    tx: Tx,
    sourceId: bigint,
    sourceProductId: number,
  ): Promise<{ goodsId: bigint; skuId: bigint; unitType: number }> {
    const mappings = await tx.hspsi_goods_source_mapping.findMany({
      where: {
        source_id: sourceId,
        source_type: HUASU_HOME_SOURCE_TYPE.STANDARD,
        source_goods_id: String(sourceProductId),
        mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
        deleted_at: null,
      },
    });
    if (!mappings.length) {
      throw new BadRequestException(`单品未映射: product_id=${sourceProductId}`);
    }
    const goodsId = mappings[0]!.goods_id;
    const defaultSku = await tx.hspsi_goods_info_sku.findFirst({
      where: {
        good_id: goodsId,
        is_default: 1,
        deleted_at: null,
      },
      orderBy: { sku_id: 'asc' },
    });
    if (defaultSku) {
      return {
        goodsId,
        skuId: defaultSku.sku_id,
        unitType: Number(defaultSku.unit_type ?? 0),
      };
    }
    const fallback = mappings[0]!;
    const sku = await tx.hspsi_goods_info_sku.findFirst({
      where: { sku_id: fallback.sku_id, good_id: goodsId, deleted_at: null },
    });
    return {
      goodsId,
      skuId: fallback.sku_id,
      unitType: Number(sku?.unit_type ?? 0),
    };
  }

  private async ensureCustomer(
    tx: Tx,
    input: {
      sourceId: bigint;
      orgId: bigint;
      order: HuasuHomeInstallmentOrder;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<bigint> {
    const userId = BigInt(input.order.user_id ?? input.order.user?.id ?? 0);
    if (!(userId > 0n)) throw new BadRequestException('订单缺少用户 id');
    const sourceType = Number(input.sourceId);
    if (!Number.isSafeInteger(sourceType) || sourceType > 255) {
      throw new BadRequestException(
        `数据源 id=${input.sourceId} 超出客户 source_type(tinyint) 范围，请调整字段类型`,
      );
    }

    const user = input.order.user;
    const name = this.clip(user?.nickname || `华溯用户${userId}`, 100);
    const mobile = this.clip(user?.mobile || '', 20);
    const status = Number(user?.status ?? 1) === 0 ? 2 : 1;
    const data = {
      org_id: input.orgId,
      name,
      mobile,
      gender: Number(user?.gender ?? 0),
      birthday: this.parseCustomerBirth(user?.birth),
      status,
      remark: this.clip(user?.remark || '', 255),
      levels: buildCustomerLevels(user ?? {}) as unknown as Prisma.InputJsonValue,
      updated_by: input.operatorId,
      updated_at: input.now,
    };

    const existing = await tx.hspsi_basic_customer.findFirst({
      where: {
        source_type: sourceType,
        related_customer_id: userId,
        deleted_at: null,
      },
    });
    if (existing) {
      await tx.hspsi_basic_customer.update({
        where: { customer_id: existing.customer_id },
        data,
      });
      return existing.customer_id;
    }

    const created = await tx.hspsi_basic_customer.create({
      data: {
        ...data,
        address: '',
        referrer_name: '',
        referrer_mobile: '',
        source_type: sourceType,
        related_customer_id: userId,
        sort: 0,
        created_by: input.operatorId,
        created_at: input.now,
      },
    });
    return created.customer_id;
  }

  private parseCustomerBirth(birth?: string): Date | null {
    const text = String(birth ?? '').trim();
    if (!text) return null;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  private async resolveOrgId(
    tx: Tx,
    sourceId: bigint,
    order: HuasuHomeInstallmentOrder,
  ): Promise<bigint> {
    const sourceOrgId = Number(order.organization_id ?? order.user?.organization_id ?? 0);
    if (!(sourceOrgId > 0)) {
      throw new BadRequestException('分期订单缺少 organization_id');
    }
    const mapping = await tx.hspsi_sys_organization_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_object_id: String(sourceOrgId),
        deleted_at: null,
      },
    });
    if (!mapping || !(mapping.org_id > 0n)) {
      throw new BadRequestException(`机构未映射: organization_id=${sourceOrgId}`);
    }
    return mapping.org_id;
  }

  private async resolveWarehouseId(tx: Tx, orgId: bigint): Promise<bigint> {
    if (!(HUASU_HOME_GOODS_CATEGORY_ID > 0n)) {
      throw new BadRequestException('请先配置 HUASU_HOME_GOODS_CATEGORY_ID');
    }
    const category = await tx.hspsi_goods_info_category.findFirst({
      where: { goods_catg_id: HUASU_HOME_GOODS_CATEGORY_ID, deleted_at: null },
    });
    if (!category) throw new BadRequestException('华溯商品分类不存在');
    const warehouse = await tx.hspsi_basic_warehouse.findFirst({
      where: {
        org_id: orgId,
        warehouse_type: category.warehouse_type,
        status: 1,
        deleted_at: null,
      },
      orderBy: [{ sort: 'asc' }, { warehouse_id: 'asc' }],
    });
    if (!warehouse) {
      throw new BadRequestException(
        `机构 ${orgId} 下无仓库类型=${category.warehouse_type} 的启用仓库`,
      );
    }
    return warehouse.warehouse_id;
  }

  private async mapPlatformStatus(
    order: HuasuHomeInstallmentOrder,
    existing: { so_id: bigint } | null,
    tx: Tx,
  ): Promise<{ orderStatus: number; deliveryStatus: number; serviceStatus: number }> {
    const status = Number(order.status);
    const hasShip = this.shippablePeriods(order).length > 0;
    let orderStatus = 1;
    let deliveryStatus = hasShip ? 3 : 1;
    let serviceStatus = 3;

    if (status === HUASU_HOME_INSTALLMENT_STATUS.COMPLETED) {
      orderStatus = 2;
      if (hasShip) deliveryStatus = 3;
    } else if (status === HUASU_HOME_INSTALLMENT_STATUS.AFTER_SALES) {
      orderStatus = 2;
      serviceStatus = 2;
    } else if (status === HUASU_HOME_INSTALLMENT_STATUS.CONVERTED) {
      orderStatus = 2;
      if (hasShip) deliveryStatus = 3;
    }

    if (this.normalizeAftersales(order).length) {
      serviceStatus = 2;
    }

    if (existing?.so_id) {
      const old = await tx.hspsi_sale_order.findFirst({
        where: { so_id: existing.so_id, deleted_at: null },
      });
      if (old) {
        deliveryStatus = Math.max(Number(old.delivery_status), deliveryStatus);
      }
    }
    return { orderStatus, deliveryStatus, serviceStatus };
  }

  private forwardOrderStatus(oldStatus: number, next: number): number {
    if (oldStatus === 3) return 3;
    if (oldStatus === 2 && next !== 3) return 2;
    return next;
  }

  private forwardServiceStatus(oldStatus: number, next: number): number {
    if (oldStatus === 2) return 2;
    if (oldStatus === 1 && next === 3) return 1;
    return next;
  }

  private resolveSoType(lines: ResolvedOrderLine[]): number {
    const types = new Set(lines.map((line) => (line.goodsType === 2 ? 2 : 1)));
    if (types.size > 1) return 3;
    return types.has(2) ? 2 : 1;
  }

  private resolvePayMode(): number {
    return HUASU_HOME_PAY_MODE_MAP[4] ?? HUASU_HOME_INSTALLMENT_DEFAULT_PAY_MODE;
  }

  private activePeriods(order: HuasuHomeInstallmentOrder): HuasuHomeInstallmentPeriod[] {
    return (order.periods ?? []).filter((period) => period && !period.deleted_at && period.no);
  }

  private paidPeriods(order: HuasuHomeInstallmentOrder): HuasuHomeInstallmentPeriod[] {
    return this.activePeriods(order).filter((period) => this.isPeriodPaid(period));
  }

  private shippablePeriods(order: HuasuHomeInstallmentOrder): HuasuHomeInstallmentPeriod[] {
    return this.paidPeriods(order).filter((period) => this.shouldShipPeriod(period));
  }

  private isPeriodPaid(period: HuasuHomeInstallmentPeriod): boolean {
    const paid = Number(period.paid_amount ?? 0);
    if (paid > 0) return true;
    if (!(Number(period.amount ?? 0) > 0) || period.unpaid_amount == null) return false;
    return Number(period.unpaid_amount) === 0;
  }

  private shouldShipPeriod(period: HuasuHomeInstallmentPeriod): boolean {
    const issue = period.rights_issue;
    return !!issue && !issue.deleted_at && Number(issue.product_id) > 0 && Number(issue.number) > 0;
  }

  private normalizeAftersales(order: HuasuHomeInstallmentOrder): HuasuHomeInstallmentAftersale[] {
    const raw = order.aftersale;
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.filter(
      (row) => row && !row.deleted_at && Number(row.product_id) > 0 && Number(row.number) > 0,
    );
  }

  private latestIssueDate(order: HuasuHomeInstallmentOrder): Date | null {
    const dates = this.shippablePeriods(order)
      .map(
        (period) =>
          this.parseDate(period.rights_issue?.created_at) ??
          this.parseDate(period.offline_paid_time) ??
          this.parseDate(period.updated_at),
      )
      .filter((date): date is Date => !!date);
    if (!dates.length) return null;
    return dates.reduce((latest, date) => (date > latest ? date : latest));
  }

  private parseDate(value?: string | null): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private clip(value: string, max: number): string {
    return String(value ?? '').slice(0, max);
  }

  private dec(value: number): Prisma.Decimal {
    return new Prisma.Decimal(Number(value || 0).toFixed(2));
  }

  private payKey(
    sourceId: bigint,
    orderType: string,
    orderId: number | string,
    periodNo: string,
  ) {
    return `HH-PAY-${sourceId}-${orderType}-${orderId}-${periodNo}`;
  }

  private shipKey(sourceId: bigint, orderType: string, periodNo: string) {
    return `HH-SHIP-${sourceId}-${orderType}-${periodNo}`;
  }

  private exitKey(
    sourceId: bigint,
    orderType: string,
    orderId: number | string,
    token: number | string,
  ) {
    return `HH-EXIT-${sourceId}-${orderType}-${orderId}-${token}`;
  }

  private async markMappingFailed(
    sourceId: bigint,
    order: HuasuHomeInstallmentOrder,
    reason: string,
    userId: string,
  ) {
    const now = new Date();
    const orderType = HUASU_HOME_ORDER_TYPE.INSTALLMENT;
    const sourceOrderId = String(order.id);
    const existing = await this.prisma.hspsi_sale_order_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_order_type: orderType,
        source_order_id: sourceOrderId,
        deleted_at: null,
      },
    });
    const data = {
      source_order_no: String(order.no ?? ''),
      source_updated_at: this.parseDate(order.updated_at) ?? this.parseDate(order.created_at),
      last_error_payload: JSON.stringify(order),
      sync_status: HUASU_HOME_ORDER_SYNC_STATUS.FAILED,
      last_sync_at: now,
      remark: this.clip(reason, 255),
      updated_by: BigInt(userId),
      updated_at: now,
    };
    if (existing) {
      await this.prisma.hspsi_sale_order_source_mapping.update({
        where: { id: existing.id },
        data,
      });
      return;
    }
    await this.prisma.hspsi_sale_order_source_mapping.create({
      data: {
        source_id: sourceId,
        source_order_type: orderType,
        source_order_id: sourceOrderId,
        so_id: 0n,
        source_status: Number(order.status ?? 0),
        created_by: BigInt(userId),
        created_at: now,
        ...data,
      },
    });
  }

  private async resolveListUpdatedAt(sourceId: bigint): Promise<string> {
    const oldestFailed = await this.prisma.hspsi_sale_order_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_order_type: HUASU_HOME_ORDER_TYPE.INSTALLMENT,
        sync_status: HUASU_HOME_ORDER_SYNC_STATUS.FAILED,
        source_updated_at: { not: null },
        deleted_at: null,
      },
      orderBy: { source_updated_at: 'asc' },
      select: { source_updated_at: true },
    });
    if (oldestFailed?.source_updated_at) {
      return this.formatDateTime(oldestFailed.source_updated_at);
    }
    const latest = await this.prisma.hspsi_sale_order_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_order_type: HUASU_HOME_ORDER_TYPE.INSTALLMENT,
        source_updated_at: { not: null },
        deleted_at: null,
      },
      orderBy: { source_updated_at: 'desc' },
      select: { source_updated_at: true },
    });
    if (latest?.source_updated_at) {
      return this.formatDateTime(latest.source_updated_at);
    }
    return '1970-01-01 00:00:00';
  }

  private formatDateTime(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private hasMoreOrderPages(
    page: number,
    pageSize: number,
    listLength: number,
    total: number | undefined,
  ): boolean {
    if (listLength <= 0) return false;
    const totalCount = Number(total);
    if (Number.isFinite(totalCount) && totalCount >= 0) {
      return page * pageSize < totalCount;
    }
    return listLength >= pageSize;
  }

  private async withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running) {
      throw new BadRequestException('华溯分期订单同步仍在进行，请稍后再试');
    }
    this.running = true;
    try {
      return await fn();
    } finally {
      this.running = false;
    }
  }

  private normalizePageSize(pageSize?: number): number {
    const raw = Number(pageSize ?? HUASU_HOME_ORDER_SYNC_DEFAULT_PAGE_SIZE);
    if (!Number.isFinite(raw) || raw < 1) return HUASU_HOME_ORDER_SYNC_DEFAULT_PAGE_SIZE;
    return Math.min(HUASU_HOME_ORDER_SYNC_MAX_PAGE_SIZE, Math.floor(raw));
  }

  private async ensureDataSource(userId: string): Promise<bigint> {
    const existing = await this.prisma.hspsi_sys_data_source.findUnique({
      where: { code: HUASU_HOME_DATA_SOURCE_CODE },
    });
    if (existing) {
      if (existing.deleted_at || existing.status !== 1) {
        throw new BadRequestException('华溯之家数据源已停用或删除，请先在系统中启用');
      }
      return existing.id;
    }
    const created = await this.prisma.hspsi_sys_data_source.create({
      data: {
        code: HUASU_HOME_DATA_SOURCE_CODE,
        name: HUASU_HOME_DATA_SOURCE_NAME,
        status: 1,
        remark: '华溯之家订单同步自动创建',
        created_by: BigInt(userId),
        updated_by: BigInt(userId),
      },
    });
    return created.id;
  }

  private emptyStats(): HuasuHomeOrderSyncStats {
    return {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      payments: 0,
      outputs: 0,
      exits: 0,
      events: 0,
      warnings: [],
      failures: [],
    };
  }
}
