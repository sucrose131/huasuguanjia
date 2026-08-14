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

export type HuasuHomeOrderSyncOptions = {
  /**
   * 增量起点（Y-m-d H:i:s）。不传则：
   * 若该类型存在失败映射，取其中最小 source_updated_at（避免失败单被后续成功单越过）；
   * 否则取成功映射的最大 source_updated_at；仍无则 `1970-01-01 00:00:00`
   */
  updated_at?: string;
  /** 每页数量，默认 200，最大 1000 */
  page_size?: number;
};
