import { Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  HUASU_HOME_DATA_SOURCE_CODE,
  HUASU_HOME_DATA_SOURCE_NAME,
  HUASU_HOME_USER_SYNC_DEFAULT_PAGE_SIZE,
  HUASU_HOME_USER_SYNC_MAX_PAGE_SIZE,
} from '../huasu-home.constants';
import { HuasuHomeService } from '../huasu-home.service';
import type { CustomerIdentityLevels, HuasuHomeUser } from '../huasu-home.types';
import { buildCustomerLevels } from './build-customer-levels';
import type { HuasuHomeUserSyncStats } from './user-sync.types';

/** 页内并发写入上限 */
const USER_SYNC_WRITE_CONCURRENCY = 8;

/**
 * 华溯之家用户同步
 *
 * 流程：
 * 1. 取水位 afterUserId = 本数据源已同步客户 max(related_customer_id)，或入参覆盖
 * 2. 循环拉取 id > afterUserId 的用户（page 固定 1，按页推进水位）
 * 3. 按页加载机构映射并写入客户；单条机构问题记失败
 *
 * 对应 docs/global/integrations/huasu-home/用户同步.md
 */
@Injectable()
export class HuasuHomeUserSyncService {
  private static readonly logger = new Logger(HuasuHomeUserSyncService.name);

