<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { DataAnalysis, Warning } from '@element-plus/icons-vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { hasPermission } from '@/utils/permission';
import DashboardHealthCard from '@/components/dashboard/DashboardHealthCard.vue';
import DashboardMessageCenter from '@/components/dashboard/DashboardMessageCenter.vue';
import DashboardMessageSummary from '@/components/dashboard/DashboardMessageSummary.vue';
import DashboardMetricCards from '@/components/dashboard/DashboardMetricCards.vue';
import DashboardQuickActions from '@/components/dashboard/DashboardQuickActions.vue';
import DashboardTodoList from '@/components/dashboard/DashboardTodoList.vue';
import DashboardTodoPreview from '@/components/dashboard/DashboardTodoPreview.vue';
import DashboardTrendCard from '@/components/dashboard/DashboardTrendCard.vue';
import { DASHBOARD_SHORTCUTS } from '@/components/dashboard/dashboard.config';
import type {
  DashboardMessageItem,
  DashboardModuleAccess,
  DashboardOverviewData,
  DashboardTodoItem,
  DashboardWidgetAccess,
} from '@/components/dashboard/dashboard.types';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const resource = computed(() => String(route.params.resource));
const title = computed(() =>
  resource.value === 'todos'
    ? '待办事项'
    : resource.value === 'messages'
      ? '消息中心'
      : resource.value === 'shortcuts'
        ? '快捷功能'
        : '数据总览',
);
const loading = ref(false);
const error = ref('');
const dashboard = reactive<DashboardOverviewData>({
  salesAmount: 0,
  purchaseAmount: 0,
  inventoryValue: 0,
  pendingCount: 0,
  lowStockCount: 0,
  inventoryCount: 0,
  healthScore: 0,
  trend: [],
  todos: [],
  messages: [],
  unreadCount: 0,
  lowStockItem: null,
});
const todoRows = ref<DashboardTodoItem[]>([]);
const todoTotal = ref(0);
const todoQuery = reactive({ page: 1, pageSize: 20, keyword: '', sourceType: '' });
const messageRows = ref<DashboardMessageItem[]>([]);
const messageTotal = ref(0);
type OverviewSection = 'metrics' | 'trend' | 'health' | 'todos' | 'messages';
const overviewLoading = reactive<Record<OverviewSection, boolean>>({
  metrics: false,
  trend: false,
  health: false,
  todos: false,
  messages: false,
});
const overviewErrors = reactive<Record<OverviewSection, string>>({
  metrics: '',
  trend: '',
  health: '',
  todos: '',
  messages: '',
});

const greeting = computed(() => {
  const hour = new Date().getHours();
  const text = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
  return `${text}，${auth.user?.username ?? '用户'}。这里是今日经营与待办概览。`;
});
const noModules: DashboardModuleAccess = {
  sales: false,
  purchase: false,
  inventory: false,
  production: false,
  todos: false,
  messages: false,
  shortcuts: false,
};
const noWidgets: DashboardWidgetAccess = {
  salesAmount: false,
  purchaseAmount: false,
  inventoryValue: false,
  pendingCount: false,
  businessTrend: false,
  inventoryHealth: false,
  todoPreview: false,
  quickActions: false,
  messageSummary: false,
};
const modules = computed(() => dashboard.modules ?? noModules);
const widgets = computed(() => dashboard.widgets ?? noWidgets);
const hasOverviewWidgets = computed(() => Object.values(widgets.value).some(Boolean));
const shortcuts = computed(() =>
  DASHBOARD_SHORTCUTS.filter(
    (item) =>
      hasPermission(auth.user, item.pagePermission) &&
      (!item.actionPermission || hasPermission(auth.user, item.actionPermission)),
  ),
);
const money = (value: any) =>
  auth.amountAccess.canViewAmount
    ? `¥${Math.round(Number(value) || 0).toLocaleString('zh-CN')}`
    : '****';
