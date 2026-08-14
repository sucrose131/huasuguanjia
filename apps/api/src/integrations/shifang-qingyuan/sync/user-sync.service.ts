import { Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
  SHIFANG_QINGYUAN_DATA_SOURCE_NAME,
  SHIFANG_QINGYUAN_USER_SYNC_DEFAULT_PAGE_SIZE,
  SHIFANG_QINGYUAN_USER_SYNC_MAX_PAGE_SIZE,
  SHIFANG_QINGYUAN_USER_SYNC_OVERLAP_MS,
} from '../shifang-qingyuan.constants';
import { ShifangQingyuanService } from '../shifang-qingyuan.service';
import type { ShifangQingyuanUserItem } from '../shifang-qingyuan.types';
import { buildCustomerLevels } from './build-customer-levels';
import type {
  ShifangQingyuanUserSyncOptions,
  ShifangQingyuanUserSyncStats,
} from './user-sync.types';

/** 页内并发写入上限 */
const USER_SYNC_WRITE_CONCURRENCY = 8;
const USER_SYNC_MAX_PAGES = 10_000;

/**
 * 十方清源用户同步
 *
 * 流程：
 * 1. 确定 start_time：首轮/重启/full 不传；之后为上一轮开始时间减重叠窗口
 * 2. 分页拉取 updated_at 落在水位之后的用户（不传 end_time）
 * 3. 按页加载机构映射并写入客户；单条机构问题记失败
 * 4. 本轮有失败则不前进内存水位，以便下一轮重试
 *
 * 对应 docs/global/integrations/shifang-qingyuan/用户同步.md
 */
@Injectable()
export class ShifangQingyuanUserSyncService {
  private static readonly logger = new Logger(ShifangQingyuanUserSyncService.name);

  /** 进程内防重入：上一轮未结束则跳过 */
  private running = false;

