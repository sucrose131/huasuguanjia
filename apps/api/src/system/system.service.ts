import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../database/prisma.service';

type Body = Record<string, any>;

@Injectable()
export class SystemService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    const [roles, roleMenus, userRoles, menus, statusMap, scopeMap] = await Promise.all([
      this.prisma.hspsi_sys_role.findMany({ where: { deleted_at: null }, orderBy: { id: 'asc' } }),
      this.prisma.hspsi_sys_role_menu.findMany(),
      this.prisma.hspsi_sys_user_role.findMany(),
      this.prisma.hspsi_sys_menu.findMany({
        where: { deleted_at: null, status: 1 },
        orderBy: [{ parent_id: 'asc' }, { sort: 'asc' }, { id: 'asc' }],
      }),
      this.dictionary('enabled_status'),
      this.dictionary('role_scope_type'),
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
      const pageMenus = assigned.filter((menu) => menu.type !== 3 && menu.parent_id !== 0);
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
        dataScopeValue: role.data_scope_type,
        dataScope: scopeMap.get(String(role.data_scope_type)) ?? String(role.data_scope_type),
        menuIds: assignedIds.filter((id) => menuMap.get(id)?.type !== 3),
        menuPermissions,
        actionPermissions,
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
    menus.filter((menu) => menu.parent_id > 0).forEach((menu) => requested.add(menu.parent_id));
    return [...requested].map(BigInt);
  }

  async createRole(body: Body, userId: string) {
    const name = this.text(body.name, '角色名称', 1, 50);
    const status = this.integer(body.status, '启用状态', 1);
    const dataScope = this.integer(body.dataScope, '默认数据范围', 1);
    if (![1, 2].includes(status) || ![1, 2, 3, 4, 5].includes(dataScope))
      throw new BadRequestException('角色状态或数据范围无效');
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
          data_scope_type: dataScope,
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
    const dataScope = this.integer(body.dataScope ?? old.data_scope_type, '默认数据范围', 1);
    if (old.code === 'admin' && (name !== old.name || status !== 1))
      throw new BadRequestException('系统管理员角色不允许改名或停用');
    if (![1, 2].includes(status) || ![1, 2, 3, 4, 5].includes(dataScope))
      throw new BadRequestException('角色状态或数据范围无效');
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
        data: { name, status, data_scope_type: dataScope, updated_by: BigInt(userId) },
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
    const [users, userRoles, roles, organizations, departments, statusMap, scopeMap] =
      await Promise.all([
        this.prisma.hspsi_sys_user.findMany({
          where: { deleted_at: null },
          orderBy: { id: 'asc' },
        }),
        this.prisma.hspsi_sys_user_role.findMany(),
        this.prisma.hspsi_sys_role.findMany({ where: { deleted_at: null } }),
        this.prisma.hspsi_basic_organization.findMany({ where: { deleted_at: null } }),
        this.prisma.hspsi_basic_dept.findMany({ where: { deleted_at: null } }),
        this.dictionary('system_account_status'),
        this.dictionary('role_scope_type'),
      ]);
    const roleMap = new Map(roles.map((role) => [Number(role.id), role]));
    const orgMap = new Map(organizations.map((org) => [String(org.org_id), org.name]));
    const deptMap = new Map(departments.map((dept) => [String(dept.dept_id), dept.name]));
    const actorMap = await this.userNames(
      users.flatMap((user) => [user.created_by, user.updated_by]),
    );
    return users.map((user) => {
      const assignedRoles = userRoles
        .filter((item) => BigInt(item.user_id) === user.id)
        .map((item) => roleMap.get(item.role_id))
        .filter(Boolean) as typeof roles;
      const scopeValues = assignedRoles.map((role) => role.data_scope_type);
      const effectiveScope = scopeValues.includes(1)
        ? 1
        : scopeValues.includes(2)
          ? 2
          : scopeValues.includes(3)
            ? 3
            : scopeValues.includes(4)
              ? 4
              : 5;
      return {
        id: String(user.id),
        account: user.username,
        name: user.nickname || user.username,
        orgId: user.org_id ? String(user.org_id) : '',
        orgName: user.org_id ? (orgMap.get(String(user.org_id)) ?? '') : '',
        deptId: user.dept_id ? String(user.dept_id) : '',
        department: user.dept_id ? (deptMap.get(String(user.dept_id)) ?? '') : '',
        roleIds: assignedRoles.map((role) => String(role.id)),
        roleNames: assignedRoles.map((role) => role.name),
        dataScope: {
          scopeTypeValue: effectiveScope,
          scopeType: scopeMap.get(String(effectiveScope)) ?? '',
        },
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

  async userOptions() {
    const [roles, organizations, departments] = await Promise.all([
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
    ]);
    return {
      roles: roles.map((role) => ({
        id: String(role.id),
        name: role.name,
        code: role.code,
        dataScope: role.data_scope_type,
      })),
      organizations: organizations.map((org) => ({ id: String(org.org_id), name: org.name })),
      departments: departments.map((dept) => ({
        id: String(dept.dept_id),
        orgId: String(dept.org_id),
        name: dept.name,
      })),
    };
  }

  private async validateUserRelations(body: Body) {
    const orgId = BigInt(this.integer(body.orgId, '所属公司', 1));
    const organization = await this.prisma.hspsi_basic_organization.findFirst({
      where: { org_id: orgId, operation_status: 1, deleted_at: null },
    });
    if (!organization) throw new BadRequestException('所属公司不存在或已停用');
    const deptId = body.deptId ? BigInt(this.integer(body.deptId, '所属部门', 1)) : null;
    if (deptId) {
      const department = await this.prisma.hspsi_basic_dept.findFirst({
        where: { dept_id: deptId, org_id: orgId, status: 1, deleted_at: null },
      });
      if (!department) throw new BadRequestException('所属部门不存在、已停用或不属于所选公司');
    }
    const roleIds = [
      ...new Set(
        (Array.isArray(body.roleIds) ? body.roleIds : []).map((value: unknown) =>
          this.integer(value, '所属角色', 1),
        ),
      ),
    ];
    if (!roleIds.length) throw new BadRequestException('至少选择一个所属角色');
    const roles = await this.prisma.hspsi_sys_role.findMany({
      where: { id: { in: roleIds.map(BigInt) }, status: 1, deleted_at: null },
    });
    if (roles.length !== roleIds.length) throw new BadRequestException('包含不存在或已停用的角色');
    return { orgId, deptId, roleIds };
  }

  async createUser(body: Body, userId: string) {
    const account = this.text(body.account, '登录账号', 3, 50);
    const name = this.text(body.name, '用户姓名', 1, 50);
    const password = this.text(body.password, '初始密码', 6, 64);
    const status = this.integer(body.status, '账号状态', 1);
    if (![1, 2].includes(status)) throw new BadRequestException('账号状态无效');
    if (
      await this.prisma.hspsi_sys_user.findFirst({ where: { username: account, deleted_at: null } })
    )
      throw new ConflictException('登录账号已存在');
    const relations = await this.validateUserRelations(body);
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
          status,
          created_by: actorId,
          updated_by: actorId,
        },
      });
      await tx.hspsi_sys_user_role.createMany({
        data: relations.roleIds.map((roleId) => ({ user_id: Number(user.id), role_id: roleId })),
        skipDuplicates: true,
      });
      return user;
    });
    return { id: String(created.id), message: '用户创建成功' };
  }

  async updateUser(id: string, body: Body, userId: string) {
    const targetId = BigInt(id);
    const old = await this.prisma.hspsi_sys_user.findFirst({
      where: { id: targetId, deleted_at: null },
    });
    if (!old) throw new NotFoundException('用户不存在');
    const name = this.text(body.name ?? old.nickname ?? old.username, '用户姓名', 1, 50);
    const status = this.integer(body.status ?? old.status ?? 1, '账号状态', 1);
    if (old.username === 'admin' && status !== 1)
      throw new BadRequestException('admin账号不允许禁用');
    if (![1, 2].includes(status)) throw new BadRequestException('账号状态无效');
    const relations = await this.validateUserRelations(body);
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
          status,
          updated_by: BigInt(userId),
          ...(password ? { password: await hash(password, 12) } : {}),
        },
      });
      await tx.hspsi_sys_user_role.deleteMany({ where: { user_id: Number(targetId) } });
      await tx.hspsi_sys_user_role.createMany({
        data: relations.roleIds.map((roleId) => ({ user_id: Number(targetId), role_id: roleId })),
        skipDuplicates: true,
      });
    });
    return { id, message: '用户保存成功' };
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
