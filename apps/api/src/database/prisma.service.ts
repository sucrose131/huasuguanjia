import { ForbiddenException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { activeDataScope } from './data-scope.context';

type ScopedModel = {
  table: string;
  orgField: string;
  orgScalar: 'BigInt' | 'Int';
  primaryField?: string;
  uniqueColumns: Map<string, string>;
  hasCreatedBy: boolean;
  personalScope: boolean;
  includesSharedOrganization: boolean;
};

const excludedPolymorphicModels = new Set([
  'hspsi_basic_staff_organizations',
  'hspsi_sys_user_authorized_org',
]);

function scopedModels() {
  const result = new Map<string, ScopedModel>();
  for (const model of Prisma.dmmf.datamodel.models) {
    if (excludedPolymorphicModels.has(model.name)) continue;
    const orgField = model.fields.some((field) => field.name === 'org_id')
      ? 'org_id'
      : model.fields.some((field) => field.name === 'organization_id')
        ? 'organization_id'
        : '';
    if (!orgField) continue;
    const orgScalar = model.fields.find((field) => field.name === orgField)?.type;
    if (orgScalar !== 'BigInt' && orgScalar !== 'Int') continue;
    result.set(model.name, {
      table: model.dbName ?? model.name,
      orgField,
      orgScalar,
      primaryField: model.fields.find((field) => field.isId)?.name,
      uniqueColumns: new Map(
        model.fields
          .filter((field) => field.isId || field.isUnique)
          .map((field) => [field.name, field.dbName ?? field.name]),
      ),
      hasCreatedBy: model.fields.some((field) => field.name === 'created_by'),
      personalScope: false,
      includesSharedOrganization: model.name === 'hspsi_goods_info',
    });
  }
  return result;
}

const SCOPED_MODELS = scopedModels();

function organizationValue(meta: ScopedModel, value: string | number | bigint) {
  return meta.orgScalar === 'BigInt' ? BigInt(value) : Number(value);
}

export function scopedOrganizationValue(modelName: string, value: string | number | bigint) {
  const meta = SCOPED_MODELS.get(modelName);
  if (!meta) throw new Error(`模型 ${modelName} 没有组织字段`);
  return organizationValue(meta, value);
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    this.$use(async (params, next) => {
      const scope = activeDataScope();
      const meta = params.model ? SCOPED_MODELS.get(params.model) : undefined;
      if (!scope || scope.isSuperAdmin || !meta) return next(params);
      if (!scope.authorizedOrgIds.length) throw new ForbiddenException('当前账号没有已授权组织');

      const allowedIds = scope.authorizedOrgIds.map((orgId) => organizationValue(meta, orgId));
      const modelAllowedIds = meta.includesSharedOrganization
        ? [...new Set([organizationValue(meta, 0), ...allowedIds])]
        : allowedIds;
      const orgCondition: Record<string, unknown> = { [meta.orgField]: { in: modelAllowedIds } };

      params.args ??= {};
      const scopedReads = new Set([
        'findMany',
        'findFirst',
        'findFirstOrThrow',
        'count',
        'aggregate',
        'groupBy',
      ]);
      if (scopedReads.has(params.action)) {
        params.args.where = params.args.where
          ? { AND: [params.args.where, orgCondition] }
          : orgCondition;
        return next(params);
      }

      const assertTargetWhere = async (where: Record<string, any>, operation: string) => {
        const findNestedValue = (value: unknown, key: string): unknown => {
          if (!value || typeof value !== 'object') return undefined;
          const record = value as Record<string, unknown>;
          if (record[key] !== undefined) return record[key];
          for (const child of Object.values(record)) {
            const found = findNestedValue(child, key);
            if (found !== undefined) return found;
          }
          return undefined;
        };
        const nestedOrgValue = findNestedValue(where, meta.orgField);
        if (nestedOrgValue !== undefined) {
          const value = nestedOrgValue;
          const rawValue =
            typeof value === 'object' && value ? (value as { equals?: unknown }).equals : value;
          if (
            rawValue === undefined ||
            rawValue === null ||
            !modelAllowedIds.includes(organizationValue(meta, rawValue as any))
          )
            throw new ForbiddenException(`不能${operation}其他组织的数据`);
          return;
        }
        const lookupField = [...meta.uniqueColumns.keys()].find(
          (field) => where[field] !== undefined && typeof where[field] !== 'object',
        );
        if (!lookupField) throw new ForbiddenException('无法确认目标数据的组织归属');
        const lookupColumn = meta.uniqueColumns.get(lookupField)!;
        const rows = await this.$queryRawUnsafe<Array<Record<string, unknown>>>(
          `SELECT \`${meta.orgField}\` AS org_id${meta.hasCreatedBy ? ', `created_by`' : ''} FROM \`${meta.table}\` WHERE \`${lookupColumn}\` = ? LIMIT 1`,
          where[lookupField],
        );
        const record = rows[0];
        if (record && !modelAllowedIds.includes(organizationValue(meta, record.org_id as any)))
          throw new ForbiddenException(`不能${operation}其他组织的数据`);
      };

      if (params.action === 'findUnique' || params.action === 'findUniqueOrThrow') {
        await assertTargetWhere(params.args.where ?? {}, '访问');
        return next(params);
      }

      if (params.action === 'updateMany' || params.action === 'deleteMany') {
        params.args.where = params.args.where
          ? { AND: [params.args.where, orgCondition] }
          : orgCondition;
        return next(params);
      }

      const assertInputOrganization = (data: Record<string, unknown>, required = false) => {
        const value = data?.[meta.orgField];
        if (required && (value === undefined || value === null))
          throw new ForbiddenException('写入数据缺少组织归属');
        if (
          value !== undefined &&
          value !== null &&
          !modelAllowedIds.includes(organizationValue(meta, value as any))
        )
          throw new ForbiddenException('不能向其他组织写入数据');
      };
      if (params.action === 'create') {
        assertInputOrganization(params.args.data, true);
        return next(params);
      }
      if (params.action === 'createMany') {
        const rows = Array.isArray(params.args.data) ? params.args.data : [params.args.data];
        rows.forEach((row: Record<string, unknown>) => assertInputOrganization(row, true));
        return next(params);
      }

      if (['update', 'delete', 'upsert'].includes(params.action)) {
        const where = params.args.where ?? {};
        await assertTargetWhere(where, '修改');
        if (params.action === 'update') assertInputOrganization(params.args.data);
        if (params.action === 'upsert') {
          assertInputOrganization(params.args.create, true);
          assertInputOrganization(params.args.update);
        }
        return next(params);
      }
      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
