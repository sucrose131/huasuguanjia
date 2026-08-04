import { ConfigService } from '@nestjs/config';

/**
 * 华溯之家配置
 * 凭证走 .env 环境变量
 */
export const HUASU_HOME_CONFIG_KEYS = {
  BASE_URL: 'HUASU_HOME_BASE_URL',
  APP_ID: 'HUASU_HOME_APP_ID',
  APP_SECRET: 'HUASU_HOME_APP_SECRET',
} as const;

export type HuasuHomeConfig = typeof HUASU_HOME_CONFIG_KEYS;

export { ConfigService };