  /** 上一轮开始时间（内存水位；进程重启后丢失则再做基线全量） */
  private lastRoundStartedAt: Date | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ShifangQingyuanService) private readonly shifangQingyuan: ShifangQingyuanService,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async syncUsers(
    options?: ShifangQingyuanUserSyncOptions,
  ): Promise<ShifangQingyuanUserSyncStats | null> {
    if (this.running) {
      ShifangQingyuanUserSyncService.logger.warn('十方清源用户同步仍在进行，跳过本轮');
      return null;
    }
    this.running = true;
    const stats = this.emptyStats();
    try {
      const pageSize = this.normalizePageSize(options?.pageSize);
      const operatorId = options?.operatorId ?? 0n;
      const now = new Date();
      const roundStartedAt = new Date();

      const sourceId = await this.ensureDataSource(operatorId);
      const sourceType = Number(sourceId);
      if (!Number.isSafeInteger(sourceType) || sourceType > 255) {
        throw new UnprocessableEntityException(
          `数据源 id=${sourceId} 超出客户 source_type(tinyint) 范围，请调整字段类型`,
        );
      }

      const startTime = this.resolveStartTime(options);
      stats.startTime = startTime ?? '';

      let page = 1;
      let guard = 0;
      while (guard < USER_SYNC_MAX_PAGES) {
        guard += 1;
        const query: { page: number; limit: number; start_time?: string } = {
          page,
          limit: pageSize,
        };
        if (startTime) query.start_time = startTime;

        const data = await this.shifangQingyuan.getUserList(query);
        const list = data.list ?? [];
        if (list.length === 0) break;

        stats.fetched += list.length;
        const orgMap = await this.loadOrgMappings(sourceId, list);
        await this.mapPool(list, USER_SYNC_WRITE_CONCURRENCY, async (item) => {
          try {
            await this.saveCustomer({
              item,
              sourceType,
              orgMap,
              operatorId,
              now,
              stats,
            });
          } catch (error) {
            if (this.isFatalSyncError(error)) throw error;
            stats.failed += 1;
            const userId = item.user?.id;
            const message = error instanceof Error ? error.message : String(error);
            stats.warnings.push(`user.id=${userId}: ${message}`);
            ShifangQingyuanUserSyncService.logger.error(
              `同步用户失败 id=${userId}: ${message}`,
            );
          }
        });

        if (list.length < pageSize) break;
        page += 1;
      }

      if (stats.failed === 0) {
        this.lastRoundStartedAt = roundStartedAt;
      } else {
        ShifangQingyuanUserSyncService.logger.warn(
          `十方清源用户同步有 ${stats.failed} 条失败，本轮不前进水位以便重试`,
        );
      }
      ShifangQingyuanUserSyncService.logger.log(
        `十方清源用户同步完成 startTime=${stats.startTime || '(full)'} fetched=${stats.fetched} created=${stats.created} updated=${stats.updated} failed=${stats.failed}`,
      );
      return stats;
    } finally {
      this.running = false;
    }
  }

  /** @deprecated 使用 buildCustomerLevels；保留便于单测直接调用 */
  buildLevels(item: ShifangQingyuanUserItem): string[] {
    return buildCustomerLevels(item);
  }

  private resolveStartTime(options?: ShifangQingyuanUserSyncOptions): string | undefined {
    if (options?.full) return undefined;
    if (options?.startTime !== undefined) {
      return this.formatDateTime(options.startTime);
    }
    if (!this.lastRoundStartedAt) return undefined;
    const overlapped = new Date(this.lastRoundStartedAt.getTime() - SHIFANG_QINGYUAN_USER_SYNC_OVERLAP_MS);
    return this.formatDateTime(overlapped);
  }

  private async loadOrgMappings(
    sourceId: bigint,
    items: ShifangQingyuanUserItem[],
  ): Promise<Map<number, bigint>> {
    const mallIds = [
      ...new Set(
        items
          .map((item) => Number(item.user?.mall_id ?? 0))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];
    if (!mallIds.length) return new Map();

    const mappings = await this.prisma.hspsi_sys_organization_mapping.findMany({
      where: {
        source_id: sourceId,
        source_object_id: { in: mallIds.map(String) },
        deleted_at: null,
      },
      select: { source_object_id: true, org_id: true },
    });
    const map = new Map<number, bigint>();
    for (const row of mappings) {
      const sourceMallId = Number(row.source_object_id);
      if (!(row.org_id > 0n) || !Number.isFinite(sourceMallId)) continue;
      map.set(sourceMallId, row.org_id);
    }
    return map;
  }

  private async saveCustomer(input: {
    item: ShifangQingyuanUserItem;
    sourceType: number;
    orgMap: Map<number, bigint>;
    operatorId: bigint;
    now: Date;
    stats: ShifangQingyuanUserSyncStats;
  }): Promise<void> {
    const user = input.item.user;
    if (!user) {
      throw new UnprocessableEntityException('用户列表元素缺少 user');
    }
    const userId = BigInt(user.id ?? 0);
    if (userId < 1n) {
      throw new UnprocessableEntityException('用户缺少有效 id');
    }

    const rawMallId = user.mall_id;
    if (rawMallId === undefined || rawMallId === null) {
      throw new UnprocessableEntityException('用户缺少 mall_id');
    }
    const sourceMallId = Number(rawMallId);
    if (!Number.isFinite(sourceMallId) || sourceMallId < 1) {
      throw new UnprocessableEntityException(`用户 mall_id 无效: ${String(rawMallId)}`);
    }
    const orgId = input.orgMap.get(sourceMallId);
    if (!orgId) {
      throw new UnprocessableEntityException(`机构未映射: mall_id=${sourceMallId}`);
    }

    const existing = await this.prisma.hspsi_basic_customer.findFirst({
      where: {
        source_type: input.sourceType,
        related_customer_id: userId,
        deleted_at: null,
      },
    });

    const name = this.clip(this.resolveName(user, userId), 100);
    const mobile = this.clip(String(user.mobile ?? ''), 20);
    const levels = buildCustomerLevels(input.item) as unknown as Prisma.InputJsonValue;
    const birthday = this.parseBirth(user.birthday);
    const status = Number(user.status ?? 1) === 0 ? 2 : 1;
    const data = {
      org_id: orgId,
      name,
      mobile,
      birthday,
      referrer_name: this.clip(
        String(user.parent_nickname || user.parent_username || ''),
        32,
      ),
      referrer_mobile: this.clip(String(user.parent_mobile || ''), 20),
      status,
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
        gender: 0,
        address: '',
        remark: '',
        sort: 0,
        created_by: input.operatorId,
        created_at: input.now,
      },
    });
    input.stats.created += 1;
  }

  private resolveName(
    user: { nickname?: string; username?: string },
    userId: bigint,
  ): string {
    const nickname = String(user.nickname ?? '').trim();
    if (nickname) return nickname;
    const username = String(user.username ?? '').trim();
    if (username) return username;
    return `十方用户${userId}`;
  }

  private async ensureDataSource(operatorId: bigint): Promise<bigint> {
    const existing = await this.prisma.hspsi_sys_data_source.findUnique({
      where: { code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE },
    });
    if (existing) {
      if (existing.deleted_at || existing.status !== 1) {
        throw new UnprocessableEntityException('十方清源数据源已停用或删除，请先在系统中启用');
      }
      return existing.id;
    }
    const created = await this.prisma.hspsi_sys_data_source.create({
      data: {
        code: SHIFANG_QINGYUAN_DATA_SOURCE_CODE,
        name: SHIFANG_QINGYUAN_DATA_SOURCE_NAME,
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
    const raw = Number(pageSize ?? SHIFANG_QINGYUAN_USER_SYNC_DEFAULT_PAGE_SIZE);
    if (!Number.isFinite(raw) || raw < 1) return SHIFANG_QINGYUAN_USER_SYNC_DEFAULT_PAGE_SIZE;
    return Math.min(SHIFANG_QINGYUAN_USER_SYNC_MAX_PAGE_SIZE, Math.floor(raw));
  }

  private parseBirth(birth?: string): Date | null {
    const text = String(birth ?? '').trim();
    if (!text) return null;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  private formatDateTime(value: Date | string): string {
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) {
        throw new UnprocessableEntityException('startTime 不能为空');
      }
      return text;
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }

  private clip(value: string, max: number): string {
    return value.length <= max ? value : value.slice(0, max);
  }

  private emptyStats(): ShifangQingyuanUserSyncStats {
    return {
      fetched: 0,
      created: 0,
      updated: 0,
      failed: 0,
      startTime: '',
      warnings: [],
    };
  }
}
