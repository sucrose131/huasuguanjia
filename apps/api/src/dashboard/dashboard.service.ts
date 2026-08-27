import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuthUser } from '../auth/auth.types';

type Query = Record<string, string | undefined>;

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private hasPermission(user: AuthUser, permission: string) {
    return user.permissions.includes('*') || user.permissions.includes(permission);
  }

  private hasModulePermission(user: AuthUser, module: string) {
    return (
      user.permissions.includes('*') ||
      user.permissions.some(
        (permission) => permission === module || permission.startsWith(`${module}:`),
      )
    );
  }

  private modules(user: AuthUser) {
    return {
      sales: this.hasModulePermission(user, 'sales'),
      purchase: this.hasModulePermission(user, 'purchase'),
      inventory: this.hasModulePermission(user, 'inventory'),
      production: this.hasModulePermission(user, 'production'),
      todos: this.hasPermission(user, 'dashboard:2:view'),
      messages: this.hasPermission(user, 'dashboard:3:view'),
      shortcuts: this.hasPermission(user, 'dashboard:4:view'),
    };
  }

  private widgets(user: AuthUser) {
    const modules = this.modules(user);
    const enabled = (key: string) => this.hasPermission(user, `dashboard:overview:widget:${key}`);
    return {
      salesAmount: enabled('sales-amount') && modules.sales,
      purchaseAmount: enabled('purchase-amount') && modules.purchase,
      inventoryValue: enabled('inventory-value') && modules.inventory,
      pendingCount: enabled('pending-count') && modules.todos,
      businessTrend: enabled('business-trend') && (modules.sales || modules.purchase),
      inventoryHealth: enabled('inventory-health') && modules.inventory,
      todoPreview: enabled('todo-preview') && modules.todos,
      quickActions: enabled('quick-actions') && modules.shortcuts,
      messageSummary: enabled('message-summary') && modules.messages,
    };
  }

  private authorizedOrgIds(user: AuthUser) {
    return [
      ...new Set(
        [
          user.orgId,
          ...(user.authorizedOrganizations ?? []).map((organization) => organization.id),
        ].filter((value): value is string => Boolean(value && value !== '0')),
      ),
    ];
  }

  private orgWhere(user: AuthUser) {
    if (user.permissions.includes('*')) return {};
    const ids = this.authorizedOrgIds(user);
    return { org_id: { in: ids.map((id) => BigInt(id)) } };
  }

  private async authorizedWarehouseIds(user: AuthUser) {
    const warehouses = await this.prisma.hspsi_basic_warehouse.findMany({
      where: { ...this.orgWhere(user), status: 1, deleted_at: null },
      select: { warehouse_id: true },
    });
    return warehouses.map((warehouse) => warehouse.warehouse_id);
  }

  private routePermission(route: string) {
    const [module, resource] = route.split('/').filter(Boolean);
    return module && resource ? `${module}:${resource}` : '';
  }

  private canOpenRoute(user: AuthUser, route: string) {
    const permission = this.routePermission(route);
    return Boolean(permission && this.hasPermission(user, permission));
  }

  private async pendingAdjustments(user: AuthUser) {
    if (user.permissions.includes('*'))
      return this.prisma.hspsi_inventory_adjust.findMany({
        where: { approve_status: 0, deleted_at: null },
        orderBy: { created_at: 'desc' },
      });
    const warehouseIds = await this.authorizedWarehouseIds(user);
    if (!warehouseIds.length) return [];
    const details = await this.prisma.hspsi_inventory_adjust_detail.findMany({
      where: { warehouse_id: { in: warehouseIds } },
      select: { adjust_id: true },
    });
    const ids = [...new Set(details.map((detail) => detail.adjust_id))];
    if (!ids.length) return [];
    return this.prisma.hspsi_inventory_adjust.findMany({
      where: { adjust_id: { in: ids }, approve_status: 0, deleted_at: null },
      orderBy: { created_at: 'desc' },
    });
  }

  private monthRange() {
    const current = this.day(new Date());
    const year = Number(current.slice(0, 4));
    const month = Number(current.slice(5, 7));
    return {
      start: new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+08:00`),
      end: new Date(
        new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+08:00`).setMonth(month),
      ),
    };
  }

  private day(value: Date | null | undefined) {
    return value
      ? new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(value)
      : '';
  }

  async overview(user: AuthUser) {
    const access = this.access(user);
    const [metrics, trend, inventoryHealth, todoResult, messageResult] = await Promise.all([
      this.metrics(user),
      this.trend(user),
      this.inventoryHealth(user),
      access.widgets.todoPreview
        ? this.todos(user, { page: '1', pageSize: '5' })
        : Promise.resolve({ items: [] }),
      access.widgets.messageSummary
        ? this.messages(user, { page: '1', pageSize: '2' })
        : Promise.resolve({ items: [], unreadCount: 0 }),
    ]);
    return {
      ...access,
      ...metrics,
      ...inventoryHealth,
      trend,
      todos: todoResult.items,
      messages: messageResult.items,
      unreadCount: messageResult.unreadCount,
    };
  }

  access(user: AuthUser) {
    return {
      modules: this.modules(user),
      widgets: this.widgets(user),
    };
  }

  async metrics(user: AuthUser) {
    const widgets = this.widgets(user);
    const { start, end } = this.monthRange();
    const org = this.orgWhere(user);
    const [sales, purchases, inventory, pendingCount] = await Promise.all([
      widgets.salesAmount
        ? this.prisma.hspsi_sale_order.aggregate({
            where: { ...org, created_at: { gte: start, lt: end }, deleted_at: null },
            _sum: { fact_amount: true },
          })
        : Promise.resolve({ _sum: { fact_amount: null } }),
      widgets.purchaseAmount
        ? this.prisma.hspsi_purchase_order.aggregate({
            where: { ...org, created_at: { gte: start, lt: end }, deleted_at: null },
            _sum: { pay_amout: true },
          })
        : Promise.resolve({ _sum: { pay_amout: null } }),
      widgets.inventoryValue
        ? this.prisma.hspsi_inventory_total.aggregate({
            where: { ...org, deleted_at: null },
            _sum: { inventory_amount: true },
          })
        : Promise.resolve({ _sum: { inventory_amount: null } }),
      widgets.pendingCount ? this.pendingCounts(user) : Promise.resolve(0),
    ]);
    return {
      salesAmount: widgets.salesAmount ? Number(sales._sum.fact_amount ?? 0) : null,
      purchaseAmount: widgets.purchaseAmount ? Number(purchases._sum.pay_amout ?? 0) : null,
      inventoryValue: widgets.inventoryValue ? Number(inventory._sum.inventory_amount ?? 0) : null,
      pendingCount,
    };
  }

  async trend(user: AuthUser) {
    const modules = this.modules(user);
    const widgets = this.widgets(user);
    const org = this.orgWhere(user);
    const trendStart = new Date(`${this.day(new Date())}T00:00:00+08:00`);
    trendStart.setDate(trendStart.getDate() - 13);
    const [salesTrendRows, purchaseTrendRows] = await Promise.all([
      widgets.businessTrend && modules.sales
        ? this.prisma.hspsi_sale_order.findMany({
            where: { ...org, created_at: { gte: trendStart }, deleted_at: null },
            select: { created_at: true, fact_amount: true },
          })
        : Promise.resolve([]),
      widgets.businessTrend && modules.purchase
        ? this.prisma.hspsi_purchase_order.findMany({
            where: { ...org, created_at: { gte: trendStart }, deleted_at: null },
            select: { created_at: true, pay_amout: true },
          })
        : Promise.resolve([]),
    ]);
    const trendMap = new Map<string, { date: string; sales: number; purchase: number }>();
    for (let index = 0; index < 14; index += 1) {
      const value = new Date(trendStart);
      value.setDate(value.getDate() + index);
      const date = this.day(value);
      trendMap.set(date, { date, sales: 0, purchase: 0 });
    }
    salesTrendRows.forEach((row) => {
      const date = this.day(row.created_at);
      if (date && trendMap.has(date)) trendMap.get(date)!.sales += Number(row.fact_amount);
    });
    purchaseTrendRows.forEach((row) => {
      const date = this.day(row.created_at);
      if (date && trendMap.has(date)) trendMap.get(date)!.purchase += Number(row.pay_amout);
    });
    return [...trendMap.values()].map((item) => ({
      date: item.date,
      sales: widgets.businessTrend && modules.sales ? item.sales : null,
      purchase: widgets.businessTrend && modules.purchase ? item.purchase : null,
    }));
  }

  async inventoryHealth(user: AuthUser) {
    const widgets = this.widgets(user);
    if (!widgets.inventoryHealth)
      return {
        lowStockCount: 0,
        inventoryCount: 0,
        healthScore: 0,
        lowStockItem: null,
      };
    const org = this.orgWhere(user);
    const warehouseIds = await this.authorizedWarehouseIds(user);
    const [lowStockCount, inventoryCount, alertRows] = await Promise.all([
      warehouseIds.length
        ? this.prisma.hspsi_inventory_alert_qty.count({
            where: { warehouse_id: { in: warehouseIds }, safe_less_qty: { gt: 0 } },
          })
        : 0,
      this.prisma.hspsi_inventory_total.count({ where: { ...org, deleted_at: null } }),
      warehouseIds.length
        ? this.prisma.hspsi_inventory_alert_qty.findMany({
            where: { warehouse_id: { in: warehouseIds }, safe_less_qty: { gt: 0 } },
            take: 1,
            orderBy: { safe_less_qty: 'desc' },
          })
        : [],
    ]);
    let lowStockItem: Record<string, unknown> | null = null;
    if (alertRows[0]) {
      const [goods, warehouse] = await Promise.all([
        this.prisma.hspsi_goods_info.findFirst({ where: { goods_id: alertRows[0].goods_id } }),
        this.prisma.hspsi_basic_warehouse.findFirst({
          where: { warehouse_id: Number(alertRows[0].warehouse_id) },
        }),
      ]);
      lowStockItem = {
        goodsId: String(alertRows[0].goods_id),
        skuId: String(alertRows[0].sku_id),
        name: goods?.goods_name ?? `商品 #${alertRows[0].goods_id}`,
        warehouse: warehouse?.name ?? '',
        stock: Number(alertRows[0].fact_qty),
        safetyStock: Number(alertRows[0].safe_qty),
        suggestedPurchaseQty: Number(alertRows[0].purchase_qty),
      };
    }
    return {
      lowStockCount,
      inventoryCount,
      healthScore: inventoryCount
        ? Math.max(
            0,
            Math.round((1 - Math.min(lowStockCount, inventoryCount) / inventoryCount) * 100),
          )
        : 0,
      lowStockItem,
    };
  }

  private async pendingCounts(user: AuthUser) {
    const org = this.orgWhere(user);
    const values = await Promise.all([
      this.canOpenRoute(user, '/purchase/applications')
        ? this.prisma.hspsi_purchase_approve.count({
            where: { ...org, approve_status: 0, deleted_at: null },
          })
        : 0,
      this.canOpenRoute(user, '/sales/orders')
        ? this.prisma.hspsi_sale_order.count({
            where: { ...org, approve_status: 0, deleted_at: null },
          })
        : 0,
      this.canOpenRoute(user, '/requisitions/applications')
        ? this.prisma.hspsi_draw_approve.count({
            where: { ...org, approve_status: 0, deleted_at: null },
          })
        : 0,
      this.canOpenRoute(user, '/production/plans')
        ? this.prisma.hspsi_production_plan.count({
            where: { ...org, approve_status: 0, deleted_at: null },
          })
        : 0,
      this.canOpenRoute(user, '/inventory/transfers')
        ? this.prisma.hspsi_inventory_transfer.count({
            where: { ...org, approve_status: 0, deleted_at: null },
          })
        : 0,
      this.canOpenRoute(user, '/inventory/checks')
        ? this.prisma.hspsi_inventory_check.count({
            where: { ...org, approve_status: 0, deleted_at: null },
          })
        : 0,
      this.canOpenRoute(user, '/inventory/losses')
        ? this.prisma.hspsi_inventory_loss.count({
            where: { ...org, business_kind: 2, approve_status: 0, deleted_at: null },
          })
        : 0,
      this.canOpenRoute(user, '/inventory/loss-outputs')
        ? this.prisma.hspsi_inventory_loss_output.count({
            where: {
              ...org,
              source_check_id: { gt: 0 },
              status: 0,
              approve_status: 0,
              deleted_at: null,
            },
          })
        : 0,
      this.canOpenRoute(user, '/inventory/overflows')
        ? this.prisma.hspsi_inventory_overflow.count({
            where: { ...org, source_check_id: { gt: 0 }, approve_status: 0, deleted_at: null },
          })
        : 0,
      this.canOpenRoute(user, '/inventory/adjustments')
        ? this.pendingAdjustments(user).then((items) => items.length)
        : 0,
    ]);
    return values.reduce((sum, value) => sum + value, 0);
  }

  /** 持久化待办（hspsi_sys_todo）的跳转路由映射，按 source_type/business_type 匹配 */
  private todoRoute(item: Record<string, any>) {
    const businessId = String(item.business_id || item.source_id || '');
    const type = item.source_type || item.business_type || '';
    if (!businessId) return '';
    if (type === 'purchase_order' || type === 'purchase_receipt')
      return `/purchase/orders?viewId=${businessId}`;
    if (type === 'purchase_application') return `/purchase/applications?viewId=${businessId}`;
    if (type === 'draw_approve') return `/requisitions/applications?viewId=${businessId}`;
    if (type === 'draw_approve_output') return `/requisitions/outputs?viewId=${businessId}`;
    return '';
  }

  async todos(user: AuthUser, query: Query) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const keyword = String(query.keyword ?? '').trim();
    const sourceType = String(query.sourceType ?? '').trim();
    const org = this.orgWhere(user);
    const stored = await this.prisma.hspsi_sys_todo.findMany({
      where: { user_id: Number(user.id), status: 0, deleted_at: null },
      orderBy: { created_at: 'desc' },
    });
    const storedRows = stored.map((item) => ({
      id: `todo-${item.id}`,
      sourceId: String(item.business_id || item.source_id || item.id),
      docNo: item.title,
      docType: item.business_type || item.source_type || '待办事项',
      businessModule: item.source_type || '工作台',
      counterparty: item.content,
      date: this.day(item.created_at),
      amount: null,
      creator: item.created_by ? String(item.created_by) : '',
      status: '待处理',
      route: this.todoRoute(item),
      createdAt: item.created_at,
    }));

    const [
      purchase,
      sales,
      production,
      transfers,
      checks,
      losses,
      lossOutputs,
      overflows,
      adjustments,
    ] = await Promise.all([
      this.canOpenRoute(user, '/purchase/applications')
        ? this.prisma.hspsi_purchase_approve.findMany({
            where: { ...org, approve_status: 0, deleted_at: null },
            orderBy: { created_at: 'desc' },
          })
        : Promise.resolve([]),
      this.canOpenRoute(user, '/sales/orders')
        ? this.prisma.hspsi_sale_order.findMany({
            where: { ...org, approve_status: 0, deleted_at: null },
            orderBy: { created_at: 'desc' },
          })
        : Promise.resolve([]),
      this.canOpenRoute(user, '/production/plans')
        ? this.prisma.hspsi_production_plan.findMany({
            where: { ...org, approve_status: 0, deleted_at: null },
            orderBy: { created_at: 'desc' },
          })
        : Promise.resolve([]),
      this.canOpenRoute(user, '/inventory/transfers')
        ? this.prisma.hspsi_inventory_transfer.findMany({
            where: { ...org, approve_status: 0, deleted_at: null },
            orderBy: { created_at: 'desc' },
          })
        : Promise.resolve([]),
      this.canOpenRoute(user, '/inventory/checks')
        ? this.prisma.hspsi_inventory_check.findMany({
            where: { ...org, approve_status: 0, deleted_at: null },
            orderBy: { created_at: 'desc' },
          })
        : Promise.resolve([]),
      this.canOpenRoute(user, '/inventory/losses')
        ? this.prisma.hspsi_inventory_loss.findMany({
            where: { ...org, business_kind: 2, approve_status: 0, deleted_at: null },
            orderBy: { created_at: 'desc' },
          })
        : Promise.resolve([]),
      this.canOpenRoute(user, '/inventory/loss-outputs')
        ? this.prisma.hspsi_inventory_loss_output.findMany({
            where: {
              ...org,
              source_check_id: { gt: 0 },
              status: 0,
              approve_status: 0,
              deleted_at: null,
            },
            orderBy: { created_at: 'desc' },
          })
        : Promise.resolve([]),
      this.canOpenRoute(user, '/inventory/overflows')
        ? this.prisma.hspsi_inventory_overflow.findMany({
            where: { ...org, source_check_id: { gt: 0 }, approve_status: 0, deleted_at: null },
            orderBy: { created_at: 'desc' },
          })
        : Promise.resolve([]),
      this.canOpenRoute(user, '/inventory/adjustments')
        ? this.pendingAdjustments(user)
        : Promise.resolve([]),
    ]);
    const row = (
      values: Partial<Record<string, unknown>> & {
        id: string;
        docNo: string;
        docType: string;
        businessModule: string;
        route: string;
        createdAt: Date | null;
      },
    ) => ({
      counterparty: '',
      date: this.day(values.createdAt),
      amount: null,
      creator: '',
      status: '待审批',
      ...values,
    });
    const generated = [
      ...purchase.map((item) =>
        row({
          id: `purchase-${item.pur_id}`,
          sourceId: String(item.pur_id),
          docNo: item.pur_no,
          docType: '采购申请',
          businessModule: '采购管理',
          route: '/purchase/applications',
          creator: String(item.created_by),
          createdAt: item.created_at,
        }),
      ),
      ...sales.map((item) =>
        row({
          id: `sales-${item.so_id}`,
          sourceId: String(item.so_id),
          docNo: item.so_no,
          docType: '销售订单',
          businessModule: '销售管理',
          route: '/sales/orders',
          counterparty: item.customer_name,
          amount: Number(item.fact_amount),
          creator: String(item.created_by ?? ''),
          createdAt: item.created_at,
        }),
      ),
      ...production.map((item) =>
        row({
          id: `production-${item.plan_id}`,
          sourceId: String(item.plan_id),
          docNo: item.plan_no,
          docType: '生产计划单',
          businessModule: '生产管理',
          route: '/production/plans',
          creator: String(item.created_by),
          createdAt: item.created_at,
        }),
      ),
      ...transfers.map((item) =>
        row({
          id: `transfer-${item.transfer_id}`,
          sourceId: String(item.transfer_id),
          docNo: item.transfer_no,
          docType: '库存调拨单',
          businessModule: '库存管理',
          route: '/inventory/transfers',
          creator: String(item.created_by),
          createdAt: item.created_at,
        }),
      ),
      ...checks.map((item) =>
        row({
          id: `check-${item.check_id}`,
          sourceId: String(item.check_id),
          docNo: item.check_no ?? `#${item.check_id}`,
          docType: '库存盘点',
          businessModule: '库存管理',
          route: '/inventory/checks',
          creator: String(item.created_by),
          createdAt: item.created_at,
        }),
      ),
      ...losses.map((item) =>
        row({
          id: `loss-${item.loss_id}`,
          sourceId: String(item.loss_id),
          docNo: item.loss_no,
          docType: '报损出库单',
          businessModule: '库存管理',
          route: '/inventory/losses',
          amount: Number(item.loss_total_amount),
          creator: String(item.created_by),
          createdAt: item.created_at,
        }),
      ),
      ...lossOutputs.map((item) => ({
        ...row({
          id: `loss-output-${item.loss_id}`,
          sourceId: String(item.loss_id),
          docNo: item.loss_no,
          docType: '报亏出库单',
          businessModule: '库存管理',
          route: '/inventory/loss-outputs',
          amount: Number(item.loss_total_amount),
          creator: String(item.created_by),
          createdAt: item.created_at,
        }),
        status: '待出库',
      })),
      ...overflows.map((item) =>
        row({
          id: `overflow-${item.overflow_id}`,
          sourceId: String(item.overflow_id),
          docNo: item.overflow_no,
          docType: '报盈入库单',
          businessModule: '库存管理',
          route: '/inventory/overflows',
          amount: Number(item.overflow_total_amount),
          creator: String(item.created_by),
          createdAt: item.created_at,
        }),
      ),
      ...adjustments.map((item) =>
        row({
          id: `adjust-${item.adjust_id}`,
          sourceId: String(item.adjust_id),
          docNo: item.adjust_no,
          docType: '库存调整记录',
          businessModule: '库存管理',
          route: '/inventory/adjustments',
          creator: String(item.created_by),
          createdAt: item.created_at,
        }),
      ),
    ];
    const permittedGenerated = generated.filter((item) => this.canOpenRoute(user, item.route));
    let result = [...storedRows, ...permittedGenerated].sort((left, right) =>
      String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')),
    );
    if (keyword)
      result = result.filter((item) =>
        [item.docNo, item.docType, item.businessModule, item.counterparty]
          .join(' ')
          .includes(keyword),
      );
    if (sourceType)
      result = result.filter(
        (item) => item.businessModule === sourceType || item.docType === sourceType,
      );
    return {
      items: result.slice((page - 1) * pageSize, page * pageSize),
      total: result.length,
      page,
      pageSize,
    };
  }

  async messages(user: AuthUser, query: Query) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const category = String(query.category ?? '');
    const userId = Number(user.id);
    const all = await this.prisma.hspsi_sys_message.findMany({
      where: { user_id: userId, deleted_at: null },
      orderBy: { created_at: 'desc' },
    });
    const notices = all.length
      ? await this.prisma.hspsi_sys_notice.findMany({
          where: { id: { in: [...new Set(all.map((item) => item.notice_id))] }, deleted_at: null },
        })
      : [];
    const noticeMap = new Map(notices.map((notice) => [notice.id, notice]));
    const rows: Array<Record<string, any>> = all.map((message) => {
      const notice = noticeMap.get(message.notice_id);
      const messageCategory =
        (notice?.level ?? 1) >= 2
          ? '预警消息'
          : notice?.source_type === 2
            ? '审批消息'
            : '业务消息';
      return {
        id: String(message.id),
        title: notice?.title ?? '系统消息',
        content: notice?.content ?? '',
        category: messageCategory,
        isRead: message.is_read,
        readTime: message.read_time,
        createdAt: message.created_at,
      };
    });
    // 各类消息总数（基于全量未过滤数据，供前端侧栏徽标使用，不受当前分类/分页影响）
    const categoryCounts = {
      审批消息: rows.filter((item) => item.category === '审批消息').length,
      预警消息: rows.filter((item) => item.category === '预警消息').length,
      业务消息: rows.filter((item) => item.category === '业务消息').length,
    };
    let result = rows;
    if (category && category !== '全部消息')
      result = result.filter((item) => item.category === category);
    return {
      items: result.slice((page - 1) * pageSize, page * pageSize),
      total: result.length,
      page,
      pageSize,
      unreadCount: all.filter((item) => item.is_read === 0).length,
      categoryCounts,
    };
  }

  async readMessage(user: AuthUser, id: string) {
    const message = await this.prisma.hspsi_sys_message.findFirst({
      where: { id: Number(id), deleted_at: null },
    });
    if (!message) throw new NotFoundException('消息不存在');
    if (message.user_id !== Number(user.id)) throw new ForbiddenException('不能操作其他用户的消息');
    await this.prisma.hspsi_sys_message.update({
      where: { id: message.id },
      data: { is_read: 1, read_time: new Date(), updated_by: Number(user.id) },
    });
    return { id, message: '消息已标记为已读' };
  }
}
