import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BUSINESS_PREFIX } from '../../../business-number/business-number.constants';
import { BusinessNumberService } from '../../../business-number/business-number.service';
import { PrismaService } from '../../../database/prisma.service';
import { INVENTORY_BUSINESS_MODE } from '../../../inventory/inventory-dictionary';
import { ExternalInventoryPostingService } from '../../common/external-inventory-posting.service';
import {
  SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
  SHIFANG_QINGYUAN_DATA_SOURCE_NAME,
  SHIFANG_QINGYUAN_FEEDBACK,
  SHIFANG_QINGYUAN_GOODS_CATEGORY_ID,
  SHIFANG_QINGYUAN_MAPPING_STATUS,
  SHIFANG_QINGYUAN_ORDER_SHIPPED_STATUSES,
  SHIFANG_QINGYUAN_ORDER_STATUS,
  SHIFANG_QINGYUAN_ORDER_SYNC_STATUS,
  SHIFANG_QINGYUAN_ORDER_SYNCABLE_STATUSES,
  SHIFANG_QINGYUAN_ORDER_TYPE,
  SHIFANG_QINGYUAN_PAY_MODE_MAP,
  SHIFANG_QINGYUAN_PAY_STATUS,
  SHIFANG_QINGYUAN_REFUND_DONE_STATUSES,
  SHIFANG_QINGYUAN_REFUND_REJECTED_STATUSES,
  SHIFANG_QINGYUAN_REFUND_TYPE,
  SHIFANG_QINGYUAN_RULE_STATUS,
  SHIFANG_QINGYUAN_RULE_TYPE,
  SHIFANG_QINGYUAN_STOCK_FLOW,
} from '../shifang-qingyuan.constants';
import { SALES_ORDER_TYPE } from '../../../sales/sales-helpers';
import { ShifangQingyuanService } from '../shifang-qingyuan.service';
import type {
  ShifangQingyuanOrder,
  ShifangQingyuanOrderDetail,
  ShifangQingyuanOrderDetailData,
  ShifangQingyuanOrderRefund,
} from '../shifang-qingyuan.types';
import type {
  ShifangQingyuanOrderSyncOptions,
  ShifangQingyuanOrderSyncStats,
} from './order-sync.types';

type Tx = Prisma.TransactionClient;

type ResolvedOrderLine = {
  goodsId: bigint;
  skuId: bigint;
  unitType: number;
  quantity: number;
  price: number;
  amount: number;
  goodsType: number;
  sourceDetailId: number;
};

type ShipLine = {
  goodsId: bigint;
  skuId: bigint;
  unitType: number;
  quantity: number;
  batchNo: string;
};

type RefundPhase = 'PROCESSING' | 'REJECTED' | 'SUCCESS';

/** 分页拉取每页条数（接口最大 100） */
const PAGE_LIMIT = 100;

/**
 * 十方清源订单同步
 *
 * 对应 docs/global/integrations/shifang-qingyuan/订单同步.md
 */
