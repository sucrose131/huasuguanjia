import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';

/**
 * 外部订单同步写入售后明细：与页面退换货明细同一张表。
 * 商品/规格与售后主表一致；已有明细则跳过；无出库单时 source_output_id=0。
 */
export async function ensureSyncedSaleOrderServiceDetail(
  tx: Prisma.TransactionClient,
  input: {
    serviceId: bigint;
    soId: bigint;
    goodsId?: bigint | number | null;
    skuId?: bigint | number | null;
    unitType?: number | null;
    quantity?: number | null;
    remark?: string | null;
  },
): Promise<void> {
  const goodsId = BigInt(input.goodsId ?? 0);
  const skuId = BigInt(input.skuId ?? 0);
  const quantity = Math.trunc(Number(input.quantity) || 0);
  if (!(goodsId > 0n) || !(skuId > 0n) || !(quantity > 0)) return;

  const existed = await tx.hspsi_sale_order_service_detail.findFirst({
    where: { service_id: input.serviceId },
    select: { id: true },
  });
  if (existed) return;

  const output = await tx.hspsi_sale_order_output.findFirst({
    where: { so_id: input.soId, comfirm_status: 1, deleted_at: null },
    orderBy: { so_output_id: 'asc' },
    select: { so_output_id: true },
  });

  await tx.hspsi_sale_order_service_detail.createMany({
    data: [
      {
        service_id: input.serviceId,
        source_output_id: output?.so_output_id ?? 0n,
        goods_id: goodsId,
        sku_id: skuId,
        batch_no: '',
        unit_type: Number(input.unitType ?? 0),
        service_qty: quantity,
        remark: String(input.remark ?? '').slice(0, 255),
      },
    ],
  });
}

/** 售后主表缺商品，或退换货事件尚未写入明细时，不允许按水位跳过。 */
export async function hasIncompleteAfterSalesService(
  db: PrismaService,
  soId: bigint,
): Promise<boolean> {
  const services = await db.hspsi_sale_order_service.findMany({
    where: { so_id: soId, deleted_at: null, event_type: { in: [4, 5] } },
    select: { service_id: true, goods_id: true },
  });
  if (!services.length) return false;
  for (const service of services) {
    if (Number(service.goods_id) === 0) return true;
    const detail = await db.hspsi_sale_order_service_detail.findFirst({
      where: { service_id: service.service_id },
      select: { id: true },
    });
    if (!detail) return true;
  }
  return false;
}
