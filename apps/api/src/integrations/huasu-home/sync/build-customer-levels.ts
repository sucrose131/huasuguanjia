import {
  HUASU_HOME_CENTENARIAN_TYPE_NAME,
  HUASU_HOME_PROVINCIAL_PARTNER_NAME,
} from '../huasu-home.constants';
import type { CustomerIdentityLevels, HuasuHomeUserLevel } from '../huasu-home.types';

/** 构建身份标签所需的最小用户字段（用户列表 / 订单嵌套用户均可） */
export type HuasuHomeIdentitySource = {
  is_centenarian?: number;
  centenarian_type?: number;
  is_provincial_partner?: number;
  level?: HuasuHomeUserLevel | null;
};

/**
 * 从华溯用户构建客户 levels（中文标签数组）
 * 例：["全家福会员","省级合伙人","百岁加会员-主卡"]
 */
export function buildCustomerLevels(user: HuasuHomeIdentitySource): CustomerIdentityLevels {
  const levels: string[] = [];

  const promoterName = String(user.level?.name ?? '').trim();
  if (promoterName) {
    levels.push(promoterName);
  }

  if (Number(user.is_provincial_partner ?? 0) === 1) {
    levels.push(HUASU_HOME_PROVINCIAL_PARTNER_NAME);
  }

  if (Number(user.is_centenarian ?? 0) === 1) {
    const centenarianType = Number(user.centenarian_type ?? 0);
    const typeName = HUASU_HOME_CENTENARIAN_TYPE_NAME[centenarianType];
    levels.push(typeName ? `百岁加会员-${typeName}` : '百岁加会员');
  }

  return levels;
}
