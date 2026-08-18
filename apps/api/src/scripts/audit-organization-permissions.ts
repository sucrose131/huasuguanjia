import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

if (!process.env.DATABASE_URL) {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((item) => item.startsWith('DATABASE_URL='));
  if (line)
    process.env.DATABASE_URL = line.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, '');
}

const prisma = new PrismaClient();
type AuditRow = Record<string, unknown>;

async function query(sql: string) {
  return prisma.$queryRawUnsafe<AuditRow[]>(sql);
}

async function main() {
  const checks = {
    organizationsWithMissingParent: await query(`
      SELECT child.org_id, child.name, child.parent_id
      FROM hspsi_basic_organization child
      LEFT JOIN hspsi_basic_organization parent
        ON parent.org_id = child.parent_id AND parent.deleted_at IS NULL
      WHERE child.deleted_at IS NULL AND child.parent_id > 0 AND parent.org_id IS NULL
    `),
    departmentsWithInvalidOrganization: await query(`
      SELECT dept.dept_id, dept.name, dept.org_id
      FROM hspsi_basic_dept dept
      LEFT JOIN hspsi_basic_organization org
        ON org.org_id = dept.org_id AND org.deleted_at IS NULL
      WHERE dept.deleted_at IS NULL AND org.org_id IS NULL
    `),
    departmentsWithInvalidParent: await query(`
      SELECT child.dept_id, child.name, child.parent_id, child.org_id
      FROM hspsi_basic_dept child
      LEFT JOIN hspsi_basic_dept parent
        ON parent.dept_id = child.parent_id AND parent.deleted_at IS NULL
      WHERE child.deleted_at IS NULL
        AND child.parent_id > 0
        AND (parent.dept_id IS NULL OR parent.org_id <> child.org_id)
    `),
    staffWithInvalidPrimaryMembership: await query(`
      SELECT staff.id, staff.name,
             SUM(CASE WHEN membership.type = 1 AND membership.deleted_at IS NULL THEN 1 ELSE 0 END) primary_count
      FROM hspsi_basic_staff staff
      LEFT JOIN hspsi_basic_staff_organizations membership ON membership.staff_id = staff.id
      WHERE staff.deleted_at IS NULL
      GROUP BY staff.id, staff.name
      HAVING primary_count <> 1
    `),
    staffWithInvalidMembershipTarget: await query(`
      SELECT membership.id, membership.staff_id, membership.org_type, membership.org_id
      FROM hspsi_basic_staff_organizations membership
      LEFT JOIN hspsi_basic_organization org
        ON membership.org_type = 1 AND org.org_id = membership.org_id AND org.deleted_at IS NULL
      LEFT JOIN hspsi_basic_dept dept
        ON membership.org_type = 2 AND dept.dept_id = membership.org_id AND dept.deleted_at IS NULL
      WHERE membership.deleted_at IS NULL
        AND (membership.org_type NOT IN (1, 2)
          OR (membership.org_type = 1 AND org.org_id IS NULL)
          OR (membership.org_type = 2 AND dept.dept_id IS NULL))
    `),
    linkedUsersWithBrokenIdentityChain: await query(`
      SELECT user.id user_id, user.username, user.staff_id, user.org_id, user.dept_id,
             staff.post_id, membership.org_type, membership.org_id primary_membership_id,
             dept.org_id primary_department_org_id
      FROM hspsi_sys_user user
      LEFT JOIN hspsi_basic_staff staff
        ON staff.id = user.staff_id AND staff.deleted_at IS NULL AND staff.status = 1
      LEFT JOIN hspsi_basic_staff_organizations membership
        ON membership.staff_id = staff.id AND membership.type = 1 AND membership.deleted_at IS NULL
      LEFT JOIN hspsi_basic_dept dept
        ON membership.org_type = 2 AND dept.dept_id = membership.org_id AND dept.deleted_at IS NULL
      LEFT JOIN hspsi_basic_position position
        ON position.id = staff.post_id AND position.deleted_at IS NULL AND position.status = 1
      WHERE user.deleted_at IS NULL AND user.staff_id IS NOT NULL AND (
        staff.id IS NULL OR position.id IS NULL OR membership.id IS NULL OR
        (membership.org_type = 1 AND user.org_id <> membership.org_id) OR
        (membership.org_type = 2 AND (user.org_id <> dept.org_id OR user.dept_id <> dept.dept_id)) OR
        NOT EXISTS (
          SELECT 1
          FROM hspsi_basic_position_belongs belongs
          LEFT JOIN hspsi_basic_organization member_org
            ON membership.org_type = 1 AND member_org.org_id = membership.org_id
          LEFT JOIN hspsi_basic_dept member_dept
            ON membership.org_type = 2 AND member_dept.dept_id = membership.org_id
          WHERE belongs.position_id = staff.post_id
            AND belongs.account_set_id = staff.account_set_id
            AND belongs.org_type = membership.org_type
            AND belongs.outer_ref_id = CASE
              WHEN membership.org_type = 1 THEN member_org.outer_ref_id
              ELSE member_dept.outer_ref_id
            END
        )
      )
    `),
    invalidAuthorizedOrganizations: await query(`
      SELECT scope.user_id, scope.org_id
      FROM hspsi_sys_user_authorized_org scope
      LEFT JOIN hspsi_sys_user user
        ON user.id = scope.user_id AND user.deleted_at IS NULL AND user.status = 1
      LEFT JOIN hspsi_basic_organization org
        ON org.org_id = scope.org_id AND org.deleted_at IS NULL AND org.operation_status = 1
      WHERE user.id IS NULL OR org.org_id IS NULL
    `),
    activeUsersWithoutActiveRole: await query(`
      SELECT user.id, user.username
      FROM hspsi_sys_user user
      LEFT JOIN hspsi_sys_user_role user_role ON user_role.user_id = user.id
      LEFT JOIN hspsi_sys_role role
        ON role.id = user_role.role_id AND role.deleted_at IS NULL AND role.status = 1
      WHERE user.deleted_at IS NULL AND user.status = 1
      GROUP BY user.id, user.username
      HAVING COUNT(role.id) = 0
    `),
  };

  const output = Object.fromEntries(
    Object.entries(checks).map(([name, rows]) => [name, { count: rows.length, rows }]),
  );
  const issueCount = Object.values(checks).reduce((sum, rows) => sum + rows.length, 0);
  console.log(
    JSON.stringify(
      { generatedAt: new Date().toISOString(), issueCount, checks: output },
      (_, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ),
  );
  if (issueCount > 0) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
