import type { CustomerIdentityLevels } from '../shifang-qingyuan.types';

export interface ShifangQingyuanUserSyncStats {
  fetched: number;
  created: number;
  updated: number;
  failed: number;
  /** 本轮请求的 start_time；首轮/全量为空字符串 */
  startTime: string;
  warnings: string[];
}

export type ShifangQingyuanUserSyncOptions = {
  pageSize?: number;
  operatorId?: bigint;
  /** 覆盖增量水位（Y-m-d H:i:s 或 Date）；与 full 同时传时以 full 为准 */
  startTime?: Date | string;
  /** 强制不传 start_time，分页拉全部 */
  full?: boolean;
};

export type { CustomerIdentityLevels };
