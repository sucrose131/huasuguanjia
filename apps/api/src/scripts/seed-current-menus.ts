import { PrismaClient } from '@prisma/client';
process.loadEnvFile?.('.env');
const prisma = new PrismaClient();
type MenuDefinition = readonly [name: string, code: string, route: string];
// 报表中心页面直接平铺在「报表中心」目录下（不再使用「目录套目录」结构）
const reportSections: readonly MenuDefinition[] = [
  ['商品资料查询表', 'reports:1:view', '/reports/products'],
  ['供应商资料查询表', 'reports:2:view', '/reports/vendors'],
  ['客户资料查询表', 'reports:3:view', '/reports/customers'],
  ['采购明细查询表', 'reports:4:view', '/reports/purchase-detail'],
  ['采购统计分析表', 'reports:5:view', '/reports/purchase-summary'],
  ['生产明细查询表', 'reports:6:view', '/reports/production-detail'],
  ['生产统计分析表', 'reports:7:view', '/reports/production-summary'],
  ['销售明细查询表', 'reports:8:view', '/reports/sales-detail'],
  ['折价处理明细表', 'reports:9:view', '/reports/discount-detail'],
  ['销售统计分析表', 'reports:10:view', '/reports/sales-summary'],
  ['领用明细查询表', 'reports:11:view', '/reports/requisition-detail'],
  ['领用统计分析表', 'reports:12:view', '/reports/requisition-summary'],
  ['入库明细查询表', 'reports:13:view', '/reports/inbound-detail'],
  ['出库明细查询表', 'reports:14:view', '/reports/outbound-detail'],
  ['报损明细查询表', 'reports:15:view', '/reports/loss-detail'],
  ['报溢明细查询表', 'reports:16:view', '/reports/overflow-detail'],
  ['库存汇总统计分析表', 'reports:17:view', '/reports/inventory-summary'],
  ['盘点汇总统计分析表', 'reports:18:view', '/reports/check-summary'],
  ['分批入库查询表', 'reports:19:view', '/reports/batch-inbound'],
  ['采购付款查询表', 'reports:20:view', '/reports/purchase-payment'],
  ['应付账款统计表', 'reports:21:view', '/reports/purchase-payable'],
];
const structure = [
  {
    name: '工作台',
    code: 'dashboard',
    icon: 'DataBoard',
    sort: 10,
    children: [
      ['数据总览', 'dashboard:1:view', '/dashboard/overview'],
      ['待办事项', 'dashboard:2:view', '/dashboard/todos'],
      ['消息中心', 'dashboard:3:view', '/dashboard/messages'],
      ['快捷功能', 'dashboard:4:view', '/dashboard/shortcuts'],
    ],
  },
  {
    name: '基础资料',
    code: 'master-data',
    icon: 'OfficeBuilding',
    sort: 20,
    children: [
      ['供应商', 'master-data:vendors', '/base/vendors'],
      ['客户', 'master-data:customers', '/base/customers'],
      ['公司', 'master-data:companies', '/base/organizations'],
      ['部门', 'master-data:departments', '/base/departments'],
      ['职位', 'master-data:positions', '/base/positions'],
      ['员工', 'master-data:employees', '/base/employees'],
      ['仓库', 'master-data:warehouses', '/base/warehouses'],
      ['计量单位', 'master-data:units', '/base/units'],
    ],
  },
  {
    name: '商品管理',
    code: 'goods',
    icon: 'Goods',
    sort: 30,
    children: [
      ['商品资料', 'goods:products', '/goods/products'],
      ['商品分类', 'goods:categories', '/goods/categories'],
      ['属性定义', 'goods:properties', '/goods/properties'],
    ],
  },
  {
    name: '采购管理',
    code: 'purchase',
    icon: 'ShoppingCart',
    sort: 40,
    children: [
      ['采购申请', 'purchase:applications', '/purchase/applications'],
      ['采购订单', 'purchase:orders', '/purchase/orders'],
      ['采购入库', 'purchase:receipts', '/purchase/receipts'],
      ['采购退货', 'purchase:returns', '/purchase/returns'],
      ['采购付款', 'purchase:payments', '/purchase/payments'],
      ['采购退款', 'purchase:refunds', '/purchase/refunds'],
    ],
  },
  {
    name: '库存管理',
    code: 'inventory',
    icon: 'TakeawayBox',
    sort: 50,
    children: [
      ['库存查询', 'inventory:stocks', '/inventory/stocks'],
      ['通用入库单', 'inventory:general-inputs', '/inventory/general-inputs'],
      ['通用出库单', 'inventory:general-outputs', '/inventory/general-outputs'],
      ['库存调拨单', 'inventory:transfers', '/inventory/transfers'],
      ['库存调整记录', 'inventory:adjustments', '/inventory/adjustments'],
      ['报损出库单', 'inventory:losses', '/inventory/losses'],
      ['报亏出库单', 'inventory:loss-outputs', '/inventory/loss-outputs'],
      ['报盈入库单', 'inventory:overflows', '/inventory/overflows'],
      ['库存盘点', 'inventory:checks', '/inventory/checks'],
      ['库存预警', 'inventory:quantity-alerts', '/inventory/quantity-alerts'],
      ['效期预警', 'inventory:expiry-alerts', '/inventory/expiry-alerts'],
    ],
  },
  {
    name: '生产管理',
    code: 'production',
    icon: 'SetUp',
    sort: 60,
    children: [
      ['生产计划单', 'production:plans', '/production/plans'],
      ['生产出库单', 'production:outputs', '/production/outputs'],
      ['生产成品入库单', 'production:inputs', '/production/inputs'],
      ['BOM编排', 'production:boms', '/production/boms'],
    ],
  },
  {
    name: '销售管理',
    code: 'sales',
    icon: 'Sell',
    sort: 70,
    children: [
      ['销售订单', 'sales:orders', '/sales/orders'],
      ['销售出库单', 'sales:outputs', '/sales/outputs'],
      ['销售退货单', 'sales:returns', '/sales/returns'],
      ['销售收款', 'sales:payments', '/sales/payments'],
      ['销售退款', 'sales:refunds', '/sales/refunds'],
      ['折价销售单', 'sales:discount-orders', '/sales/discount-orders'],
      ['售后记录', 'sales:services', '/sales/services'],
    ],
  },
  {
    name: '领用管理',
    code: 'requisitions',
    icon: 'Tickets',
    sort: 80,
    children: [
      ['领用申请单', 'requisitions:applications', '/requisitions/applications'],
      ['领用出库单', 'requisitions:outputs', '/requisitions/outputs'],
      ['领用退回单', 'requisitions:returns', '/requisitions/returns'],
    ],
  },
  {
    name: '报表中心',
    code: 'reports',
    icon: 'DataAnalysis',
    sort: 90,
    children: reportSections,
  },
  {
    name: '系统管理',
    code: 'system',
    icon: 'Setting',
    sort: 100,
    children: [
      ['角色管理', 'system:1:view', '/system/roles'],
      ['用户管理', 'system:2:view', '/system/users'],
      ['系统配置', 'system:3:view', '/system/config'],
      ['任务管理', 'system:4:view', '/system/tasks'],
    ],
  },
] as const;
const systemActions = [
  ['查看', 'system:view'],
  ['新增', 'system:create'],
  ['编辑', 'system:update'],
  ['删除', 'system:delete'],
] as const;
const businessActions = [
  ['inventory:stocks', '库存查询-导出', 'inventory:stocks:export', 60],
] as const;
async function upsertMenu(data: any) {
  const old = await prisma.hspsi_sys_menu.findFirst({
    where: { code: data.code, deleted_at: null },
  });
  return old
    ? prisma.hspsi_sys_menu.update({ where: { id: old.id }, data })
    : prisma.hspsi_sys_menu.create({ data });
}
async function main() {
  const ids: number[] = [];
  for (const group of structure) {
    const parent = await upsertMenu({
      parent_id: 0,
      path: '0',
      name: group.name,
      code: group.code,
      icon: group.icon,
      route: null,
      component: null,
      redirect: null,
      type: 1,
      status: 1,
      sort: group.sort,
      remark: '系统基础菜单',
    });
    ids.push(parent.id);
    for (const [index, childDef] of group.children.entries()) {
      const [name, code, route] = childDef;
      const child = await upsertMenu({
        parent_id: parent.id,
        path: `0,${parent.id}`,
        name,
        code,
        icon: null,
        route,
        component: null,
        redirect: null,
        type: 2,
        status: 1,
        sort: index + 1,
        remark: '系统业务菜单',
      });
      ids.push(child.id);
    }
    const currentCodes = group.children.map((child) => child[1]);
    const staleMenus = await prisma.hspsi_sys_menu.findMany({
      where: {
        parent_id: parent.id,
        type: 2,
        code: { notIn: [...currentCodes] },
        deleted_at: null,
      },
    });
    if (staleMenus.length) {
      await prisma.hspsi_sys_role_menu.deleteMany({
        where: { menu_id: { in: staleMenus.map((menu) => BigInt(menu.id)) } },
      });
      await prisma.hspsi_sys_menu.deleteMany({
        where: { id: { in: staleMenus.map((menu) => menu.id) } },
      });
    }
  }
  for (const [pageCode, name, code, sort] of businessActions) {
    const page = await prisma.hspsi_sys_menu.findFirstOrThrow({
      where: { code: pageCode, type: 2, deleted_at: null },
    });
    const action = await upsertMenu({
      parent_id: page.id,
      path: `${page.path},${page.id}`,
      name,
      code,
      icon: null,
      route: null,
      component: null,
      redirect: null,
      type: 3,
      status: 1,
      sort,
      remark: '菜单级操作权限；页面菜单本身代表查看权限',
      deleted_at: null,
    });
    ids.push(action.id);
  }
  const systemParent = await prisma.hspsi_sys_menu.findFirstOrThrow({
    where: { code: 'system', deleted_at: null },
  });
  for (const [index, action] of systemActions.entries()) {
    const [name, code] = action;
    const item = await upsertMenu({
      parent_id: systemParent.id,
      path: `0,${systemParent.id}`,
      name,
      code,
      icon: null,
      route: null,
      component: null,
      redirect: null,
      type: 3,
      status: 1,
      sort: 100 + index,
      remark: '系统管理操作权限',
    });
    ids.push(item.id);
  }
  const admin = await prisma.hspsi_sys_role.findFirst({
    where: { code: 'admin', deleted_at: null },
  });
  if (admin)
    await prisma.hspsi_sys_role_menu.createMany({
      data: ids.map((menu_id) => ({ role_id: admin.id, menu_id: BigInt(menu_id) })),
      skipDuplicates: true,
    });
  console.log(`已初始化 ${ids.length} 个当前范围菜单`);
}
main().finally(() => prisma.$disconnect());