@Injectable()
export class ShifangQingyuanOrderSyncService {
  private static readonly logger = new Logger(ShifangQingyuanOrderSyncService.name);
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShifangQingyuanService) private readonly shifangQingyuan: ShifangQingyuanService,
    @Inject(BusinessNumberService) private readonly businessNumber: BusinessNumberService,
    @Inject(ExternalInventoryPostingService)
    private readonly externalPosting: ExternalInventoryPostingService,
  ) {}

  /** 批量同步：按 start_time 增量拉列表（list 已含全量）→ applyOrder */
  async syncOrders(
    userId = '0',
    options: ShifangQingyuanOrderSyncOptions = {},
  ): Promise<ShifangQingyuanOrderSyncStats> {
    return this.withSyncLock(() => this.syncOrdersUnlocked(userId, options));
  }

  private async syncOrdersUnlocked(
    userId: string,
    options: ShifangQingyuanOrderSyncOptions,
  ): Promise<ShifangQingyuanOrderSyncStats> {
    const stats = this.emptyStats();
    const sourceId = await this.ensureDataSource(userId);
    const startTime =
      options.start_time?.trim() || (await this.resolveListStartTime(sourceId));
    const endTime = options.end_time?.trim() || undefined;
    let page = options.page && options.page > 0 ? options.page : 1;
    const limit = PAGE_LIMIT;

    for (;;) {
      const data = await this.shifangQingyuan.getOrderList({
        page,
        limit,
        start_time: startTime,
        end_time: endTime,
        pay_status: options.pay_status ?? SHIFANG_QINGYUAN_PAY_STATUS.PAID,
        ...(options.order_status != null ? { order_status: options.order_status } : {}),
        ...(options.order_no ? { order_no: options.order_no } : {}),
      });
      const list = data.list ?? [];
      for (const item of list) {
        stats.fetched += 1;
        await this.applyOrderSafe(item, sourceId, userId, stats);
      }
      if (!list.length || list.length < limit) break;
      page += 1;
    }

    ShifangQingyuanOrderSyncService.logger.log(
      `[shifang-qingyuan] order sync done: ${JSON.stringify({
        startTime,
        endTime,
        ...stats,
        failures: stats.failures.length,
        warnings: stats.warnings.length,
      })}`,
    );
    return stats;
  }

  /** 单笔同步：按十方 order_no 拉列表（list 已含全量）后 applyOrder */
  async syncOrderByNo(orderNo: string, userId = '0'): Promise<ShifangQingyuanOrderSyncStats> {
    return this.withSyncLock(() => this.syncOrderByNoUnlocked(orderNo, userId));
  }

  private async syncOrderByNoUnlocked(
    orderNo: string,
    userId: string,
  ): Promise<ShifangQingyuanOrderSyncStats> {
    const stats = this.emptyStats();
    const sourceId = await this.ensureDataSource(userId);
    const data = await this.shifangQingyuan.getOrderList({
      order_no: orderNo,
      limit: 1,
    });
    const item = data.list?.[0];
    if (!item?.order?.id) {
      throw new BadRequestException(`十方清源订单不存在: ${orderNo}`);
    }
    stats.fetched = 1;
    await this.applyOrderSafe(item, sourceId, userId, stats);
    return stats;
  }

  private async withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running) {
      throw new BadRequestException('十方清源订单同步仍在进行，请稍后再试');
    }
    this.running = true;
    try {
      return await fn();
    } finally {
      this.running = false;
    }
  }

  private async applyOrderSafe(
    snapshot: ShifangQingyuanOrderDetailData,
    sourceId: bigint,
    userId: string,
    stats: ShifangQingyuanOrderSyncStats,
  ) {
    const order = snapshot.order;
    try {
      await this.applyOrder(snapshot, sourceId, userId, stats);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      stats.failed += 1;
      stats.failures.push({
        sourceOrderId: String(order.id),
        orderNo: String(order.order_no ?? ''),
        reason,
      });
      await this.markMappingFailed(sourceId, snapshot, reason, userId).catch(() => undefined);
      ShifangQingyuanOrderSyncService.logger.warn(
        `[shifang-qingyuan] order ${order.id}/${order.order_no} sync failed: ${reason}`,
      );
    }
  }

  private async applyOrder(
    snapshot: ShifangQingyuanOrderDetailData,
    sourceId: bigint,
    userId: string,
    stats: ShifangQingyuanOrderSyncStats,
  ) {
    const order = snapshot.order;
    const payStatus = Number(order.pay_status);
    const orderStatus = Number(order.order_status);

    if (
      payStatus !== SHIFANG_QINGYUAN_PAY_STATUS.PAID ||
      orderStatus === SHIFANG_QINGYUAN_ORDER_STATUS.PENDING_PAY
    ) {
      stats.skipped += 1;
      return;
    }
    if (!SHIFANG_QINGYUAN_ORDER_SYNCABLE_STATUSES.has(orderStatus)) {
      stats.skipped += 1;
      return;
    }

    const orderType = SHIFANG_QINGYUAN_ORDER_TYPE.SALE_ORDER;
    const sourceOrderId = String(order.id);
    const sourceUpdatedAt =
      this.parseUnix(order.updated_at) ?? this.parseUnix(order.created_at);
    const operatorId = BigInt(userId);
    const now = new Date();
    const payload = JSON.stringify(snapshot);

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
      existing.sync_status === SHIFANG_QINGYUAN_ORDER_SYNC_STATUS.SUCCESS &&
      existing.so_id > 0n &&
      sourceUpdatedAt &&
      existing.source_updated_at &&
      existing.source_updated_at.getTime() === sourceUpdatedAt.getTime() &&
      existing.source_status === orderStatus
    ) {
      stats.skipped += 1;
      return;
    }

    // 事务成功后才累加业务计数，避免中途失败导致 created/failed 双计
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
        const orgId = await this.resolveOrgId(tx, sourceId, order.mall_id);
        const warehouseId = await this.resolveWarehouseId(tx, orgId);
        const customerId = await this.ensureCustomer(tx, {
          sourceId,
          orgId,
          order,
          operatorId,
          now,
        });
        const lines = await this.resolveOrderLines(tx, sourceId, snapshot.details ?? []);
        const statusTriple = await this.mapPlatformStatus(
          snapshot,
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
                source_order_no: String(order.order_no ?? ''),
                so_id: 0n,
                source_status: 0,
                sync_status: SHIFANG_QINGYUAN_ORDER_SYNC_STATUS.RETRY,
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
          snapshot,
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
            source_order_no: String(order.order_no ?? ''),
            updated_by: operatorId,
            updated_at: now,
          },
        });

        if (
          await this.ensurePayment(tx, {
            soId,
            sourceId,
            orderType,
            order,
            operatorId,
            now,
          })
        ) {
          delta.payments += 1;
        }

        const shouldShip =
          !this.isCloudStockInbound(snapshot) &&
          (SHIFANG_QINGYUAN_ORDER_SHIPPED_STATUSES.has(orderStatus) ||
            (snapshot.express?.length ?? 0) > 0 ||
            Number(order.shipping_status) === 1);
        if (shouldShip) {
          const shipped = await this.ensureShipments(tx, {
            soId,
            sourceId,
            orderType,
            snapshot,
            lines,
            orgId,
            warehouseId,
            operatorId,
            now,
            userId,
          });
          delta.outputs += shipped;
        }

        const afterSales = await this.ensureAfterSales(tx, {
          soId,
          sourceId,
          orderType,
          snapshot,
          lines,
          customerId,
          orgId,
          warehouseId,
          operatorId,
          now,
          userId,
        });
        delta.payments += afterSales.payments;
        delta.exits += afterSales.exits;
        delta.events += afterSales.events;

        await tx.hspsi_sale_order_source_mapping.update({
          where: { id: mapping.id },
          data: {
            so_id: soId,
            source_status: orderStatus,
            source_updated_at: sourceUpdatedAt,
            last_payload: payload,
            last_error_payload: null,
            sync_status: SHIFANG_QINGYUAN_ORDER_SYNC_STATUS.SUCCESS,
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

  private async upsertSaleOrder(
    tx: Tx,
    input: {
      mappingId: bigint;
      existingSoId: bigint | null;
      sourceId: bigint;
      orgId: bigint;
      warehouseId: bigint;
      customerId: bigint;
      snapshot: ShifangQingyuanOrderDetailData;
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
      snapshot,
      lines,
      statusTriple,
      operatorId,
      now,
    } = input;
    const order = snapshot.order;
    const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);
    const soAmountNum = Number(order.original_goods_price || order.goods_price || 0);
    const factAmountNum = Number(order.pay_money || 0);
    const totalAmount = this.dec(soAmountNum);
    const factAmount = this.dec(factAmountNum);
    const priceoff = this.dec(Math.max(soAmountNum - factAmountNum, 0));
    const address = this.formatAddress(order);
    const tracking = this.formatTrackingNos(snapshot);
    const soType = this.resolveSoType(snapshot, lines);
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
      customer_name: this.clip(order.receiver_name || customer.name || '', 30),
      customer_mobile: this.clip(order.mobile || customer.mobile || '', 20),
      customer_address: this.clip(address, 100),
      order_date: this.parseUnix(order.created_at) ?? now,
      sales_name: '',
      sales_mobile: '',
      so_qty: totalQty,
      so_amount: totalAmount,
      fact_amount: factAmount,
      priceoff_amount: priceoff,
      order_status: statusTriple.orderStatus,
      delivery_status: statusTriple.deliveryStatus,
      service_status: statusTriple.serviceStatus,
      shipper: tracking,
      delivery_date:
        statusTriple.deliveryStatus >= 3 ? (this.shipmentDate(snapshot) ?? now) : null,
      status: 1,
      approve_status: 1,
      approve_comment: '十方清源已支付订单同步',
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
          shipper: tracking || old.shipper,
          delivery_date: headerData.delivery_date ?? old.delivery_date,
        },
      });
      // 明细以外部为准全量替换（仅未出库前；已有确认出库则不改明细避免与库存冲突）
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
      order: ShifangQingyuanOrder;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<boolean> {
    const key = this.payKey(input.sourceId, input.orderType, input.order.id);
    const old = await tx.hspsi_sales_order_payment.findUnique({ where: { request_key: key } });
    if (old) return false;

    const amount = this.dec(Number(input.order.pay_money ?? 0));
    if (amount.lte(0)) return false;

    const occurredAt =
      this.parseUnix(input.order.pay_time) ??
      this.parseUnix(input.order.created_at) ??
      input.now;

    const order = await tx.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: input.soId } });
    const payNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_RECEIPT);
    const payMode = this.resolvePayMode(Number(input.order.payment_type));
    await tx.hspsi_sales_order_payment.create({
      data: {
        org_id: order.org_id,
        dept_id: 0n,
        pay_no: payNo,
        so_id: input.soId,
        so_pay_type: 1,
        pay_mode: payMode,
        fact_pay_amount: amount,
        pay_date: occurredAt,
        request_key: key,
        remark: '',
        created_by: input.operatorId,
        updated_by: input.operatorId,
        created_at: occurredAt,
        updated_at: input.now,
      },
    });
    return true;
  }

  private async ensureShipments(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      snapshot: ShifangQingyuanOrderDetailData;
      lines: ResolvedOrderLine[];
      orgId: bigint;
      warehouseId: bigint;
      operatorId: bigint;
      now: Date;
      userId: string;
    },
  ): Promise<number> {
    const expressList = input.snapshot.express?.filter((item) => item && item.id != null) ?? [];
    const keys =
      expressList.length > 0
        ? [
            {
              key: this.shipKey(input.sourceId, input.orderType, expressList[0]!.id),
              shipmentId: String(expressList[0]!.id),
            },
          ]
        : [
            {
              key: this.shipKey(input.sourceId, input.orderType, 'ALL'),
              shipmentId: 'ALL',
            },
          ];

    let created = 0;
    for (const item of keys) {
      const existed = await tx.hspsi_sale_order_output.findFirst({
        where: { so_id: input.soId, remark: item.key, deleted_at: null },
      });
      if (existed) continue;

      const shipLines = await this.buildShipLines(tx, input.lines);
      if (!shipLines.length) throw new BadRequestException('发货明细为空');

      const outputNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_OUTPUT);
      const output = await tx.hspsi_sale_order_output.create({
        data: {
          so_output_no: outputNo,
          so_id: input.soId,
          org_id: input.orgId,
          warehouse_id: input.warehouseId,
          output_date: this.shipmentDate(input.snapshot) ?? input.now,
          go_where: 1,
          dept_id: 0n,
          receiver_id: input.operatorId,
          output_sku_qty: new Set(shipLines.map((line) => `${line.goodsId}:${line.skuId}`)).size,
          status: true,
          comfirm_status: 1,
          comfirm_comment: '十方清源外部发货同步自动确认',
          comfirm_by: input.operatorId,
          comfirm_date: input.now,
          posting_version: 1,
          remark: item.key,
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
          idempotencyKey: `shifang-qingyuan-output:${item.key}:v1`,
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
          delivery_date: this.shipmentDate(input.snapshot) ?? input.now,
          shipper: this.formatTrackingNos(input.snapshot),
          updated_by: input.operatorId,
          updated_at: input.now,
        },
      });
      created += 1;
    }
    return created;
  }

  private async ensureAfterSales(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      snapshot: ShifangQingyuanOrderDetailData;
      lines: ResolvedOrderLine[];
      customerId: bigint;
      orgId: bigint;
      warehouseId: bigint;
      operatorId: bigint;
      now: Date;
      userId: string;
    },
  ): Promise<{ payments: number; exits: number; events: number }> {
    const result = { payments: 0, exits: 0, events: 0 };
    const refunds = input.snapshot.refunds ?? [];
    if (!refunds.length) return result;

    const order = input.snapshot.order;

    for (const refund of refunds) {
      const phase = this.resolveRefundPhase(refund);
      const type = Number(refund.type);

      if (phase === 'PROCESSING') {
        if (
          await this.ensureAfterSalesEvent(tx, {
            soId: input.soId,
            sourceId: input.sourceId,
            orderType: input.orderType,
            order,
            refund,
            lines: input.lines,
            customerId: input.customerId,
            operatorId: input.operatorId,
            now: input.now,
            eventStatus: 1,
            phase,
          })
        ) {
          result.events += 1;
        }
        await tx.hspsi_sale_order.update({
          where: { so_id: input.soId },
          data: {
            service_status: 1,
            updated_by: input.operatorId,
            updated_at: input.now,
          },
        });
        continue;
      }

      if (phase === 'REJECTED') {
        if (
          await this.ensureAfterSalesEvent(tx, {
            soId: input.soId,
            sourceId: input.sourceId,
            orderType: input.orderType,
            order,
            refund,
            lines: input.lines,
            customerId: input.customerId,
            operatorId: input.operatorId,
            now: input.now,
            eventStatus: 3,
            phase,
          })
        ) {
          result.events += 1;
        }
        continue;
      }

      // SUCCESS
      if (
        await this.ensureAfterSalesEvent(tx, {
          soId: input.soId,
          sourceId: input.sourceId,
          orderType: input.orderType,
          order,
          refund,
          lines: input.lines,
          customerId: input.customerId,
          operatorId: input.operatorId,
          now: input.now,
          eventStatus: 2,
          phase,
        })
      ) {
        result.events += 1;
      }

      const refundAmount =
        Number(refund.reality_refund_price || 0) > 0
          ? Number(refund.reality_refund_price)
          : Number(refund.refund_price || 0);

      if (type !== SHIFANG_QINGYUAN_REFUND_TYPE.EXCHANGE && refundAmount > 0) {
        const key = this.refundKey(input.sourceId, input.orderType, order.id, refund.id);
        const old = await tx.hspsi_sales_order_payment.findUnique({ where: { request_key: key } });
        if (!old) {
          const so = await tx.hspsi_sale_order.findUniqueOrThrow({
            where: { so_id: input.soId },
          });
          const occurredAt = this.resolveRefundOccurredAt(refund, input.now);
          const payNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_REFUND);
          await tx.hspsi_sales_order_payment.create({
            data: {
              org_id: so.org_id,
              dept_id: 0n,
              pay_no: payNo,
              so_id: input.soId,
              so_pay_type: 2,
              pay_mode: this.resolvePayMode(Number(order.payment_type)),
              fact_pay_amount: this.dec(refundAmount),
              pay_date: occurredAt,
              request_key: key,
              remark: this.clip(refund.reason || refund.remark || order.remark || '', 255),
              created_by: input.operatorId,
              updated_by: input.operatorId,
              created_at: occurredAt,
              updated_at: input.now,
            },
          });
          result.payments += 1;
        }
      }

      if (type === SHIFANG_QINGYUAN_REFUND_TYPE.RETURN_REFUND) {
        if (this.isCloudStockInbound(input.snapshot)) continue;
        const exitKey = this.exitKey(input.sourceId, input.orderType, order.id, refund.id);
        const existed = await tx.hspsi_sale_order_exit.findFirst({
          where: { so_id: input.soId, remark: exitKey, deleted_at: null },
        });
        if (!existed) {
          const returnLines = await this.buildReturnLinesFromRefund(tx, {
            sourceId: input.sourceId,
            refund,
            lines: input.lines,
            details: input.snapshot.details ?? [],
          });
          if (returnLines.length > 0) {
            const output = await tx.hspsi_sale_order_output.findFirst({
              where: { so_id: input.soId, comfirm_status: 1, deleted_at: null },
              orderBy: { so_output_id: 'asc' },
            });
            const exitNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_RETURN);
            const so = await tx.hspsi_sale_order.findUniqueOrThrow({
              where: { so_id: input.soId },
            });
            const exitQty = returnLines.reduce((sum, line) => sum + line.quantity, 0);
            const exit = await tx.hspsi_sale_order_exit.create({
              data: {
                so_exit_no: exitNo,
                so_id: input.soId,
                source_output_id: output?.so_output_id ?? 0n,
                exit_reson: this.clip(refund.reason || order.remark || '', 255),
                exit_qty: exitQty,
                disposal_type: 1,
                org_id: input.orgId,
                warehouse_id: input.warehouseId,
                exit_date: input.now,
                dept_id: 0n,
                receiver_id: input.operatorId,
                customer_id: so.customer_id,
                customer_name: so.customer_name,
                customer_mobile: so.customer_mobile,
                customer_address: so.customer_address,
                sales_name: so.sales_name,
                sales_mobile: so.sales_mobile,
                status: true,
                comfirm_status: 1,
                comfirm_comment: '十方清源售后退货同步自动确认',
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
                remark: this.clip(refund.reason || refund.remark || '', 255),
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
                idempotencyKey: `shifang-qingyuan-exit:${exitKey}:v1`,
                remark: this.clip(refund.reason || refund.remark || '', 255),
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
        }
      }

      await tx.hspsi_sale_order.update({
        where: { so_id: input.soId },
        data: {
          service_status: 2,
          order_status:
            Number(order.order_status) === SHIFANG_QINGYUAN_ORDER_STATUS.CLOSED ? 3 : 2,
          updated_by: input.operatorId,
          updated_at: input.now,
        },
      });
    }

    return result;
  }

  private async ensureAfterSalesEvent(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: ShifangQingyuanOrder;
      refund: ShifangQingyuanOrderRefund;
      lines: ResolvedOrderLine[];
      customerId: bigint;
      operatorId: bigint;
      now: Date;
      eventStatus: number;
      phase: RefundPhase;
    },
  ): Promise<boolean> {
    const key = `SFQY-EVT-${input.sourceId}-${input.orderType}-${input.order.id}-AS-${input.refund.id}-${input.phase}`;
    const old = await tx.hspsi_sale_order_service.findFirst({
      where: { so_id: input.soId, remark: key, deleted_at: null },
    });
    if (old) return false;

    const type = Number(input.refund.type);
    const eventType = type === SHIFANG_QINGYUAN_REFUND_TYPE.EXCHANGE ? 5 : 4;
    const content =
      input.eventStatus === 3
        ? this.clip(input.refund.refuse_remark || input.refund.remark || '', 255)
        : this.clip(input.refund.reason || input.refund.remark || input.order.remark || '', 255);

    const goodsLine = this.resolveRefundGoodsLine(input.refund, input.lines);
    const occurredAt = this.resolveRefundOccurredAt(input.refund, input.now);

    const serviceNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_SERVICE);
    await tx.hspsi_sale_order_service.create({
      data: {
        service_no: serviceNo,
        so_id: input.soId,
        customer_id: Number(input.customerId),
        goods_id: goodsLine ? Number(goodsLine.goodsId) : 0,
        sku_id: goodsLine ? Number(goodsLine.skuId) : 0,
        event_type: eventType,
        event_content: content,
        event_status: input.eventStatus,
        handler_id: input.operatorId,
        event_date: occurredAt,
        remark: key,
        created_by: input.operatorId,
        updated_by: input.operatorId,
        created_at: occurredAt,
        updated_at: input.now,
      },
    });
    return true;
  }

  /** refund.order_detail_id → 已解析的平台下单行 */
  private resolveRefundGoodsLine(
    refund: ShifangQingyuanOrderRefund,
    lines: ResolvedOrderLine[],
  ): ResolvedOrderLine | null {
    const detailId = Number(refund.order_detail_id);
    if (!(detailId > 0)) return lines[0] ?? null;
    return lines.find((line) => line.sourceDetailId === detailId) ?? lines[0] ?? null;
  }

  /** 售后/退款业务时间：打款时间 → 更新时间 → 创建时间 */
  private resolveRefundOccurredAt(refund: ShifangQingyuanOrderRefund, fallback: Date): Date {
    return (
      this.parseUnix(refund.refund_at) ??
      this.parseUnix(refund.updated_at) ??
      this.parseUnix(refund.created_at) ??
      fallback
    );
  }

  /**
   * 出库明细：按订单行查 conversion_rule（启用 + REPLACE/COMBO_SPLIT）；
   * 有则 qty * quantity_ratio，无则原下单 SKU。合并同 goods:sku；空批号。
   */
  private async buildShipLines(tx: Tx, orderLines: ResolvedOrderLine[]): Promise<ShipLine[]> {
    const expanded: Array<{
      goodsId: bigint;
      skuId: bigint;
      unitType: number;
      quantity: number;
    }> = [];

    for (const orderLine of orderLines) {
      if (!(orderLine.quantity > 0)) continue;

      const rules = await tx.hspsi_goods_sku_conversion_rule.findMany({
        where: {
          source_goods_id: orderLine.goodsId,
          source_sku_id: orderLine.skuId,
          rule_type: {
            in: [
              SHIFANG_QINGYUAN_RULE_TYPE.REPLACE,
              SHIFANG_QINGYUAN_RULE_TYPE.COMBO_SPLIT,
            ],
          },
          status: SHIFANG_QINGYUAN_RULE_STATUS.ENABLED,
          deleted_at: null,
        },
      });

      if (!rules.length) {
        expanded.push({
          goodsId: orderLine.goodsId,
          skuId: orderLine.skuId,
          unitType: orderLine.unitType,
          quantity: orderLine.quantity,
        });
        continue;
      }

      for (const rule of rules) {
        const targetSku = await tx.hspsi_goods_info_sku.findFirst({
          where: {
            sku_id: rule.target_sku_id,
            good_id: rule.target_goods_id,
            deleted_at: null,
          },
        });
        expanded.push({
          goodsId: rule.target_goods_id,
          skuId: rule.target_sku_id,
          unitType: targetSku?.unit_type ?? orderLine.unitType,
          quantity: orderLine.quantity * Math.max(1, Number(rule.quantity_ratio || 1)),
        });
      }
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

  /** 售后退货入库：关联 order_detail_id → 平台 mapping + refund.num；无法解析返回空 */
  private async buildReturnLinesFromRefund(
    tx: Tx,
    input: {
      sourceId: bigint;
      refund: ShifangQingyuanOrderRefund;
      lines: ResolvedOrderLine[];
      details: ShifangQingyuanOrderDetail[];
    },
  ): Promise<ShipLine[]> {
    const qty = Math.max(1, Number(input.refund.num || 0));
    const detailId = Number(input.refund.order_detail_id);
    let line = input.lines.find((item) => item.sourceDetailId === detailId);

    if (!line) {
      const detail = input.details.find((item) => Number(item.id) === detailId);
      if (!detail) return [];
      try {
        const resolved = await this.resolveOrderLines(tx, input.sourceId, [detail]);
        line = resolved[0];
      } catch {
        return [];
      }
    }
    if (!line) return [];

    return [
      {
        goodsId: line.goodsId,
        skuId: line.skuId,
        unitType: line.unitType,
        quantity: qty,
        batchNo: '',
      },
    ];
  }

  private async resolveOrderLines(
    tx: Tx,
    sourceId: bigint,
    details: ShifangQingyuanOrderDetail[],
  ): Promise<ResolvedOrderLine[]> {
    if (!details.length) throw new BadRequestException('订单明细为空');
    const lines: ResolvedOrderLine[] = [];
    for (const detail of details) {
      const sourceGoodsId = String(detail.goods_id);
      if (!detail.goods_attr_id) {
        throw new BadRequestException(
          `订单明细缺少规格ID: detail=${detail.id} goods=${sourceGoodsId}`,
        );
      }
      const sourceSkuId = String(detail.goods_attr_id);
      const mapping = await tx.hspsi_goods_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_goods_id: sourceGoodsId,
          source_sku_id: sourceSkuId,
          mapping_status: SHIFANG_QINGYUAN_MAPPING_STATUS.MAPPED,
          deleted_at: null,
        },
      });
      if (!mapping) {
        throw new BadRequestException(
          `商品未映射: goods=${sourceGoodsId} sku=${sourceSkuId}`,
        );
      }
      const sku = await tx.hspsi_goods_info_sku.findFirst({
        where: { sku_id: mapping.sku_id, good_id: mapping.goods_id, deleted_at: null },
      });
      const goods = await tx.hspsi_goods_info.findFirst({
        where: { goods_id: mapping.goods_id, deleted_at: null },
      });
      if (!sku || !goods) {
        throw new BadRequestException(
          `映射商品不存在 goods=${mapping.goods_id} sku=${mapping.sku_id}`,
        );
      }
      const quantity = Number(detail.num);
      if (!(quantity > 0)) {
        throw new BadRequestException(`订单行数量无效 detail=${detail.id}`);
      }
      const price = Number(detail.price ?? 0);
      const amount = Number(detail.goods_price) || price * quantity;
      lines.push({
        goodsId: mapping.goods_id,
        skuId: mapping.sku_id,
        unitType: Number(sku.unit_type ?? 0),
        quantity,
        price,
        amount,
        goodsType: Number(goods.goods_type ?? 1),
        sourceDetailId: Number(detail.id),
      });
    }
    return lines;
  }

  private async ensureCustomer(
    tx: Tx,
    input: {
      sourceId: bigint;
      orgId: bigint;
      order: ShifangQingyuanOrder;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<bigint> {
    const userId = BigInt(input.order.user_id ?? 0);
    if (!(userId > 0n)) throw new BadRequestException('订单缺少用户 id');
    const sourceType = Number(input.sourceId);
    if (!Number.isSafeInteger(sourceType) || sourceType > 255) {
      throw new BadRequestException(
        `数据源 id=${input.sourceId} 超出客户 source_type(tinyint) 范围，请调整字段类型`,
      );
    }

    const existing = await tx.hspsi_basic_customer.findFirst({
      where: {
        source_type: sourceType,
        related_customer_id: userId,
        deleted_at: null,
      },
    });
    const address = this.formatAddress(input.order);
    if (existing) {
      await tx.hspsi_basic_customer.update({
        where: { customer_id: existing.customer_id },
        data: {
          address: this.clip(address, 255),
          updated_by: input.operatorId,
          updated_at: input.now,
        },
      });
      return existing.customer_id;
    }

    const name = this.clip(input.order.receiver_name || `用户${userId}`, 100);
    const mobile = this.clip(input.order.mobile || '', 20);
    const created = await tx.hspsi_basic_customer.create({
      data: {
        org_id: input.orgId,
        name,
        gender: 0,
        mobile,
        address: this.clip(address, 255),
        referrer_name: '',
        referrer_mobile: '',
        source_type: sourceType,
        related_customer_id: userId,
        status: 1,
        remark: '',
        levels: [] as unknown as Prisma.InputJsonValue,
        created_by: input.operatorId,
        updated_by: input.operatorId,
        created_at: input.now,
        updated_at: input.now,
      },
    });
    return created.customer_id;
  }

  private async resolveOrgId(tx: Tx, sourceId: bigint, mallId: number): Promise<bigint> {
    const mapping = await tx.hspsi_sys_organization_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_object_id: String(mallId),
        deleted_at: null,
      },
    });
    if (!mapping || !(mapping.org_id > 0n)) {
      throw new BadRequestException(`机构未映射: mall_id=${mallId}`);
    }
    return mapping.org_id;
  }

  private async resolveWarehouseId(tx: Tx, orgId: bigint): Promise<bigint> {
    if (!(SHIFANG_QINGYUAN_GOODS_CATEGORY_ID > 0n)) {
      throw new BadRequestException('请先配置 SHIFANG_QINGYUAN_GOODS_CATEGORY_ID');
    }
    const category = await tx.hspsi_goods_info_category.findFirst({
      where: { goods_catg_id: SHIFANG_QINGYUAN_GOODS_CATEGORY_ID, deleted_at: null },
    });
    if (!category) throw new BadRequestException('十方清源商品分类不存在');
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
    snapshot: ShifangQingyuanOrderDetailData,
    existing: { so_id: bigint } | null,
    tx: Tx,
  ): Promise<{ orderStatus: number; deliveryStatus: number; serviceStatus: number }> {
    let deliveryStatus = 1;
    let orderStatus = 1;
    let serviceStatus = 3;
    const order = snapshot.order;
    const status = Number(order.order_status);

    switch (status) {
      case SHIFANG_QINGYUAN_ORDER_STATUS.PENDING_SHIP:
      case SHIFANG_QINGYUAN_ORDER_STATUS.PENDING_PICKUP:
        orderStatus = 1;
        deliveryStatus = 1;
        serviceStatus = 3;
        break;
      case SHIFANG_QINGYUAN_ORDER_STATUS.SHIPPED:
      case SHIFANG_QINGYUAN_ORDER_STATUS.RECEIVED:
      case SHIFANG_QINGYUAN_ORDER_STATUS.PICKUP_DONE:
        orderStatus = 1;
        deliveryStatus = 3;
        serviceStatus = 3;
        break;
      case SHIFANG_QINGYUAN_ORDER_STATUS.COMPLETED:
        orderStatus = 2;
        deliveryStatus = 3;
        serviceStatus = 3;
        break;
      case SHIFANG_QINGYUAN_ORDER_STATUS.CLOSED:
        orderStatus = 3;
        deliveryStatus = 1;
        serviceStatus = 2;
        break;
      default:
        orderStatus = 1;
        deliveryStatus = 1;
        serviceStatus = 3;
    }

    if (this.isCloudStockInbound(snapshot)) {
      deliveryStatus = 1;
    }

    const refunds = snapshot.refunds ?? [];
    const hasProcessingRefund = refunds.some(
      (refund) => this.resolveRefundPhase(refund) === 'PROCESSING',
    );
    const hasSuccessfulRefund = refunds.some(
      (refund) => this.resolveRefundPhase(refund) === 'SUCCESS',
    );
    const isFeedback = Number(order.is_feedback);

    if (hasProcessingRefund || isFeedback === SHIFANG_QINGYUAN_FEEDBACK.PROCESSING) {
      serviceStatus = 1;
      if (status !== SHIFANG_QINGYUAN_ORDER_STATUS.CLOSED) {
        orderStatus = 1;
      }
    } else if (
      hasSuccessfulRefund &&
      isFeedback === SHIFANG_QINGYUAN_FEEDBACK.DONE
    ) {
      serviceStatus = 2;
      orderStatus =
        status === SHIFANG_QINGYUAN_ORDER_STATUS.CLOSED ? 3 : 2;
    }

    if (existing?.so_id) {
      const old = await tx.hspsi_sale_order.findFirst({
        where: { so_id: existing.so_id, deleted_at: null },
      });
      if (old) {
        deliveryStatus = Math.max(Number(old.delivery_status), deliveryStatus);
        if (
          status === SHIFANG_QINGYUAN_ORDER_STATUS.CLOSED ||
          hasProcessingRefund ||
          hasSuccessfulRefund
        ) {
          deliveryStatus = Math.max(Number(old.delivery_status), deliveryStatus);
        }
      }
    }

    return { orderStatus, deliveryStatus, serviceStatus };
  }

  private resolveRefundPhase(refund: ShifangQingyuanOrderRefund): RefundPhase {
    if (
      Number(refund.is_refund) === 1 ||
      SHIFANG_QINGYUAN_REFUND_DONE_STATUSES.has(Number(refund.refund_status))
    ) {
      return 'SUCCESS';
    }
    if (SHIFANG_QINGYUAN_REFUND_REJECTED_STATUSES.has(Number(refund.refund_status))) {
      return 'REJECTED';
    }
    return 'PROCESSING';
  }

  private forwardOrderStatus(oldStatus: number, next: number): number {
    // 1正常 < 2结束 < 3关闭；不允许回退
    if (oldStatus === 3) return 3;
    if (oldStatus === 2 && next !== 3) return 2;
    return next;
  }

  private forwardServiceStatus(oldStatus: number, next: number): number {
    // 3无 → 1售后中 → 2售后结束
    if (oldStatus === 2) return 2;
    if (oldStatus === 1 && next === 3) return 1;
    return next;
  }

  private resolveSoType(
    snapshot: ShifangQingyuanOrderDetailData,
    lines: ResolvedOrderLine[],
  ): number {
    if (this.isCloudStockInbound(snapshot)) return SALES_ORDER_TYPE.NO_OUTPUT;
    const types = new Set(lines.map((line) => (line.goodsType === 2 ? 2 : 1)));
    if (types.size > 1) return SALES_ORDER_TYPE.MIXED;
    return types.has(2) ? SALES_ORDER_TYPE.VIRTUAL : SALES_ORDER_TYPE.PHYSICAL;
  }

  private resolvePayMode(method: number): number {
    return SHIFANG_QINGYUAN_PAY_MODE_MAP[Number(method)] ?? 2;
  }

  /** order_type=1：向云库存纯入库，无实体发货，平台不写出库/回库。 */
  private isCloudStockInbound(snapshot: ShifangQingyuanOrderDetailData): boolean {
    return Number(snapshot.order_type) === SHIFANG_QINGYUAN_STOCK_FLOW.CLOUD_IN;
  }

  private formatAddress(order: ShifangQingyuanOrder): string {
    return `${order.region_name ?? ''}${order.address ?? ''}`;
  }

  private formatTrackingNos(snapshot: ShifangQingyuanOrderDetailData): string {
    const nos = (snapshot.express ?? [])
      .map((item) => String(item.express_no ?? '').trim())
      .filter(Boolean);
    return this.clip([...new Set(nos)].join(','), 30);
  }

  private shipmentDate(snapshot: ShifangQingyuanOrderDetailData): Date | null {
    const fromConsign = this.parseUnix(snapshot.order.consign_time);
    if (fromConsign) return fromConsign;
    const expressAt = snapshot.express?.[0]?.created_at;
    if (expressAt) return this.parseUnix(expressAt);
    if (SHIFANG_QINGYUAN_ORDER_SHIPPED_STATUSES.has(Number(snapshot.order.order_status))) {
      return this.parseUnix(snapshot.order.updated_at);
    }
    return null;
  }

  private parseUnix(value?: number | null): Date | null {
    if (value == null || !(Number(value) > 0)) return null;
    const n = Number(value);
    return new Date(n > 1e12 ? n : n * 1000);
  }

  private clip(value: string, max: number): string {
    return String(value ?? '').slice(0, max);
  }

  private dec(value: number): Prisma.Decimal {
    return new Prisma.Decimal(Number(value || 0).toFixed(2));
  }

  private payKey(sourceId: bigint, orderType: string, orderId: number | string) {
    return `SFQY-PAY-${sourceId}-${orderType}-${orderId}`;
  }
  private refundKey(
    sourceId: bigint,
    orderType: string,
    orderId: number | string,
    token: number | string,
  ) {
    return `SFQY-REFUND-${sourceId}-${orderType}-${orderId}-${token}`;
  }
  private shipKey(sourceId: bigint, orderType: string, shipmentId: number | string) {
    return `SFQY-SHIP-${sourceId}-${orderType}-${shipmentId}`;
  }
  private exitKey(
    sourceId: bigint,
    orderType: string,
    orderId: number | string,
    token: number | string,
  ) {
    return `SFQY-EXIT-${sourceId}-${orderType}-${orderId}-${token}`;
  }

  private async markMappingFailed(
    sourceId: bigint,
    snapshot: ShifangQingyuanOrderDetailData,
    reason: string,
    userId: string,
  ) {
    const now = new Date();
    const order = snapshot.order;
    const orderType = SHIFANG_QINGYUAN_ORDER_TYPE.SALE_ORDER;
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
      source_order_no: String(order.order_no ?? ''),
      last_error_payload: JSON.stringify(snapshot),
      sync_status: SHIFANG_QINGYUAN_ORDER_SYNC_STATUS.FAILED,
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

  private async resolveListStartTime(sourceId: bigint): Promise<string> {
    const latest = await this.prisma.hspsi_sale_order_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_order_type: SHIFANG_QINGYUAN_ORDER_TYPE.SALE_ORDER,
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

  /** Y-m-d H:i:s（本地/服务器时区按 Date 本地串；同步水位用） */
  private formatDateTime(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private async ensureDataSource(userId: string): Promise<bigint> {
    const existing = await this.prisma.hspsi_sys_data_source.findFirst({
      where: { code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE, deleted_at: null },
    });
    if (existing) {
      if (existing.status !== 1) {
        throw new BadRequestException('十方清源数据源已停用或删除，请先在系统中启用');
      }
      return existing.id;
    }
    const created = await this.prisma.hspsi_sys_data_source.create({
      data: {
        code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
        name: SHIFANG_QINGYUAN_DATA_SOURCE_NAME,
        status: 1,
        remark: '十方清源订单同步自动创建',
        created_by: BigInt(userId),
        updated_by: BigInt(userId),
      },
    });
    return created.id;
  }

  private emptyStats(): ShifangQingyuanOrderSyncStats {
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
