import { describe, expect, it } from 'vitest';
import { inferRequestPermissions } from './request-permission';

describe('inferRequestPermissions', () => {
  it('区分采购申请查看、新增、提交和审核', () => {
    expect(
      inferRequestPermissions({ method: 'GET', originalUrl: '/api/purchase/applications/7' }),
    ).toEqual(['purchase:applications']);
    expect(
      inferRequestPermissions({
        method: 'POST',
        originalUrl: '/api/purchase/applications',
        body: { submit: true },
      }),
    ).toEqual([
      'purchase:applications',
      'purchase:applications:create',
      'purchase:applications:submit',
    ]);
    expect(
      inferRequestPermissions({
        method: 'POST',
        originalUrl: '/api/purchase/applications/7/approve',
      }),
    ).toEqual(['purchase:applications', 'purchase:applications:approve']);
  });

  it('处理专用操作和别名路由', () => {
    expect(
      inferRequestPermissions({
        method: 'POST',
        originalUrl: '/api/requisitions/applications/7/submit-oa',
      }),
    ).toEqual(['requisitions:applications', 'requisitions:applications:submit']);
    expect(
      inferRequestPermissions({ method: 'POST', originalUrl: '/api/purchase/refunds/7/flows' }),
    ).toEqual(['purchase:refunds', 'purchase:refunds:record']);
    expect(
      inferRequestPermissions({ method: 'DELETE', originalUrl: '/api/purchase/refunds/flows/8' }),
    ).toEqual(['purchase:refunds', 'purchase:refunds:void-record']);
    expect(
      inferRequestPermissions({ method: 'POST', originalUrl: '/api/inventory/overflow-inputs/9/confirm' }),
    ).toEqual(['inventory:overflows', 'inventory:overflows:confirm']);
  });

  it('辅助选项接口不猜测页面权限', () => {
    expect(
      inferRequestPermissions({ method: 'GET', originalUrl: '/api/production/product-options' }),
    ).toEqual([]);
  });

  it('只对具有提交动作的页面追加提交权限，并映射生产退料', () => {
    expect(
      inferRequestPermissions({
        method: 'POST',
        originalUrl: '/api/production/plans',
        body: { submit: true },
      }),
    ).toEqual(['production:plans', 'production:plans:create']);
    expect(
      inferRequestPermissions({
        method: 'POST',
        originalUrl: '/api/production/material-returns/8/confirm',
      }),
    ).toEqual(['production:outputs', 'production:outputs:confirm-material-return']);
  });

  it('映射基础资料与商品主档的页面操作', () => {
    expect(
      inferRequestPermissions({ method: 'PATCH', originalUrl: '/api/base-data/organizations/3/status' }),
    ).toEqual(['master-data:companies', 'master-data:companies:status']);
    expect(
      inferRequestPermissions({ method: 'DELETE', originalUrl: '/api/goods/categories/8' }),
    ).toEqual(['goods:categories', 'goods:categories:delete']);
    expect(inferRequestPermissions({ method: 'POST', originalUrl: '/api/goods' })).toEqual([
      'goods:products',
      'goods:products:create',
    ]);
  });
});
