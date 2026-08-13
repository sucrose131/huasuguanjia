import { ConfigService } from '@nestjs/config';

/**
 * 华溯之家配置
 * 凭证走 .env 环境变量
 *
 * 注：华溯之家使用 RSA 公钥加密生成签名，不需要 app_id/app_secret
 * 注：用户同步任务参数不走环境变量，后期由数据库配置管理
 */
export const HUASU_HOME_CONFIG_KEYS = {
  BASE_URL: 'HUASU_HOME_BASE_URL',
  PUBLIC_KEY: 'HUASU_HOME_APP_PUBLIC_KEY',
} as const;

export type HuasuHomeConfig = typeof HUASU_HOME_CONFIG_KEYS;

export { ConfigService };
