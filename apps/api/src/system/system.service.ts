import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../database/prisma.service';
import { AmountAccessService } from '../amount-access/amount-access.service';

type Body = Record<string, any>;

@Injectable()
export class SystemService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AmountAccessService) private readonly amountAccess: AmountAccessService,
  ) {}

  private integer(value: unknown, field: string, minimum = 0) {
    const result = Number(value);
    if (!Number.isInteger(result) || result < minimum)
      throw new BadRequestException(`${field}格式不正确`);
    return result;
  }

  private text(value: unknown, field: string, minimum: number, maximum: number) {
    const result = String(value ?? '').trim();
    if (result.length < minimum || result.length > maximum)
      throw new BadRequestException(`${field}长度应为${minimum}至${maximum}个字符`);
    return result;
  }

  private async dictionary(code: string) {
    const category = await this.prisma.hspsi_sys_dictionary_category.findFirst({
      where: { dict_catg_code: code, deleted_at: null },
    });
    if (!category) return new Map<string, string>();
    const rows = await this.prisma.hspsi_sys_dictionary.findMany({
      where: { dict_catg_id: category.dict_catg_id, deleted_at: null },
    });
    return new Map(rows.map((row) => [String(row.dict_value), String(row.dict_name ?? '')]));
  }

  private async userNames(ids: Array<bigint | null | undefined>) {
    const values = [
      ...new Set(ids.filter((id): id is bigint => id !== null && id !== undefined && id > 0n)),
    ];
    if (!values.length) return new Map<string, string>();
    const users = await this.prisma.hspsi_sys_user.findMany({
      where: { id: { in: values } },
      select: { id: true, username: true, nickname: true },
    });
    return new Map(users.map((user) => [String(user.id), user.nickname || user.username]));
  }

  async roles() {
    const [roles, roleMenus, userRoles, menus, statusMap] = await Promise.all([
      this.prisma.hspsi_sys_role.findMany({ where: { deleted_at: null }, orderBy: { id: 'asc' } }),
      this.prisma.hspsi_sys_role_menu.findMany(),
      this.prisma.hspsi_sys_user_role.findMany(),
      this.prisma.hspsi_sys_menu.findMany({
        where: { deleted_at: null, status: 1 },
        orderBy: [{ parent_id: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
      }),
      this.dictionary('enabled_status'),
    ]);
    const actorMap = await this.userNames(
      roles.flatMap((role) => [role.created_by, role.updated_by]),
    );
    const menuMap = new Map(menus.map((menu) => [menu.id, menu]));
    const childrenByParent = new Map<number, typeof menus>();
    for (const menu of menus) {
      const values = childrenByParent.get(menu.parent_id) ?? [];
      values.push(menu);
      childrenByParent.set(menu.parent_id, values);
    }
    return roles.map((role) => {
      const assignedIds = roleMenus
        .filter((item) => item.role_id === role.id)
        .map((item) => Number(item.menu_id));
      const assigned = assignedIds.map((id) => menuMap.get(id)).filter(Boolean) as typeof menus;
      const pageMenus = assigned.filter((menu) => menu.type === 2);
      const menuPermissions =
        role.code === 'admin'
          ? ['全部']
          : pageMenus.map(
              (menu) => `${menuMap.get(menu.parent_id)?.name ?? '未分组'}.${menu.name}`,
            );
      const actionPermissions =
        role.code === 'admin'
          ? ['全部']
          : assigned.filter((menu) => menu.type === 3).map((menu) => menu.name);
      return {
        id: String(role.id),
        name: role.name,
        code: role.code,
        statusValue: role.status ?? 1,
        status: statusMap.get(String(role.status ?? 1)) ?? String(role.status ?? 1),
        menuIds: assignedIds.filter((id) => menuMap.get(id)?.type === 2),
        menuPermissions,
        menuPermissionCount: pageMenus.length,
        actionPermissions,
        actionPermissionCount: assigned.filter((menu) => menu.type === 3).length,
        actionPermissionCodes: assigned.filter((menu) => menu.type === 3).map((menu) => menu.code),
        userCount: userRoles.filter((item) => BigInt(item.role_id) === role.id).length,
        createdBy:
          actorMap.get(String(role.created_by ?? 0n)) ??
          (role.created_by ? String(role.created_by) : ''),
        updatedBy:
          actorMap.get(String(role.updated_by ?? 0n)) ??
          (role.updated_by ? String(role.updated_by) : ''),
        createdAt: role.created_at,
        updatedAt: role.updated_at,
        childMenus: childrenByParent.get(Number(role.id))?.length ?? 0,
      };
    });
  }

  private async roleMenuIds(body: Body) {
    const requested = new Set<number>(
      (Array.isArray(body.menuIds) ? body.menuIds : []).map((value: unknown) =>
        this.integer(value, '菜单权限', 1),
      ),
    );
    const actionCodes = Array.isArray(body.actionPermissionCodes)
      ? body.actionPermissionCodes.map(String)
      : [];
    if (actionCodes.length) {
      const actions = await this.prisma.hspsi_sys_menu.findMany({
        where: { code: { in: actionCodes }, type: 3, status: 1, deleted_at: null },
      });
      if (actions.length !== new Set(actionCodes).size)
        throw new BadRequestException('包含无效的操作权限');
      actions.forEach((action) => requested.add(action.id));
    }
    if (!requested.size) throw new BadRequestException('至少选择一项菜单权限');
    const menus = await this.prisma.hspsi_sys_menu.findMany({
      where: { id: { in: [...requested] }, status: 1, deleted_at: null },
    });
    if (menus.length !== requested.size)
      throw new BadRequestException('包含不存在或已停用的菜单权限');
    // 逐级补齐全部祖先目录（不止一级）：报表/基础资料存在「目录→子目录→页面」的多层结构，
    // 只补一级父目录会漏掉顶层目录 code，导致依赖目录 code 的接口（如 options）报无权限。
    let expanded = true;
    while (expanded) {
      expanded = false;
      const parents = await this.prisma.hspsi_sys_menu.findMany({
        where: { id: { in: [...requested] }, status: 1, deleted_at: null },
        select: { id: true, parent_id: true },
      });
      for (const menu of parents) {
        const parentId = Number(menu.parent_id);
        if (parentId > 0 && !requested.has(parentId)) {
          requested.add(parentId);
          expanded = true;
        }
      }
    }
    return [...requested].map(BigInt);
  }

  async createRole(body: Body, userId: string) {
    const name = this.text(body.name, '角色名称', 1, 50);
    const status = this.integer(body.status, '启用状态', 1);
    if (![1, 2].includes(status)) throw new BadRequestException('角色状态无效');
    if (await this.prisma.hspsi_sys_role.findFirst({ where: { name, deleted_at: null } }))
      throw new ConflictException('角色名称已存在');
    const menuIds = await this.roleMenuIds(body);
    const actorId = BigInt(userId);
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.hspsi_sys_role.create({
        data: {
          name,
          code: `role-${Date.now()}`,
          status,
          created_by: actorId,
          updated_by: actorId,
        },
      });
      await tx.hspsi_sys_role_menu.createMany({
        data: menuIds.map((menuId) => ({ role_id: created.id, menu_id: menuId })),
        skipDuplicates: true,
      });
      return created;
    });
    return { id: String(role.id), message: '角色创建成功' };
  }

  async updateRole(id: string, body: Body, userId: string) {
    const roleId = BigInt(id);
    const old = await this.prisma.hspsi_sys_role.findFirst({
      where: { id: roleId, deleted_at: null },
    });
    if (!old) throw new NotFoundException('角色不存在');
    const name = this.text(body.name ?? old.name, '角色名称', 1, 50);
    const status = this.integer(body.status ?? old.status ?? 1, '启用状态', 1);
    if (old.code === 'admin' && (name !== old.name || status !== 1))
      throw new BadRequestException('系统管理员角色不允许改名或停用');
    if (![1, 2].includes(status)) throw new BadRequestException('角色状态无效');
    if (status === 2) {
      const assignedUsers = await this.prisma.hspsi_sys_user_role.count({
        where: { role_id: Number(roleId) },
      });
      if (assignedUsers > 0) throw new BadRequestException('该角色仍有关联用户，不能停用');
    }
    const duplicate = await this.prisma.hspsi_sys_role.findFirst({
      where: { name, id: { not: roleId }, deleted_at: null },
    });
    if (duplicate) throw new ConflictException('角色名称已存在');
    const menuIds =
      body.menuIds !== undefined || body.actionPermissionCodes !== undefined
        ? await this.roleMenuIds(body)
        : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.hspsi_sys_role.update({
        where: { id: roleId },
        data: { name, status, updated_by: BigInt(userId) },
      });
      if (menuIds) {
        await tx.hspsi_sys_role_menu.deleteMany({ where: { role_id: roleId } });
        await tx.hspsi_sys_role_menu.createMany({
          data: menuIds.map((menuId) => ({ role_id: roleId, menu_id: menuId })),
          skipDuplicates: true,
        });
      }
    });
    return { id, message: '角色保存成功' };
  }

  async users() {
    const [
      users,
      userRoles,
      roles,
      organizations,
      departments,
      amountAccessRows,
      authorizedOrgs,
      roleOverrides,
      statusMap,
    ] = await Promise.all([
      this.prisma.hspsi_sys_user.findMany({
        where: { deleted_at: null },
        orderBy: { id: 'asc' },
      }),
      this.prisma.hspsi_sys_user_role.findMany(),
      this.prisma.hspsi_sys_role.findMany({ where: { deleted_at: null } }),
      this.prisma.hspsi_basic_organization.findMany({ where: { deleted_at: null } }),
      this.prisma.hspsi_basic_dept.findMany({ where: { deleted_at: null } }),
      this.prisma.hspsi_sys_user_amount_access.findMany(),
      this.prisma.hspsi_sys_user_authorized_org.findMany(),
      this.prisma.hspsi_sys_user_role_override.findMany(),
      this.dictionary('system_account_status'),
    ]);
    const staffIds = users.flatMap((user) => (user.staff_id ? [user.staff_id] : []));
    const staffs = staffIds.length
      ? await this.prisma.hspsi_basic_staff.findMany({
          where: { id: { in: staffIds }, deleted_at: null },
        })
      : [];
    const positionIds = [...new Set(staffs.map((staff) => staff.post_id).filter((id) => id > 0n))];
    const positions = positionIds.length
      ? await this.prisma.hspsi_basic_position.findMany({
          where: { id: { in: positionIds }, deleted_at: null },
        })
      : [];
    const staffMap = new Map(staffs.map((staff) => [String(staff.id), staff]));
    const positionMap = new Map(positions.map((position) => [String(position.id), position.name]));
    const roleMap = new Map(roles.map((role) => [Number(role.id), role]));
    const orgMap = new Map(organizations.map((org) => [String(org.org_id), org.name]));
    const deptMap = new Map(departments.map((dept) => [String(dept.dept_id), dept.name]));
    const roleOverrideUsers = new Set(roleOverrides.map((item) => String(item.user_id)));
    const authorizedOrgsByUser = new Map<string, typeof authorizedOrgs>();
    for (const scope of authorizedOrgs) {
      const userId = String(scope.user_id);
      const values = authorizedOrgsByUser.get(userId) ?? [];
      values.push(scope);
      authorizedOrgsByUser.set(userId, values);
    }
    const actorMap = await this.userNames(
      users.flatMap((user) => [user.created_by, user.updated_by]),
    );
    return users.map((user) => {
      const assignedRole = userRoles
        .filter((item) => BigInt(item.user_id) === user.id)
        .map((item) => roleMap.get(item.role_id))
        .find(Boolean);
      const configuredAmountAccess = amountAccessRows.find((item) => item.user_id === user.id);
      const staff = user.staff_id ? staffMap.get(String(user.staff_id)) : undefined;
      const userAuthorizedOrgs = authorizedOrgsByUser.get(String(user.id)) ?? [];
      const manualAuthorizedOrgs = userAuthorizedOrgs.filter(
        (scope) => scope.created_by !== 0n && scope.org_id !== user.org_id,
      );
      const amountAccess =
        user.status === 1 && configuredAmountAccess
          ? this.amountAccess.fromFlags(
              configuredAmountAccess.can_view_amount,
              configuredAmountAccess.can_edit_amount,
            )
          : this.amountAccess.fromFlags(0, 0);
      return {
        id: String(user.id),
        account: user.username,
        name: user.nickname || user.username,
        fixedOrgId: user.org_id ? String(user.org_id) : '',
        fixedOrgName: user.org_id ? (orgMap.get(String(user.org_id)) ?? '') : '',
        orgId: user.org_id ? String(user.org_id) : '',
        orgName: user.org_id ? (orgMap.get(String(user.org_id)) ?? '') : '',
        deptId: user.dept_id ? String(user.dept_id) : '',
        department: user.dept_id ? (deptMap.get(String(user.dept_id)) ?? '') : '',
        staffId: user.staff_id ? String(user.staff_id) : '',
        staffName: staff?.name ?? '',
        positionId: staff?.post_id ? String(staff.post_id) : '',
        positionName: staff?.post_id ? (positionMap.get(String(staff.post_id)) ?? '') : '',
        identitySource: user.staff_id ? 'OA同步人员' : '本地账号',
        authorizedOrgIds: userAuthorizedOrgs.map((scope) => String(scope.org_id)),
        authorizedOrgNames: userAuthorizedOrgs.map(
          (scope) => orgMap.get(String(scope.org_id)) ?? `#${scope.org_id}`,
        ),
        manualAuthorizedOrgIds: manualAuthorizedOrgs.map((scope) => String(scope.org_id)),
        manualAuthorizedOrgNames: manualAuthorizedOrgs.map(
          (scope) => orgMap.get(String(scope.org_id)) ?? `#${scope.org_id}`,
        ),
        authorizedOrganizations: userAuthorizedOrgs.map((scope) => ({
          id: String(scope.org_id),
          name: orgMap.get(String(scope.org_id)) ?? `#${scope.org_id}`,
          fixed: scope.org_id === user.org_id,
          source:
            scope.org_id === user.org_id ? (user.staff_id ? 'OA同步' : '本地账号') : '人工授权',
        })),
        roleId: assignedRole ? String(assignedRole.id) : '',
        roleName: assignedRole?.name ?? '',
        roleSource: roleOverrideUsers.has(String(user.id))
          ? '本地人工授权'
          : user.staff_id
            ? 'OA岗位默认角色'
            : '本地账号授权',
        amountAccess: amountAccess.level,
        canViewAmount: amountAccess.canViewAmount,
        canEditAmount: amountAccess.canEditAmount,
        amountGrantReason: configuredAmountAccess?.grant_reason ?? '',
        authorizationSource: user.staff_id ? 'OA身份同步 + 本地业务授权' : '本地系统账号',
        phone: user.phone ?? '',
        statusValue: user.status ?? 1,
        status: statusMap.get(String(user.status ?? 1)) ?? String(user.status ?? 1),
        createdBy:
          actorMap.get(String(user.created_by ?? 0n)) ??
          (user.created_by ? String(user.created_by) : ''),
        updatedBy:
          actorMap.get(String(user.updated_by ?? 0n)) ??
          (user.updated_by ? String(user.updated_by) : ''),
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      };
    });
  }

  updateUserAmountAccess(id: string, body: Body, userId: string) {
    return this.amountAccess.saveForUser(id, body, userId);
  }

  async userOptions(organizationIds?: string[]) {
    const [roles, organizations, departments, staff, memberships, positions, positionBelongs] =
      await Promise.all([
        this.prisma.hspsi_sys_role.findMany({
          where: { status: 1, deleted_at: null },
          orderBy: { id: 'asc' },
        }),
        this.prisma.hspsi_basic_organization.findMany({
          where: { operation_status: 1, deleted_at: null },
          orderBy: [{ sort: 'asc' }, { org_id: 'asc' }],
        }),
        this.prisma.hspsi_basic_dept.findMany({
          where: { status: 1, deleted_at: null },
          orderBy: [{ sort: 'asc' }, { dept_id: 'asc' }],
        }),
        this.prisma.hspsi_basic_staff.findMany({
          where: { status: 1, deleted_at: null, post_id: { gt: 0 } },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.hspsi_basic_staff_organizations.findMany({
          where: { type: 1, deleted_at: null },
        }),
        this.prisma.hspsi_basic_position.findMany({
          where: { status: 1, deleted_at: null },
        }),
        this.prisma.hspsi_basic_position_belongs.findMany(),
      ]);
    const allowed = new Set(organizationIds ?? organizations.map((org) => String(org.org_id)));
    const orgMap = new Map(organizations.map((org) => [String(org.org_id), org.name]));
    const deptMap = new Map(departments.map((dept) => [String(dept.dept_id), dept]));
    const membershipMap = new Map(memberships.map((item) => [String(item.staff_id), item]));
    const positionMap = new Map(positions.map((item) => [String(item.id), item]));
    const positionBelongsKeys = new Set(
      positionBelongs.map(
        (item) =>
          `${item.position_id}:${item.account_set_id}:${item.org_type}:${item.outer_ref_id}`,
      ),
    );
    const staffOptions = staff.flatMap((item) => {
      const membership = membershipMap.get(String(item.id));
      const position = positionMap.get(String(item.post_id));
      if (!membership || !position) return [];
      const dept = membership.org_type === 2 ? deptMap.get(String(membership.org_id)) : undefined;
      const orgId = membership.org_type === 1 ? membership.org_id : dept?.org_id;
      if (!orgId || !allowed.has(String(orgId))) return [];
      const organization = organizations.find((org) => org.org_id === orgId);
      const targetOuterRefId =
        membership.org_type === 1 ? organization?.outer_ref_id : dept?.outer_ref_id;
      if (
        !targetOuterRefId ||
        !positionBelongsKeys.has(
          `${position.id}:${item.account_set_id}:${membership.org_type}:${targetOuterRefId}`,
        )
      )
        return [];
      return [
        {
          id: String(item.id),
          name: item.name,
          mobile: item.mobile,
          orgId: String(orgId),
          orgName: orgMap.get(String(orgId)) ?? '',
          deptId: dept ? String(dept.dept_id) : '',
          positionId: String(position.id),
          positionName: position.name,
        },
      ];
    });
    return {
      roles: roles.map((role) => ({
        id: String(role.id),
        name: role.name,
        code: role.code,
      })),
      organizations: organizations.map((org) => ({
        id: String(org.org_id),
        name: org.name,
        parentId: String(org.parent_id),
        sort: org.sort,
      })),
      departments: departments.map((dept) => ({
        id: String(dept.dept_id),
        orgId: String(dept.org_id),
        name: dept.name,
      })),
      staff: staffOptions,
    };
  }

  private async validateUserRelations(body: Body, canAssignSuperAdmin = false) {
    const staffId = body.staffId ? BigInt(this.integer(body.staffId, '关联人员', 1)) : null;
    if (staffId) throw new BadRequestException('OA人员账号由组织同步自动创建和授权');
    let orgId = BigInt(this.integer(body.orgId, '所属公司', 1));
    let deptId = body.deptId ? BigInt(this.integer(body.deptId, '所属部门', 1)) : null;
    const organization = await this.prisma.hspsi_basic_organization.findFirst({
      where: { org_id: orgId, operation_status: 1, deleted_at: null },
    });
    if (!organization) throw new BadRequestException('所属公司不存在或已停用');
    if (deptId) {
      const department = await this.prisma.hspsi_basic_dept.findFirst({
        where: { dept_id: deptId, org_id: orgId, status: 1, deleted_at: null },
      });
      if (!department) throw new BadRequestException('所属部门不存在、已停用或不属于所选公司');
    }
    const roleId = this.integer(body.roleId, '所属角色', 1);
    const role = await this.prisma.hspsi_sys_role.findFirst({
      where: { id: BigInt(roleId), status: 1, deleted_at: null },
    });
    if (!role) throw new BadRequestException('所属角色不存在或已停用');
    if (!canAssignSuperAdmin && role.code === 'admin')
      throw new ForbiddenException('只有超级管理员可以授予超级管理员角色');
    const authorizedOrgIds = [
      ...new Set(
        (Array.isArray(body.authorizedOrgIds) ? body.authorizedOrgIds : []).map((value: unknown) =>
          this.integer(value, '指定组织', 1),
        ),
      ),
    ];
    if (!authorizedOrgIds.length) throw new BadRequestException('本地系统账号至少选择一个授权组织');
    {
      const authorized = await this.prisma.hspsi_basic_organization.findMany({
        where: {
          org_id: { in: authorizedOrgIds.map(BigInt) },
          operation_status: 1,
          deleted_at: null,
        },
      });
      if (authorized.length !== authorizedOrgIds.length)
        throw new BadRequestException('授权组织中包含不存在或已停用的组织');
    }
    if (!authorizedOrgIds.includes(Number(orgId))) authorizedOrgIds.push(Number(orgId));
    return {
      orgId,
      deptId,
      staffId,
      roleId,
      authorizedOrgIds,
    };
  }

  async createUser(body: Body, userId: string, isSuperAdmin = false) {
    const account = this.text(body.account, '登录账号', 3, 50);
    const name = this.text(body.name, '用户姓名', 1, 50);
    const password = this.text(body.password, '初始密码', 6, 64);
    const status = this.integer(body.status, '账号状态', 1);
    if (![1, 2].includes(status)) throw new BadRequestException('账号状态无效');
    if (
      await this.prisma.hspsi_sys_user.findFirst({ where: { username: account, deleted_at: null } })
    )
      throw new ConflictException('登录账号已存在');
    const relations = await this.validateUserRelations(body, isSuperAdmin);
    const actorId = BigInt(userId);
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.hspsi_sys_user.create({
        data: {
          username: account,
          nickname: name,
          password: await hash(password, 12),
          phone: String(body.phone ?? '').trim() || null,
          org_id: relations.orgId,
          dept_id: relations.deptId,
          staff_id: relations.staffId,
          status,
          created_by: actorId,
          updated_by: actorId,
        },
      });
      await tx.hspsi_sys_user_role.createMany({
        data: [{ user_id: Number(user.id), role_id: relations.roleId }],
        skipDuplicates: true,
      });
      if (relations.authorizedOrgIds.length)
        await tx.hspsi_sys_user_authorized_org.createMany({
          data: relations.authorizedOrgIds.map((orgId) => ({
            user_id: user.id,
            org_id: BigInt(orgId),
            created_by: actorId,
          })),
          skipDuplicates: true,
        });
      return user;
    });
    return { id: String(created.id), message: '用户创建成功' };
  }

  async updateUser(id: string, body: Body, userId: string, isSuperAdmin = false) {
    const targetId = BigInt(id);
    const old = await this.prisma.hspsi_sys_user.findFirst({
      where: { id: targetId, deleted_at: null },
    });
    if (!old) throw new NotFoundException('用户不存在');
    if (old.staff_id) {
      // OA 同步人员的身份、角色和组织授权由 OA 维护，本地不能手工修改；
      // 仅放行「重置密码」这一单一操作（body 只含 password 字段）。
      const allowedKeys = new Set(['password']);
      const hasNonPasswordChange = Object.keys(body).some((key) => !allowedKeys.has(key));
      if (hasNonPasswordChange) {
        throw new BadRequestException('OA同步人员的身份、角色和组织授权不能在本地手工修改');
      }
      const password = String(body.password ?? '');
      if (password && (password.length < 6 || password.length > 64))
        throw new BadRequestException('重置密码长度应为6至64个字符');
      if (!password) throw new BadRequestException('OA同步用户仅支持重置密码，且密码不能为空');
      await this.prisma.hspsi_sys_user.update({
        where: { id: targetId },
        data: {
          password: await hash(password, 12),
          updated_by: BigInt(userId),
          updated_at: new Date(),
        },
      });
      return { id, message: '密码重置成功' };
    }
    const name = this.text(body.name ?? old.nickname ?? old.username, '用户姓名', 1, 50);
    const status = this.integer(body.status ?? old.status ?? 1, '账号状态', 1);
    if (old.username === 'admin' && status !== 1)
      throw new BadRequestException('admin账号不允许禁用');
    if (![1, 2].includes(status)) throw new BadRequestException('账号状态无效');
    const relations = await this.validateUserRelations(body, isSuperAdmin);
    const password = String(body.password ?? '');
    if (password && (password.length < 6 || password.length > 64))
      throw new BadRequestException('重置密码长度应为6至64个字符');
    await this.prisma.$transaction(async (tx) => {
      await tx.hspsi_sys_user.update({
        where: { id: targetId },
        data: {
          nickname: name,
          phone: String(body.phone ?? '').trim() || null,
          org_id: relations.orgId,
          dept_id: relations.deptId,
          staff_id: relations.staffId,
          status,
          updated_by: BigInt(userId),
          ...(password ? { password: await hash(password, 12) } : {}),
        },
      });
      await tx.hspsi_sys_user_authorized_org.deleteMany({ where: { user_id: targetId } });
      if (relations.authorizedOrgIds.length)
        await tx.hspsi_sys_user_authorized_org.createMany({
          data: relations.authorizedOrgIds.map((orgId) => ({
            user_id: targetId,
            org_id: BigInt(orgId),
            created_by: BigInt(userId),
          })),
          skipDuplicates: true,
        });
    });
    return { id, message: '用户保存成功' };
  }

  async updateUserRoles(id: string, body: Body, userId: string, isSuperAdmin: boolean) {
    if (!isSuperAdmin) throw new ForbiddenException('只有超级管理员可以变更用户角色');
    const targetId = BigInt(this.integer(id, '用户ID', 1));
    const target = await this.prisma.hspsi_sys_user.findFirst({
      where: { id: targetId, deleted_at: null },
      select: { id: true, username: true, staff_id: true, org_id: true },
    });
    if (!target) throw new NotFoundException('用户不存在');
    if (!target.org_id) throw new BadRequestException('该用户尚未配置固定所属组织');
    const roleId = this.integer(body.roleId, '所属角色', 1);
    const role = await this.prisma.hspsi_sys_role.findFirst({
      where: { id: BigInt(roleId), status: 1, deleted_at: null },
      select: { id: true, code: true },
    });
    if (!role) throw new BadRequestException('所属角色不存在或已停用');
    if (target.id === BigInt(userId) && role.code !== 'admin')
      throw new BadRequestException('不能移除当前登录账号自己的超级管理员角色');

    const currentAuthorizedOrgs = await this.prisma.hspsi_sys_user_authorized_org.findMany({
      where: { user_id: targetId },
      select: { org_id: true },
    });
    const requestedAuthorizedOrgIds = [
      ...new Set(
        (Array.isArray(body.authorizedOrgIds)
          ? body.authorizedOrgIds
          : currentAuthorizedOrgs.map((item) => String(item.org_id))
        ).map((value: unknown) => this.integer(value, '数据访问组织', 1)),
      ),
    ];
    const fixedOrgId = Number(target.org_id);
    if (!requestedAuthorizedOrgIds.includes(fixedOrgId)) requestedAuthorizedOrgIds.push(fixedOrgId);
    const organizations = await this.prisma.hspsi_basic_organization.findMany({
      where: {
        org_id: { in: requestedAuthorizedOrgIds.map(BigInt) },
        operation_status: 1,
        deleted_at: null,
      },
      select: { org_id: true },
    });
    if (organizations.length !== requestedAuthorizedOrgIds.length)
      throw new BadRequestException('数据访问组织中包含不存在或已停用的组织');

    const actorId = BigInt(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.hspsi_sys_user_role.deleteMany({ where: { user_id: Number(targetId) } });
      await tx.hspsi_sys_user_role.createMany({
        data: [{ user_id: Number(targetId), role_id: roleId }],
        skipDuplicates: true,
      });
      await tx.hspsi_sys_user_authorized_org.deleteMany({
        where: { user_id: targetId, org_id: { not: target.org_id! } },
      });
      await tx.hspsi_sys_user_authorized_org.createMany({
        data: [
          {
            user_id: targetId,
            org_id: target.org_id!,
            created_by: target.staff_id ? 0n : actorId,
          },
          ...requestedAuthorizedOrgIds
            .filter((orgId) => orgId !== fixedOrgId)
            .map((orgId) => ({
              user_id: targetId,
              org_id: BigInt(orgId),
              created_by: actorId,
            })),
        ],
        skipDuplicates: true,
      });
      if (target.staff_id) {
        await tx.hspsi_sys_user_role_override.upsert({
          where: { user_id: targetId },
          create: { user_id: targetId, updated_by: actorId },
          update: { updated_by: actorId, updated_at: new Date() },
        });
      }
      await tx.hspsi_sys_user.update({
        where: { id: targetId },
        data: { updated_by: actorId, updated_at: new Date() },
      });
    });
    return {
      id,
      roleId: String(roleId),
      fixedOrgId: String(target.org_id),
      authorizedOrgIds: requestedAuthorizedOrgIds.map(String),
      message: target.staff_id
        ? '角色和数据访问组织已保存；固定所属组织仍由OA维护'
        : '角色和数据访问组织已保存',
    };
  }

  async menus() {
    const [menus, typeMap, statusMap] = await Promise.all([
      this.prisma.hspsi_sys_menu.findMany({
        where: { deleted_at: null },
        orderBy: [{ parent_id: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
      }),
      this.dictionary('system_menu_type'),
      this.dictionary('enabled_status'),
    ]);
    const menuMap = new Map(menus.map((menu) => [menu.id, menu]));
    return menus.map((menu) => ({
      id: String(menu.id),
      parentId: String(menu.parent_id),
      parentName:
        menu.parent_id === 0
          ? '一级菜单'
          : (menuMap.get(menu.parent_id)?.name ?? `#${menu.parent_id}`),
      name: menu.name,
      typeValue: menu.type ?? 1,
      type: typeMap.get(String(menu.type ?? 1)) ?? String(menu.type ?? 1),
      path: menu.route || menu.path || '',
      route: menu.route ?? '',
      permission: menu.code,
      icon: menu.icon ?? '',
      sortOrder: menu.sort ?? 0,
      visible: menu.status === 1,
      statusValue: menu.status ?? 1,
      statusName: statusMap.get(String(menu.status ?? 1)) ?? String(menu.status ?? 1),
      createdAt: menu.created_at,
      updatedAt: menu.updated_at,
    }));
  }

  async menuOptions() {
    const menus = await this.prisma.hspsi_sys_menu.findMany({
      where: { type: 1, status: 1, deleted_at: null },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    });
    return menus.map((menu) => ({ id: String(menu.id), name: menu.name }));
  }

  private async menuData(body: Body, editingId?: number) {
    const parentId = this.integer(body.parentId ?? 0, '上级菜单');
    const name = this.text(body.name, '菜单名称', 1, 50);
    const type = this.integer(body.type ?? 2, '菜单类型', 1);
    const status = this.integer(body.status ?? 1, '显示状态', 1);
    const sort = this.integer(body.sortOrder ?? 0, '显示顺序');
    if (![1, 2, 3].includes(type) || ![1, 2].includes(status))
      throw new BadRequestException('菜单类型或状态无效');
    let path = '0';
    if (parentId) {
      if (editingId && parentId === editingId)
        throw new BadRequestException('菜单不能选择自身作为上级');
      const parent = await this.prisma.hspsi_sys_menu.findFirst({
        where: { id: parentId, deleted_at: null },
      });
      if (!parent) throw new BadRequestException('上级菜单不存在');
      if (parent.type !== 1) throw new BadRequestException('只有目录可以作为上级菜单');
      path = `${parent.path || '0'},${parent.id}`;
      if (editingId && `${parent.path},${parent.id},`.includes(`,${editingId},`))
        throw new BadRequestException('不能把菜单移动到自己的下级');
    }
    return {
      parent_id: parentId,
      path,
      name,
      type,
      route: String(body.route ?? body.path ?? '').trim() || null,
      code: String(body.permission ?? '').trim(),
      icon: String(body.icon ?? '').trim() || null,
      sort,
      status,
    };
  }

  async createMenu(body: Body, userId: string) {
    const data = await this.menuData(body);
    if (
      data.code &&
      (await this.prisma.hspsi_sys_menu.findFirst({ where: { code: data.code, deleted_at: null } }))
    )
      throw new ConflictException('权限编码已存在');
    const created = await this.prisma.hspsi_sys_menu.create({
      data: {
        ...data,
        component: null,
        redirect: null,
        remark: '',
        created_by: Number(userId),
        updated_by: Number(userId),
      },
    });
    return { id: String(created.id), message: '菜单创建成功' };
  }

  async updateMenu(id: string, body: Body, userId: string) {
    const menuId = this.integer(id, '菜单ID', 1);
    const old = await this.prisma.hspsi_sys_menu.findFirst({
      where: { id: menuId, deleted_at: null },
    });
    if (!old) throw new NotFoundException('菜单不存在');
    const data = await this.menuData(body, menuId);
    if (data.code) {
      const duplicate = await this.prisma.hspsi_sys_menu.findFirst({
        where: { code: data.code, id: { not: menuId }, deleted_at: null },
      });
      if (duplicate) throw new ConflictException('权限编码已存在');
    }
    await this.prisma.hspsi_sys_menu.update({
      where: { id: menuId },
      data: { ...data, updated_by: Number(userId) },
    });
    return { id, message: '菜单保存成功' };
  }

  async deleteMenu(id: string) {
    const menuId = this.integer(id, '菜单ID', 1);
    const old = await this.prisma.hspsi_sys_menu.findFirst({
      where: { id: menuId, deleted_at: null },
    });
    if (!old) throw new NotFoundException('菜单不存在');
    if (
      await this.prisma.hspsi_sys_menu.findFirst({ where: { parent_id: menuId, deleted_at: null } })
    )
      throw new BadRequestException('当前菜单存在子菜单，请先删除子菜单');
    await this.prisma.$transaction([
      this.prisma.hspsi_sys_role_menu.deleteMany({ where: { menu_id: BigInt(menuId) } }),
      this.prisma.hspsi_sys_menu.delete({ where: { id: menuId } }),
    ]);
    return { id, message: '菜单删除成功' };
  }
}
