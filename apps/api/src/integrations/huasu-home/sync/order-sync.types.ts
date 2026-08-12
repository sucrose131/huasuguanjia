import type { HuasuHomeOrderListQuery } from '../huasu-home.types';

export type HuasuHomeOrderSyncStats = {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  payments: number;
  outputs: number;
  exits: number;
  events: number;
  warnings: string[];
  failures: Array<{ sourceOrderId: string; orderSn: string; reason: string }>;
};

export type HuasuHomeOrderSyncOptions = Partial<HuasuHomeOrderListQuery> & {
  /**
   * 增量起点（Y-m-d H:i:s）。不传则取本数据源映射表最大 source_updated_at；
   * 若仍无，则默认 `1970-01-01 00:00:00`
   */
  updated_at?: string;
};
