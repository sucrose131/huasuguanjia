import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

type InventoryDb = Prisma.TransactionClient | PrismaService;

export function expiryAlertDaysFromDictionaryName(name: unknown, fallback = 90) {
  const matched = String(name ?? '').match(/(\d+)\s*天/);
  const days = Number(matched?.[1] ?? fallback);
  return Number.isFinite(days) && days >= 0 ? days : fallback;
}

@Injectable()
export class InventoryAlertService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async syncExpiryAlert(
    db: InventoryDb,
    input: {
      goodsId: bigint | string | number;
      skuId: bigint | string | number;
      warehouseId: bigint | string | number;
      batchNo: string;
      endDay?: Date | string | null;
    },
  ) {
    const batchNo = String(input.batchNo ?? '').trim();
    if (!batchNo || !input.endDay) return null;
    const endDay = input.endDay instanceof Date ? input.endDay : new Date(String(input.endDay));
    if (Number.isNaN(endDay.getTime())) return null;

    const goodsId = BigInt(input.goodsId);
    const skuId = BigInt(input.skuId);
    const warehouseId = BigInt(input.warehouseId);
    const category = await db.hspsi_sys_dictionary_category.findFirst({
      where: { dict_catg_code: 'expiry_alert_type', deleted_at: null },
      select: { dict_catg_id: true },
    });
    const defaultType = category
      ? await db.hspsi_sys_dictionary.findFirst({
          where: { dict_catg_id: category.dict_catg_id, deleted_at: null },
          orderBy: [{ sort: 'asc' }, { dict_id: 'asc' }],
          select: { dict_value: true, dict_name: true },
        })
      : null;
    const stock = await db.hspsi_inventory_batch_total.findUnique({
      where: {
        goods_id_sku_id_warehouse_id_batch_no: {
          goods_id: goodsId,
          sku_id: skuId,
          warehouse_id: warehouseId,
          batch_no: batchNo,
        },
      },
      select: { inventory_qty: true, inventory_amount: true },
    });
    const data = {
      end_day: endDay,
      alter_type: Number(defaultType?.dict_value ?? 0),
      alter_day: expiryAlertDaysFromDictionaryName(defaultType?.dict_name),
      alter_qty: Number(stock?.inventory_qty ?? 0),
      alter_value: String(stock?.inventory_amount ?? 0),
      updated_at: new Date(),
    };
    const existing = await db.hspsi_inventory_alert_period.findFirst({
      where: { goods_id: goodsId, sku_id: skuId, warehouse_id: warehouseId, batch_no: batchNo },
      orderBy: { id: 'asc' },
    });
    if (existing) {
      return db.hspsi_inventory_alert_period.update({ where: { id: existing.id }, data });
    }
    return db.hspsi_inventory_alert_period.create({
      data: {
        goods_id: goodsId,
        sku_id: skuId,
        warehouse_id: warehouseId,
        batch_no: batchNo,
        ...data,
        created_at: new Date(),
      },
    });
  }
}