  /** 进程内防重入：上一轮未结束则跳过 */
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HuasuHomeService) private readonly huasuHome: HuasuHomeService,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async syncUsers(options?: {
    pageSize?: number;
    operatorId?: bigint;
    /** 覆盖水位：只同步 id 大于该值的用户；不传则取库中已同步最大 related_customer_id */
    afterUserId?: number;
  }): Promise<HuasuHomeUserSyncStats | null> {
    if (this.running) {
      HuasuHomeUserSyncService.logger.warn('华溯用户同步仍在进行，跳过本轮');
      return null;
    }
    this.running = true;
    const stats = this.emptyStats();
    try {
      const pageSize = this.normalizePageSize(options?.pageSize);
      const operatorId = options?.operatorId ?? 0n;
      const now = new Date();

      const sourceId = await this.ensureDataSource(operatorId);
      const sourceType = Number(sourceId);
      if (!Number.isSafeInteger(sourceType) || sourceType > 255) {
        throw new UnprocessableEntityException(
          `数据源 id=${sourceId} 超出客户 source_type(tinyint) 范围，请调整字段类型`,
        );
      }

      let afterUserId =
        options?.afterUserId !== undefined
          ? Math.max(0, Math.floor(Number(options.afterUserId) || 0))
          : await this.getMaxSyncedUserId(sourceType);
      stats.afterUserId = afterUserId;
      stats.lastUserId = afterUserId;

      let guard = 0;
      while (guard < 10_000) {
        guard += 1;
        const data = await this.huasuHome.getUserList({
          page: 1,
          page_size: pageSize,
          id: afterUserId,
        });
        const list = data.list ?? [];
        if (list.length === 0) break;

        stats.fetched += list.length;
        const pageMaxId = list.reduce(
          (max, user) => Math.max(max, Number(user.id) || 0),
          afterUserId,
        );
        if (pageMaxId <= afterUserId) {
          HuasuHomeUserSyncService.logger.warn(
            `用户列表水位未前进 afterUserId=${afterUserId}，停止拉取避免死循环`,
          );
          break;
        }

        const orgMap = await this.loadOrgMappings(sourceId, list);
        await this.mapPool(list, USER_SYNC_WRITE_CONCURRENCY, async (user) => {
          try {
            await this.saveCustomer({
              user,
              sourceType,
              orgMap,
              operatorId,
              now,
              stats,
            });
          } catch (error) {
            if (this.isFatalSyncError(error)) throw error;
            stats.failed += 1;
            const message = error instanceof Error ? error.message : String(error);
            stats.warnings.push(`user.id=${user.id}: ${message}`);
            HuasuHomeUserSyncService.logger.error(`同步用户失败 id=${user.id}: ${message}`);
          }
        });

        afterUserId = pageMaxId;
        stats.lastUserId = afterUserId;
        if (list.length < pageSize) break;
      }

      HuasuHomeUserSyncService.logger.log(
        `华溯用户同步完成 afterUserId=${stats.afterUserId} lastUserId=${stats.lastUserId} fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} failed=${stats.failed}`,
      );
      return stats;
    } finally {
      this.running = false;
    }
  }

  /** @deprecated 使用 buildCustomerLevels；保留便于单测直接调用 */
  buildLevels(user: HuasuHomeUser): CustomerIdentityLevels {
    return buildCustomerLevels(user);
  }

  private async getMaxSyncedUserId(sourceType: number): Promise<number> {
    const row = await this.prisma.hspsi_basic_customer.aggregate({
      where: {
        source_type: sourceType,
        deleted_at: null,
        related_customer_id: { gt: 0 },
      },
      _max: { related_customer_id: true },
    });
    const maxId = row._max.related_customer_id;
    if (maxId === null || maxId === undefined) return 0;
    const value = Number(maxId);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  private async loadOrgMappings(
    sourceId: bigint,
    users: HuasuHomeUser[],
  ): Promise<Map<number, bigint>> {
    const orgIds = [
      ...new Set(
        users
          .map((user) => Number(user.organization_id ?? 0))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    if (!orgIds.length) return new Map();

    const mappings = await this.prisma.hspsi_sys_organization_mapping.findMany({
      where: {
        source_id: sourceId,
        source_object_id: { in: orgIds.map(String) },
        deleted_at: null,
      },
      select: { source_object_id: true, org_id: true },
    });
    const map = new Map<number, bigint>();
    for (const row of mappings) {
      const sourceOrgId = Number(row.source_object_id);
      if (!(row.org_id > 0n) || !Number.isFinite(sourceOrgId)) continue;
      map.set(sourceOrgId, row.org_id);
    }
    return map;
  }

  private async saveCustomer(input: {
    user: HuasuHomeUser;
    sourceType: number;
    orgMap: Map<number, bigint>;
    operatorId: bigint;
    now: Date;
    stats: HuasuHomeUserSyncStats;
  }): Promise<void> {
    const userId = BigInt(input.user.id);
    if (userId < 1n) {
      throw new UnprocessableEntityException('用户缺少有效 id');
    }

    const rawOrgId = input.user.organization_id;
    if (rawOrgId === undefined || rawOrgId === null) {
      throw new UnprocessableEntityException('用户缺少 organization_id');
    }
    const sourceOrgId = Number(rawOrgId);
    if (!Number.isFinite(sourceOrgId)) {
      throw new UnprocessableEntityException(
        `用户 organization_id 非法: ${String(rawOrgId)}`,
      );
    }
    if (sourceOrgId < 1) {
      throw new UnprocessableEntityException(`用户 organization_id 无效: ${sourceOrgId}`);
    }
    const orgId = input.orgMap.get(sourceOrgId);
    if (!orgId) {
      throw new UnprocessableEntityException(`机构未映射: organization_id=${sourceOrgId}`);
    }

    const existing = await this.prisma.hspsi_basic_customer.findFirst({
      where: {
        source_type: input.sourceType,
        related_customer_id: userId,
        deleted_at: null,
      },
    });

    const name = this.clip(input.user.nickname || `华溯用户${userId}`, 100);
    const mobile = this.clip(input.user.mobile || '', 20);
    const levels = buildCustomerLevels(input.user) as unknown as Prisma.InputJsonValue;
    const birthday = this.parseBirth(input.user.birth);
    const status = Number(input.user.status ?? 1) === 0 ? 2 : 1;
    const data = {
      org_id: orgId,
      name,
      mobile,
      gender: Number(input.user.gender ?? 0),
      birthday,
      referrer_name: this.clip(input.user.referrer?.nickname || '', 32),
      referrer_mobile: this.clip(input.user.referrer?.mobile || '', 20),
      status,
      remark: this.clip(input.user.remark || '', 255),
      levels,
      updated_by: input.operatorId,
      updated_at: input.now,
    };

    if (existing) {
      await this.prisma.hspsi_basic_customer.update({
        where: { customer_id: existing.customer_id },
        data,
      });
      input.stats.updated += 1;
      return;
    }

    await this.prisma.hspsi_basic_customer.create({
      data: {
        ...data,
        source_type: input.sourceType,
        related_customer_id: userId,
        address: '',
        sort: 0,
        created_by: input.operatorId,
        created_at: input.now,
      },
    });
    input.stats.created += 1;
  }

  private async ensureDataSource(operatorId: bigint): Promise<bigint> {
    const existing = await this.prisma.hspsi_sys_data_source.findUnique({
      where: { code: HUASU_HOME_DATA_SOURCE_CODE },
    });
    if (existing) {
      if (existing.deleted_at || existing.status !== 1) {
        throw new UnprocessableEntityException('华溯之家数据源已停用或删除，请先在系统中启用');
      }
      return existing.id;
    }
    const created = await this.prisma.hspsi_sys_data_source.create({
      data: {
        code: HUASU_HOME_DATA_SOURCE_CODE,
        name: HUASU_HOME_DATA_SOURCE_NAME,
        status: 1,
        created_by: operatorId,
        updated_by: operatorId,
      },
    });
    return created.id;
  }

  private async mapPool<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    if (!items.length) return;
    let next = 0;
    const limit = Math.max(1, Math.min(concurrency, items.length));
    const runners = Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await worker(items[index]!);
      }
    });
    await Promise.all(runners);
  }

  private isFatalSyncError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code);
    }
    if (error instanceof Prisma.PrismaClientInitializationError) return true;
    if (error instanceof Prisma.PrismaClientRustPanicError) return true;
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes('econnrefused') ||
        (msg.includes('connection') && msg.includes('closed')) ||
        msg.includes('server has gone away')
      );
    }
    return false;
  }

  private normalizePageSize(pageSize?: number): number {
    const raw = Number(pageSize ?? HUASU_HOME_USER_SYNC_DEFAULT_PAGE_SIZE);
    if (!Number.isFinite(raw) || raw < 1) return HUASU_HOME_USER_SYNC_DEFAULT_PAGE_SIZE;
    return Math.min(HUASU_HOME_USER_SYNC_MAX_PAGE_SIZE, Math.floor(raw));
  }

  private parseBirth(birth?: string): Date | null {
    const text = String(birth ?? '').trim();
    if (!text) return null;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  private clip(value: string, max: number): string {
    return value.length <= max ? value : value.slice(0, max);
  }

  private emptyStats(): HuasuHomeUserSyncStats {
    return {
      fetched: 0,
      created: 0,
      updated: 0,
      failed: 0,
      afterUserId: 0,
      lastUserId: 0,
      warnings: [],
    };
  }
}