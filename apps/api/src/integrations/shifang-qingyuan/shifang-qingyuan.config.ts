import { ConfigService } from '@nestjs/config';

/**
 * 十方清源配置
 * 凭证走 .env 环境变量
 */
export const SHIFANG_QINGYUAN_CONFIG_KEYS = {
  BASE_URL: 'SHIFANG_QINGYUAN_BASE_URL',
  APP_ID: 'SHIFANG_QINGYUAN_APP_ID',
  APP_SECRET: 'SHIFANG_QINGYUAN_APP_SECRET',
} as const;

export type ShifangQingyuanConfig = typeof SHIFANG_QINGYUAN_CONFIG_KEYS;

export { ConfigService };
