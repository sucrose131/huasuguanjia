import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type InventoryLine = {
  goodsId: bigint | string | number;
  skuId: bigint | string | number;
  batchNo?: string | null;
  unitType?: number;
  quantity: number | string;
  amount?: number | string;
};

export type InventoryPosting = {
  orgId: bigint | string | number;
  warehouseId: bigint | string | number;
  direction: 1 | -1;
  operationType: number;
  inventoryMode: number;
  sourceId: bigint | string | number;
  sourceType: string;
  sourceNo: string;
  operationBy: bigint | string | number;
  idempotencyKey: string;
  remark: string;
  lines: InventoryLine[];
};

type Db = Prisma.TransactionClient | PrismaClient;

@Injectable()
export class InventoryPostingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async post(input: InventoryPosting, tx?: Prisma.TransactionClient) {
    if (tx) return this.postInTransaction(tx, input);
    return this.prisma.$transaction((client) => this.postInTransaction(client, input));
  }

  private async validateMaster(db: Db, input: InventoryPosting) {
    const orgId = BigInt(String(input.orgId));
    const warehouseId = BigInt(String(input.warehouseId));
    const warehouse = await db.hspsi_basic_warehouse.findFirst({
      where: { warehouse_id: warehouseId, org_id: orgId, status: 1, deleted_at: null },
    });
    if (!warehouse) throw new BadRequestException('组织或仓库无效，或仓库未启用');
    if (!input.lines.length) throw new BadRequestException('库存过账至少需要一条明细');
    for (const line of input.lines) {
      if (!Number.isSafeInteger(Number(line.quantity)) || Number(line.quantity) <= 0)
        throw new BadRequestException('库存数量必须为正整数');
      const goodsId = BigInt(String(line.goodsId));
      const skuId = BigInt(String(line.skuId));
      const goods = await db.hspsi_goods_info.findFirst({
        where: {
          goods_id: goodsId,
          org_id: { in: [0n, orgId] },
          status: 1,
          deleted_at: null,
        },
      });
      const sku = await db.hspsi_goods_info_sku.findFirst({
        where: { sku_id: skuId, good_id: goodsId, status: 1, deleted_at: null },
      });
      if (!goods || !sku) throw new BadRequestException('商品或 SKU 无效，或未启用');
      const category = await db.hspsi_goods_info_category.findFirst({
        where: { goods_catg_id: goods.goods_catg_id, deleted_at: null },
      });
      if (category && category.warehouse_type !== warehouse.warehouse_type)
        throw new BadRequestException(`${goods.goods_name} 与目标仓库类型不匹配`);
    }
  }

  private async postInTransaction(tx: Prisma.TransactionClient, input: InventoryPosting) {
    await this.validateMaster(tx, input);
    const orgId = BigInt(String(input.orgId));
    const warehouseId = BigInt(String(input.warehouseId));
    const sourceId = BigInt(String(input.sourceId));
    const operationBy = BigInt(String(input.operationBy));
    const results: Array<{
      goodsId: bigint;
      skuId: bigint;
      batchNo: string;
      quantity: number;
      amount: number;
      unitCost: number;
    }> = [];
    for (const line of input.lines) {
      const goodsId = BigInt(String(line.goodsId));
      const skuId = BigInt(String(line.skuId));
      const batchNo = String(line.batchNo ?? '').trim();
      const quantity = Number(line.quantity);
      const totalKey = {
        org_id_warehouse_id_goods_id_sku_id: {
          org_id: orgId,
          warehouse_id: warehouseId,
          goods_id: goodsId,
          sku_id: skuId,
        },
      };
      const batchKey = {
        goods_id_sku_id_warehouse_id_batch_no: {
          goods_id: goodsId,
          sku_id: skuId,
          warehouse_id: warehouseId,
          batch_no: batchNo,
        },
      };

      // 锁定总量和批次行，保证并发出库不会形成负库存。
      await tx.$queryRaw`SELECT id FROM hspsi_inventory_total WHERE org_id=${orgId} AND warehouse_id=${warehouseId} AND goods_id=${goodsId} AND sku_id=${skuId} FOR UPDATE`;
      await tx.$queryRaw`SELECT goods_id FROM hspsi_inventory_batch_total WHERE warehouse_id=${warehouseId} AND goods_id=${goodsId} AND sku_id=${skuId} AND batch_no=${batchNo} FOR UPDATE`;
      const [total, batch] = await Promise.all([
        tx.hspsi_inventory_total.findUnique({ where: totalKey }),
        tx.hspsi_inventory_batch_total.findUnique({ where: batchKey }),
      ]);
      if (
        input.direction < 0 &&
        (!total ||
          !batch ||
          Number(total.inventory_qty) < quantity ||
          Number(batch.inventory_qty) < quantity)
      ) {
        throw new BadRequestException(`批次 ${batchNo || '无批号'} 库存不足`);
      }

      const unitType = Number(line.unitType ?? batch?.unit_type ?? total?.unit_type ?? 0);
      const amount =
        input.direction > 0
          ? Number(line.amount ?? 0)
          : batch && Number(batch.inventory_qty) > 0
            ? (Number(batch.inventory_amount) * quantity) / Number(batch.inventory_qty)
            : 0;
      const signedQty = quantity * input.direction;
      const signedAmount = amount * input.direction;
      const inputIncrement = input.direction > 0 ? quantity : 0;
      const outputIncrement = input.direction < 0 ? quantity : 0;

      const postingKey = `${input.idempotencyKey}:${warehouseId}:${goodsId}:${skuId}:${batchNo}`;
      if (await tx.hspsi_inventory_total_detail.findUnique({ where: { posting_key: postingKey } }))
        throw new BadRequestException('该业务明细已经完成库存过账，请勿重复操作');
      const updatedTotal = await tx.hspsi_inventory_total.upsert({
        where: totalKey,
        create: {
          org_id: orgId,
          warehouse_id: warehouseId,
          goods_id: goodsId,
          sku_id: skuId,
          unit_type: unitType,
          input_qty: inputIncrement,
          output_qty: outputIncrement,
          inventory_qty: signedQty,
          inventory_amount: new Prisma.Decimal(signedAmount),
        },
        update: {
          input_qty: { increment: inputIncrement },
          output_qty: { increment: outputIncrement },
          inventory_qty: { increment: signedQty },
          inventory_amount: { increment: new Prisma.Decimal(signedAmount) },
          updated_at: new Date(),
          deleted_at: null,
        },
      });
      await tx.hspsi_inventory_batch_total.upsert({
        where: batchKey,
        create: {
          org_id: orgId,
          warehouse_id: warehouseId,
          goods_id: goodsId,
          sku_id: skuId,
          batch_no: batchNo,
          unit_type: unitType,
          input_qty: inputIncrement,
          output_qty: outputIncrement,
          inventory_qty: signedQty,
          inventory_amount: new Prisma.Decimal(signedAmount),
        },
        update: {
          input_qty: { increment: inputIncrement },
          output_qty: { increment: outputIncrement },
          inventory_qty: { increment: signedQty },
          inventory_amount: { increment: new Prisma.Decimal(signedAmount) },
        },
      });
      const [goods, sku, org, warehouse, unit] = await Promise.all([
        tx.hspsi_goods_info.findUniqueOrThrow({ where: { goods_id: goodsId } }),
        tx.hspsi_goods_info_sku.findUniqueOrThrow({ where: { sku_id: skuId } }),
        tx.hspsi_basic_organization.findUniqueOrThrow({ where: { org_id: orgId } }),
        tx.hspsi_basic_warehouse.findUniqueOrThrow({ where: { warehouse_id: warehouseId } }),
        unitType ? tx.hspsi_basic_unit.findUnique({ where: { id: BigInt(unitType) } }) : null,
      ]);
      await tx.hspsi_inventory_total_detail.create({
        data: {
          org_id: orgId,
          warehouse_id: warehouseId,
          goods_id: goodsId,
          sku_id: skuId,
          batch_no: batchNo,
          operation_type: input.operationType,
          operation_qty: signedQty,
          inventory_mode: input.inventoryMode,
          source_id: sourceId,
          source_type: input.sourceType,
          source_no: input.sourceNo,
          operation_by: operationBy,
          after_qty: updatedTotal.inventory_qty,
          posting_key: postingKey,
          goods_code: goods.query_code,
          goods_name: goods.goods_name,
          sku_spec: sku.spec_models,
          org_name: org.name,
          warehouse_name: warehouse.name,
          unit_name: unit?.name ?? '',
          remark: input.remark,
        },
      });
      results.push({
        goodsId,
        skuId,
        batchNo,
        quantity,
        amount,
        unitCost: quantity > 0 ? amount / quantity : 0,
      });
    }
    return results;
  }
}