const messageText = (item: DashboardMessageItem) =>
  Object.prototype.hasOwnProperty.call(item, 'amount')
    ? `${item.content || ''} ${money(item.amount)}。`
    : item.content || '暂无消息内容';
const dateText = (value: any) => (value ? String(value).replace('T', ' ').slice(0, 16) : '—');

async function loadOverview() {
  const access = (await api.get('/dashboard/access')) as any;
  dashboard.modules = access.modules;
  dashboard.widgets = access.widgets;
  loading.value = false;
  const tasks: Promise<void>[] = [];
  const needsMetrics =
    widgets.value.salesAmount ||
    widgets.value.purchaseAmount ||
    widgets.value.inventoryValue ||
    widgets.value.pendingCount;
  if (needsMetrics)
    tasks.push(
      loadOverviewSection('metrics', async () => {
        Object.assign(dashboard, await api.get('/dashboard/metrics'));
      }),
    );
  if (widgets.value.businessTrend)
    tasks.push(
      loadOverviewSection('trend', async () => {
        dashboard.trend = (await api.get('/dashboard/trend')) as any;
      }),
    );
  if (widgets.value.inventoryHealth)
    tasks.push(
      loadOverviewSection('health', async () => {
        Object.assign(dashboard, await api.get('/dashboard/inventory-health'));
      }),
    );
  if (widgets.value.todoPreview)
    tasks.push(
      loadOverviewSection('todos', async () => {
        const data = (await api.get('/dashboard/todos', {
          params: { page: 1, pageSize: 5 },
        })) as any;
        dashboard.todos = data.items ?? [];
      }),
    );
  if (widgets.value.messageSummary)
    tasks.push(
      loadOverviewSection('messages', async () => {
        const data = (await api.get('/dashboard/messages', {
          params: { page: 1, pageSize: 2 },
        })) as any;
        dashboard.messages = data.items ?? [];
        dashboard.unreadCount = data.unreadCount ?? 0;
      }),
    );
  await Promise.all(tasks);
}
async function loadOverviewSection(section: OverviewSection, request: () => Promise<void>) {
  overviewLoading[section] = true;
  overviewErrors[section] = '';
  try {
    await request();
  } catch (caught: any) {
    overviewErrors[section] = caught?.response?.data?.message ?? '该模块暂时加载失败';
  } finally {
    overviewLoading[section] = false;
  }
}
async function loadTodos() {
  const data = (await api.get('/dashboard/todos', { params: todoQuery })) as any;
  todoRows.value = data.items ?? [];
  todoTotal.value = data.total ?? 0;
}
async function loadMessages() {
  const data = (await api.get('/dashboard/messages', {
    params: { page: 1, pageSize: 100 },
  })) as any;
  messageRows.value = data.items ?? [];
  messageTotal.value = data.total ?? 0;
  dashboard.unreadCount = data.unreadCount ?? 0;
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    if (resource.value === 'todos') await loadTodos();
    else if (resource.value === 'messages') await loadMessages();
    else if (resource.value !== 'shortcuts') await loadOverview();
  } catch (caught: any) {
    error.value = caught?.response?.data?.message ?? '工作台数据加载失败';
  } finally {
    loading.value = false;
  }
}
function openTodo(item: DashboardTodoItem) {
  if (item.route)
    router.push({ path: item.route, query: { sourceId: item.sourceId, status: 'pending' } });
}
async function readMessage(item: DashboardMessageItem) {
  if (!item.isRead) await api.post(`/dashboard/messages/${item.id}/read`);
  await loadMessages();
}
function quick(path: string, create?: boolean) {
  router.push({ path, query: create ? { create: '1' } : {} });
}
watch(resource, load);
onMounted(load);
</script>

