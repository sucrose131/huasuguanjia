import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BUSINESS_PREFIX } from '../../../business-number/business-number.constants';
import { BusinessNumberService } from '../../../business-number/business-number.service';
import { PrismaService } from '../../../database/prisma.service';
import { INVENTORY_BUSINESS_MODE } from '../../../inventory/inventory-dictionary';
import {
  HUASU_HOME_AFTER_SALES_STATUS,
  HUASU_HOME_AFTER_SALES_TYPE,
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_DATA_SOURCE_NAME,
  HUASU_HOME_GOODS_CATEGORY_ID,
  HUASU_HOME_MAPPING_STATUS,
  HUASU_HOME_ORDER_SHIPPED_STATUSES,
  HUASU_HOME_ORDER_STATUS,
  HUASU_HOME_ORDER_SYNC_DEFAULT_PAGE_SIZE,
  HUASU_HOME_ORDER_SYNC_MAX_PAGES,
  HUASU_HOME_ORDER_SYNC_MAX_PAGE_SIZE,
  HUASU_HOME_ORDER_SYNC_STATUS,
  HUASU_HOME_ORDER_SYNCABLE_STATUSES,
  HUASU_HOME_ORDER_TYPE,
  HUASU_HOME_PAY_MODE_MAP,
  HUASU_HOME_PRODUCT_TYPE,
  HUASU_HOME_RULE_STATUS,
  HUASU_HOME_SOURCE_TYPE,
} from '../huasu-home.constants';
import { HuasuHomeService } from '../huasu-home.service';
import type {
  HuasuHomeOrder,
  HuasuHomeOrderItem,
  HuasuHomeOrderPackageItem,
  HuasuHomeRightsDeductedRecord,
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
 * 华溯之家订单同步
 *
 * 对应 docs/integrations/huasu-home/订单同步.md
 */
@Injectable()
export class HuasuHomeOrderSyncService {
  private static readonly logger = new Logger(HuasuHomeOrderSyncService.name);

  /** 进程内防重入：批量/单笔同步互斥 */
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HuasuHomeService) private readonly huasuHome: HuasuHomeService,
    @Inject(BusinessNumberService) private readonly businessNumber: BusinessNumberService,
    @Inject(ExternalInventoryPostingService)
    private readonly externalPosting: ExternalInventoryPostingService,
  ) {}

  /**
   * 批量同步：按 updated_at 增量拉列表（page 递增）→ 按页即时 applyOrder
   *
   * 以返回的 total 判断是否还有下一页；本页为空则结束，避免 total 偏大时死循环。
   */
  async syncOrders(
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
        const data = await this.huasuHome.getOrderList({
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

      HuasuHomeOrderSyncService.logger.log(
        `[huasu-home] order sync done: ${JSON.stringify({
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

  /** 单笔同步：按华溯 order_sn 拉详情后 applyOrder */
  async syncOrderBySn(orderSn: string, userId = '0'): Promise<HuasuHomeOrderSyncStats> {
    return this.withSyncLock(async () => {
      const stats = this.emptyStats();
      const sourceId = await this.ensureDataSource(userId);
      const order = await this.huasuHome.getOrderInfo(orderSn);
      stats.fetched = 1;
      await this.applyOrderSafe(order, sourceId, userId, stats);
      return stats;
    });
  }

  /** @deprecated 使用 syncOrderBySn */
  async syncOrderById(sourceOrderId: string, userId = '0'): Promise<HuasuHomeOrderSyncStats> {
    return this.syncOrderBySn(sourceOrderId, userId);
  }

  private async applyOrderSafe(
    order: HuasuHomeOrder,
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
      HuasuHomeOrderSyncService.logger.warn(
        `[huasu-home] order ${order.id}/${order.order_sn} sync failed: ${reason}`,
      );
    }
  }

  private async applyOrder(
    order: HuasuHomeOrder,
    sourceId: bigint,
    userId: string,
    stats: HuasuHomeOrderSyncStats,
  ) {
    if (!HUASU_HOME_ORDER_SYNCABLE_STATUSES.has(Number(order.order_status))) {
      stats.skipped += 1;
      return;
    }

    if (this.isConvertedInstallmentOrder(order)) {
      stats.skipped += 1;
      return;
    }

    const orderType = HUASU_HOME_ORDER_TYPE.SALE_ORDER;
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
      existing.sync_status === HUASU_HOME_ORDER_SYNC_STATUS.SUCCESS &&
      existing.so_id > 0n &&
      sourceUpdatedAt &&
      existing.source_updated_at &&
      existing.source_updated_at.getTime() === sourceUpdatedAt.getTime() &&
      existing.source_status === Number(order.order_status) &&
      !(await this.hasServiceMissingGoods(existing.so_id))
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
        const orgId = await this.resolveOrgId(tx, sourceId, order.service_org_id);
        const warehouseId = await this.resolveWarehouseId(tx, orgId);
        const customerId = await this.ensureCustomer(tx, {
          sourceId,
          orgId,
          order,
          operatorId,
          now,
        });
        const lines = await this.resolveOrderLines(tx, sourceId, order.items ?? []);
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

        if (HUASU_HOME_ORDER_SHIPPED_STATUSES.has(Number(order.order_status))) {
          const shipped = await this.ensureShipments(tx, {
            soId,
            sourceId,
            orderType,
            order,
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
          order,
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
      order: HuasuHomeOrder;
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
    const address = this.formatAddress(order);
    const tracking = this.formatTrackingNos(order);
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
      customer_name: this.clip(order.consignee || customer.name || '', 30),
      customer_mobile: this.clip(order.mobile || customer.mobile || '', 20),
      customer_address: this.clip(address, 100),
      order_date: this.parseDate(order.created_at) ?? now,
      sales_name: this.clip(order.referrer?.nickname || '', 30),
      sales_mobile: this.clip(order.referrer?.mobile || '', 20),
      so_qty: totalQty,
      so_amount: totalAmount,
      fact_amount: factAmount,
      priceoff_amount: priceoff,
      order_status: statusTriple.orderStatus,
      delivery_status: statusTriple.deliveryStatus,
      service_status: statusTriple.serviceStatus,
      shipper: tracking,
      delivery_date:
        statusTriple.deliveryStatus >= 3
          ? (this.shipmentDate(order) ?? now)
          : null,
      status: 1,
      approve_status: 1,
      approve_comment: '华溯之家已支付订单同步',
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
      order: HuasuHomeOrder;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<boolean> {
    const key = this.payKey(input.sourceId, input.orderType, input.order.id);
    const old = await tx.hspsi_sales_order_payment.findUnique({ where: { request_key: key } });
    if (old) return false;

    const amount = input.order.payments?.amount
      ? this.dec(Number(input.order.payments.amount))
      : this.dec(Number(input.order.actual_amount ?? 0));
    if (amount.lte(0)) return false;

    const order = await tx.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: input.soId } });
    const payNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_RECEIPT);
    const payMode = this.resolvePayMode(
      Number(input.order.payments?.payment_method ?? input.order.payment_method),
    );
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
          this.parseDate(input.order.payments?.pay_time) ??
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

  private async ensureShipments(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeOrder;
      lines: ResolvedOrderLine[];
      orgId: bigint;
      warehouseId: bigint;
      operatorId: bigint;
      now: Date;
      userId: string;
    },
  ): Promise<number> {
    const shipments = input.order.shipments?.filter((item) => item && item.id != null) ?? [];
    // shipments.items 当前为空，无法按包裹拆数量；整单只出一次库，幂等键取首包裹或 ALL
    const keys =
      shipments.length > 0
        ? [
            {
              key: this.shipKey(input.sourceId, input.orderType, shipments[0]!.id),
              shipmentId: String(shipments[0]!.id),
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

      const shipLines = await this.buildShipLines(tx, {
        sourceId: input.sourceId,
        items: input.order.items ?? [],
        orderLines: input.lines,
      });
      if (!shipLines.length) throw new BadRequestException('发货明细为空');

      const outputNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_OUTPUT);
      const output = await tx.hspsi_sale_order_output.create({
        data: {
          so_output_no: outputNo,
          so_id: input.soId,
          org_id: input.orgId,
          warehouse_id: input.warehouseId,
          output_date: this.shipmentDate(input.order) ?? input.now,
          go_where: 1,
          dept_id: 0n,
          receiver_id: input.operatorId,
          output_sku_qty: new Set(shipLines.map((line) => `${line.goodsId}:${line.skuId}`)).size,
          status: true,
          comfirm_status: 1,
          comfirm_comment: '华溯之家外部发货同步自动确认',
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
          idempotencyKey: `huasu-home-output:${item.key}:v1`,
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
          delivery_date: this.shipmentDate(input.order) ?? input.now,
          shipper: this.formatTrackingNos(input.order),
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
      order: HuasuHomeOrder;
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
    const type = Number(input.order.after_sales_type ?? 0);
    const status = Number(input.order.after_sales_status ?? 0);
    if (type === HUASU_HOME_AFTER_SALES_TYPE.NONE) return result;

    if (status === HUASU_HOME_AFTER_SALES_STATUS.PROCESSING) {
      if (
        await this.ensureAfterSalesEvent(tx, {
          ...input,
          eventStatus: 1,
          suffix: 'PROCESSING',
        })
      )
        result.events += 1;
      await tx.hspsi_sale_order.update({
        where: { so_id: input.soId },
        data: { service_status: 1, updated_by: input.operatorId, updated_at: input.now },
      });
      return result;
    }

    if (
      status === HUASU_HOME_AFTER_SALES_STATUS.REJECTED ||
      status === HUASU_HOME_AFTER_SALES_STATUS.USER_CANCEL
    ) {
      if (
        await this.ensureAfterSalesEvent(tx, {
          ...input,
          eventStatus: 3,
          suffix: `CANCEL-${status}`,
        })
      )
        result.events += 1;
      return result;
    }

    if (status !== HUASU_HOME_AFTER_SALES_STATUS.DONE) return result;

    if (
      await this.ensureAfterSalesEvent(tx, {
        ...input,
        eventStatus: 2,
        suffix: 'DONE',
      })
    )
      result.events += 1;

    const refundAmount = Number(input.order.after_sales_amount ?? 0);
    if (refundAmount > 0) {
      const key = this.refundKey(input.sourceId, input.orderType, input.order.id, status);
      const old = await tx.hspsi_sales_order_payment.findUnique({ where: { request_key: key } });
      if (!old) {
        const order = await tx.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: input.soId } });
        const payNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_REFUND);
        await tx.hspsi_sales_order_payment.create({
          data: {
            org_id: order.org_id,
            dept_id: 0n,
            pay_no: payNo,
            so_id: input.soId,
            so_pay_type: 2,
            pay_mode: this.resolvePayMode(input.order.payment_method),
            fact_pay_amount: this.dec(refundAmount),
            pay_date: input.now,
            request_key: key,
            remark: this.clip(input.order.after_sales?.reason || input.order.remark || '', 255),
            created_by: input.operatorId,
            updated_by: input.operatorId,
            created_at: input.now,
            updated_at: input.now,
          },
        });
        result.payments += 1;
      }
    }

    // 仅退款不回库；退货退款 / 异常售后(曾发货)按权益扣减回库
    const needReturn =
      type === HUASU_HOME_AFTER_SALES_TYPE.RETURN_REFUND ||
      (type === HUASU_HOME_AFTER_SALES_TYPE.ABNORMAL &&
        HUASU_HOME_ORDER_SHIPPED_STATUSES.has(Number(input.order.order_status)));

    if (needReturn) {
      const exitKey = this.exitKey(input.sourceId, input.orderType, input.order.id, status);
      const existed = await tx.hspsi_sale_order_exit.findFirst({
        where: { so_id: input.soId, remark: exitKey, deleted_at: null },
      });
      if (!existed) {
        // 回库明细来自 rights_deducted_records；为空则跳过回库、只记账
        const returnLines = await this.buildReturnLinesFromRights(
          tx,
          input.sourceId,
          input.order.after_sales?.rights_deducted_records,
        );
        if (returnLines.length > 0) {
          const output = await tx.hspsi_sale_order_output.findFirst({
            where: { so_id: input.soId, comfirm_status: 1, deleted_at: null },
            orderBy: { so_output_id: 'asc' },
          });
          const exitNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_RETURN);
          const order = await tx.hspsi_sale_order.findUniqueOrThrow({
            where: { so_id: input.soId },
          });
          const exitQty = returnLines.reduce((sum, line) => sum + line.quantity, 0);
          const exit = await tx.hspsi_sale_order_exit.create({
            data: {
              so_exit_no: exitNo,
              so_id: input.soId,
              source_output_id: output?.so_output_id ?? 0n,
              exit_reson: this.clip(input.order.remark ?? '', 255),
              exit_qty: exitQty,
              disposal_type: 1,
              org_id: input.orgId,
              warehouse_id: input.warehouseId,
              exit_date: input.now,
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
              comfirm_comment: '华溯之家售后退货同步自动确认',
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
              remark: this.clip(input.order.after_sales?.reason || input.order.remark || '', 255),
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
              remark: this.clip(input.order.after_sales?.reason || input.order.remark || '', 255),
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
          Number(input.order.order_status) === HUASU_HOME_ORDER_STATUS.REFUNDED
            ? 3
            : 2,
        updated_by: input.operatorId,
        updated_at: input.now,
      },
    });
    return result;
  }

  private async ensureAfterSalesEvent(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      orderType: string;
      order: HuasuHomeOrder;
      lines: ResolvedOrderLine[];
      customerId: bigint;
      operatorId: bigint;
      now: Date;
      eventStatus: number;
      suffix: string;
    },
  ): Promise<boolean> {
    const key = `HH-EVT-${input.sourceId}-${input.orderType}-${input.order.id}-AS-${input.suffix}`;
    const old = await tx.hspsi_sale_order_service.findFirst({
      where: { so_id: input.soId, remark: key, deleted_at: null },
    });
    const goods = this.resolveServiceGoodsLine(input.order, input.lines);
    if (old) {
      await this.backfillServiceGoods(tx, old, goods, input.operatorId, input.now);
      return false;
    }
    const type = Number(input.order.after_sales_type ?? 0);
    const eventType =
      type === HUASU_HOME_AFTER_SALES_TYPE.EXCHANGE
        ? 5
        : type === HUASU_HOME_AFTER_SALES_TYPE.REFUND_ONLY
          ? 4
          : 4;
    const serviceNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_SERVICE);
    await tx.hspsi_sale_order_service.create({
      data: {
        service_no: serviceNo,
        so_id: input.soId,
        customer_id: Number(input.customerId),
        goods_id: goods ? Number(goods.goodsId) : 0,
        sku_id: goods ? Number(goods.skuId) : 0,
        event_type: eventType,
        event_content: this.resolveEventContent(input.order, input.eventStatus),
        event_status: input.eventStatus,
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

  /**
   * 出库明细：优先按 items.package_items 展开真实发货单品；
   * 数量 = (number + gift_number) * items.quantity；
   * package_items 为空时回退 conversion_rule / 原下单 SKU。
   * 外部同步统一空批号，过账允许负库存（不走平台 FIFO 占批）。
   */
  private async buildShipLines(
    tx: Tx,
    input: {
      sourceId: bigint;
      items: HuasuHomeOrderItem[];
      orderLines: ResolvedOrderLine[];
    },
  ): Promise<ShipLine[]> {
    const expanded: Array<{
      goodsId: bigint;
      skuId: bigint;
      unitType: number;
      quantity: number;
    }> = [];

    for (let i = 0; i < input.items.length; i += 1) {
      const item = input.items[i]!;
      const orderLine = input.orderLines[i];
      const buyQty = Number(item.quantity);
      if (!(buyQty > 0)) continue;

      const packageItems = (item.package_items ?? []).filter(
        (row): row is HuasuHomeOrderPackageItem => !!row && Number(row.product_id) > 0,
      );

      if (packageItems.length > 0) {
        for (const pkgItem of packageItems) {
          const perSet =
            Number(pkgItem.number || 0) + Number(pkgItem.gift_number || 0);
          const quantity = perSet * buyQty;
          if (!(quantity > 0)) continue;
          const target = await this.resolveDefaultStandardSku(
            tx,
            input.sourceId,
            Number(pkgItem.product_id),
          );
          expanded.push({
            goodsId: target.goodsId,
            skuId: target.skuId,
            unitType: target.unitType,
            quantity,
          });
        }
        continue;
      }

      // 无 package_items：回退 conversion_rule / 原下单行
      if (!orderLine) {
        throw new BadRequestException(
          `订单行 ${item.id} 无 package_items 且缺少已解析的下单明细`,
        );
      }
      const rules = await tx.hspsi_goods_sku_conversion_rule.findMany({
        where: {
          source_goods_id: orderLine.goodsId,
          source_sku_id: orderLine.skuId,
          status: HUASU_HOME_RULE_STATUS.ENABLED,
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

  /**
   * 售后退货入库明细：按 after_sales.rights_deducted_records 展开。
   * 数量 = gift_number + buy_number；同 product_id 合并；规格取默认 SKU。
   * 记录为空 / 数量均为 0 时返回空数组（调用方跳过回库、只记账）。
   */
  private async buildReturnLinesFromRights(
    tx: Tx,
    sourceId: bigint,
    records: HuasuHomeRightsDeductedRecord[] | null | undefined,
  ): Promise<ShipLine[]> {
    const merged = new Map<
      string,
      { goodsId: bigint; skuId: bigint; unitType: number; quantity: number }
    >();

    for (const rec of records ?? []) {
      const productId = Number(rec.product_id);
      const quantity = Number(rec.gift_number || 0) + Number(rec.buy_number || 0);
      if (!(productId > 0) || !(quantity > 0)) continue;

      const target = await this.resolveDefaultStandardSku(tx, sourceId, productId);
      const key = `${target.goodsId}:${target.skuId}`;
      const cur = merged.get(key);
      if (cur) cur.quantity += quantity;
      else
        merged.set(key, {
          goodsId: target.goodsId,
          skuId: target.skuId,
          unitType: target.unitType,
          quantity,
        });
    }

    return [...merged.values()].map((line) => ({
      goodsId: line.goodsId,
      skuId: line.skuId,
      unitType: line.unitType,
      quantity: line.quantity,
      batchNo: '',
    }));
  }

  /** product_id → 平台默认规格（is_default=1，否则取映射中首个） */
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
      throw new BadRequestException(
        `单品未映射: product_id=${sourceProductId}`,
      );
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

  /** 历史同步事件 goods_id=0 时，下次同步补写商品规格，不跳过。 */
  private async hasServiceMissingGoods(soId: bigint): Promise<boolean> {
    const missing = await this.prisma.hspsi_sale_order_service.findFirst({
      where: { so_id: soId, deleted_at: null, goods_id: 0, event_type: { in: [4, 5] } },
      select: { service_id: true },
    });
    return Boolean(missing);
  }

  /**
   * 售后事件商品取销售订单行（必须属于该单，页面才能编辑）。
   * 优先：权益扣减 product_id 能匹配的下单行 → 有 after_sales_amount 的行 → 首行。
   */
  private resolveServiceGoodsLine(
    order: HuasuHomeOrder,
    lines: ResolvedOrderLine[],
  ): ResolvedOrderLine | null {
    if (!lines.length) return null;
    const rightsIds = new Set(
      (order.after_sales?.rights_deducted_records ?? [])
        .map((row) => Number(row.product_id))
        .filter((id) => id > 0),
    );
    if (rightsIds.size) {
      const matched = lines.find((line) => rightsIds.has(line.sourceProductId));
      if (matched) return matched;
    }
    const items = order.items ?? [];
    const amountIndex = items.findIndex((item) => Number(item.after_sales_amount) > 0);
    if (amountIndex >= 0 && lines[amountIndex]) return lines[amountIndex]!;
    return lines[0] ?? null;
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

  private async resolveOrderLines(
    tx: Tx,
    sourceId: bigint,
    items: HuasuHomeOrderItem[],
  ): Promise<ResolvedOrderLine[]> {
    if (!items.length) throw new BadRequestException('订单明细为空');
    const lines: ResolvedOrderLine[] = [];
    for (const item of items) {
      const isCombo =
        Number(item.product_type) === HUASU_HOME_PRODUCT_TYPE.COMBO ||
        (item.product_type == null && Number(item.package_id ?? 0) > 0);
      const sourceType = isCombo ? HUASU_HOME_SOURCE_TYPE.COMBO : HUASU_HOME_SOURCE_TYPE.STANDARD;
      const sourceGoodsId = String(
        isCombo ? item.package_id || item.product_id : item.product_id,
      );
      const sourceSkuId = isCombo ? '0' : String(item.sku_id);
      const mapping = await tx.hspsi_goods_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_type: sourceType,
          source_goods_id: sourceGoodsId,
          source_sku_id: sourceSkuId,
          mapping_status: HUASU_HOME_MAPPING_STATUS.MAPPED,
          deleted_at: null,
        },
      });
      if (!mapping) {
        throw new BadRequestException(
          `商品未映射: type=${sourceType} goods=${sourceGoodsId} sku=${sourceSkuId}`,
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
      const quantity = Number(item.quantity);
      if (!(quantity > 0)) throw new BadRequestException(`订单行数量无效 item=${item.id}`);
      const price = Number(item.price ?? 0);
      lines.push({
        goodsId: mapping.goods_id,
        skuId: mapping.sku_id,
        unitType: Number(sku.unit_type ?? 0),
        quantity,
        price,
        amount: price * quantity,
        goodsType: Number(goods.goods_type ?? 1),
        sourceProductId: Number(item.product_id),
      });
    }
    return lines;
  }

  private async ensureCustomer(
    tx: Tx,
    input: {
      sourceId: bigint;
      orgId: bigint;
      order: HuasuHomeOrder;
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
    const address = this.formatAddress(input.order);
    const name = this.clip(user?.nickname || input.order.consignee || `华溯用户${userId}`, 100);
    const mobile = this.clip(user?.mobile || input.order.mobile || '', 20);
    const status = Number(user?.status ?? 1) === 0 ? 2 : 1;
    const data = {
      org_id: input.orgId,
      name,
      mobile,
      gender: Number(user?.gender ?? 0),
      birthday: this.parseCustomerBirth(user?.birth),
      address: this.clip(address, 255),
      referrer_name: this.clip(input.order.referrer?.nickname || '', 32),
      referrer_mobile: this.clip(input.order.referrer?.mobile || '', 20),
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

  private async resolveOrgId(tx: Tx, sourceId: bigint, serviceOrgId: number): Promise<bigint> {
    const mapping = await tx.hspsi_sys_organization_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_object_id: String(serviceOrgId),
        deleted_at: null,
      },
    });
    if (!mapping || !(mapping.org_id > 0n)) {
      throw new BadRequestException(`机构未映射: service_org_id=${serviceOrgId}`);
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
    order: HuasuHomeOrder,
    existing: { so_id: bigint } | null,
    tx: Tx,
  ): Promise<{ orderStatus: number; deliveryStatus: number; serviceStatus: number }> {
    let deliveryStatus = 1;
    let orderStatus = 1;
    let serviceStatus = 3;
    const status = Number(order.order_status);
    switch (status) {
      case HUASU_HOME_ORDER_STATUS.PAID:
        orderStatus = 1;
        deliveryStatus = 1;
        serviceStatus = 3;
        break;
      case HUASU_HOME_ORDER_STATUS.SHIPPED:
      case HUASU_HOME_ORDER_STATUS.RECEIVED:
        orderStatus = 1;
        deliveryStatus = 3;
        serviceStatus = 3;
        break;
      case HUASU_HOME_ORDER_STATUS.COMPLETED:
        orderStatus = 2;
        deliveryStatus = 3;
        serviceStatus = 3;
        break;
      case HUASU_HOME_ORDER_STATUS.AFTER_SALES:
        orderStatus = 1;
        deliveryStatus = 3;
        serviceStatus = 1;
        break;
      case HUASU_HOME_ORDER_STATUS.AFTER_SALES_DONE:
        orderStatus = 2;
        deliveryStatus = 3;
        serviceStatus = 2;
        break;
      case HUASU_HOME_ORDER_STATUS.REFUNDED:
        orderStatus = 3;
        deliveryStatus = 3;
        serviceStatus = 2;
        break;
      default:
        orderStatus = 1;
        deliveryStatus = 1;
        serviceStatus = 3;
    }

    if (existing?.so_id) {
      const old = await tx.hspsi_sale_order.findFirst({
        where: { so_id: existing.so_id, deleted_at: null },
      });
      if (old) {
        deliveryStatus = Math.max(Number(old.delivery_status), deliveryStatus);
        // 售后中若此前未发货，保持待发货
        if (
          status === HUASU_HOME_ORDER_STATUS.AFTER_SALES &&
          Number(old.delivery_status) < 3 &&
          !HUASU_HOME_ORDER_SHIPPED_STATUSES.has(status)
        ) {
          deliveryStatus = Number(old.delivery_status);
        }
        if (
          [HUASU_HOME_ORDER_STATUS.AFTER_SALES, HUASU_HOME_ORDER_STATUS.AFTER_SALES_DONE].includes(
            status as never,
          ) &&
          Number(old.delivery_status) > 0
        ) {
          deliveryStatus = Math.max(Number(old.delivery_status), deliveryStatus);
        }
      }
    }
    return { orderStatus, deliveryStatus, serviceStatus };
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

  private resolveSoType(lines: ResolvedOrderLine[]): number {
    const types = new Set(lines.map((line) => (line.goodsType === 2 ? 2 : 1)));
    if (types.size > 1) return 3;
    return types.has(2) ? 2 : 1;
  }

  private resolvePayMode(method: number): number {
    const mapped = HUASU_HOME_PAY_MODE_MAP[Number(method)];
    if (!mapped) throw new BadRequestException(`支付方式无效: ${method}`);
    // 余额/线下字典可能未配置，落库仍写目标值；收款不走字典强校验
    return mapped;
  }

  /**
   * 事件内容只取源端备注类文本：有则写，无则空。
   * - 售后拒绝/用户取消 → cancel_reason
   * - 其余状态/售后事件 → remark
   */
  private resolveEventContent(order: HuasuHomeOrder, eventStatus?: number): string {
    if (eventStatus === 3) {
      return this.clip(order.cancel_reason ?? '', 255);
    }
    const as = order.after_sales;
    return this.clip(as?.reason || as?.remark || order.remark || '', 255);
  }

  private formatAddress(order: HuasuHomeOrder): string {
    const addr = order.address;
    if (addr == null) return '';
    if (typeof addr === 'string') return addr;
    if (Array.isArray(addr)) return addr.filter(Boolean).join('');
    return [addr.province, addr.city, addr.district, addr.address].filter(Boolean).join('');
  }

  private formatTrackingNos(order: HuasuHomeOrder): string {
    const nos = (order.shipments ?? [])
      .map((item) => String(item.tracking_no ?? '').trim())
      .filter(Boolean);
    return this.clip([...new Set(nos)].join(','), 30);
  }

  private shipmentDate(order: HuasuHomeOrder): Date | null {
    const ts = order.shipments?.[0]?.created_at;
    if (ts && Number(ts) > 0) {
      // 华溯文档为 integer，可能是秒
      const n = Number(ts);
      return new Date(n > 1e12 ? n : n * 1000);
    }
    if (HUASU_HOME_ORDER_SHIPPED_STATUSES.has(Number(order.order_status))) {
      return this.parseDate(order.updated_at);
    }
    return null;
  }

  /** 普通订单若由分期完款转入（order_installment_no 有值）则跳过，避免与分期履约重复。 */
  private isConvertedInstallmentOrder(order: HuasuHomeOrder): boolean {
    if (!Object.prototype.hasOwnProperty.call(order, 'order_installment_no')) {
      return false;
    }
    const value = order.order_installment_no;
    if (value == null) return false;
    return String(value).trim() !== '';
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
    order: HuasuHomeOrder,
    reason: string,
    userId: string,
  ) {
    const now = new Date();
    const orderType = HUASU_HOME_ORDER_TYPE.SALE_ORDER;
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
        source_order_type: HUASU_HOME_ORDER_TYPE.SALE_ORDER,
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
        source_order_type: HUASU_HOME_ORDER_TYPE.SALE_ORDER,
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
      throw new BadRequestException('华溯订单同步仍在进行，请稍后再试');
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
