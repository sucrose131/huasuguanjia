import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { AuthUser } from '../auth/auth.types';

type Query = Record<string, string | undefined>;

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private orgWhere(user: AuthUser) {
    if (user.permissions.includes('*')) return {};
    return user.orgId && user.orgId !== '0' ? { org_id: BigInt(user.orgId) } : {};
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
    const { start, end } = this.monthRange();
    const org = this.orgWhere(user);
    const trendStart = new Date(`${this.day(new Date())}T00:00:00+08:00`);
    trendStart.setDate(trendStart.getDate() - 13);
    const [
      sales,
      purchases,
      inventory,
      lowStock,
      inventoryRows,
      salesTrendRows,
      purchaseTrendRows,
      pendingCounts,
      todoResult,
      messageResult,
    ] = await Promise.all([
      this.prisma.hspsi_sale_order.aggregate({
        where: { ...org, created_at: { gte: start, lt: end }, deleted_at: null },
        _sum: { fact_amount: true },
      }),
      this.prisma.hspsi_purchase_order.aggregate({
        where: { ...org, created_at: { gte: start, lt: end }, deleted_at: null },
        _sum: { pay_amout: true },
      }),
      this.prisma.hspsi_inventory_total.aggregate({
        where: { ...org, deleted_at: null },
        _sum: { inventory_amount: true },
      }),
      this.prisma.hspsi_inventory_alert_qty.count({ where: { safe_less_qty: { gt: 0 } } }),
      this.prisma.hspsi_inventory_total.findMany({
        where: { ...org, deleted_at: null },
        select: { goods_id: true, sku_id: true, warehouse_id: true, inventory_qty: true },
      }),
      this.prisma.hspsi_sale_order.findMany({
        where: { ...org, created_at: { gte: trendStart }, deleted_at: null },
        select: { created_at: true, fact_amount: true },
      }),
      this.prisma.hspsi_purchase_order.findMany({
        where: { ...org, created_at: { gte: trendStart }, deleted_at: null },
        select: { created_at: true, pay_amout: true },
      }),
      this.pendingCounts(user),
      this.todos(user, { page: '1', pageSize: '5' }),
      this.messages(user, { page: '1', pageSize: '5' }),
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

    const alertRows = lowStock
      ? await this.prisma.hspsi_inventory_alert_qty.findMany({
          where: { safe_less_qty: { gt: 0 } },
          take: 1,
          orderBy: { safe_less_qty: 'desc' },
        })
      : [];
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

    const totalInventoryRows = inventoryRows.length;
    return {
      salesAmount: Number(sales._sum.fact_amount ?? 0),
      purchaseAmount: Number(purchases._sum.pay_amout ?? 0),
      inventoryValue: Number(inventory._sum.inventory_amount ?? 0),
      pendingCount: pendingCounts,
      lowStockCount: lowStock,
      inventoryCount: totalInventoryRows,
      healthScore: totalInventoryRows
        ? Math.max(
            0,
            Math.round((1 - Math.min(lowStock, totalInventoryRows) / totalInventoryRows) * 100),
          )
        : 0,
      trend: [...trendMap.values()],
      lowStockItem,
      todos: todoResult.items,
      messages: messageResult.items.slice(0, 2),
      unreadCount: messageResult.unreadCount,
    };
  }

  private async pendingCounts(user: AuthUser) {
    const org = this.orgWhere(user);
    const values = await Promise.all([
      this.prisma.hspsi_purchase_approve.count({
        where: { ...org, approve_status: 0, deleted_at: null },
      }),
      this.prisma.hspsi_sale_order.count({
        where: { ...org, approve_status: 0, deleted_at: null },
      }),
      this.prisma.hspsi_draw_approve.count({
        where: { ...org, approve_status: 0, deleted_at: null },
      }),
      this.prisma.hspsi_production_plan.count({
        where: { ...org, approve_status: 0, deleted_at: null },
      }),
      this.prisma.hspsi_inventory_transfer.count({
        where: { ...org, approve_status: 0, deleted_at: null },
      }),
      this.prisma.hspsi_inventory_check.count({
        where: { ...org, approve_status: 0, deleted_at: null },
      }),
      this.prisma.hspsi_inventory_loss.count({
        where: { ...org, business_kind: 2, approve_status: 0, deleted_at: null },
      }),
      this.prisma.hspsi_inventory_loss_output.count({
        where: {
          ...org,
          source_check_id: { gt: 0 },
          status: 0,
          approve_status: 0,
          deleted_at: null,
        },
      }),
      this.prisma.hspsi_inventory_overflow.count({
        where: { ...org, source_check_id: { gt: 0 }, approve_status: 0, deleted_at: null },
      }),
      this.prisma.hspsi_inventory_adjust.count({ where: { approve_status: 0, deleted_at: null } }),
    ]);
    return values.reduce((sum, value) => sum + value, 0);
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
      route: '',
      createdAt: item.created_at,
    }));

    const [
      purchase,
      sales,
      requisitions,
      production,
      transfers,
      checks,
      losses,
      lossOutputs,
      overflows,
      adjustments,
    ] = await Promise.all([
      this.prisma.hspsi_purchase_approve.findMany({
        where: { ...org, approve_status: 0, deleted_at: null },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.hspsi_sale_order.findMany({
        where: { ...org, approve_status: 0, deleted_at: null },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.hspsi_draw_approve.findMany({
        where: { ...org, approve_status: 0, deleted_at: null },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.hspsi_production_plan.findMany({
        where: { ...org, approve_status: 0, deleted_at: null },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.hspsi_inventory_transfer.findMany({
        where: { ...org, approve_status: 0, deleted_at: null },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.hspsi_inventory_check.findMany({
        where: { ...org, approve_status: 0, deleted_at: null },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.hspsi_inventory_loss.findMany({
        where: { ...org, business_kind: 2, approve_status: 0, deleted_at: null },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.hspsi_inventory_loss_output.findMany({
        where: {
          ...org,
          source_check_id: { gt: 0 },
          status: 0,
          approve_status: 0,
          deleted_at: null,
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.hspsi_inventory_overflow.findMany({
        where: { ...org, source_check_id: { gt: 0 }, approve_status: 0, deleted_at: null },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.hspsi_inventory_adjust.findMany({
        where: { approve_status: 0, deleted_at: null },
        orderBy: { created_at: 'desc' },
      }),
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
      ...requisitions.map((item) =>
        row({
          id: `draw-${item.draw_id}`,
          sourceId: String(item.draw_id),
          docNo: item.draw_no,
          docType: '领用申请单',
          businessModule: '领用管理',
          route: '/requisitions/applications',
          creator: String(item.created_by),
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
    let result = [...storedRows, ...generated].sort((left, right) =>
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
    let rows: Array<Record<string, any>> = all.map((message) => {
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
    const org = this.orgWhere(user);
    const [todoResult, stockAlert, latestSale, latestPurchase, latestProduction] =
      await Promise.all([
        this.todos(user, { page: '1', pageSize: '3' }),
        this.prisma.hspsi_inventory_alert_qty.findFirst({
          where: { safe_less_qty: { gt: 0 } },
          orderBy: { safe_less_qty: 'desc' },
        }),
        this.prisma.hspsi_sale_order.findFirst({
          where: { ...org, deleted_at: null },
          orderBy: { created_at: 'desc' },
        }),
        this.prisma.hspsi_purchase_order.findFirst({
          where: { ...org, deleted_at: null },
          orderBy: { created_at: 'desc' },
        }),
        this.prisma.hspsi_production_plan.findFirst({
          where: { ...org, deleted_at: null },
          orderBy: { created_at: 'desc' },
        }),
      ]);
    const generated: Array<Record<string, any>> = todoResult.items.map((item) => ({
      id: `generated-approval-${item.id}`,
      title: `${item.docType}待处理`,
      content: `单据 ${item.docNo} 已进入待审批队列，请及时处理。`,
      category: '审批消息',
      isRead: 1,
      readTime: null,
      createdAt: item.createdAt,
    }));
    if (stockAlert) {
      const [goods, warehouse] = await Promise.all([
        this.prisma.hspsi_goods_info.findFirst({ where: { goods_id: stockAlert.goods_id } }),
        this.prisma.hspsi_basic_warehouse.findFirst({
          where: { warehouse_id: Number(stockAlert.warehouse_id) },
        }),
      ]);
      generated.push({
        id: `generated-stock-${stockAlert.id}`,
        title: '库存低于安全库存',
        content: `${goods?.goods_name ?? `商品 #${stockAlert.goods_id}`} 在${warehouse?.name ? `“${warehouse.name}”` : '当前仓库'}的库存为 ${Number(stockAlert.fact_qty)}，安全库存为 ${Number(stockAlert.safe_qty)}，建议补货 ${Number(stockAlert.purchase_qty)}。`,
        category: '预警消息',
        isRead: 1,
        readTime: null,
        createdAt: stockAlert.updated_at ?? stockAlert.created_at,
      });
    }
    if (latestSale)
      generated.push({
        id: `generated-sales-${latestSale.so_id}`,
        title: '销售订单业务动态',
        content: `销售订单 ${latestSale.so_no}，客户“${latestSale.customer_name}”，订单金额`,
        amount: Number(latestSale.fact_amount),
        category: '业务消息',
        isRead: 1,
        readTime: null,
        createdAt: latestSale.updated_at ?? latestSale.created_at,
      });
    if (latestPurchase)
      generated.push({
        id: `generated-purchase-${latestPurchase.po_id}`,
        title: '采购订单业务动态',
        content: `采购订单 ${latestPurchase.po_no}，采购金额`,
        amount: Number(latestPurchase.pay_amout),
        category: '业务消息',
        isRead: 1,
        readTime: null,
        createdAt: latestPurchase.updated_at ?? latestPurchase.created_at,
      });
    if (latestProduction)
      generated.push({
        id: `generated-production-${latestProduction.plan_id}`,
        title: '生产计划业务动态',
        content: `生产计划 ${latestProduction.plan_no}，计划数量 ${Number(latestProduction.plan_qty).toLocaleString('zh-CN')}，可在生产管理中查看执行状态。`,
        category: '业务消息',
        isRead: 1,
        readTime: null,
        createdAt: latestProduction.updated_at ?? latestProduction.created_at,
      });
    rows = [...rows, ...generated].sort((left, right) =>
      String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')),
    );
    if (category && category !== '全部消息')
      rows = rows.filter((item) => item.category === category);
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
      unreadCount: all.filter((item) => item.is_read === 0).length,
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
