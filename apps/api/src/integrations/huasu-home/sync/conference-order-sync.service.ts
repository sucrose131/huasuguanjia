import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BUSINESS_PREFIX } from '../../../business-number/business-number.constants';
import { BusinessNumberService } from '../../../business-number/business-number.service';
import { PrismaService } from '../../../database/prisma.service';
import { INVENTORY_BUSINESS_MODE } from '../../../inventory/inventory-dictionary';
import {
  HUASU_HOME_CONFERENCE_ORDER_STATUS,
  HUASU_HOME_CONFERENCE_REFUND_STATUS,
  HUASU_HOME_CONFERENCE_RIGHTS_GRANTED,
  HUASU_HOME_CONFERENCE_SYNCABLE_STATUSES,
  HUASU_HOME_CONFERENCE_VERIFY_STATUS,
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_DATA_SOURCE_NAME,
  HUASU_HOME_GOODS_CATEGORY_ID,
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
  HuasuHomeConferenceOrder,
  HuasuHomeOrderPackageItem,
} from '../huasu-home.types';
import { ExternalInventoryPostingService } from '../../common/external-inventory-posting.service';
import { buildCustomerLevels } from './build-customer-levels';
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
};

type ShipLine = {
  goodsId: bigint;
  skuId: bigint;
  unitType: number;
  quantity: number;
  batchNo: string;
};

/**
 * 华溯之家会议门票订单同步
 *
 * 购买：已支付建销售单 + 收款，不出库。
 * 核销且权益发放：出库扣库。
 * 退款：仅记账，不回库。本地已出库后再退款则整单失败。
 * 首次同步即同时核销+退款：不出库，只记收款和退款。
 */
