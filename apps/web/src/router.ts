import { createRouter, createWebHistory } from 'vue-router';
import Layout from '@/views/Layout.vue';
import Login from '@/views/Login.vue';
import ResourcePage from '@/views/ResourcePage.vue';
import GoodsPage from '@/views/GoodsPage.vue';
import CategoriesPage from '@/views/CategoriesPage.vue';
import PropertiesPage from '@/views/PropertiesPage.vue';
import InventoryGeneralPage from '@/views/InventoryGeneralPage.vue';
import SystemPage from '@/views/SystemPage.vue';
import DashboardPage from '@/views/DashboardPage.vue';
import ReportPage from '@/views/ReportPage.vue';
import RequisitionApplicationPage from '@/views/business/RequisitionApplicationPage.vue';
import RequisitionOutputPage from '@/views/business/RequisitionOutputPage.vue';
import RequisitionReturnPage from '@/views/business/RequisitionReturnPage.vue';
import ProductionPlanPage from '@/views/business/ProductionPlanPage.vue';
import ProductionBomPage from '@/views/business/ProductionBomPage.vue';
import ProductionInputPage from '@/views/business/ProductionInputPage.vue';
import ProductionOutputPage from '@/views/business/ProductionOutputPage.vue';
import ProductionShortagePage from '@/views/business/ProductionShortagePage.vue';
import SalesOrderPage from '@/views/business/SalesOrderPage.vue';
import SalesOutputPage from '@/views/business/SalesOutputPage.vue';
import SalesReturnPage from '@/views/business/SalesReturnPage.vue';
import SalesPaymentPage from '@/views/business/SalesPaymentPage.vue';
import SalesRefundPage from '@/views/business/SalesRefundPage.vue';
import SalesDiscountOrderPage from '@/views/business/SalesDiscountOrderPage.vue';
import SalesServicePage from '@/views/business/SalesServicePage.vue';
import PurchaseApplicationPage from '@/views/business/PurchaseApplicationPage.vue';
import PurchaseOrderPage from '@/views/business/PurchaseOrderPage.vue';
import PurchaseReceiptPage from '@/views/business/PurchaseReceiptPage.vue';
import PurchaseReturnPage from '@/views/business/PurchaseReturnPage.vue';
import PurchasePaymentPage from '@/views/business/PurchasePaymentPage.vue';
import PurchaseRefundPage from '@/views/business/PurchaseRefundPage.vue';
import InventoryStockPage from '@/views/business/InventoryStockPage.vue';
import InventoryTransferPage from '@/views/business/InventoryTransferPage.vue';
import InventoryAdjustmentPage from '@/views/business/InventoryAdjustmentPage.vue';
import InventoryCheckPage from '@/views/business/InventoryCheckPage.vue';
import InventoryLossPage from '@/views/business/InventoryLossPage.vue';
import InventoryLossOutputPage from '@/views/business/InventoryLossOutputPage.vue';
import InventoryOverflowPage from '@/views/business/InventoryOverflowPage.vue';
import InventoryOverflowInputPage from '@/views/business/InventoryOverflowInputPage.vue';
import InventoryQuantityAlertPage from '@/views/business/InventoryQuantityAlertPage.vue';
import InventoryExpiryAlertPage from '@/views/business/InventoryExpiryAlertPage.vue';
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
      { path: 'purchase/applications', component: PurchaseApplicationPage },
      { path: 'purchase/orders', component: PurchaseOrderPage },
      { path: 'purchase/receipts', component: PurchaseReceiptPage },
      { path: 'purchase/returns', component: PurchaseReturnPage },
      { path: 'purchase/payments', component: PurchasePaymentPage },
      { path: 'purchase/refunds', component: PurchaseRefundPage },
      {
        path: 'inventory/:resource(general-inputs|general-outputs)',
        component: InventoryGeneralPage,
      },
      { path: 'inventory/stocks', component: InventoryStockPage },
      { path: 'inventory/transfers', component: InventoryTransferPage },
      { path: 'inventory/adjustments', component: InventoryAdjustmentPage },
      { path: 'inventory/checks', component: InventoryCheckPage },
      { path: 'inventory/losses', component: InventoryLossPage },
      { path: 'inventory/loss-outputs', component: InventoryLossOutputPage },
      { path: 'inventory/overflows', component: InventoryOverflowPage },
      { path: 'inventory/overflow-inputs', component: InventoryOverflowInputPage },
      { path: 'inventory/quantity-alerts', component: InventoryQuantityAlertPage },
      { path: 'inventory/expiry-alerts', component: InventoryExpiryAlertPage },
      { path: 'production/plans', component: ProductionPlanPage },
      { path: 'production/boms', component: ProductionBomPage },
      { path: 'production/inputs', component: ProductionInputPage },
      { path: 'production/outputs', component: ProductionOutputPage },
      { path: 'production/shortages', component: ProductionShortagePage },
      { path: 'sales/orders', component: SalesOrderPage },
      { path: 'sales/outputs', component: SalesOutputPage },
      { path: 'sales/returns', component: SalesReturnPage },
      { path: 'sales/payments', component: SalesPaymentPage },
      { path: 'sales/refunds', component: SalesRefundPage },
      { path: 'sales/discount-orders', component: SalesDiscountOrderPage },
      { path: 'sales/services', component: SalesServicePage },
      { path: 'requisitions/applications', component: RequisitionApplicationPage },
      { path: 'requisitions/outputs', component: RequisitionOutputPage },
      { path: 'requisitions/returns', component: RequisitionReturnPage },
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
