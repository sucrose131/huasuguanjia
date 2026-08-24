export type ShifangQingyuanAgentOrderSyncStats = {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  outputs: number;
  exits: number;
  warnings: string[];
  failures: Array<{ sourceOrderId: string; orderNo: string; reason: string }>;
};

export type ShifangQingyuanAgentOrderSyncOptions = {
  start_time?: string;
  end_time?: string;
  page?: number;
  limit?: number;
  order_no?: string;
};
