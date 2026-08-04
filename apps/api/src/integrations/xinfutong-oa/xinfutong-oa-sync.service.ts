import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AccountSetCredential } from './xinfutong-oa-credential.service';
import type {
  MemberRecord,
  OrganizationRecord,
  PositionRecord,
} from './xinfutong-oa.types';

/**
 * 同步统计：组织/部门
 */
export interface OrganizationSyncStats {
  org_inserted: number;
  org_updated: number;
  dept_inserted: number;
  dept_updated: number;
}

/**
 * 同步统计：岗位
 */
export interface PositionSyncStats {
  position_inserted: number;
  position_updated: number;
  belongs_inserted: number;
  belongs_updated: number;
}

/**
 * 同步统计：企业成员
 */
export interface MemberSyncStats {
  staff_inserted: number;
  staff_updated: number;
  org_inserted: number;
}

/**
 * 薪福通 OA 数据同步服务
 *
 * 职责：将薪福通组织/岗位/企业成员数据同步到本地基础数据表。
 *
 * 同步规则（对应 PHP 版 syncOrganizations / syncPositions / syncMembers）：
 * - 以 (outer_ref_id, account_set_id) 做幂等：存在则更新，不存在则新增
 * - 各表均写入 account_set_id / app_id，用于区分数据来源
 * - 组织按 idPath 深度排序后处理，确保父节点先于子节点写入
 * - 组织/部门的 path 在写入后基于本地主键和父节点 path 拼接
 * - 岗位/成员的所属组织关联每次同步先清除再重新写入
 */
