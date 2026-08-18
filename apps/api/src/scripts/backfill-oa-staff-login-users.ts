import { PrismaClient } from '@prisma/client';
import { XinfutongOaSyncService } from '../integrations/xinfutong-oa/sync/sync.service';

process.loadEnvFile?.('.env');

const prisma = new PrismaClient();
const syncService = new XinfutongOaSyncService(prisma as never);

type BackfillStats = {
  staffTotal: number;
  inserted: number;
  updated: number;
  skipped: number;
  enabled: number;
  disabled: number;
  missingPrimaryOrganization: number;
  mappedIdentities: number;
  uniqueLoginUsers: number;
};

async function primaryOrganization(staffId: bigint) {
  const membership = await prisma.hspsi_basic_staff_organizations.findFirst({
    where: { staff_id: staffId, type: 1, deleted_at: null },
    orderBy: [{ org_type: 'desc' }, { id: 'asc' }],
  });
  if (!membership) return null;
  if (membership.org_type === 1) {
    const organization = await prisma.hspsi_basic_organization.findFirst({
      where: { org_id: membership.org_id, operation_status: 1, deleted_at: null },
      select: { org_id: true },
    });
    return organization ? { orgId: organization.org_id, deptId: null } : null;
  }
  if (membership.org_type === 2) {
    const department = await prisma.hspsi_basic_dept.findFirst({
      where: { dept_id: membership.org_id, status: 1, deleted_at: null },
      select: { dept_id: true, org_id: true },
    });
    return department ? { orgId: department.org_id, deptId: department.dept_id } : null;
  }
  return null;
}

async function main() {
  const staff = await prisma.hspsi_basic_staff.findMany({
    where: { status: 1, deleted_at: null },
    orderBy: { id: 'asc' },
  });
  const stats: BackfillStats = {
    staffTotal: staff.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    enabled: 0,
    disabled: 0,
    missingPrimaryOrganization: 0,
    mappedIdentities: 0,
    uniqueLoginUsers: 0,
  };

  for (const employee of staff) {
    const primary = await primaryOrganization(employee.id);
    if (!primary) stats.missingPrimaryOrganization += 1;
    const identityUsable = Boolean(primary && employee.outer_ref_id && employee.mobile);
    const result = await syncService.upsertLoginUserByMobile({
      mobile: employee.mobile,
      name: employee.name,
      orgId: primary?.orgId ?? null,
      deptId: primary?.deptId ?? null,
      staffId: employee.id,
      accountSetId: employee.account_set_id,
      identityUsable: false,
    });
    stats[result] += 1;
    if (result === 'skipped') continue;

    const user = await prisma.hspsi_sys_user.findFirst({
      where: { username: employee.mobile, deleted_at: null },
      select: { id: true },
    });
    if (!user) {
      stats.skipped += 1;
      continue;
    }
    await syncService.linkUserOaStaffIdentity(user.id, employee.id, employee.account_set_id);
    await syncService.refreshUserAuthorization({
      userId: user.id,
      staffId: employee.id,
      postId: employee.post_id,
      accountSetId: employee.account_set_id,
      identityUsable,
    });
    const refreshed = await prisma.hspsi_sys_user.findUnique({
      where: { id: user.id },
      select: { status: true },
    });
    if (refreshed?.status === 1) stats.enabled += 1;
    else stats.disabled += 1;
  }

  const mappings = await prisma.hspsi_sys_user_oa_staff.findMany({
    select: { user_id: true, staff_id: true },
  });
  stats.mappedIdentities = mappings.length;
  stats.uniqueLoginUsers = new Set(mappings.map((item) => String(item.user_id))).size;

  console.log(JSON.stringify({ result: 'PASS', ...stats }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
