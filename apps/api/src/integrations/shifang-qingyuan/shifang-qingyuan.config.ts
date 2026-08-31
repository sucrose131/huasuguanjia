import { ConfigService } from '@nestjs/config';

/**
 * 十方清源配置
 * 凭证走 .env 环境变量
 *
 * 认证方式：x-mall-sign + Host 请求头（对应 goods-api.md 认证章节）
 */
export const SHIFANG_QINGYUAN_CONFIG_KEYS = {
  BASE_URL: 'SHIFANG_QINGYUAN_BASE_URL',
  MALL_SIGN: 'SHIFANG_QINGYUAN_MALL_SIGN',
  HOST: 'SHIFANG_QINGYUAN_HOST',
} as const;

export type ShifangQingyuanConfig = typeof SHIFANG_QINGYUAN_CONFIG_KEYS;

export { ConfigService };