@Injectable()
export class XinfutongOaSyncService {
  private static readonly logger = new Logger(XinfutongOaSyncService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ==================== 组织/部门同步 ====================

  /**
   * 将薪福通组织数据同步到 hspsi_basic_organization / hspsi_basic_dept
   *
   * 对应 PHP 版 syncOrganizations()：
   * - type != 'D' 的写入 hspsi_basic_organization（组织表）
   * - type == 'D' 的写入 hspsi_basic_dept（部门表）
   * 按 idPath 深度排序后处理，确保父节点先于子节点写入。
   *
   * @param credential 账套凭证
   * @param records OA 组织记录数组
   * @returns 同步统计
   */
  async syncOrganizations(
    credential: AccountSetCredential,
    records: OrganizationRecord[],
  ): Promise<OrganizationSyncStats> {
    const stats: OrganizationSyncStats = {
      org_inserted: 0,
      org_updated: 0,
      dept_inserted: 0,
      dept_updated: 0,
    };

    if (records.length === 0) {
      return stats;
    }

    // 按 idPath 深度排序，确保父节点先于子节点处理
    const sorted = [...records].sort((a, b) => {
      const depthA = (a.idPath ?? '').split('/').length;
      const depthB = (b.idPath ?? '').split('/').length;
      return depthA - depthB;
    });

    await this.prisma.$transaction(async (tx) => {
      /**
       * 查找表：outer_ref_id => 节点信息
       * - type: OA type（'D' 为部门，其他为组织）
       * - local_id: 本地主键（org_id 或 dept_id）
       * - org_id: 所属 org_id（组织为自身，部门为所属组织）
       * - path: 自身完整路径（用于子节点拼接）
       * - org_path: 所属组织路径
       */
      const lookup = new Map<
        string,
        { type: string; localId: bigint; orgId: bigint; path: string; orgPath: string }
      >();

      for (const record of sorted) {
        const outerRefId = record.id ?? '';
        if (!outerRefId) continue;

        const type = record.type ?? 'G';
        const parentOuterRefId = record.parentId ?? '';

        // 解析父节点信息
        let parentLocalId = 0n;
        let parentOrgId = 0n;
        let parentPath = '';
        let parentOrgPath = '';
        const parentInfo = parentOuterRefId ? lookup.get(parentOuterRefId) : undefined;
        if (parentInfo) {
          parentOrgId = parentInfo.orgId;
          parentPath = parentInfo.path;
          parentOrgPath = parentInfo.orgPath;
          // 父节点为部门时，当前部门的 parent_id 指向父部门 dept_id
          if (parentInfo.type === 'D') {
            parentLocalId = parentInfo.localId;
          }
        }

        if (type === 'D') {
          // ===== 写入部门表 hspsi_basic_dept =====
          const status = record.status ?? 'active';
          const data = {
            account_set_id: credential.id,
            app_id: credential.appId,
            org_id: parentOrgId,
            parent_id: parentLocalId,
            name: record.name ?? '',
            dept_no: record.code ?? '',
            sort: record.orderNumber ?? 0,
            status: status === 'active' ? 1 : 2,
            outer_ref_id: outerRefId,
          };

          const existing = await tx.hspsi_basic_dept.findFirst({
            where: { outer_ref_id: outerRefId, account_set_id: credential.id },
            select: { dept_id: true },
          });

          let deptId: bigint;
          if (existing) {
            await tx.hspsi_basic_dept.update({
              where: { dept_id: existing.dept_id },
              data,
            });
            deptId = existing.dept_id;
            stats.dept_updated++;
          } else {
            const created = await tx.hspsi_basic_dept.create({ data });
            deptId = created.dept_id;
            stats.dept_inserted++;
          }

          // 部门 path：父为部门则继承父部门 path，否则为根路径 '/'
          const path = parentLocalId > 0n ? parentPath : '/';
          await tx.hspsi_basic_dept.update({
            where: { dept_id: deptId },
            data: { path },
          });

          // 子节点拼接路径用：当前节点的完整路径 = 父路径 + 自身 ID + '/'
          const fullPath = `${path}${deptId}/`;
          lookup.set(outerRefId, {
            type: 'D',
            localId: deptId,
            orgId: parentOrgId,
            path: fullPath,
            orgPath: parentOrgPath,
          });
        } else {
          // ===== 写入组织表 hspsi_basic_organization =====
          // 组织的 parent_id 指向父组织的 org_id（若父为部门则取其所属 org_id）
          let parentOrgIdForOrg = 0n;
          if (parentOuterRefId) {
            const p = lookup.get(parentOuterRefId);
            if (p) parentOrgIdForOrg = p.orgId;
          }

          const status = record.status ?? 'active';
          const leader = record.leaders?.[0] ?? {};
          const effectiveDate = record.effectiveDate ?? '';
          const data = {
            parent_id: parentOrgIdForOrg,
            org_no: record.code ?? '',
            name: record.name ?? '',
            org_level: this.mapOrgLevel(type),
            short_name: record.name ?? '',
            contact_name: leader.name ?? '',
            sort: record.orderNumber ?? 0,
            operation_status: status === 'active' ? 1 : 2,
            established_at: effectiveDate ? new Date(effectiveDate) : null,
            outer_ref_id: outerRefId,
            account_set_id: credential.id,
            app_id: credential.appId,
            remark: record.remark ?? '',
          };

          const existing = await tx.hspsi_basic_organization.findFirst({
            where: { outer_ref_id: outerRefId, account_set_id: credential.id },
            select: { org_id: true },
          });

          let orgId: bigint;
          if (existing) {
            await tx.hspsi_basic_organization.update({
              where: { org_id: existing.org_id },
              data,
            });
            orgId = existing.org_id;
            stats.org_updated++;
          } else {
            const created = await tx.hspsi_basic_organization.create({ data });
            orgId = created.org_id;
            stats.org_inserted++;
          }

          // 组织 path：父组织的完整路径（不含自身），根组织为 '/'
          const path = parentOrgIdForOrg > 0n ? parentOrgPath : '/';
          await tx.hspsi_basic_organization.update({
            where: { org_id: orgId },
            data: { path },
          });

          // 子节点拼接路径用：当前节点的完整路径 = 父路径 + 自身 ID + '/'
          const fullPath = `${path}${orgId}/`;
          lookup.set(outerRefId, {
            type,
            localId: orgId,
            orgId,
            path: fullPath,
            orgPath: fullPath,
          });
        }
      }
    });

    return stats;
  }

  /**
   * OA 组织类型映射到本地 org_level
   *
   * 对应 PHP 版 mapOrgLevel()：
   * G-集团→1, B-分公司→2, S-子公司→3, BD-事业部→4, PT-项目组→5, SP-门店→6
   */
  private mapOrgLevel(type: string): number {
    switch (type) {
      case 'G':
        return 1;
      case 'B':
        return 2;
      case 'S':
        return 3;
      case 'BD':
        return 4;
      case 'PT':
        return 5;
      case 'SP':
        return 6;
      default:
        return 0;
    }
  }

  // ==================== 岗位同步 ====================

  /**
   * 将薪福通岗位数据同步到 hspsi_basic_position / hspsi_basic_position_belongs
   *
   * 对应 PHP 版 syncPositions()：
   * - 岗位表以 (outer_ref_id, account_set_id) 做幂等
   * - 每次同步前清除当前岗位的所属组织关联，再重新写入
   * - 所属组织表的 org_type 通过查询组织表判断：存在为组织(1)，否则为部门(2)
   *
   * @param credential 账套凭证
   * @param records OA 岗位记录数组
   * @returns 同步统计
   */
  async syncPositions(
    credential: AccountSetCredential,
    records: PositionRecord[],
  ): Promise<PositionSyncStats> {
    const stats: PositionSyncStats = {
      position_inserted: 0,
      position_updated: 0,
      belongs_inserted: 0,
      belongs_updated: 0,
    };

    if (records.length === 0) {
      return stats;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const record of records) {
        const outerRefId = record.sequenceNumber ?? '';
        if (!outerRefId) continue;

        const data = {
          name: record.positionName ?? '',
          post_code: record.codeNumber ?? '',
          outer_ref_id: outerRefId,
          account_set_id: credential.id,
          app_id: credential.appId,
          remark: record.remark ?? '',
          sort: record.orderNumber ?? 0,
        };

        // 查询是否已存在（幂等，以 outer_ref_id + account_set_id 联合判断）
        const existing = await tx.hspsi_basic_position.findFirst({
          where: { outer_ref_id: outerRefId, account_set_id: credential.id },
          select: { id: true },
        });

        let positionId: bigint;
        if (existing) {
          await tx.hspsi_basic_position.update({
            where: { id: existing.id },
            data,
          });
          positionId = existing.id;
          stats.position_updated++;
        } else {
          const created = await tx.hspsi_basic_position.create({ data });
          positionId = created.id;
          stats.position_inserted++;
        }

        // 同步所属组织关系：先删除当前岗位的旧关联，再重新写入
        await tx.hspsi_basic_position_belongs.deleteMany({
          where: { position_id: positionId },
        });

        const organizations = record.organizations ?? [];
        for (const org of organizations) {
          const orgOuterRefId = org.organizationId ?? '';
          if (!orgOuterRefId) continue;

          // 判断组织类型：在组织表中存在为组织（1），否则为部门（2）
          const orgExists = await tx.hspsi_basic_organization.findFirst({
            where: { outer_ref_id: orgOuterRefId, account_set_id: credential.id },
            select: { org_id: true },
          });
          const orgType = orgExists ? 1 : 2;

          await tx.hspsi_basic_position_belongs.create({
            data: {
              position_id: positionId,
              outer_ref_id: orgOuterRefId,
              account_set_id: credential.id,
              app_id: credential.appId,
              org_type: orgType,
            },
          });
          stats.belongs_inserted++;
        }
      }
    });

