import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BUSINESS_PREFIX } from '../../../business-number/business-number.constants';
import { BusinessNumberService } from '../../../business-number/business-number.service';
import { PrismaService } from '../../../database/prisma.service';
import { INVENTORY_BUSINESS_MODE } from '../../../inventory/inventory-dictionary';
import { SALES_ORDER_TYPE } from '../../../sales/sales-helpers';
import { ExternalInventoryPostingService } from '../../common/external-inventory-posting.service';
import {
  SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS,
  SHIFANG_QINGYUAN_AGENT_ORDER_SHIPPED_STATUSES,
  SHIFANG_QINGYUAN_AGENT_ORDER_SYNC_OVERLAP_MS,
  SHIFANG_QINGYUAN_AGENT_ORDER_SYNCABLE_STATUSES,
  SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
  SHIFANG_QINGYUAN_DATA_SOURCE_NAME,
  SHIFANG_QINGYUAN_GOODS_CATEGORY_ID,
  SHIFANG_QINGYUAN_ORDER_SYNC_STATUS,
  SHIFANG_QINGYUAN_ORDER_TYPE,
  SHIFANG_QINGYUAN_SOURCE_TYPE,
} from '../shifang-qingyuan.constants';
import { ShifangQingyuanService } from '../shifang-qingyuan.service';
import type {
  ShifangQingyuanAgentOrderDetail,
  ShifangQingyuanAgentOrderListItem,
  ShifangQingyuanUser,
} from '../shifang-qingyuan.types';
import type {
  ShifangQingyuanAgentOrderSyncOptions,
  ShifangQingyuanAgentOrderSyncStats,
} from './agent-order-sync.types';

type Tx = Prisma.TransactionClient;

type ResolvedOrderLine = {
  goodsId: bigint;
  skuId: bigint;
  unitType: number;
  quantity: number;
};

type ShipLine = {
  goodsId: bigint;
  skuId: bigint;
  unitType: number;
  quantity: number;
  batchNo: string;
};

/** 分页拉取每页条数（接口最大 100） */
const PAGE_LIMIT = 100;

/**
 * 十方清源云库存自提单同步
 *
 * 对应 docs/global/integrations/shifang-qingyuan/自提订单同步.md
 */
