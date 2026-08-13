import type { CustomerIdentityLevels } from '../huasu-home.types';

export interface HuasuHomeUserSyncStats {
  fetched: number;
  created: number;
  updated: number;
  failed: number;
  /** 本轮起始水位（请求传入的最小用户 ID） */
  afterUserId: number;
  /** 本轮结束后水位（已处理到的最大用户 ID） */
  lastUserId: number;
  warnings: string[];
}

export type { CustomerIdentityLevels };
