export type ShifangQingyuanOrderSyncStats = {
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
  failures: Array<{ sourceOrderId: string; orderNo: string; reason: string }>;
};

export type ShifangQingyuanOrderSyncOptions = {
  start_time?: string;
  end_time?: string;
  page?: number;
  limit?: number;
  order_no?: string;
  pay_status?: number;
  order_status?: number;
};