<template>
  <section class="page dashboard-page">
    <header class="page-head">
      <div>
        <h2>{{ title }}</h2>
        <p class="page-subtitle">
          {{
            resource === 'todos'
              ? '集中处理关键业务单据，审批通过后自动同步业务台账。'
              : resource === 'messages'
                ? '查看审批、预警和业务消息。'
                : greeting
          }}
        </p>
      </div>
    </header>

    <div v-if="loading" class="dashboard-state">
      <el-icon class="is-loading"><DataAnalysis /></el-icon><span>正在加载工作台…</span>
    </div>
    <div v-else-if="error" class="dashboard-state error">
      <el-icon><Warning /></el-icon><strong>暂时无法读取工作台数据</strong><span>{{ error }}</span
      ><el-button @click="load">重新连接</el-button>
    </div>

    <template v-else-if="resource === 'todos'">
      <DashboardTodoList
        :rows="todoRows"
        :total="todoTotal"
        :query="todoQuery"
        :money="money"
        @search="
          todoQuery.page = 1;
          loadTodos();
        "
        @page="loadTodos"
        @open="openTodo"
      />
    </template>

    <template v-else-if="resource === 'messages'">
      <DashboardMessageCenter
        :rows="messageRows"
        :message-text="messageText"
        :date-text="dateText"
        @read="readMessage"
      />
    </template>

    <template v-else-if="resource === 'shortcuts'">
      <DashboardQuickActions :shortcuts="shortcuts" @navigate="quick" />
    </template>

    <template v-else>
      <div v-if="!hasOverviewWidgets" class="dashboard-state">
        <el-icon><DataAnalysis /></el-icon><span>当前角色尚未配置数据总览组件</span>
      </div>
      <el-alert
        v-if="overviewErrors.metrics"
        :title="overviewErrors.metrics"
        type="error"
        :closable="false"
        show-icon
        class="dashboard-widget-error"
      />
      <DashboardMetricCards
        v-else
        v-loading="overviewLoading.metrics"
        :sales-amount="dashboard.salesAmount"
        :purchase-amount="dashboard.purchaseAmount"
        :inventory-value="dashboard.inventoryValue"
        :pending-count="dashboard.pendingCount"
        :widgets="widgets"
        :money="money"
      />

      <div class="dashboard-grid">
        <el-alert
          v-if="widgets.businessTrend && overviewErrors.trend"
          :title="overviewErrors.trend"
          type="error"
          :closable="false"
          show-icon
          class="dashboard-widget-error"
        />
        <DashboardTrendCard
          v-else-if="widgets.businessTrend"
          v-loading="overviewLoading.trend"
          :trend="dashboard.trend"
          :modules="modules"
          :money="money"
        />
        <el-alert
          v-if="widgets.inventoryHealth && overviewErrors.health"
          :title="overviewErrors.health"
          type="error"
          :closable="false"
          show-icon
          class="dashboard-widget-error"
        />
        <DashboardHealthCard
          v-else-if="widgets.inventoryHealth"
          v-loading="overviewLoading.health"
          :data="dashboard"
          @navigate="quick"
        />
        <el-alert
          v-if="widgets.todoPreview && overviewErrors.todos"
          :title="overviewErrors.todos"
          type="error"
          :closable="false"
          show-icon
          class="dashboard-widget-error"
        />
        <DashboardTodoPreview
          v-else-if="widgets.todoPreview"
          v-loading="overviewLoading.todos"
          :rows="dashboard.todos"
          :money="money"
          @open="openTodo"
          @all="router.push('/dashboard/todos')"
        />

        <div v-if="widgets.quickActions || widgets.messageSummary" class="dashboard-side">
          <DashboardQuickActions
            v-if="widgets.quickActions"
            compact
            :shortcuts="shortcuts"
            @navigate="quick"
          />
          <DashboardMessageSummary
            v-if="widgets.messageSummary && !overviewErrors.messages"
            v-loading="overviewLoading.messages"
            :rows="dashboard.messages"
            :unread-count="dashboard.unreadCount"
            :date-text="dateText"
            @open="router.push('/dashboard/messages')"
          />
          <el-alert
            v-else-if="widgets.messageSummary"
            :title="overviewErrors.messages"
            type="error"
            :closable="false"
            show-icon
            class="dashboard-widget-error"
          />
        </div>
      </div>
    </template>
  </section>
