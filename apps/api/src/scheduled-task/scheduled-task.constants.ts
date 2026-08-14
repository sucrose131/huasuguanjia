export const SCHEDULED_TASK_TIMEZONE = 'Asia/Shanghai';
export const DEFAULT_CRON_EXPR = '0 1 * * *';
export const LAST_MESSAGE_MAX = 500;

export const SCHEDULED_TASK_CODE = {
  HUASU_USERS: 'huasu-home:users',
  HUASU_PRODUCTS: 'huasu-home:products',
  HUASU_ORDERS: 'huasu-home:orders',
  OA_ORG: 'xinfutong-oa:org',
} as const;

export type ScheduledTaskCode = (typeof SCHEDULED_TASK_CODE)[keyof typeof SCHEDULED_TASK_CODE];

export const SCHEDULED_TASK_TYPES: Array<{ code: ScheduledTaskCode; name: string }> = [
  { code: SCHEDULED_TASK_CODE.HUASU_USERS, name: '华溯之家用户同步' },
  { code: SCHEDULED_TASK_CODE.HUASU_PRODUCTS, name: '华溯之家商品同步' },
  { code: SCHEDULED_TASK_CODE.HUASU_ORDERS, name: '华溯之家订单同步' },
  { code: SCHEDULED_TASK_CODE.OA_ORG, name: '薪福通OA组织同步' },
];

export const SCHEDULED_TASK_STATUS = {
  DISABLED: 0,
  ENABLED: 1,
} as const;

export const SCHEDULED_TASK_LAST_STATUS = {
  FAILED: 0,
  SUCCESS: 1,
  SKIPPED: 2,
  RUNNING: 3,
} as const;

export const SCHEDULED_TASK_TRIGGER = {
  CRON: 0,
  MANUAL: 1,
} as const;

/** 可被测试覆盖；生产为 30 分钟超时、失败后 1/5/15 分钟重试。 */
export const SCHEDULED_TASK_RUNTIME = {
  timeoutMs: 30 * 60 * 1000,
  retryDelaysMs: [60_000, 300_000, 900_000],
};

export const SCHEDULED_TASK_PUBLIC_MESSAGE = {
  FAILED: '执行失败，详见服务端日志',
  TIMEOUT: '执行超时，详见服务端日志',
  SKIPPED: '上一轮未结束，已跳过',
  RETRY: '执行失败，将自动重试',
} as const;

export function retryPublicMessage(delayMs: number) {
  const minutes = Math.round(delayMs / 60_000);
  if (minutes >= 1) return `执行失败，将在 ${minutes} 分钟后重试`;
  return SCHEDULED_TASK_PUBLIC_MESSAGE.RETRY;
}
