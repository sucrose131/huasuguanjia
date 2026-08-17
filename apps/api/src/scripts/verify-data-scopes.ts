import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line) process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, '');
}

const prisma = new PrismaClient();
const apiBase = process.env.TEST_API_URL ?? 'http://127.0.0.1:8000/api';
const stamp = Date.now();
const password = 'VerifyScope#2026';
const createdUserIds: bigint[] = [];
const createdRoleIds: bigint[] = [];
const tokens: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function login(username: string) {
  const response = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json() as any;
  assert(response.ok, `${username} 登录失败：${body.message ?? response.status}`);
  tokens.push(body.data.token);
  return body.data.token as string;
}

async function get(token: string, path: string) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await response.json() as any;
  assert(response.ok, `${path} 请求失败：${body.message ?? response.status}`);
  return body.data;
}

async function main() {
  const organizations = await prisma.hspsi_basic_organization.findMany({
    where: { operation_status: 1, deleted_at: null },
    select: { org_id: true, parent_id: true },
  });
  const purchaseMenu = await prisma.hspsi_sys_menu.findFirst({
    where: { code: 'purchase:applications', status: 1, deleted_at: null },
  });
  assert(purchaseMenu, '缺少采购申请菜单权限测试夹具');
  const purchaseDirectory = await prisma.hspsi_sys_menu.findFirst({
    where: { code: 'purchase', status: 1, deleted_at: null },
  });
  assert(purchaseDirectory, '缺少采购管理目录权限测试夹具');
  const passwordHash = await hash(password, 12);
  const fixtures = [
    { scope: 1, orgId: 6n, specified: [] as bigint[] },
    { scope: 2, orgId: 1n, specified: [] as bigint[] },
    { scope: 3, orgId: 6n, specified: [] as bigint[] },
    { scope: 4, orgId: 6n, specified: [7n] },
    { scope: 5, orgId: 6n, specified: [] as bigint[] },
  ];
  const results: Record<string, unknown> = {};

  for (const fixture of fixtures) {
    const role = await prisma.hspsi_sys_role.create({
      data: {
        name: `权限范围验证${fixture.scope}-${stamp}`,
        code: `verify-scope-${fixture.scope}-${stamp}`,
        status: 1,
        data_scope_type: fixture.scope,
      },
    });
    createdRoleIds.push(role.id);
    await prisma.hspsi_sys_role_menu.createMany({
      data: [purchaseDirectory.id, purchaseMenu.id].map((menuId) => ({
        role_id: role.id,
        menu_id: BigInt(menuId),
      })),
    });
    const user = await prisma.hspsi_sys_user.create({
      data: {
        org_id: fixture.orgId,
        username: `verify_scope_${fixture.scope}_${stamp}`,
        password: passwordHash,
        nickname: `数据范围${fixture.scope}验证`,
        status: 1,
      },
    });
    createdUserIds.push(user.id);
    await prisma.hspsi_sys_user_role.create({
      data: { user_id: Number(user.id), role_id: Number(role.id) },
    });
    if (fixture.specified.length)
      await prisma.hspsi_sys_user_org_scope.createMany({
        data: fixture.specified.map((orgId) => ({ user_id: user.id, org_id: orgId })),
      });

    const token = await login(user.username);
    const me = await get(token, '/auth/me');
    const actualIds = new Set<string>(me.organizationIds);
    if (fixture.scope === 1)
      assert(actualIds.size === organizations.length, '全部数据范围未包含全部启用组织');
    if (fixture.scope === 2) {
      const expected = new Set(['1']);
      let changed = true;
      while (changed) {
        changed = false;
        for (const org of organizations) {
          if (!expected.has(String(org.org_id)) && expected.has(String(org.parent_id))) {
            expected.add(String(org.org_id));
            changed = true;
          }
        }
      }
      assert([...expected].every((id) => actualIds.has(id)), '本组织及下级范围计算错误');
    }
    if (fixture.scope === 3)
      assert(actualIds.size === 1 && actualIds.has('6'), '本组织范围计算错误');
    if (fixture.scope === 4)
      assert(actualIds.size === 2 && actualIds.has('6') && actualIds.has('7'), '指定组织范围计算错误');
    if (fixture.scope === 5) {
      assert(actualIds.size === 1 && actualIds.has('6'), '本人数据组织范围计算错误');
      const applications = await get(token, '/purchase/applications');
      assert((applications.items ?? []).length === 0, '本人数据范围读取了他人创建的采购申请');
    }
    results[`scope${fixture.scope}`] = { organizationIds: [...actualIds], passed: true };
  }

  console.log(JSON.stringify({ result: 'PASS', scopes: results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const token of tokens) {
      try {
        await fetch(`${apiBase}/auth/logout`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
      } catch {}
    }
    if (createdUserIds.length) {
      await prisma.hspsi_sys_user_org_scope.deleteMany({ where: { user_id: { in: createdUserIds } } });
      await prisma.hspsi_sys_user_role.deleteMany({
        where: { user_id: { in: createdUserIds.map(Number) } },
      });
      await prisma.hspsi_sys_user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdRoleIds.length) {
      await prisma.hspsi_sys_role_menu.deleteMany({ where: { role_id: { in: createdRoleIds } } });
      await prisma.hspsi_sys_role.deleteMany({ where: { id: { in: createdRoleIds } } });
    }
    await prisma.$disconnect();
  });