</template>

<style>
.dashboard-state {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--hs-muted);
}
.dashboard-state.error {
  flex-direction: column;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 15px;
}
.metric-grid article {
  position: relative;
  min-height: 116px;
  padding: 18px 20px 16px 62px;
  border: 1px solid var(--hs-border);
  border-radius: 6px;
  background: #fff;
}
.metric-grid .el-icon {
  position: absolute;
  left: 20px;
  top: 20px;
  width: 30px;
  height: 30px;
  padding: 7px;
  border-radius: 6px;
  background: #eef2ff;
  color: var(--hs-primary);
}
.metric-grid span,
.metric-grid small {
  display: block;
  color: var(--hs-muted);
}
.metric-grid strong {
  display: block;
  margin: 8px 0 4px;
  font-size: 22px;
}
.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.75fr) minmax(300px, 1fr);
  gap: 15px;
}
.dashboard-card {
  border: 1px solid var(--hs-border);
  border-radius: 6px;
  background: #fff;
  overflow: hidden;
}
.dashboard-card > header {
  min-height: 66px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 17px;
  border-bottom: 1px solid var(--hs-border);
}
.dashboard-card h3 {
  margin: 0 0 4px;
  font-size: 13px;
}
.dashboard-card header small {
  color: var(--hs-muted);
}
.dashboard-card header button {
  border: 0;
  background: transparent;
  color: var(--hs-primary);
  cursor: pointer;
}
.trend-card {
  min-height: 292px;
}
.legend {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--hs-muted);
  font-size: 10px;
}
.legend i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--hs-primary);
}
.legend i:nth-of-type(2) {
  margin-left: 8px;
  background: #9aa9c5;
}
.trend-chart {
  height: 220px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 20px 16px 12px;
  overflow-x: auto;
}
.trend-day {
  min-width: 38px;
  flex: 1;
  text-align: center;
}
.bars {
  height: 160px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
  border-bottom: 1px solid #e9edf2;
}
.bars i {
  width: 9px;
  border-radius: 2px 2px 0 0;
  background: var(--hs-primary);
}
.bars i + i {
  background: #9aa9c5;
}
.trend-day small {
  display: block;
  margin-top: 7px;
  color: #7a8595;
  font-size: 9px;
}
.health-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 22px 16px;
}
.health-ring {
  width: 118px;
  height: 118px;
  padding: 10px;
  border-radius: 50%;
}
.health-ring > span {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  border-radius: 50%;
  background: #fff;
}
.health-ring strong {
  font-size: 26px;
}
.health-ring small {
  color: var(--hs-muted);
}
.health-counts p {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--hs-muted);
}
.health-counts p strong {
  margin-left: auto;
  color: #263044;
}
.health-counts i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.health-counts .good {
  background: #078c68;
}
.health-counts .low {
  background: #e39034;
}
.stock-warning {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 14px 14px;
  padding: 10px;
  border-radius: 4px;
  background: #fff5e9;
  color: #b96715;
}
.stock-warning span {
  min-width: 0;
  flex: 1;
}
.stock-warning span > * {
  display: block;
}
.stock-warning button {
  border: 0;
  background: transparent;
  color: #b96715;
  cursor: pointer;
}
.stock-clear {
  padding: 14px;
  text-align: center;
  color: var(--hs-muted);
}
.todo-row {
  width: 100%;
  min-height: 62px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto 16px;
  align-items: center;
  gap: 10px;
  padding: 9px 16px;
  border: 0;
  border-bottom: 1px solid #eef1f5;
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.todo-row:hover {
  background: #fafbfe;
}
.todo-row span > * {
  display: block;
}
.todo-row span:nth-of-type(2) {
  text-align: right;
}
.todo-row small {
  margin-top: 3px;
  color: var(--hs-muted);
  font-size: 9px;
}
.dashboard-side {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.quick-card > div {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  padding: 14px;
}
.quick-card > div button {
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--hs-border);
  border-radius: 5px;
  background: #fafbfd;
  color: #384357;
  cursor: pointer;
}
.message-summary {
  cursor: pointer;
}
.message-summary p {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 10px 15px;
  border-bottom: 1px solid #eef1f5;
}
.message-summary p i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--hs-primary);
}
.message-summary p i.read {
  background: #b6becb;
}
.message-summary p span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.message-summary time {
  color: var(--hs-muted);
  font-size: 9px;
}
.dashboard-empty {
  padding: 36px 16px;
  text-align: center;
  color: var(--hs-muted);
}
.todo-filter {
  display: flex;
  gap: 9px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--hs-border);
  background: #fafbfd;
}
.todo-filter .el-input {
  width: 300px;
}
.todo-filter .el-select {
  width: 160px;
}
.message-center {
  min-height: 470px;
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
}
.message-categories {
  padding: 12px;
  border-right: 1px solid var(--hs-border);
}
.message-categories button {
  width: 100%;
  height: 42px;
  display: grid;
  grid-template-columns: 22px 1fr auto;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #596578;
  text-align: left;
  cursor: pointer;
}
.message-categories button.active {
  background: #eef2ff;
  color: var(--hs-primary);
}
.message-categories b {
  font-size: 10px;
}
.message-row {
  width: 100%;
  min-height: 86px;
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border: 0;
  border-bottom: 1px solid var(--hs-border);
  background: #fff;
  text-align: left;
  cursor: pointer;
}
.message-row.unread {
  background: #f8faff;
}
.message-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #eef2ff;
  color: var(--hs-primary);
}
.message-copy > * {
  display: block;
}
.message-copy strong {
  font-size: 12px;
}
.message-copy strong i {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 7px;
  border-radius: 50%;
  background: var(--hs-primary);
}
.message-copy small {
  margin-top: 5px;
  color: var(--hs-muted);
}
.message-copy time {
  margin-top: 5px;
  color: #929cac;
  font-size: 9px;
}
.shortcut-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.shortcut-grid button {
  min-height: 116px;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--hs-border);
  border-radius: 7px;
  background: #fff;
  color: #344055;
  text-align: left;
  cursor: pointer;
  transition: 0.18s ease;
}
.shortcut-grid button:hover {
  border-color: var(--hs-primary);
  box-shadow: 0 8px 24px rgba(36, 55, 95, 0.08);
  transform: translateY(-1px);
}
.shortcut-grid .el-icon {
  width: 42px;
  height: 42px;
  border-radius: 8px;
  background: #eef2ff;
  color: var(--hs-primary);
  font-size: 20px;
}
.shortcut-grid span > * {
  display: block;
}
.shortcut-grid strong {
  font-size: 14px;
}
.shortcut-grid small {
  margin-top: 7px;
  color: var(--hs-muted);
  line-height: 1.5;
}
.shortcut-grid button > b {
  color: #a3adbb;
  font-size: 18px;
}
@media (max-width: 1180px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
  .dashboard-side {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .shortcut-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 820px) {
  .message-center {
    grid-template-columns: 1fr;
  }
  .message-categories {
    display: flex;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--hs-border);
  }
  .message-categories button {
    min-width: 110px;
  }
  .dashboard-side {
    display: block;
  }
  .dashboard-side > * + * {
    margin-top: 15px;
  }
  .todo-filter {
    flex-direction: column;
  }
  .todo-filter > * {
    width: 100% !important;
  }
}
@media (max-width: 540px) {
  .metric-grid {
    grid-template-columns: 1fr;
  }
  .todo-row {
    grid-template-columns: 30px minmax(0, 1fr) 16px;
  }
  .todo-row > span:nth-of-type(2) {
    display: none;
  }
  .quick-card > div {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .trend-day {
    min-width: 30px;
  }
  .shortcut-grid {
    grid-template-columns: 1fr;
  }
}
</style>
