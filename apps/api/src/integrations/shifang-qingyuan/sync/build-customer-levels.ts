import type { CustomerIdentityLevels, ShifangQingyuanUserItem } from '../shifang-qingyuan.types';

/** 构建身份标签所需的最小字段（用户列表元素） */
export type ShifangQingyuanIdentitySource = Pick<
  ShifangQingyuanUserItem,
  'user' | 'user_level' | 'cloud_stock_agent'
>;

/**
 * 从十方用户构建客户 levels（中文标签数组，去重）
 * 例：["经销商","城市合伙人"]
 */
export function buildCustomerLevels(item: ShifangQingyuanIdentitySource): CustomerIdentityLevels {
  const levels: string[] = [];

  const memberName = String(item.user?.level_name ?? item.user_level?.name ?? '').trim();
  if (memberName) {
    levels.push(memberName);
  }

  const agentName = String(item.cloud_stock_agent?.level_name ?? '').trim();
  if (agentName && agentName !== memberName) {
    levels.push(agentName);
  }

  return levels;
}
