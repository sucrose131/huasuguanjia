import { ConfigService } from '@nestjs/config';

/**
 * 薪福通 OA 配置
 * 凭证走数据库，这里仅声明非凭证配置项
 * 实际读取由各服务通过 ConfigService.getOrThrow 完成
 */
export const XINFUTONG_OA_CONFIG_KEYS = {
  BASE_URL: 'XINFUTONG_OA_BASE_URL',
  APP_ID: 'XINFUTONG_OA_APP_ID', // 指定使用 hspsi_sys_account_set 中的哪套凭证
  EVENT_PUBLIC_KEY: 'XINFUTONG_OA_EVENT_PUBLIC_KEY', // 事件订阅回调验签公钥（130 hex）
} as const;

// 仅用于类型提示，防止拼写错误
export type XinfutongOaConfig = typeof XINFUTONG_OA_CONFIG_KEYS;

// 保持与现有模块风格一致，导出 ConfigService 供注入使用
export { ConfigService };
