import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, '');
}

const prisma = new PrismaClient();

type AuditRow = Record<string, unknown>;

async function query(sql: string) {
  return prisma.$queryRawUnsafe<AuditRow[]>(sql);
}

async function main() {
  const checks = {
    activeWarehousesWithoutType: await query(`
      SELECT warehouse_id, org_id, name, warehouse_type
      FROM hspsi_basic_warehouse
      WHERE status = 1 AND deleted_at IS NULL AND warehouse_type <= 0
      ORDER BY warehouse_id
    `),
    activeCategoriesWithoutType: await query(`
      SELECT goods_catg_id, goods_name, warehouse_type
      FROM hspsi_goods_info_category
      WHERE status = 1 AND deleted_at IS NULL AND warehouse_type <= 0
      ORDER BY goods_catg_id
    `),
    salesOrderLinkErrors: await query(`
      SELECT so.so_id, so.so_no, so.org_id, so.warehouse_id, d.goods_id,
             w.org_id AS warehouse_org_id, w.warehouse_type, c.warehouse_type AS category_warehouse_type
      FROM hspsi_sale_order so
      JOIN hspsi_sale_order_detail d ON d.so_id = so.so_id
      LEFT JOIN hspsi_basic_warehouse w ON w.warehouse_id = so.warehouse_id
      LEFT JOIN hspsi_goods_info g ON g.goods_id = d.goods_id
      LEFT JOIN hspsi_goods_info_category c ON c.goods_catg_id = g.goods_catg_id
      WHERE so.deleted_at IS NULL AND (
        w.warehouse_id IS NULL OR w.org_id <> so.org_id OR
        g.goods_id IS NULL OR g.org_id NOT IN (0, so.org_id) OR
        c.goods_catg_id IS NULL OR c.warehouse_type <> w.warehouse_type
      )
      ORDER BY so.so_id, d.id
    `),
    requisitionLinkErrors: await query(`
      SELECT a.draw_id, a.draw_no, a.org_id, a.warehouse_id, d.goods_id,
             g.org_id AS goods_org_id, w.org_id AS warehouse_org_id,
             w.warehouse_type, c.warehouse_type AS category_warehouse_type
      FROM hspsi_draw_approve a
      JOIN hspsi_draw_approve_detail d ON d.draw_id = a.draw_id
      LEFT JOIN hspsi_basic_warehouse w ON w.warehouse_id = a.warehouse_id
      LEFT JOIN hspsi_goods_info g ON g.goods_id = d.goods_id
      LEFT JOIN hspsi_goods_info_category c ON c.goods_catg_id = g.goods_catg_id
      WHERE a.deleted_at IS NULL AND (
        w.warehouse_id IS NULL OR w.org_id <> a.org_id OR
        g.goods_id IS NULL OR g.org_id NOT IN (0, a.org_id) OR
        c.goods_catg_id IS NULL OR c.warehouse_type <> w.warehouse_type
      )
      ORDER BY a.draw_id, d.draw_detail_id
    `),
    productionBomLinkErrors: await query(`
      SELECT b.bom_id, b.bom_no, b.org_id, b.warehouse_id, d.goods_id,
             w.org_id AS warehouse_org_id, w.warehouse_type, c.warehouse_type AS category_warehouse_type
      FROM hspsi_production_bom b
      JOIN hspsi_production_bom_detail d ON d.bom_id = b.bom_id
      LEFT JOIN hspsi_basic_warehouse w ON w.warehouse_id = b.warehouse_id
      LEFT JOIN hspsi_goods_info g ON g.goods_id = d.goods_id
      LEFT JOIN hspsi_goods_info_category c ON c.goods_catg_id = g.goods_catg_id
      WHERE b.deleted_at IS NULL AND (
        w.warehouse_id IS NULL OR w.org_id <> b.org_id OR
        g.goods_id IS NULL OR g.org_id NOT IN (0, b.org_id) OR
        c.goods_catg_id IS NULL OR c.warehouse_type <> w.warehouse_type
      )
      ORDER BY b.bom_id, d.id
    `),
    transferWarehouseOrgErrors: await query(`
      SELECT t.transfer_id, t.transfer_no, t.org_id, t.warehouse_id,
             t.to_org_id, t.to_warehouse_id,
             source.org_id AS source_warehouse_org_id,
             target.org_id AS target_warehouse_org_id
      FROM hspsi_inventory_transfer t
      LEFT JOIN hspsi_basic_warehouse source ON source.warehouse_id = t.warehouse_id
      LEFT JOIN hspsi_basic_warehouse target ON target.warehouse_id = t.to_warehouse_id
      WHERE t.deleted_at IS NULL AND (
        source.warehouse_id IS NULL OR source.org_id <> t.org_id OR
        target.warehouse_id IS NULL OR target.org_id <> t.to_org_id
      )
      ORDER BY t.transfer_id
    `),
  };

  const output = Object.fromEntries(
    Object.entries(checks).map(([name, rows]) => [name, { count: rows.length, rows }]),
  );
  console.log(JSON.stringify(output, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
