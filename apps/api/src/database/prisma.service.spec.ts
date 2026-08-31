import { describe, expect, it } from 'vitest';
import { scopedOrganizationValue } from './prisma.service';
import { activeDataScope, runWithDataScope } from './data-scope.context';

describe('PrismaService organization scope scalar mapping', () => {
  it('系统待办和通知的 organization_id 使用 Int', () => {
    expect(scopedOrganizationValue('hspsi_sys_todo', '9')).toBe(9);
    expect(scopedOrganizationValue('hspsi_sys_notice', '9')).toBe(9);
  });

  it('业务单据的 org_id 继续使用 BigInt', () => {
    expect(scopedOrganizationValue('hspsi_purchase_order', '9')).toBe(9n);
    expect(scopedOrganizationValue('hspsi_inventory_total', '9')).toBe(9n);
  });

  it('商品主档不再使用历史 org_id 参与通用组织隔离', () => {
    expect(() => scopedOrganizationValue('hspsi_goods_info', '9')).toThrow(
      '模型 hspsi_goods_info 没有组织字段',
    );
  });

  it('普通用户的组织范围由固定组织和人工额外授权组织合并', () => {
    runWithDataScope(
      {
        id: '9',
        username: 'tester',
        orgId: '1',
        deptId: '2',
        authorizedOrganizations: [
          { id: '1', name: '主组织' },
          { id: '8', name: '额外授权组织' },
        ],
        permissions: ['inventory:stocks'],
      },
      () => expect(activeDataScope()?.authorizedOrgIds).toEqual(['1', '8']),
    );
  });
});