@Injectable()
export class ShifangQingyuanAgentOrderSyncService {
  private static readonly logger = new Logger(ShifangQingyuanAgentOrderSyncService.name);
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShifangQingyuanService) private readonly shifangQingyuan: ShifangQingyuanService,
    @Inject(BusinessNumberService) private readonly businessNumber: BusinessNumberService,
    @Inject(ExternalInventoryPostingService)
    private readonly externalPosting: ExternalInventoryPostingService,
  ) {}

  async syncAgentOrders(
    userId = '0',
    options: ShifangQingyuanAgentOrderSyncOptions = {},
  ): Promise<ShifangQingyuanAgentOrderSyncStats> {
    return this.withSyncLock(() => this.syncAgentOrdersUnlocked(userId, options));
  }

  private async syncAgentOrdersUnlocked(
    userId: string,
    options: ShifangQingyuanAgentOrderSyncOptions,
  ): Promise<ShifangQingyuanAgentOrderSyncStats> {
    const stats = this.emptyStats();
    const sourceId = await this.ensureDataSource(userId);
    const startTime =
      options.start_time?.trim() || (await this.resolveListStartTime(sourceId));
    const endTime = options.end_time?.trim() || undefined;
    let page = options.page && options.page > 0 ? options.page : 1;
    const limit = PAGE_LIMIT;

    for (;;) {
      const data = await this.shifangQingyuan.getAgentOrderList({
        page,
        limit,
        start_time: startTime,
        ...(endTime ? { end_time: endTime } : {}),
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

    ShifangQingyuanAgentOrderSyncService.logger.log(
      `[shifang-qingyuan] agent order sync done: ${JSON.stringify({
        startTime,
        endTime,
        ...stats,
        failures: stats.failures.length,
        warnings: stats.warnings.length,
      })}`,
    );
    return stats;
  }

  async syncAgentOrderByNo(
    orderNo: string,
    userId = '0',
  ): Promise<ShifangQingyuanAgentOrderSyncStats> {
    return this.withSyncLock(() => this.syncAgentOrderByNoUnlocked(orderNo, userId));
  }

  private async syncAgentOrderByNoUnlocked(
    orderNo: string,
    userId: string,
  ): Promise<ShifangQingyuanAgentOrderSyncStats> {
    const stats = this.emptyStats();
    const sourceId = await this.ensureDataSource(userId);
    const data = await this.shifangQingyuan.getAgentOrderList({
      order_no: orderNo,
      limit: 1,
    });
    const item = data.list?.[0];
    if (!item?.id) {
      throw new BadRequestException(`十方清源自提单不存在: ${orderNo}`);
    }
    stats.fetched = 1;
    await this.applyOrderSafe(item, sourceId, userId, stats);
    return stats;
  }

  private async withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running) {
      throw new BadRequestException('十方清源自提订单同步仍在进行，请稍后再试');
    }
    this.running = true;
    try {
      return await fn();
    } finally {
      this.running = false;
    }
  }

  private async applyOrderSafe(
    snapshot: ShifangQingyuanAgentOrderListItem,
    sourceId: bigint,
    userId: string,
    stats: ShifangQingyuanAgentOrderSyncStats,
  ) {
    try {
      await this.applyOrder(snapshot, sourceId, userId, stats);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      stats.failed += 1;
      stats.failures.push({
        sourceOrderId: String(snapshot.id ?? ''),
        orderNo: String(snapshot.order_no ?? ''),
        reason,
      });
      await this.markMappingFailed(sourceId, snapshot, reason, userId).catch(() => undefined);
      ShifangQingyuanAgentOrderSyncService.logger.warn(
        `[shifang-qingyuan] agent order ${snapshot.id}/${snapshot.order_no} sync failed: ${reason}`,
      );
    }
  }

  private async applyOrder(
    snapshot: ShifangQingyuanAgentOrderListItem,
    sourceId: bigint,
    userId: string,
    stats: ShifangQingyuanAgentOrderSyncStats,
  ) {
    const sendStatus = Number(snapshot.send_status);
    if (sendStatus === SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.UNPAID_FREIGHT) {
      stats.skipped += 1;
      return;
    }
    if (!SHIFANG_QINGYUAN_AGENT_ORDER_SYNCABLE_STATUSES.has(sendStatus)) {
      stats.skipped += 1;
      return;
    }

    const orderType = SHIFANG_QINGYUAN_ORDER_TYPE.CLOUD_STOCK_AGENT_ORDER;
    const sourceOrderId = String(snapshot.id);
    const sourceUpdatedAt = this.parseUnix(snapshot.created_at);
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
      existing.source_status === sendStatus
    ) {
      stats.skipped += 1;
      return;
    }

    const delta = { created: 0, updated: 0, outputs: 0, exits: 0 };

    await this.prisma.$transaction(
      async (tx) => {
        const user = snapshot.user;
        if (!user?.id) throw new BadRequestException('自提单缺少用户');
        const orgId = await this.resolveOrgId(tx, sourceId, Number(user.mall_id));
        const warehouseId = await this.resolveWarehouseId(tx, orgId);
        const customerId = await this.ensureCustomer(tx, {
          sourceId,
          orgId,
          user,
          address: String(snapshot.address ?? ''),
          operatorId,
          now,
        });
        const lines = await this.resolveOrderLines(tx, sourceId, snapshot.details ?? []);
        const statusTriple = await this.mapPlatformStatus(snapshot, existing?.so_id ? existing : null, tx);

        let mapping = existing
          ? await tx.hspsi_sale_order_source_mapping.findFirstOrThrow({
              where: { id: existing.id },
            })
          : await tx.hspsi_sale_order_source_mapping.create({
              data: {
                source_id: sourceId,
                source_order_type: orderType,
                source_order_id: sourceOrderId,
                source_order_no: String(snapshot.order_no ?? ''),
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
          user,
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
            source_order_no: String(snapshot.order_no ?? ''),
            updated_by: operatorId,
            updated_at: now,
          },
        });

        if (SHIFANG_QINGYUAN_AGENT_ORDER_SHIPPED_STATUSES.has(sendStatus)) {
          delta.outputs += await this.ensureShipments(tx, {
            soId,
            sourceId,
            snapshot,
            lines,
            orgId,
            warehouseId,
            operatorId,
            now,
            userId,
          });
        }

        if (sendStatus === SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.CANCELLED) {
          delta.exits += await this.ensureRestock(tx, {
            soId,
            orgId,
            warehouseId,
            operatorId,
            now,
            userId,
          });
        }

        await tx.hspsi_sale_order_source_mapping.update({
          where: { id: mapping.id },
          data: {
            so_id: soId,
            source_status: sendStatus,
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
    stats.outputs += delta.outputs;
    stats.exits += delta.exits;
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
      snapshot: ShifangQingyuanAgentOrderListItem;
      user: ShifangQingyuanUser;
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
      user,
      lines,
      statusTriple,
      operatorId,
      now,
    } = input;
    const totalQty = lines.reduce((sum, line) => sum + line.quantity, 0);
    const zero = this.dec(0);
    const customer = await tx.hspsi_basic_customer.findFirstOrThrow({
      where: { customer_id: customerId },
    });
    const displayName = this.userDisplayName(user);
    const displayMobile = this.userMobile(user);

    const headerData = {
      org_id: orgId,
      warehouse_id: warehouseId,
      so_type: SALES_ORDER_TYPE.PHYSICAL,
      so_source: sourceId,
      so_source_id: mappingId,
      business_source_type: '',
      business_source_id: 0n,
      business_source_no: '',
      so_property_type: 1,
      customer_id: customerId,
      customer_name: this.clip(displayName || customer.name || '', 30),
      customer_mobile: this.clip(displayMobile || customer.mobile || '', 20),
      customer_address: this.clip(String(snapshot.address ?? ''), 100),
      order_date: this.parseUnix(snapshot.created_at) ?? now,
      sales_name: '',
      sales_mobile: '',
      so_qty: totalQty,
      so_amount: zero,
      fact_amount: zero,
      priceoff_amount: zero,
      order_status: statusTriple.orderStatus,
      delivery_status: statusTriple.deliveryStatus,
      service_status: statusTriple.serviceStatus,
      shipper: this.clip(String(snapshot.express_no ?? '').trim(), 30),
      delivery_date:
        statusTriple.deliveryStatus >= 3 ? (this.parseUnix(snapshot.created_at) ?? now) : null,
      status: 1,
      approve_status: 1,
      approve_comment: '十方清源自提订单同步',
      approve_by: operatorId,
      approve_date: now,
      remark: this.clip(String(snapshot.order_type_text ?? ''), 255),
      updated_by: operatorId,
      updated_at: now,
    };

    const detailRows = lines.map((line) => ({
      goods_id: line.goodsId,
      sku_id: line.skuId,
      unit_type: line.unitType,
      sale_qty: line.quantity,
      sale_price: zero,
      sale_amount: zero,
      fact_sale_amount: zero,
    }));

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
          shipper: headerData.shipper || old.shipper,
          delivery_date: headerData.delivery_date ?? old.delivery_date,
        },
      });
      const confirmedOutput = await tx.hspsi_sale_order_output.count({
        where: { so_id: existingSoId, comfirm_status: 1, deleted_at: null },
      });
      if (!confirmedOutput) {
        await tx.hspsi_sale_order_detail.deleteMany({ where: { so_id: existingSoId } });
        await tx.hspsi_sale_order_detail.createMany({
          data: detailRows.map((row) => ({ ...row, so_id: existingSoId })),
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
      data: detailRows.map((row) => ({ ...row, so_id: created.so_id })),
    });
    return { soId: created.so_id, created: true };
  }

  private async ensureShipments(
    tx: Tx,
    input: {
      soId: bigint;
      sourceId: bigint;
      snapshot: ShifangQingyuanAgentOrderListItem;
      lines: ResolvedOrderLine[];
      orgId: bigint;
      warehouseId: bigint;
      operatorId: bigint;
      now: Date;
      userId: string;
    },
  ): Promise<number> {
    const key = this.shipKey(input.sourceId, input.snapshot.id);
    const existed = await tx.hspsi_sale_order_output.findFirst({
      where: { so_id: input.soId, remark: key, deleted_at: null },
    });
    if (existed) return 0;

    const shipLines = this.mergeShipLines(input.lines);
    if (!shipLines.length) throw new BadRequestException('发货明细为空');

    const outputNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_OUTPUT);
    const output = await tx.hspsi_sale_order_output.create({
      data: {
        so_output_no: outputNo,
        so_id: input.soId,
        org_id: input.orgId,
        warehouse_id: input.warehouseId,
        output_date: this.parseUnix(input.snapshot.created_at) ?? input.now,
        go_where: 1,
        dept_id: 0n,
        receiver_id: input.operatorId,
        output_sku_qty: new Set(shipLines.map((line) => `${line.goodsId}:${line.skuId}`)).size,
        status: true,
        comfirm_status: 1,
        comfirm_comment: '十方清源自提发货同步自动确认',
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
        idempotencyKey: `shifang-qingyuan-output:${output.so_output_id}:v1`,
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
        delivery_date: this.parseUnix(input.snapshot.created_at) ?? input.now,
        shipper: this.clip(String(input.snapshot.express_no ?? '').trim(), 30),
        updated_by: input.operatorId,
        updated_at: input.now,
      },
    });
    return 1;
  }

  /**
   * 已出库后取消：按本平台出库单回库。未出库只关单。
   * 过账键绑定出库单 ID：sfqy-exit:{so_output_id}:v1
   */
  private async ensureRestock(
    tx: Tx,
    input: {
      soId: bigint;
      orgId: bigint;
      warehouseId: bigint;
      operatorId: bigint;
      now: Date;
      userId: string;
    },
  ): Promise<number> {
    const output = await tx.hspsi_sale_order_output.findFirst({
      where: { so_id: input.soId, comfirm_status: 1, deleted_at: null },
      orderBy: { so_output_id: 'asc' },
    });
    if (!output) return 0;

    const existed = await tx.hspsi_sale_order_exit.findFirst({
      where: {
        so_id: input.soId,
        source_output_id: output.so_output_id,
        deleted_at: null,
      },
    });
    if (existed) return 0;

    const outputDetails = await tx.hspsi_sale_order_output_detail.findMany({
      where: { so_output_id: output.so_output_id },
    });
    if (!outputDetails.length) throw new BadRequestException('出库明细为空，无法回库');

    const returnLines: ShipLine[] = outputDetails.map((line) => ({
      goodsId: line.goods_id,
      skuId: line.sku_id,
      unitType: Number(line.unit_type ?? 0),
      quantity: Number(line.output_qty),
      batchNo: String(line.batch_no ?? ''),
    }));
    const exitQty = returnLines.reduce((sum, line) => sum + line.quantity, 0);
    const so = await tx.hspsi_sale_order.findUniqueOrThrow({ where: { so_id: input.soId } });
    const exitNo = await this.businessNumber.generate(BUSINESS_PREFIX.SALES_RETURN);
    const exit = await tx.hspsi_sale_order_exit.create({
      data: {
        so_exit_no: exitNo,
        so_id: input.soId,
        source_output_id: output.so_output_id,
        exit_reson: '十方清源自提订单取消回库',
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
        comfirm_comment: '十方清源自提取消同步自动确认',
        comfirm_by: input.operatorId,
        comfirm_date: input.now,
        posting_version: 1,
        remark: `sfqy-exit:${output.so_output_id}:v1`,
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
        remark: '十方清源自提订单取消回库',
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
        idempotencyKey: `sfqy-exit:${output.so_output_id}:v1`,
        remark: '十方清源自提订单取消回库',
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
    return 1;
  }

  private async resolveOrderLines(
    tx: Tx,
    sourceId: bigint,
    details: ShifangQingyuanAgentOrderDetail[],
  ): Promise<ResolvedOrderLine[]> {
    if (!details.length) throw new BadRequestException('自提单明细为空');
    const lines: ResolvedOrderLine[] = [];
    for (const detail of details) {
      const sourceGoodsId = String(detail.goods_id);
      const mapping = await tx.hspsi_goods_source_mapping.findFirst({
        where: {
          source_id: sourceId,
          source_type: SHIFANG_QINGYUAN_SOURCE_TYPE.STANDARD,
          source_goods_id: sourceGoodsId,
          deleted_at: null,
        },
        orderBy: { id: 'asc' },
      });
      if (!mapping) {
        throw new BadRequestException(`商品未映射: goods=${sourceGoodsId} source_type=STANDARD`);
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
      lines.push({
        goodsId: mapping.goods_id,
        skuId: mapping.sku_id,
        unitType: Number(sku.unit_type ?? 0),
        quantity,
      });
    }
    return lines;
  }

  private mergeShipLines(orderLines: ResolvedOrderLine[]): ShipLine[] {
    const merged = new Map<string, ShipLine>();
    for (const line of orderLines) {
      if (!(line.quantity > 0)) continue;
      const key = `${line.goodsId}:${line.skuId}`;
      const cur = merged.get(key);
      if (cur) cur.quantity += line.quantity;
      else {
        merged.set(key, {
          goodsId: line.goodsId,
          skuId: line.skuId,
          unitType: line.unitType,
          quantity: line.quantity,
          batchNo: '',
        });
      }
    }
    return [...merged.values()];
  }

  private async ensureCustomer(
    tx: Tx,
    input: {
      sourceId: bigint;
      orgId: bigint;
      user: ShifangQingyuanUser;
      address: string;
      operatorId: bigint;
      now: Date;
    },
  ): Promise<bigint> {
    const userId = BigInt(input.user.id ?? 0);
    if (!(userId > 0n)) throw new BadRequestException('自提单缺少用户 id');
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
    const address = this.clip(input.address, 255);
    if (existing) {
      await tx.hspsi_basic_customer.update({
        where: { customer_id: existing.customer_id },
        data: {
          address,
          updated_by: input.operatorId,
          updated_at: input.now,
        },
      });
      return existing.customer_id;
    }

    const created = await tx.hspsi_basic_customer.create({
      data: {
        org_id: input.orgId,
        name: this.clip(this.userDisplayName(input.user), 100),
        gender: 0,
        mobile: this.clip(this.userMobile(input.user), 20),
        address,
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
    snapshot: ShifangQingyuanAgentOrderListItem,
    existing: { so_id: bigint } | null,
    tx: Tx,
  ): Promise<{ orderStatus: number; deliveryStatus: number; serviceStatus: number }> {
    let deliveryStatus = 1;
    let orderStatus = 1;
    const serviceStatus = 3;
    const status = Number(snapshot.send_status);

    switch (status) {
      case SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.PENDING_SHIP:
        orderStatus = 1;
        deliveryStatus = 1;
        break;
      case SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.SHIPPED:
        orderStatus = 1;
        deliveryStatus = 3;
        break;
      case SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.COMPLETED:
        orderStatus = 2;
        deliveryStatus = 3;
        break;
      case SHIFANG_QINGYUAN_AGENT_ORDER_SEND_STATUS.CANCELLED:
        orderStatus = 3;
        deliveryStatus = 1;
        break;
      default:
        orderStatus = 1;
        deliveryStatus = 1;
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

  private userDisplayName(user: ShifangQingyuanUser): string {
    const nickname = String(user.nickname ?? '').trim();
    if (nickname) return nickname;
    const username = String(user.username ?? '').trim();
    if (username) return username;
    return `用户${user.id}`;
  }

  private userMobile(user: ShifangQingyuanUser): string {
    const mobile = String(user.mobile ?? '').trim();
    if (mobile) return mobile;
    return String(user.username ?? '').trim();
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

  private shipKey(sourceId: bigint, orderId: number | string) {
    return `SFQY-AGENT-SHIP-${sourceId}-${orderId}`;
  }

  private async markMappingFailed(
    sourceId: bigint,
    snapshot: ShifangQingyuanAgentOrderListItem,
    reason: string,
    userId: string,
  ) {
    const now = new Date();
    const orderType = SHIFANG_QINGYUAN_ORDER_TYPE.CLOUD_STOCK_AGENT_ORDER;
    const sourceOrderId = String(snapshot.id ?? '');
    const existing = await this.prisma.hspsi_sale_order_source_mapping.findFirst({
      where: {
        source_id: sourceId,
        source_order_type: orderType,
        source_order_id: sourceOrderId,
        deleted_at: null,
      },
    });
    const data = {
      source_order_no: String(snapshot.order_no ?? ''),
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
        source_status: Number(snapshot.send_status ?? 0),
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
        source_order_type: SHIFANG_QINGYUAN_ORDER_TYPE.CLOUD_STOCK_AGENT_ORDER,
        last_sync_at: { not: null },
        deleted_at: null,
      },
      orderBy: { last_sync_at: 'desc' },
      select: { last_sync_at: true },
    });
    if (latest?.last_sync_at) {
      return this.formatDateTime(
        new Date(latest.last_sync_at.getTime() - SHIFANG_QINGYUAN_AGENT_ORDER_SYNC_OVERLAP_MS),
      );
    }
    return '1970-01-01 00:00:00';
  }

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
        remark: '十方清源自提订单同步自动创建',
        created_by: BigInt(userId),
        updated_by: BigInt(userId),
      },
    });
    return created.id;
  }

  private emptyStats(): ShifangQingyuanAgentOrderSyncStats {
    return {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      outputs: 0,
      exits: 0,
      warnings: [],
      failures: [],
    };
  }
}
