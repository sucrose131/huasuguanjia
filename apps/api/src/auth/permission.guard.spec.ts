import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from './permission.guard';

function context(request: Record<string, unknown>) {
  return {
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function guard(required = ['purchase']) {
  const reflector = { getAllAndOverride: vi.fn(() => required) };
  return new PermissionGuard(reflector as never);
}

describe('PermissionGuard 菜单内操作权限', () => {
  it('页面查看权限不能代替新增权限', () => {
    const request = {
      method: 'POST',
      originalUrl: '/api/purchase/applications',
      user: { permissions: ['purchase', 'purchase:applications'] },
    };
    expect(() => guard().canActivate(context(request))).toThrow(ForbiddenException);
  });

  it('同时具备页面与操作权限时放行', () => {
    const request = {
      method: 'POST',
      originalUrl: '/api/purchase/applications',
      user: { permissions: ['purchase:applications', 'purchase:applications:create'] },
    };
    expect(guard().canActivate(context(request))).toBe(true);
  });

  it('超级管理员保持全权限，辅助接口仍使用显式权限', () => {
    expect(
      guard().canActivate(
        context({
          method: 'DELETE',
          originalUrl: '/api/purchase/orders/1',
          user: { permissions: ['*'] },
        }),
      ),
    ).toBe(true);
    expect(
      guard(['master-data']).canActivate(
        context({
          method: 'GET',
          originalUrl: '/api/options/dictionaries',
          user: { permissions: ['master-data'] },
        }),
      ),
    ).toBe(true);
  });

  it('拥有模块下页面权限时，options 辅助接口无需目录 code 即可访问', () => {
    const request = {
      method: 'GET',
      originalUrl: '/api/sales/order-options',
      user: { permissions: ['sales:orders'] },
    };
    expect(guard(['sales']).canActivate(context(request))).toBe(true);
  });

  it('主数据读取（商品/基础资料）仅需登录，不校验权限', () => {
    const request = {
      method: 'GET',
      originalUrl: '/api/goods',
      user: { permissions: [] },
    };
    expect(guard(['goods']).canActivate(context(request))).toBe(true);
  });

  it('模块目录权限不能代替具体业务页面权限', () => {
    const request = {
      method: 'GET',
      originalUrl: '/api/purchase/orders',
      user: { permissions: ['purchase', 'purchase:applications'] },
    };
    expect(() => guard().canActivate(context(request))).toThrow(ForbiddenException);
  });
});
