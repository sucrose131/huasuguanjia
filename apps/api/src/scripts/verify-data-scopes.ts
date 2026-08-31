import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash } from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line)
    process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, '');
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
  const body = (await response.json()) as any;
  assert(response.ok, `${username} 登录失败：${body.message ?? response.status}`);
  tokens.push(body.data.token);
  return body.data.token as string;
}

async function get(token: string, path: string) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as any;
  assert(response.ok, `${path} 请求失败：${body.message ?? response.status}`);
  return body.data;
}

async function main() {
  const organizations = await prisma.hspsi_basic_organization.findMany({
    where: { operation_status: 1, deleted_at: null },
    select: { org_id: true },
    orderBy: { org_id: 'asc' },
    take: 3,
  });
  assert(organizations.length >= 3, '至少需要三个启用组织验证固定组织与授权范围');
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
    { name: 'single', orgId: organizations[0]!.org_id, authorized: [organizations[0]!.org_id] },
    {
      name: 'multiple',
      orgId: organizations[0]!.org_id,
      authorized: organizations.slice(0, 2).map((item) => item.org_id),
    },
  ];
  const results: Record<string, unknown> = {};

  for (const fixture of fixtures) {
    const role = await prisma.hspsi_sys_role.create({
      data: {
        name: `授权组织验证${fixture.name}-${stamp}`,
        code: `verify-authorized-org-${fixture.name}-${stamp}`,
        status: 1,
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
        username: `verify_org_${fixture.name}_${stamp}`,
        password: passwordHash,
        nickname: `授权组织${fixture.name}验证`,
        status: 1,
      },
    });
    createdUserIds.push(user.id);
    await prisma.hspsi_sys_user_role.create({
      data: { user_id: Number(user.id), role_id: Number(role.id) },
    });
    await prisma.hspsi_sys_user_authorized_org.createMany({
      data: fixture.authorized.map((orgId) => ({ user_id: user.id, org_id: orgId })),
    });

    const token = await login(user.username);
    const me = await get(token, '/auth/me');
    const actualIds = new Set<string>(
      (me.authorizedOrganizations ?? []).map((item: { id: string }) => item.id),
    );
    assert(
      actualIds.size === fixture.authorized.length &&
        fixture.authorized.every((id) => actualIds.has(String(id))),
      '授权组织列表与关系表不一致',
    );
    assert(me.currentOrgId === String(fixture.orgId), '登录时没有默认选择主组织');
    if (fixture.authorized.length > 1) {
      const refreshed = await get(token, '/auth/me');
      assert(refreshed.currentOrgId === String(fixture.orgId), '额外授权组织改变了固定所属组织');
      const removedSwitch = await fetch(`${apiBase}/auth/switch-organization`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ orgId: String(fixture.authorized[1]) }),
      });
      assert(removedSwitch.status === 404, '旧组织切换接口仍然存在');
    }
    results[fixture.name] = { authorizedOrganizationIds: [...actualIds], passed: true };
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
      await prisma.hspsi_sys_user_authorized_org.deleteMany({
        where: { user_id: { in: createdUserIds } },
      });
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
