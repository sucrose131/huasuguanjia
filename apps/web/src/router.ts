import { createRouter, createWebHistory } from 'vue-router';
import Layout from '@/views/Layout.vue';
import Login from '@/views/Login.vue';
import ResourcePage from '@/views/ResourcePage.vue';
import GoodsPage from '@/views/GoodsPage.vue';
import CategoriesPage from '@/views/CategoriesPage.vue';
import PropertiesPage from '@/views/PropertiesPage.vue';
import PurchasePage from '@/views/PurchasePage.vue';
import InventoryPage from '@/views/InventoryPage.vue';
import InventoryGeneralPage from '@/views/InventoryGeneralPage.vue';
import WorkflowPage from '@/views/WorkflowPage.vue';
import RequisitionApplicationPage from '@/views/business/RequisitionApplicationPage.vue';
import RequisitionOutputPage from '@/views/business/RequisitionOutputPage.vue';
import RequisitionReturnPage from '@/views/business/RequisitionReturnPage.vue';
import ProductionPlanPage from '@/views/business/ProductionPlanPage.vue';
import ProductionBomPage from '@/views/business/ProductionBomPage.vue';
import ProductionInputPage from '@/views/business/ProductionInputPage.vue';
import ProductionOutputPage from '@/views/business/ProductionOutputPage.vue';
import ProductionShortagePage from '@/views/business/ProductionShortagePage.vue';
import SalesOrderPage from '@/views/business/SalesOrderPage.vue';
import SystemPage from '@/views/SystemPage.vue';
import DashboardPage from '@/views/DashboardPage.vue';
import ReportPage from '@/views/ReportPage.vue';
const routes = [
  { path: '/login', component: Login },
  {
    path: '/',
    component: Layout,
    redirect: '/dashboard/overview',
    children: [
      { path: 'dashboard/:resource(overview|todos|messages|shortcuts)', component: DashboardPage },
      { path: 'base/:resource', component: ResourcePage },
      { path: 'goods/products', component: GoodsPage },
      { path: 'goods/categories', component: CategoriesPage },
      { path: 'goods/properties', component: PropertiesPage },
      { path: 'purchase/:resource', component: PurchasePage },
      { path: 'inventory/overflow-inputs', redirect: '/inventory/overflows' },
      {
        path: 'inventory/:resource(general-inputs|general-outputs)',
        component: InventoryGeneralPage,
      },
      {
        path: 'inventory/:resource(stocks|transfers|adjustments|losses|loss-outputs|overflows|overflow-inputs|checks|quantity-alerts|expiry-alerts)',
        component: InventoryPage,
      },
      { path: 'production/plans', component: ProductionPlanPage },
      { path: 'production/boms', component: ProductionBomPage },
      { path: 'production/inputs', component: ProductionInputPage },
      { path: 'production/outputs', component: ProductionOutputPage },
      { path: 'production/shortages', component: ProductionShortagePage },
      { path: 'production/:resource', component: WorkflowPage },
      { path: 'sales/orders', component: SalesOrderPage },
      { path: 'sales/:resource', component: WorkflowPage },
      { path: 'requisitions/applications', component: RequisitionApplicationPage },
      { path: 'requisitions/outputs', component: RequisitionOutputPage },
      { path: 'requisitions/returns', component: RequisitionReturnPage },
      { path: 'requisitions/:resource', component: WorkflowPage },
      { path: 'system/:resource(roles|users|config|tasks)', component: SystemPage },
      {
        path: 'reports/:report(products|vendors|customers|purchase-detail|purchase-summary|production-detail|production-summary|sales-detail|discount-detail|sales-summary|requisition-detail|requisition-summary|inbound-detail|outbound-detail|loss-detail|overflow-detail|inventory-summary|check-summary|batch-inbound|purchase-payment|purchase-payable)',
        component: ReportPage,
      },
    ],
  },
];
const fallbackTitles: Record<string, string> = {
  '/login': '登录',
  '/dashboard/overview': '数据总览',
  '/dashboard/todos': '待办事项',
  '/dashboard/messages': '消息中心',
  '/dashboard/shortcuts': '快捷功能',
  '/base/organizations': '公司',
  '/base/departments': '部门',
  '/base/positions': '职位',
  '/base/employees': '员工',
};
function pageTitle(path: string) {
  if (fallbackTitles[path]) return fallbackTitles[path];
  try {
    const menus = JSON.parse(localStorage.getItem('hspsi_menus') ?? '[]') as Array<{
      name?: string;
      route?: string | null;
    }>;
    const menu = menus.find((item) => item.route === path);
    if (menu?.name) return menu.name;
  } catch {}
  return '业务工作台';
}
export const router = createRouter({ history: createWebHistory(), routes });
router.beforeEach((to) => {
  const token = localStorage.getItem('hspsi_token');
  if (to.path !== '/login' && !token) return '/login';
  if (to.path === '/login' && token) return '/';
  if (token && to.path !== '/' && to.path !== '/login') {
    try {
      const menus = JSON.parse(localStorage.getItem('hspsi_menus') ?? '[]') as Array<{
        route?: string | null;
        type?: number;
        code?: string;
      }>;
      const pages = menus.filter((item) => item.route && item.type !== 3);
      const allowed = pages.some((item) => item.route === to.path);
      if (pages.length && !allowed) return pages[0]!.route!;
    } catch {}
  }
});
router.afterEach((to) => {
  document.title = `${pageTitle(to.path)} · 华溯管家`;
});
