import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../database/prisma.service';
import { runWithDataScope } from '../database/data-scope.context';

if (!process.env.DATABASE_URL) {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line)
    process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, '');
}

const prisma = new PrismaService();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  await prisma.$connect();
  const warehouses = await prisma.hspsi_basic_warehouse.findMany({
    where: { deleted_at: null },
    select: { warehouse_id: true, org_id: true },
    orderBy: { warehouse_id: 'asc' },
  });
  const organizationIds = [...new Set(warehouses.map((item) => String(item.org_id)))];
  assert(organizationIds.length >= 2, '至少需要两个有仓库的组织验证数据隔离');
  const currentOrgId = organizationIds[0]!;
  const foreignOrgId = organizationIds[1]!;
  const scopedUser = {
    id: '999999',
    username: 'organization-verifier',
    orgId: currentOrgId,
    deptId: null,
    currentOrgId,
    currentOrgName: '自动验证组织',
    authorizedOrganizations: [
      { id: currentOrgId, name: '当前组织' },
      { id: foreignOrgId, name: '其他组织' },
    ],
    isSuperAdmin: false,
    permissions: [],
  };

  const scopedWarehouses = await runWithDataScope(
    scopedUser,
    async () =>
      await prisma.hspsi_basic_warehouse.findMany({
        where: { deleted_at: null },
        select: { warehouse_id: true, org_id: true },
      }),
  );
  assert(
    scopedWarehouses.length > 0 &&
      scopedWarehouses.every((item) => String(item.org_id) === currentOrgId),
    '仓库列表出现非当前组织数据',
  );

  const foreignWarehouse = warehouses.find((item) => String(item.org_id) === foreignOrgId)!;
  let crossOrganizationReadBlocked = false;
  try {
    await runWithDataScope(
      scopedUser,
      async () =>
        await prisma.hspsi_basic_warehouse.findUnique({
          where: { warehouse_id: foreignWarehouse.warehouse_id },
        }),
    );
  } catch {
    crossOrganizationReadBlocked = true;
  }
  assert(crossOrganizationReadBlocked, '跨组织仓库详情读取未被拒绝');

  let crossOrganizationCreateBlocked = false;
  try {
    await runWithDataScope(
      scopedUser,
      async () =>
        await prisma.hspsi_basic_warehouse.create({
          data: { org_id: BigInt(foreignOrgId) } as never,
        }),
    );
  } catch {
    crossOrganizationCreateBlocked = true;
  }
  assert(crossOrganizationCreateBlocked, '跨组织仓库创建未被拒绝');

  let missingOrganizationCreateBlocked = false;
  try {
    await runWithDataScope(
      scopedUser,
      async () => await prisma.hspsi_basic_warehouse.create({ data: {} as never }),
    );
  } catch {
    missingOrganizationCreateBlocked = true;
  }
  assert(missingOrganizationCreateBlocked, '缺少组织归属的仓库创建未被拒绝');

  const sharedGoods = await prisma.hspsi_goods_info.findFirst({
    where: { org_id: 0n, deleted_at: null },
    select: { goods_id: true },
  });
  if (sharedGoods) {
    const visible = await runWithDataScope(
      scopedUser,
      async () =>
        await prisma.hspsi_goods_info.findFirst({ where: { goods_id: sharedGoods.goods_id } }),
    );
    assert(visible, '集团共享商品 org_id=0 被当前组织过滤误伤');
  }

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        currentOrgId,
        checks: {
          listOnlyCurrentOrganization: true,
          crossOrganizationReadBlocked,
          crossOrganizationCreateBlocked,
          missingOrganizationCreateBlocked,
          sharedGoodsStillVisible: Boolean(sharedGoods),
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
