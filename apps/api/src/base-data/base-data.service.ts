import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ResourceConfig, resourceConfigs } from './base-data.config';

@Injectable()
export class BaseDataService {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  private config(resource: string) {
    const config = resourceConfigs[resource];
    if (!config) throw new NotFoundException('基础资料类型不存在');
    return config;
  }
  private delegate(config: ResourceConfig) {
    return (this.prisma as unknown as Record<string, any>)[config.model];
  }
  private value(value: unknown, type: string) {
    if (type === 'json') return value ?? null;
    if (value === null || value === undefined || value === '')
      return type === 'date' ? null : type === 'string' ? '' : type === 'bigint' ? 0n : 0;
    if (type === 'bigint') return BigInt(String(value));
    if (type === 'number') return Number(value);
    if (type === 'date') return new Date(String(value));
    return String(value).trim();
  }
  private data(config: ResourceConfig, input: Record<string, unknown>, partial: boolean) {
    const result: Record<string, unknown> = {};
    for (const [field, definition] of Object.entries(config.fields)) {
      // json 字段由外部同步维护，基础资料接口不接受写入
      if (definition.type === 'json') continue;
      if (!(field in input)) {
        if (!partial && definition.required) throw new BadRequestException(`${field} 必填`);
        continue;
      }
      result[definition.column] = this.value(input[field], definition.type);
    }
    return result;
  }
  private output(config: ResourceConfig, row: Record<string, unknown>) {
    const item: Record<string, unknown> = { id: row[config.primaryKey] };
    for (const [field, definition] of Object.entries(config.fields))
      item[field] = row[definition.column];
    item.createdAt = row.created_at;
    item.updatedAt = row.updated_at;
    return item;
  }
  async list(resource: string, query: Record<string, string | undefined>) {
    const config = this.config(resource);
    const delegate = this.delegate(config);
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const where: Record<string, unknown> = config.softDelete === false ? {} : { deleted_at: null };
    if (query.keyword)
      where.OR = config.keywordFields.map((field) => ({ [field]: { contains: query.keyword } }));
    if (query.orgId && Object.values(config.fields).some((item) => item.column === 'org_id'))
      where.org_id = BigInt(query.orgId);
    if (
      query.status !== undefined &&
      Object.values(config.fields).some((item) => item.column === 'status')
    )
      where.status = Number(query.status);
    if (
      query.sourceType &&
      Object.values(config.fields).some((item) => item.column === 'source_type')
    )
      where.source_type = Number(query.sourceType);
    if (
      query.warehouseType &&
      Object.values(config.fields).some((item) => item.column === 'warehouse_type')
    )
      where.warehouse_type = Number(query.warehouseType);
    if (
      query.operationStatus &&
      Object.values(config.fields).some((item) => item.column === 'operation_status')
    )
      where.operation_status = Number(query.operationStatus);
    if (query.parentId && Object.values(config.fields).some((item) => item.column === 'parent_id'))
      where.parent_id = BigInt(query.parentId);
    if (query.orgId && resource === 'employees') {
      const departmentIds = (
        await this.prisma.hspsi_basic_dept.findMany({
          where: { org_id: BigInt(query.orgId), deleted_at: null },
          select: { dept_id: true },
        })
      ).map((item) => item.dept_id);
      const staffIds = (
        await this.prisma.hspsi_basic_staff_organizations.findMany({
          where: {
            deleted_at: null,
            OR: [
              { org_type: 1, org_id: BigInt(query.orgId) },
              { org_type: 2, org_id: { in: departmentIds } },
            ],
          },
          select: { staff_id: true },
        })
      ).map((item) => item.staff_id);
      where.id = { in: staffIds };
    }
    if (query.orgId && resource === 'positions') {
      const [organization, departments] = await Promise.all([
        this.prisma.hspsi_basic_organization.findFirst({
          where: { org_id: BigInt(query.orgId), deleted_at: null },
          select: { outer_ref_id: true },
        }),
        this.prisma.hspsi_basic_dept.findMany({
          where: { org_id: BigInt(query.orgId), deleted_at: null },
          select: { outer_ref_id: true },
        }),
      ]);
      const departmentRefs = departments.map((item) => item.outer_ref_id).filter(Boolean);
      const belongs = await this.prisma.hspsi_basic_position_belongs.findMany({
        where: {
          OR: [
            { org_type: 1, outer_ref_id: organization?.outer_ref_id ?? '__none__' },
            { org_type: 2, outer_ref_id: { in: departmentRefs } },
          ],
        },
        select: { position_id: true },
      });
      where.id = { in: belongs.map((item) => item.position_id) };
    }
    const [rows, total] = await this.prisma.$transaction([
      delegate.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [config.primaryKey]: 'desc' },
      }),
      delegate.count({ where }),
    ]);
    const records = rows as Record<string, any>[];
    const userIds = [
      ...new Set(
        records
          .flatMap((row) => [
            row.updated_by,
            row.created_by,
            resource === 'departments' ? row.leader_id : null,
          ])
          .filter(Boolean)
          .map(String),
      ),
    ].map(BigInt);
    const orgIds = [
      ...new Set(
        records
          .map((row) => row.org_id)
          .filter(Boolean)
          .map(String),
      ),
    ].map(BigInt);
    const parentIds =
      resource === 'organizations'
        ? [
            ...new Set(
              records
                .map((row) => row.parent_id)
                .filter((id) => id && id !== 0n)
                .map(String),
            ),
          ].map(BigInt)
        : [];
    const parentDeptIds =
      resource === 'departments'
        ? [
            ...new Set(
              records
                .map((row) => row.parent_id)
                .filter((id) => id && id !== 0n)
                .map(String),
            ),
          ].map(BigInt)
        : [];
    const customerIds =
      resource === 'customers'
        ? [
            ...new Set(
              records
                .map((row) => row.related_customer_id)
                .filter((id) => id && id !== 0n)
                .map(String),
            ),
          ].map(BigInt)
        : [];
    const [users, organizations, parents, parentDepartments, customers] = await Promise.all([
      userIds.length
        ? this.prisma.hspsi_sys_user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, username: true, nickname: true },
          })
        : [],
      orgIds.length
        ? this.prisma.hspsi_basic_organization.findMany({
            where: { org_id: { in: orgIds } },
            select: { org_id: true, org_no: true, name: true },
          })
        : [],
      parentIds.length
        ? this.prisma.hspsi_basic_organization.findMany({
            where: { org_id: { in: parentIds } },
            select: { org_id: true, org_no: true, name: true },
          })
        : [],
      parentDeptIds.length
        ? this.prisma.hspsi_basic_dept.findMany({
            where: { dept_id: { in: parentDeptIds } },
            select: { dept_id: true, dept_no: true, name: true },
          })
        : [],
      customerIds.length
        ? this.prisma.hspsi_basic_customer.findMany({
            where: { customer_id: { in: customerIds } },
            select: { customer_id: true, name: true, mobile: true },
          })
        : [],
    ]);
    const recordIds = records.map((row) => BigInt(row[config.primaryKey]));
    const postIds =
      resource === 'employees'
        ? [
            ...new Set(
              records
                .map((row) => row.post_id)
                .filter((id) => id && id !== 0n)
                .map(String),
            ),
          ].map(BigInt)
        : [];
    const [relatedPositions, staffMemberships, positionMemberships] = await Promise.all([
      postIds.length
        ? this.prisma.hspsi_basic_position.findMany({
            where: { id: { in: postIds }, deleted_at: null },
            select: { id: true, post_code: true, name: true },
          })
        : [],
      resource === 'employees' && recordIds.length
        ? this.prisma.hspsi_basic_staff_organizations.findMany({
            where: { staff_id: { in: recordIds }, deleted_at: null },
          })
        : [],
      resource === 'positions' && recordIds.length
        ? this.prisma.hspsi_basic_position_belongs.findMany({
            where: { position_id: { in: recordIds } },
          })
        : [],
    ]);
    const memberDeptIds = staffMemberships
      .filter((item) => item.org_type === 2)
      .map((item) => item.org_id);
    const memberOrgIds = staffMemberships
      .filter((item) => item.org_type === 1)
      .map((item) => item.org_id);
    const positionOrgRefs = positionMemberships
      .filter((item) => item.org_type === 1)
      .map((item) => item.outer_ref_id);
    const positionDeptRefs = positionMemberships
      .filter((item) => item.org_type === 2)
      .map((item) => item.outer_ref_id);
    const [memberDepartments, directOrganizations, positionOrganizations, positionDepartments] =
      await Promise.all([
        memberDeptIds.length
          ? this.prisma.hspsi_basic_dept.findMany({
              where: { dept_id: { in: memberDeptIds }, deleted_at: null },
              select: { dept_id: true, dept_no: true, name: true, org_id: true },
            })
          : [],
        memberOrgIds.length
          ? this.prisma.hspsi_basic_organization.findMany({
              where: { org_id: { in: memberOrgIds }, deleted_at: null },
              select: { org_id: true, org_no: true, name: true },
            })
          : [],
        positionOrgRefs.length
          ? this.prisma.hspsi_basic_organization.findMany({
              where: { outer_ref_id: { in: positionOrgRefs }, deleted_at: null },
              select: { org_id: true, org_no: true, name: true, outer_ref_id: true },
            })
          : [],
        positionDeptRefs.length
          ? this.prisma.hspsi_basic_dept.findMany({
              where: { outer_ref_id: { in: positionDeptRefs }, deleted_at: null },
              select: {
                dept_id: true,
                dept_no: true,
                name: true,
                org_id: true,
                outer_ref_id: true,
              },
            })
          : [],
      ]);
    const companyIds = [...new Set(memberDepartments.map((item) => String(item.org_id)))].map(
      BigInt,
    );
    const departmentCompanies = companyIds.length
      ? await this.prisma.hspsi_basic_organization.findMany({
          where: { org_id: { in: companyIds }, deleted_at: null },
          select: { org_id: true, org_no: true, name: true },
        })
      : [];
    const items = records.map((row) => {
      const item = this.output(config, row);
      const user = users.find((value) => value.id === (row.updated_by || row.created_by));
      const leader = users.find((value) => value.id === row.leader_id);
      const org = organizations.find((value) => value.org_id === row.org_id);
      const parent = parents.find((value) => value.org_id === row.parent_id);
      const parentDepartment = parentDepartments.find((value) => value.dept_id === row.parent_id);
      const related = customers.find((value) => value.customer_id === row.related_customer_id);
      const position = relatedPositions.find((value) => value.id === row.post_id);
      const memberships = staffMemberships.filter((value) => value.staff_id === row.id);
      const departmentsForStaff = memberships
        .filter((value) => value.org_type === 2)
        .map((value) => memberDepartments.find((dept) => dept.dept_id === value.org_id))
        .filter(Boolean);
      const directOrgsForStaff = memberships
        .filter((value) => value.org_type === 1)
        .map((value) =>
          directOrganizations.find((organization) => organization.org_id === value.org_id),
        )
        .filter(Boolean);
      const primaryDepartment = memberships.find(
        (value) => value.org_type === 2 && value.type === 1,
      );
      const primaryDept = primaryDepartment
        ? memberDepartments.find((dept) => dept.dept_id === primaryDepartment.org_id)
        : undefined;
      const primaryOrg = primaryDept
        ? departmentCompanies.find((organization) => organization.org_id === primaryDept.org_id)
        : directOrgsForStaff[0];
      const belongs = positionMemberships.filter((value) => value.position_id === row.id);
      const positionOrgs = belongs
        .filter((value) => value.org_type === 1)
        .map((value) =>
          positionOrganizations.find(
            (organization) => organization.outer_ref_id === value.outer_ref_id,
          ),
        )
        .filter(Boolean);
      const positionDepts = belongs
        .filter((value) => value.org_type === 2)
        .map((value) =>
          positionDepartments.find((dept) => dept.outer_ref_id === value.outer_ref_id),
        )
        .filter(Boolean);
      return {
        ...item,
        operatorName:
          user?.nickname || user?.username || String(row.updated_by || row.created_by || '—'),
        organization: primaryOrg
          ? { id: primaryOrg.org_id, code: primaryOrg.org_no, name: primaryOrg.name }
          : org
            ? { id: org.org_id, code: org.org_no, name: org.name }
            : null,
        parentOrganization: parent
          ? { id: parent.org_id, code: parent.org_no, name: parent.name }
          : null,
        parentDepartment: parentDepartment
          ? {
              id: parentDepartment.dept_id,
              code: parentDepartment.dept_no,
              name: parentDepartment.name,
            }
          : null,
        leader: leader ? { id: leader.id, name: leader.nickname || leader.username } : null,
        relatedCustomer: related
          ? { id: related.customer_id, name: related.name, mobile: related.mobile }
          : null,
        position: position
          ? { id: position.id, code: position.post_code, name: position.name }
          : null,
        departmentNames: departmentsForStaff
          .map((value: any) => value.name)
          .filter((name, index, all) => all.indexOf(name) === index)
          .join('、'),
        organizationNames: [
          ...directOrgsForStaff.map((value: any) => value.name),
          ...departmentsForStaff
            .map(
              (value: any) =>
                departmentCompanies.find((company) => company.org_id === value.org_id)?.name,
            )
            .filter(Boolean),
        ]
          .filter((name, index, all) => all.indexOf(name) === index)
          .join('、'),
        belongNames: [
          ...positionOrgs.map((value: any) => value.name),
          ...positionDepts.map((value: any) => value.name),
        ]
          .filter((name, index, all) => all.indexOf(name) === index)
          .join('、'),
      };
    });
    const baseWhere = config.softDelete === false ? {} : { deleted_at: null };
    const [allCount, activeCount, inactiveCount] =
      resource === 'vendors'
        ? await Promise.all([
            delegate.count({ where: baseWhere }),
            delegate.count({ where: baseWhere }),
            delegate.count({ where: { deleted_at: { not: null } } }),
          ])
        : resource === 'organizations'
          ? await Promise.all([
              delegate.count({ where: baseWhere }),
              delegate.count({ where: { ...baseWhere, operation_status: 1 } }),
              delegate.count({ where: { ...baseWhere, operation_status: 2 } }),
            ])
          : await Promise.all([
              delegate.count({ where: baseWhere }),
              delegate.count({ where: { ...baseWhere, status: 1 } }),
              delegate.count({ where: { ...baseWhere, status: { not: 1 } } }),
            ]);
    return {
      items,
      total,
      page,
      pageSize,
      summary: { total: allCount, active: activeCount, inactive: inactiveCount },
    };
  }
  async options(resource: string, keyword?: string, orgId?: string) {
    const config = this.config(resource);
    const result = await this.list(resource, {
      keyword,
      orgId,
      page: '1',
      pageSize: '100',
      status: '1',
    });
    return result.items.map((item: Record<string, unknown>) => ({
      value: item.id,
      label: item[config.labelField],
      raw: item,
    }));
  }
  async detail(resource: string, id: string) {
    const config = this.config(resource);
    const row = await this.delegate(config).findFirst({
      where: {
        [config.primaryKey]: BigInt(id),
        ...(config.softDelete === false ? {} : { deleted_at: null }),
      },
    });
    if (!row) throw new NotFoundException('记录不存在');
    return this.output(config, row);
  }
  async create(resource: string, input: Record<string, unknown>, userId: string) {
    const config = this.config(resource);
    const audit =
      config.auditFields === false
        ? {}
        : { created_by: BigInt(userId), updated_by: BigInt(userId) };
    const row = await this.delegate(config).create({
      data: { ...this.data(config, input, false), ...audit },
    });
    return { id: row[config.primaryKey], message: '创建成功' };
  }
  async update(resource: string, id: string, input: Record<string, unknown>, userId: string) {
    const existing = await this.detail(resource, id);
    const config = this.config(resource);
    if (
      resource === 'warehouses' &&
      'warehouseType' in input &&
      Number(input.warehouseType) !== Number(existing.warehouseType)
    ) {
      const warehouseId = BigInt(id);
      const [inventoryCount, orderCount, receiptCount] = await Promise.all([
        this.prisma.hspsi_inventory_total.count({
          where: { warehouse_id: warehouseId, deleted_at: null, inventory_qty: { not: 0 } },
        }),
        this.prisma.hspsi_purchase_order.count({
          where: { warehouse_id: warehouseId, deleted_at: null, status: { in: [1, 2, 3, 4, 5] } },
        }),
        this.prisma.hspsi_purchase_order_input.count({
          where: { warehouse_id: warehouseId, deleted_at: null, comfirm_status: 0 },
        }),
      ]);
      if (inventoryCount || orderCount || receiptCount)
        throw new BadRequestException('仓库已有库存或未完成采购单据，不能修改仓库类型');
    }
    const audit =
      config.auditFields === false
        ? { updated_at: new Date() }
        : { updated_by: BigInt(userId), updated_at: new Date() };
    const row = await this.delegate(config).update({
      where: { [config.primaryKey]: BigInt(id) },
      data: { ...this.data(config, input, true), ...audit },
    });
    return { id: row[config.primaryKey], message: '更新成功' };
  }
  async remove(resource: string, id: string, userId: string) {
    await this.detail(resource, id);
    const config = this.config(resource);
    if (config.softDelete === false)
      throw new BadRequestException('该基础资料不支持删除，请使用停用');
    const audit =
      config.auditFields === false
        ? { updated_at: new Date() }
        : { updated_by: BigInt(userId), updated_at: new Date() };
    await this.delegate(config).update({
      where: { [config.primaryKey]: BigInt(id) },
      data: { deleted_at: new Date(), ...audit },
    });
    return { id, message: '删除成功' };
  }
  async setStatus(resource: string, id: string, status: number, userId: string) {
    if (resource === 'vendors') throw new BadRequestException('供应商不支持启停操作');
    await this.detail(resource, id);
    const config = this.config(resource);
    const column = resource === 'organizations' ? 'operation_status' : 'status';
    const audit =
      config.auditFields === false
        ? { updated_at: new Date() }
        : { updated_by: BigInt(userId), updated_at: new Date() };
    await this.delegate(config).update({
      where: { [config.primaryKey]: BigInt(id) },
      data: { [column]: status, ...audit },
    });
    return {
      id,
      message:
        resource === 'organizations'
          ? status === 1
            ? '组织已恢复正常'
            : '组织已停业'
          : status === 1
            ? '已启用'
            : '已停用',
    };
  }
}