@Injectable()
export class HuasuHomeConferenceOrderSyncService {
  private static readonly logger = new Logger(HuasuHomeConferenceOrderSyncService.name);

  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HuasuHomeService) private readonly huasuHome: HuasuHomeService,
    @Inject(BusinessNumberService) private readonly businessNumber: BusinessNumberService,
    @Inject(ExternalInventoryPostingService)
    private readonly externalPosting: ExternalInventoryPostingService,
  ) {}

  async syncConferenceOrders(
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
        const data = await this.huasuHome.getConferenceOrderList({
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

      HuasuHomeConferenceOrderSyncService.logger.log(
        `[huasu-home] conference order sync done: ${JSON.stringify({
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
    order: HuasuHomeConferenceOrder,
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
        orderSn: String(order.order_sn ?? ''),
        reason,
      });
      await this.markMappingFailed(sourceId, order, reason, userId).catch(() => undefined);
      HuasuHomeConferenceOrderSyncService.logger.warn(
        `[huasu-home] conference order ${order.id}/${order.order_sn} sync failed: ${reason}`,
      );
    }
  }

  private async applyOrder(
    order: HuasuHomeConferenceOrder,
    sourceId: bigint,
    userId: string,
    stats: HuasuHomeOrderSyncStats,
  ) {
    if (!HUASU_HOME_CONFERENCE_SYNCABLE_STATUSES.has(Number(order.order_status))) {
      stats.skipped += 1;
      return;
    }

    const orderType = HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET;
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

    if (this.shouldSkipUnchanged(existing, order, sourceUpdatedAt)) {
      stats.skipped += 1;
      return;
    }

    const delta = {
      created: 0,
      updated: 0,
      payments: 0,
      outputs: 0,
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
        const lines = await this.resolveComboLine(tx, sourceId, order);
        const statusTriple = await this.mapPlatformStatus(
          order,
          existing?.so_id ? existing : null,
          tx,
        );

        let mapping = existing
          ? await tx.hspsi_sale_order_source_mapping.findFirstOrThrow({
              where: { id: existing.id },
            })
          : await tx.hspsi_sale_order_source_mapping.create({
              data: {
                source_id: sourceId,
                source_order_type: orderType,
                source_order_id: sourceOrderId,
                source_order_no: String(order.order_sn ?? ''),
                so_id: 0n,
                source_status: 0,
                sync_status: HUASU_HOME_ORDER_SYNC_STATUS.RETRY,
                created_by: operatorId,
                updated_by: operatorId,
                created_at: now,
                updated_at: now,
              },
            });

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

        mapping = await tx.hspsi_sale_order_source_mapping.update({
          where: { id: mapping.id },
          data: {
            so_id: soId,
            source_order_no: String(order.order_sn ?? ''),
            updated_by: operatorId,
            updated_at: now,
          },
        });

        if (await this.ensurePayment(tx, { soId, sourceId, orderType, order, operatorId, now })) {
          delta.payments += 1;
        }

        if (
          await this.ensureStatusEvent(tx, {
            soId,
            sourceId,
            orderType,
            order,
            customerId,
            operatorId,
            now,
          })
        ) {
          delta.events += 1;
        }

        if (
          await this.ensureTicketEvent(tx, {
            soId,
            sourceId,
            orderType,
            order,
            customerId,
            operatorId,
            now,
          })
        ) {
          delta.events += 1;
        }

        const refunded = this.isRefunded(order);
        const alreadyShipped = await this.hasConfirmedOutput(tx, soId);

        if (refunded && alreadyShipped) {
          throw new BadRequestException('门票已核销发货后出现退款，拒绝同步');
        }

        if (this.shouldShip(order) && !refunded) {
          const shipped = await this.ensureShipment(tx, {
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
          delta.outputs += shipped;
        }

        if (refunded) {
          if (await this.ensureRefund(tx, { soId, sourceId, orderType, order, operatorId, now })) {
            delta.payments += 1;
          }
        }

        await tx.hspsi_sale_order_source_mapping.update({
          where: { id: mapping.id },
          data: {
            so_id: soId,
            source_status: Number(order.order_status),
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
    order: HuasuHomeConferenceOrder,
    sourceUpdatedAt: Date | null,
  ): boolean {
    if (
      !existing ||
      existing.sync_status !== HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS ||
      !(existing.so_id > 0n) ||
      !sourceUpdatedAt ||
      !existing.source_updated_at ||
      existing.source_updated_at.getTime() !== sourceUpdatedAt.getTime() ||
      existing.source_status !== Number(order.order_status)
    ) {
      return false;
    }
    const last = this.parseLastPayload(existing.last_payload);
    if (!last) return false;
    return (
      Number(last.verify_status) === Number(order.verify_status) &&
      Number(last.rights_granted) === Number(order.rights_granted)
    );
  }

  private parseLastPayload(
    payload: string | null,
  ): { verify_status?: number; rights_granted?: number } | null {
    if (!payload) return null;
    try {
      const parsed = JSON.parse(payload) as {
        verify_status?: number;
        rights_granted?: number;
      };
      return parsed;
    } catch {
      return null;
    }
  }

  private shouldShip(order: HuasuHomeConferenceOrder): boolean {
    return (
      Number(order.verify_status) === HUASU_HOME_CONFERENCE_VERIFY_STATUS.VERIFIED &&
      Number(order.rights_granted) === HUASU_HOME_CONFERENCE_RIGHTS_GRANTED.YES
    );
  }

  private isRefunded(order: HuasuHomeConferenceOrder): boolean {
    return (
      Number(order.order_status) === HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUNDED ||
      Number(order.refund?.refund_status) === HUASU_HOME_CONFERENCE_REFUND_STATUS.DONE
    );
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
      order: HuasuHomeConferenceOrder;
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
    const totalAmount = this.dec(Number(order.total_amount ?? 0));
    const factAmount = this.dec(Number(order.actual_amount ?? 0));
    const priceoff = this.dec(
      Math.max(Number(order.total_amount ?? 0) - Number(order.actual_amount ?? 0), 0),
    );
    const soType = this.resolveSoType(lines);
    const customer = await tx.hspsi_basic_customer.findFirstOrThrow({
      where: { customer_id: customerId },
    });

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
      order_date: this.parseDate(order.created_at) ?? now,
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
      delivery_date:
        statusTriple.deliveryStatus >= 3 ? (this.parseDate(order.verify_time) ?? now) : null,
      status: 1,
      approve_status: 1,
      approve_comment: '华溯之家会议门票订单同步',
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

  private async ensurePayment(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeConferenceOrder;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<boolean> {
    const key = this.payKey(input.sourceId, input.orderType, input.order.id);
    const old = await tx.hspsi_sales_order_payment.findUnique({ where: { request_key: key } });
    if (old) return false;

    const amount = this.dec(Number(input.order.actual_amount ?? 0));
    if (amount.lte(0)) return false;

    const order = await tx.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: input.soId } });
    const payNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_RECEIPT);
    const payMode = this.resolvePayMode(Number(input.order.payment_method));
    await tx.hspsi_sales_order_payment.create({
      data: {
        org_id: order.org_id,
        dept_id: 0n,
        pay_no: payNo,
        so_id: input.soId,
        so_pay_type: 1,
        pay_mode: payMode,
        fact_pay_amount: amount,
        pay_date:
          this.parseDate(input.order.pay_time) ??
          this.parseDate(input.order.created_at) ??
          input.now,
        request_key: key,
        remark: '',
        created_by: input.operatorId,
        updated_by: input.operatorId,
        created_at: input.now,
        updated_at: input.now,
      },
    });
    return true;
  }

  private async ensureStatusEvent(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeConferenceOrder;
      customerId: bigint;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<boolean> {
    const status = Number(input.order.order_status);
    const key = `HH-EVT-${input.sourceId}-${input.orderType}-${input.order.id}-STATUS-${status}`;
    const old = await tx.hspsi_sale_order_service.findFirst({
      where: { so_id: input.soId, remark: key, deleted_at: null },
    });
    if (old) return false;

    const eventType =
      status === HUASU_HOME_CONFERENCE_ORDER_STATUS.PAID
        ? 2
        : status === HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUND_APPLY ||
            status === HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUNDED
          ? 4
          : 11;
    const eventStatus =
      status === HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUND_APPLY ? 1 : 2;
    const serviceNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_SERVICE);
    await tx.hspsi_sale_order_service.create({
      data: {
        service_no: serviceNo,
        so_id: input.soId,
        customer_id: Number(input.customerId),
        goods_id: 0,
        sku_id: 0,
        event_type: eventType,
        event_content: this.resolveEventContent(input.order),
        event_status: eventStatus,
        handler_id: input.operatorId,
        event_date: input.now,
        remark: key,
        created_by: input.operatorId,
        updated_by: input.operatorId,
        created_at: input.now,
        updated_at: input.now,
      },
    });
    return true;
  }

  private async ensureTicketEvent(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeConferenceOrder;
      customerId: bigint;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<boolean> {
    const verifyStatus = Number(input.order.verify_status);
    const key = `HH-EVT-${input.sourceId}-${input.orderType}-${input.order.id}-TICKET-${verifyStatus}`;
    const old = await tx.hspsi_sale_order_service.findFirst({
      where: { so_id: input.soId, remark: key, deleted_at: null },
    });
    if (old) return false;

    const serviceNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_SERVICE);
    await tx.hspsi_sale_order_service.create({
      data: {
        service_no: serviceNo,
        so_id: input.soId,
        customer_id: Number(input.customerId),
        goods_id: 0,
        sku_id: 0,
        event_type: verifyStatus === HUASU_HOME_CONFERENCE_VERIFY_STATUS.VERIFIED ? 3 : 2,
        event_content: this.clip(input.order.remark ?? '', 255),
        event_status: 2,
        handler_id: input.operatorId,
        event_date: this.parseDate(input.order.verify_time) ?? input.now,
        remark: key,
        created_by: input.operatorId,
        updated_by: input.operatorId,
        created_at: input.now,
        updated_at: input.now,
      },
    });
    return true;
  }

  private async hasConfirmedOutput(tx: Tx, soId: bigint): Promise<boolean> {
    const count = await tx.hspsi_sale_order_output.count({
      where: { so_id: soId, comfirm_status: 1, deleted_at: null },
    });
    return count > 0;
  }

  private async ensureShipment(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeConferenceOrder;
      orgId: bigint;
      warehouseId: bigint;
      operatorId: bigint;
      now: Date;
      userId: string;
    },
  ): Promise<number> {
    const key = this.shipKey(input.sourceId, input.orderType, input.order.id);
    const existed = await tx.hspsi_sale_order_output.findFirst({
      where: { so_id: input.soId, remark: key, deleted_at: null },
    });
    if (existed) return 0;

    const shipLines = await this.buildShipLines(tx, input.sourceId, input.order);
    if (!shipLines.length) throw new BadRequestException('门票发货明细为空');

    const outputNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_OUTPUT);
    const outputDate = this.parseDate(input.order.verify_time) ?? input.now;
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
        output_sku_qty: new Set(shipLines.map((line) => `${line.goodsId}:${line.skuId}`)).size,
        status: true,
        comfirm_status: 1,
        comfirm_comment: '华溯之家会议门票核销同步自动确认',
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
        remark: '',
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

  private async ensureRefund(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeConferenceOrder;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<boolean> {
    const token = input.order.refund?.id ?? 'ALL';
    const key = this.refundKey(input.sourceId, input.orderType, input.order.id, token);
    const old = await tx.hspsi_sales_order_payment.findUnique({ where: { request_key: key } });
    if (old) return false;

    const refundAmount = Number(
      input.order.refund?.refund_amount ?? input.order.actual_amount ?? 0,
    );
    if (!(refundAmount > 0)) return false;

    const order = await tx.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: input.soId } });
    const payNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_REFUND);
    await tx.hspsi_sales_order_payment.create({
      data: {
        org_id: order.org_id,
        dept_id: 0n,
        pay_no: payNo,
        so_id: input.soId,
        so_pay_type: 2,
        pay_mode: this.resolvePayMode(Number(input.order.payment_method)),
        fact_pay_amount: this.dec(refundAmount),
        pay_date:
          this.parseDate(input.order.refund?.updated_at) ??
          this.parseDate(input.order.updated_at) ??
          input.now,
        request_key: key,
        remark: this.clip(input.order.refund?.reason || input.order.remark || '', 255),
        created_by: input.operatorId,
        updated_by: input.operatorId,
        created_at: input.now,
        updated_at: input.now,
      },
    });
    return true;
  }

  private async buildShipLines(
    tx: Tx,
    sourceId: bigint,
    order: HuasuHomeConferenceOrder,
  ): Promise<ShipLine[]> {
    const buyQty = Number(order.quantity);
    if (!(buyQty > 0)) throw new BadRequestException('门票购买数量无效');

    const packageItems = (order.package_items ?? []).filter(
      (row): row is HuasuHomeOrderPackageItem => !!row && Number(row.product_id) > 0,
    );
    if (!packageItems.length) {
      throw new BadRequestException('门票核销发货缺少 package_items');
    }

    const expanded: Array<{
      goodsId: bigint;
      skuId: bigint;
      unitType: number;
      quantity: number;
    }> = [];

    for (const pkgItem of packageItems) {
      const perSet = Number(pkgItem.number || 0) + Number(pkgItem.gift_number || 0);
      const quantity = perSet * buyQty;
      if (!(quantity > 0)) continue;
      const target = await this.resolveDefaultStandardSku(tx, sourceId, Number(pkgItem.product_id));
      expanded.push({
        goodsId: target.goodsId,
        skuId: target.skuId,
        unitType: target.unitType,
        quantity,
      });
    }

    const merged = new Map<
      string,
      { goodsId: bigint; skuId: bigint; unitType: number; quantity: number }
    >();
    for (const line of expanded) {
      const key = `${line.goodsId}:${line.skuId}`;
      const cur = merged.get(key);
      if (cur) cur.quantity += line.quantity;
      else merged.set(key, { ...line });
    }

    return [...merged.values()].map((line) => ({
      goodsId: line.goodsId,
      skuId: line.skuId,
      unitType: line.unitType,
      quantity: line.quantity,
      batchNo: '',
    }));
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

  private async resolveComboLine(
    tx: Tx,
    sourceId: bigint,
    order: HuasuHomeConferenceOrder,
  ): Promise<ResolvedOrderLine[]> {
    const packageId = Number(order.product_package_id);
    if (!(packageId > 0)) throw new BadRequestException('门票订单缺少 product_package_id');
    const quantity = Number(order.quantity);
    if (!(quantity > 0)) throw new BadRequestException('门票购买数量无效');

    const mapping = await tx.hspsi_goods_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_type: HUASU_HOME_SOURCE_TYPE.COMBO,
        source_goods_id: String(packageId),
        source_sku_id: '0',
        mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
        deleted_at: null,
      },
    });
    if (!mapping) {
      throw new BadRequestException(
        `商品未映射: type=${HUASU_HOME_SOURCE_TYPE.COMBO} goods=${packageId} sku=0`,
      );
    }
    const sku = await tx.hspsi_goods_info_sku.findFirst({
      where: { sku_id: mapping.sku_id, good_id: mapping.goods_id, deleted_at: null },
    });
    const goods = await tx.hspsi_goods_info.findFirst({
      where: { goods_id: mapping.goods_id, deleted_at: null },
    });
    if (!sku || !goods) {
      throw new BadRequestException(`映射商品不存在 goods=${mapping.goods_id} sku=${mapping.sku_id}`);
    }
    const price = Number(order.price ?? 0);
    return [
      {
        goodsId: mapping.goods_id,
        skuId: mapping.sku_id,
        unitType: Number(sku.unit_type ?? 0),
        quantity,
        price,
        amount: price * quantity,
        goodsType: Number(goods.goods_type ?? 1),
      },
    ];
  }

  private async ensureCustomer(
    tx: Tx,
    input: {
      sourceId: bigint;
      orgId: bigint;
      order: HuasuHomeConferenceOrder;
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
    order: HuasuHomeConferenceOrder,
  ): Promise<bigint> {
    const sourceOrgId = Number(order.user?.organization_id ?? 0);
    if (!(sourceOrgId > 0)) {
      throw new BadRequestException('门票订单缺少 user.organization_id');
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
    order: HuasuHomeConferenceOrder,
    existing: { so_id: bigint } | null,
    tx: Tx,
  ): Promise<{ orderStatus: number; deliveryStatus: number; serviceStatus: number }> {
    const status = Number(order.order_status);
    let orderStatus = 1;
    let deliveryStatus = this.shouldShip(order) && !this.isRefunded(order) ? 3 : 1;
    let serviceStatus = 3;

    if (status === HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUND_APPLY) {
      serviceStatus = 1;
    } else if (this.isRefunded(order)) {
      orderStatus = 3;
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

  private resolvePayMode(method: number): number {
    const mapped = HUASU_HOME_PAY_MODE_MAP[Number(method)];
    if (!mapped) throw new BadRequestException(`支付方式无效: ${method}`);
    return mapped;
  }

  private resolveEventContent(order: HuasuHomeConferenceOrder): string {
    const status = Number(order.order_status);
    if (
      status === HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUND_APPLY ||
      status === HUASU_HOME_CONFERENCE_ORDER_STATUS.REFUNDED
    ) {
      return this.clip(order.refund?.reason || order.refund?.remark || order.remark || '', 255);
    }
    return this.clip(order.remark ?? '', 255);
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

  private payKey(sourceId: bigint, orderType: string, orderId: number | string) {
    return `HH-PAY-${sourceId}-${orderType}-${orderId}`;
  }

  private refundKey(
    sourceId: bigint,
    orderType: string,
    orderId: number | string,
    token: number | string,
  ) {
    return `HH-REFUND-${sourceId}-${orderType}-${orderId}-${token}`;
  }

  private shipKey(sourceId: bigint, orderType: string, shipmentId: number | string) {
    return `HH-SHIP-${sourceId}-${orderType}-${shipmentId}`;
  }

  private async markMappingFailed(
    sourceId: bigint,
    order: HuasuHomeConferenceOrder,
    reason: string,
    userId: string,
  ) {
    const now = new Date();
    const orderType = HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET;
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
      source_order_no: String(order.order_sn ?? ''),
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
        source_status: Number(order.order_status ?? 0),
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
        source_order_type: HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET,
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
        source_order_type: HUASU_HOME_ORDER_TYPE.CONFERENCE_TICKET,
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
      throw new BadRequestException('华溯会议门票订单同步仍在进行，请稍后再试');
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
