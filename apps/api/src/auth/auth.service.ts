import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuthUser } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(RedisService) private redis: RedisService,
    @Inject(JwtService) private jwt: JwtService,
    @Inject(ConfigService) private config: ConfigService,
  ) {}
  private async sessionData(userId: string) {
    const user = await this.prisma.hspsi_sys_user.findFirst({
      where: { id: BigInt(userId), deleted_at: null, status: 1 },
    });
    if (!user) throw new UnauthorizedException('账号不存在或已停用');
    const userRoles = await this.prisma.hspsi_sys_user_role.findMany({
      where: { user_id: Number(user.id) },
    });
    const roleIds = userRoles.map((item) => BigInt(item.role_id));
    const roles = roleIds.length
      ? await this.prisma.hspsi_sys_role.findMany({
          where: { id: { in: roleIds }, status: 1, deleted_at: null },
        })
      : [];
    if (!roles.length) throw new UnauthorizedException('账号没有启用的角色');
    const activeRoleIds = roles.map((role) => role.id);
    const roleMenus = roleIds.length
      ? await this.prisma.hspsi_sys_role_menu.findMany({ where: { role_id: { in: activeRoleIds } } })
      : [];
    const menuIds = [...new Set(roleMenus.map((item) => Number(item.menu_id)))];
    const menus = menuIds.length
      ? await this.prisma.hspsi_sys_menu.findMany({
          where: { id: { in: menuIds }, deleted_at: null, status: 1 },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        })
      : [];
    const isAdmin = roles.some((role) => role.code === 'admin');

    let orgId = user.org_id;
    let deptId = user.dept_id;
    let staffId: bigint | null = null;
    let positionId: bigint | null = null;
    let positionName: string | null = null;
    if (user.staff_id) {
      const staff = await this.prisma.hspsi_basic_staff.findFirst({
        where: { id: user.staff_id, status: 1, deleted_at: null },
      });
      if (!staff || staff.post_id <= 0n)
        throw new UnauthorizedException('账号关联的人员或岗位已停用，请先同步组织人员');
      const [position, membership] = await Promise.all([
        this.prisma.hspsi_basic_position.findFirst({
          where: { id: staff.post_id, status: 1, deleted_at: null },
        }),
        this.prisma.hspsi_basic_staff_organizations.findFirst({
          where: { staff_id: staff.id, type: 1, deleted_at: null },
        }),
      ]);
      if (!position || !membership)
        throw new UnauthorizedException('账号的组织—部门—岗位—人员关系不完整');
      let membershipOuterRefId = '';
      if (membership.org_type === 1) {
        const organization = await this.prisma.hspsi_basic_organization.findFirst({
          where: { org_id: membership.org_id, operation_status: 1, deleted_at: null },
        });
        if (!organization) throw new UnauthorizedException('账号所属组织不存在或已停用');
        orgId = organization.org_id;
        deptId = null;
        membershipOuterRefId = organization.outer_ref_id;
      } else if (membership.org_type === 2) {
        const department = await this.prisma.hspsi_basic_dept.findFirst({
          where: { dept_id: membership.org_id, status: 1, deleted_at: null },
        });
        if (!department) throw new UnauthorizedException('账号所属部门不存在或已停用');
        orgId = department.org_id;
        deptId = department.dept_id;
        membershipOuterRefId = department.outer_ref_id;
      } else {
        throw new UnauthorizedException('账号人员的主组织类型无效');
      }
      const positionBelongs = await this.prisma.hspsi_basic_position_belongs.findFirst({
        where: {
          position_id: position.id,
          account_set_id: staff.account_set_id,
          org_type: membership.org_type,
          outer_ref_id: membershipOuterRefId,
        },
      });
      if (!positionBelongs)
        throw new UnauthorizedException('账号岗位不属于人员当前主组织或部门');
      staffId = staff.id;
      positionId = position.id;
      positionName = position.name;
    }
    if (!orgId) throw new UnauthorizedException('账号没有所属组织');

    const organizations = await this.prisma.hspsi_basic_organization.findMany({
      where: { operation_status: 1, deleted_at: null },
      select: { org_id: true, parent_id: true },
    });
    const ownOrgId = String(orgId);
    const allOrgIds = organizations.map((item) => String(item.org_id));
    const descendantIds = new Set([ownOrgId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const org of organizations) {
        const id = String(org.org_id);
        if (!descendantIds.has(id) && descendantIds.has(String(org.parent_id))) {
          descendantIds.add(id);
          changed = true;
        }
      }
    }
    const configuredOrgIds = (
      await this.prisma.hspsi_sys_user_org_scope.findMany({ where: { user_id: user.id } })
    ).map((item) => String(item.org_id));
    const scopeValues = roles.map((role) => role.data_scope_type);
    const effectiveScope = scopeValues.includes(1)
      ? 1
      : scopeValues.includes(2)
        ? 2
        : scopeValues.includes(3)
          ? 3
          : scopeValues.includes(4)
            ? 4
            : 5;
    const organizationIds = isAdmin || scopeValues.includes(1)
      ? allOrgIds
      : [
          ...new Set([
            ownOrgId,
            ...(scopeValues.includes(2) ? [...descendantIds] : []),
            ...(scopeValues.includes(4) ? configuredOrgIds : []),
          ]),
        ];
    const authUser: AuthUser = {
      id: user.id.toString(),
      username: user.username,
      orgId: orgId.toString(),
      deptId: deptId?.toString() ?? null,
      staffId: staffId?.toString() ?? null,
      positionId: positionId?.toString() ?? null,
      positionName,
      dataScopeType: effectiveScope,
      organizationIds,
      isSuperAdmin: isAdmin,
      permissions: isAdmin ? ['*'] : menus.map((item) => item.code),
    };
    return { user: authUser, menus };
  }
  async login(username: string, password: string) {
    const normalizedUsername = username.trim();
    const user = await this.prisma.hspsi_sys_user.findFirst({
      where: { username: normalizedUsername, deleted_at: null, status: 1 },
    });
    if (!user || !(await compare(password, user.password)))
      throw new UnauthorizedException('账号或密码错误');
    const { user: authUser, menus } = await this.sessionData(user.id.toString());
    const sid = randomUUID();
    const ttl = Number(this.config.get('SESSION_TTL_SECONDS') ?? 28800);
    await this.redis.ensureConnected();
    await this.redis.client.set(`session:${sid}`, user.id.toString(), 'EX', ttl);
    return { token: await this.jwt.signAsync({ ...authUser, sid }), user: authUser, menus };
  }
  session(userId: string) {
    return this.sessionData(userId);
  }
  async resolveSession(sid: string, tokenUserId: string) {
    await this.redis.ensureConnected();
    const stored = await this.redis.client.get(`session:${sid}`);
    if (!stored) throw new UnauthorizedException('登录已失效，请重新登录');
    let userId = stored;
    try {
      const parsed = JSON.parse(stored) as { userId?: string };
      if (parsed?.userId) userId = String(parsed.userId);
    } catch {
      // 兼容改造前仅保存用户 ID 的会话。
    }
    if (userId !== String(tokenUserId)) throw new UnauthorizedException('登录会话无效');
    return (await this.sessionData(userId)).user;
  }
  async logout(sid: string) {
    await this.redis.ensureConnected();
    await this.redis.client.del(`session:${sid}`);
  }
}
