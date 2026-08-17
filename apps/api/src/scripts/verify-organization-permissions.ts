import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AmountAccessService } from '../amount-access/amount-access.service';
import { PrismaService } from '../database/prisma.service';
import { runWithDataScope } from '../database/data-scope.context';
import { SystemService } from '../system/system.service';

if (!process.env.DATABASE_URL) {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, '');
}

const prisma = new PrismaService();
const amountAccess = new AmountAccessService(prisma);
const system = new SystemService(prisma, amountAccess);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  await prisma.$connect();
  const scopedUser = {
    id: '4',
    username: 'scope-verifier',
    orgId: '6',
    deptId: null,
    dataScopeType: 3,
    organizationIds: ['6'],
    isSuperAdmin: false,
    permissions: [],
  };
  const scopedWarehouses = await runWithDataScope(scopedUser, async () =>
    await prisma.hspsi_basic_warehouse.findMany({
      where: { deleted_at: null },
      select: { warehouse_id: true, org_id: true },
    }),
  );
  assert(scopedWarehouses.length > 0 && scopedWarehouses.every((row) => row.org_id === 6n),
    '本组织查询出现跨组织仓库');
  const foreignWarehouse = await prisma.hspsi_basic_warehouse.findFirst({
    where: { org_id: 9n, deleted_at: null },
  });
  assert(foreignWarehouse, '缺少跨组织读取测试仓库');
  let crossOrgReadBlocked = false;
  try {
    await runWithDataScope(scopedUser, async () =>
      await prisma.hspsi_basic_warehouse.findUnique({
        where: { warehouse_id: foreignWarehouse.warehouse_id },
      }),
    );
  } catch {
    crossOrgReadBlocked = true;
  }
  assert(crossOrgReadBlocked, '跨组织唯一记录读取未被拒绝');
  let crossOrgCreateBlocked = false;
  try {
    await runWithDataScope(scopedUser, async () =>
      await prisma.hspsi_basic_warehouse.create({ data: { org_id: 9n } as any }),
    );
  } catch {
    crossOrgCreateBlocked = true;
  }
  assert(crossOrgCreateBlocked, '跨组织创建未被拒绝');
  let missingOrgCreateBlocked = false;
  try {
    await runWithDataScope(scopedUser, async () =>
      await prisma.hspsi_basic_warehouse.create({ data: {} as any }),
    );
  } catch {
    missingOrgCreateBlocked = true;
  }
  assert(missingOrgCreateBlocked, '缺少组织归属的创建未被拒绝');
  const ownStock = await prisma.hspsi_inventory_total.findFirst({ where: { org_id: 6n } });
  assert(ownStock, '缺少本组织复合库存测试数据');
  const compositeStock = await runWithDataScope(scopedUser, async () =>
    await prisma.hspsi_inventory_total.findUnique({
      where: {
        org_id_warehouse_id_goods_id_sku_id: {
          org_id: ownStock.org_id,
          warehouse_id: ownStock.warehouse_id,
          goods_id: ownStock.goods_id,
          sku_id: ownStock.sku_id,
        },
      },
    }),
  );
  assert(compositeStock, '本组织复合唯一键库存查询被误拦截');
  const foreignStock = await prisma.hspsi_inventory_total.findFirst({ where: { org_id: 9n } });
  assert(foreignStock, '缺少跨组织复合库存测试数据');
  let crossOrgCompositeReadBlocked = false;
  try {
    await runWithDataScope(scopedUser, async () =>
      await prisma.hspsi_inventory_total.findUnique({
        where: {
          org_id_warehouse_id_goods_id_sku_id: {
            org_id: foreignStock.org_id,
            warehouse_id: foreignStock.warehouse_id,
            goods_id: foreignStock.goods_id,
            sku_id: foreignStock.sku_id,
          },
        },
      }),
    );
  } catch {
    crossOrgCompositeReadBlocked = true;
  }
  assert(crossOrgCompositeReadBlocked, '跨组织复合唯一键库存查询未被拒绝');
  const fixture = await prisma.hspsi_basic_staff.findFirst({
    where: {
      status: 1,
      deleted_at: null,
      post_id: { gt: 0 },
      id: { notIn: (await prisma.hspsi_sys_user.findMany({
        where: { staff_id: { not: null }, deleted_at: null },
        select: { staff_id: true },
      })).flatMap((item) => (item.staff_id ? [item.staff_id] : [])) },
    },
    orderBy: { id: 'asc' },
  });
  assert(fixture, '没有可用于验证的启用 OA 人员');
  const membership = await prisma.hspsi_basic_staff_organizations.findFirst({
    where: { staff_id: fixture.id, type: 1, deleted_at: null },
  });
  const position = await prisma.hspsi_basic_position.findFirst({
    where: { id: fixture.post_id, status: 1, deleted_at: null },
  });
  assert(membership && position, '测试人员的主组织或岗位无效');
  const department = membership.org_type === 2
    ? await prisma.hspsi_basic_dept.findFirst({
        where: { dept_id: membership.org_id, status: 1, deleted_at: null },
      })
    : null;
  const expectedOrgId = membership.org_type === 1 ? membership.org_id : department?.org_id;
  const expectedDeptId = membership.org_type === 2 ? membership.org_id : null;
  assert(expectedOrgId, '测试人员无法反算所属组织');
  const role = await prisma.hspsi_sys_role.findFirst({
    where: { code: { not: 'admin' }, status: 1, deleted_at: null },
  });
  assert(role, '没有可用于验证的启用普通角色');

  const account = `verify-scope-${Date.now()}`;
  let createdId: bigint | null = null;
  try {
    const result = await system.createUser(
      {
        account,
        password: 'Verify#2026',
        name: fixture.name,
        phone: fixture.mobile,
        staffId: String(fixture.id),
        // 故意提交错误组织；后端必须以 OA 人员主关系为准。
        orgId: expectedOrgId === 9n ? '6' : '9',
        deptId: '',
        roleIds: [String(role.id)],
        authorizedOrgIds: [],
        status: 1,
      },
      '1',
    );
    createdId = BigInt(result.id);
    const saved = await prisma.hspsi_sys_user.findUnique({ where: { id: createdId } });
    assert(saved?.staff_id === fixture.id, '系统用户没有稳定关联 OA 人员');
    assert(saved.org_id === expectedOrgId, '所属组织未按 OA 人员主关系反算');
    assert(saved.dept_id === expectedDeptId, '所属部门未按 OA 人员主关系反算');
    assert(
      (await prisma.hspsi_sys_user_role.count({ where: { user_id: Number(createdId) } })) === 1,
      '角色没有正确绑定',
    );
    assert(
      (await prisma.hspsi_sys_user_amount_access.count({ where: { user_id: createdId } })) === 0,
      '关联 OA 人员时不应自动授予金额白名单',
    );
    console.log(JSON.stringify({
      result: 'PASS',
      checks: {
        oaStaffLinked: true,
        organizationDerivedFromPrimaryMembership: true,
        departmentDerivedFromPrimaryMembership: true,
        activePositionRequired: true,
        roleBoundIndependently: true,
        amountWhitelistNotGrantedAutomatically: true,
        organizationScopedRead: true,
        crossOrganizationReadBlocked: true,
        crossOrganizationCreateBlocked: true,
        missingOrganizationWriteBlocked: true,
        compositeInventoryKeyAllowedInOrganization: true,
        crossOrganizationCompositeKeyBlocked: true,
      },
    }, null, 2));
  } finally {
    if (createdId) {
      await prisma.hspsi_sys_user_amount_access.deleteMany({ where: { user_id: createdId } });
      await prisma.hspsi_sys_user_org_scope.deleteMany({ where: { user_id: createdId } });
      await prisma.hspsi_sys_user_role.deleteMany({ where: { user_id: Number(createdId) } });
      await prisma.hspsi_sys_user.delete({ where: { id: createdId } });
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
