import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../auth/auth.types';
import { DashboardService } from './dashboard.service';

const user = (permissions: string[], organizations = ['1', '2']): AuthUser => ({
  id: '10',
  username: 'tester',
  orgId: '1',
  deptId: null,
  authorizedOrganizations: organizations.map((id) => ({ id, name: `组织${id}` })),
  permissions,
});

describe('DashboardService permission and organization scope', () => {
  it('uses the primary organization and every additionally authorized organization', () => {
    const service = new DashboardService({} as never);
    expect((service as any).orgWhere(user(['inventory:stocks']))).toEqual({
      org_id: { in: [1n, 2n] },
    });
  });

  it('derives dashboard modules from permissions instead of role names', () => {
    const service = new DashboardService({} as never);
    expect(
      (service as any).modules(user(['dashboard:1:view', 'dashboard:2:view', 'purchase:orders'])),
    ).toEqual({
      sales: false,
      purchase: true,
      inventory: false,
      production: false,
      todos: true,
      messages: false,
      shortcuts: false,
    });
  });

  it('shows a dashboard widget only when both the widget and business permissions exist', () => {
    const service = new DashboardService({} as never);
    expect(
      (service as any).widgets(
        user([
          'dashboard:1:view',
          'dashboard:2:view',
          'dashboard:4:view',
          'purchase:orders',
          'sales:orders',
          'dashboard:overview:widget:purchase-amount',
          'dashboard:overview:widget:inventory-value',
          'dashboard:overview:widget:todo-preview',
        ]),
      ),
    ).toEqual({
      salesAmount: false,
      purchaseAmount: true,
      inventoryValue: false,
      pendingCount: false,
      businessTrend: false,
      inventoryHealth: false,
      todoPreview: true,
      quickActions: false,
      messageSummary: false,
    });
  });

  it('does not query data for metric widgets that the role did not select', async () => {
    const prisma = {
      hspsi_sale_order: { aggregate: vi.fn() },
      hspsi_purchase_order: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { pay_amout: 1200 } }),
      },
      hspsi_inventory_total: { aggregate: vi.fn() },
    };
    const service = new DashboardService(prisma as never);
    const result = await service.metrics(
      user(['purchase:orders', 'dashboard:overview:widget:purchase-amount']),
    );

    expect(result).toEqual({
      salesAmount: null,
      purchaseAmount: 1200,
      inventoryValue: null,
      pendingCount: 0,
    });
    expect(prisma.hspsi_purchase_order.aggregate).toHaveBeenCalledOnce();
    expect(prisma.hspsi_sale_order.aggregate).not.toHaveBeenCalled();
    expect(prisma.hspsi_inventory_total.aggregate).not.toHaveBeenCalled();
  });

  it('does not expose a todo route without its page permission', () => {
    const service = new DashboardService({} as never);
    const current = user(['dashboard:2:view', 'purchase:applications']);
    expect((service as any).canOpenRoute(current, '/purchase/applications')).toBe(true);
    expect((service as any).canOpenRoute(current, '/sales/orders')).toBe(false);
  });

  it('limits inventory adjustments through warehouses in authorized organizations', async () => {
    const prisma = {
      hspsi_basic_warehouse: {
        findMany: vi.fn().mockResolvedValue([{ warehouse_id: 11n }]),
      },
      hspsi_inventory_adjust_detail: {
        findMany: vi.fn().mockResolvedValue([{ adjust_id: 101n }, { adjust_id: 101n }]),
      },
      hspsi_inventory_adjust: {
        findMany: vi.fn().mockResolvedValue([{ adjust_id: 101n }]),
      },
    };
    const service = new DashboardService(prisma as never);
    await (service as any).pendingAdjustments(user(['inventory:adjustments']));
    expect(prisma.hspsi_inventory_adjust_detail.findMany).toHaveBeenCalledWith({
      where: { warehouse_id: { in: [11n] } },
      select: { adjust_id: true },
    });
    expect(prisma.hspsi_inventory_adjust.findMany).toHaveBeenCalledWith({
      where: { adjust_id: { in: [101n] }, approve_status: 0, deleted_at: null },
      orderBy: { created_at: 'desc' },
    });
  });
});