    return stats;
  }

  // ==================== 企业成员同步 ====================

  /**
   * 将薪福通企业成员数据同步到 hspsi_basic_staff / hspsi_basic_staff_organizations
   *
   * 对应 PHP 版 syncMembers()：
   * - 员工表以 (outer_ref_id, account_set_id) 做幂等
   * - post_id 通过 (post.id, account_set_id) 关联本地岗位表获取，查不到则置 0
   * - staff_code 使用 OA 的 number 字段
   * - out_staff_id 使用 OA 的 idRelation.staffId
   * - gender 映射：M→1, F→2, 其他→0
   * - status 映射：ENABLE→1, 其他→2
   * - deleted_at：OA 的 deleted=true 时写入当前时间，否则 null
   * - 每次同步前清除当前员工的组织关联，再重新写入
   * - 组织关联的 org_type：先查组织表(1)，否则查部门表(2)，都查不到则跳过
   * - 组织关联的 type 映射：PRIMARY→1（主部门），其他→2（兼任部门）
   *
   * @param credential 账套凭证
   * @param records OA 企业成员记录数组
   * @returns 同步统计
   */
  async syncMembers(
    credential: AccountSetCredential,
    records: MemberRecord[],
  ): Promise<MemberSyncStats> {
    const stats: MemberSyncStats = {
      staff_inserted: 0,
      staff_updated: 0,
      org_inserted: 0,
    };

    if (records.length === 0) {
      return stats;
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const record of records) {
        const outerRefId = record.memberId ?? '';
        if (!outerRefId) continue;

        // 通过 post.id 关联本地岗位表获取 post_id（限定 account_set_id）
        const postOuterRefId = record.post?.id ?? '';
        let postId = 0n;
        if (postOuterRefId) {
          const position = await tx.hspsi_basic_position.findFirst({
            where: { outer_ref_id: postOuterRefId, account_set_id: credential.id },
            select: { id: true },
          });
          if (position) {
            postId = position.id;
          }
        }

        // 性别映射：M→1, F→2, 其他→0
        const gender = record.gender === 'M' ? 1 : record.gender === 'F' ? 2 : 0;
        // 状态映射：ENABLE→1, 其他→2
        const status = record.status === 'ENABLE' ? 1 : 2;
        // 删除标记：deleted=true 时记录删除时间，否则 null
        const deletedAt = record.deleted ? now : null;

        const data = {
          post_id: postId,
          name: record.name ?? '',
          mobile: record.mobile ?? '',
          staff_code: record.number ?? '',
          out_staff_id: record.idRelation?.staffId ?? '',
          gender,
          status,
          outer_ref_id: outerRefId,
          account_set_id: credential.id,
          app_id: credential.appId,
          deleted_at: deletedAt,
        };

        // 查询是否已存在（幂等，以 outer_ref_id + account_set_id 联合判断）
        const existing = await tx.hspsi_basic_staff.findFirst({
          where: { outer_ref_id: outerRefId, account_set_id: credential.id },
          select: { id: true },
        });

        let staffId: bigint;
        if (existing) {
          // 更新时不覆盖 created_at
          await tx.hspsi_basic_staff.update({
            where: { id: existing.id },
            data: { ...data, updated_at: now },
          });
          staffId = existing.id;
          stats.staff_updated++;
        } else {
          const created = await tx.hspsi_basic_staff.create({
            data: { ...data, created_at: now, updated_at: now },
          });
          staffId = created.id;
          stats.staff_inserted++;
        }

        // 同步组织关联：先删除当前员工的旧关联，再重新写入
        await tx.hspsi_basic_staff_organizations.deleteMany({
          where: { staff_id: staffId },
        });

        const organizations = record.organizations ?? [];
        for (const org of organizations) {
          const orgOuterRefId = org.organizationId ?? '';
          if (!orgOuterRefId) continue;

          // 先查组织表（限定 account_set_id），存在则为组织（org_type=1）
          const orgRow = await tx.hspsi_basic_organization.findFirst({
            where: { outer_ref_id: orgOuterRefId, account_set_id: credential.id },
            select: { org_id: true },
          });

          let localOrgId: bigint;
          let orgType: number;
          if (orgRow) {
            localOrgId = orgRow.org_id;
            orgType = 1;
          } else {
            // 组织表中不存在，则查部门表（限定 account_set_id），存在则为部门（org_type=2）
            const deptRow = await tx.hspsi_basic_dept.findFirst({
              where: { outer_ref_id: orgOuterRefId, account_set_id: credential.id },
              select: { dept_id: true },
            });
            if (!deptRow) {
              // 本地组织和部门均未同步时跳过，避免产生脏数据
              continue;
            }
            localOrgId = deptRow.dept_id;
            orgType = 2;
          }

          // 类型映射：PRIMARY→1（主部门），其他→2（兼任部门）
          const type = org.type === 'PRIMARY' ? 1 : 2;

          await tx.hspsi_basic_staff_organizations.create({
            data: {
              org_id: localOrgId,
              staff_id: staffId,
              account_set_id: credential.id,
              app_id: credential.appId,
              org_type: orgType,
              type,
              created_at: now,
              updated_at: now,
            },
          });
          stats.org_inserted++;
        }
      }
    });

    return stats;
  }
}
