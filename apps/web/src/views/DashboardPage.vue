<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Bell,
  Box,
  CircleCheck,
  Clock,
  DataAnalysis,
  Goods,
  ShoppingCart,
  Tickets,
  Warning,
} from '@element-plus/icons-vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';

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
const dashboard = reactive<any>({
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
const todoRows = ref<any[]>([]);
const todoTotal = ref(0);
const todoQuery = reactive({ page: 1, pageSize: 20, keyword: '', sourceType: '' });
const messageRows = ref<any[]>([]);
const messageTotal = ref(0);
const messageCategory = ref('全部消息');
const categories = ['全部消息', '审批消息', '预警消息', '业务消息'];

const greeting = computed(() => {
  const hour = new Date().getHours();
  const text = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
  return `${text}，${auth.user?.username ?? '用户'}。这里是今日经营与待办概览。`;
});
const maxTrend = computed(() =>
  Math.max(1, ...dashboard.trend.flatMap((item: any) => [item.sales, item.purchase])),
);
const filteredMessages = computed(() =>
  messageCategory.value === '全部消息'
    ? messageRows.value
    : messageRows.value.filter((item) => item.category === messageCategory.value),
);
const categoryCount = (category: string) =>
  category === '全部消息'
    ? messageRows.value.length
    : messageRows.value.filter((item) => item.category === category).length;
const money = (value: any) =>
  auth.amountAccess.canViewAmount
    ? `¥${Math.round(Number(value) || 0).toLocaleString('zh-CN')}`
    : '****';
const dateText = (value: any) => (value ? String(value).replace('T', ' ').slice(0, 16) : '—');

async function loadOverview() {
  const data = (await api.get('/dashboard')) as any;
  Object.assign(dashboard, data);
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
function openTodo(item: any) {
  if (item.route)
    router.push({ path: item.route, query: { sourceId: item.sourceId, status: 'pending' } });
}
async function readMessage(item: any) {
  if (!item.isRead) await api.post(`/dashboard/messages/${item.id}/read`);
  await loadMessages();
}
function quick(path: string, action?: string) {
  router.push({ path, query: action ? { create: '1' } : {} });
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
      <div class="panel">
        <div class="todo-filter">
          <el-input
            v-model="todoQuery.keyword"
            clearable
            placeholder="搜索单据编号、类型或往来信息"
            @keyup.enter="
              todoQuery.page = 1;
              loadTodos();
            "
          /><el-select v-model="todoQuery.sourceType" clearable placeholder="来源类型"
            ><el-option label="采购管理" value="采购管理" /><el-option
              label="生产管理"
              value="生产管理" /><el-option label="销售管理" value="销售管理" /><el-option
              label="领用管理"
              value="领用管理" /><el-option label="库存管理" value="库存管理" /></el-select
          ><el-button
            type="primary"
            @click="
              todoQuery.page = 1;
              loadTodos();
            "
            >查询</el-button
          >
        </div>
        <div class="table-wrap">
          <el-table :data="todoRows"
            ><el-table-column type="index" label="序号" width="65" /><el-table-column
              prop="docNo"
              label="单据编号"
              min-width="150"
              ><template #default="{ row }"
                ><strong class="business-no">{{ row.docNo }}</strong></template
              ></el-table-column
            ><el-table-column prop="docType" label="单据类型" min-width="130" /><el-table-column
              prop="businessModule"
              label="来源模块"
              width="110"
            /><el-table-column prop="counterparty" label="往来单位/信息" min-width="150"
              ><template #default="{ row }">{{
                row.counterparty || '—'
              }}</template></el-table-column
            ><el-table-column prop="date" label="日期" width="110" /><el-table-column
              label="金额"
              width="120"
              align="right"
              ><template #default="{ row }">{{
                row.amount == null ? '—' : money(row.amount)
              }}</template></el-table-column
            ><el-table-column prop="creator" label="创建人" width="100" /><el-table-column
              prop="status"
              label="状态"
              width="100"
              ><template #default="{ row }"
                ><el-tag type="warning">{{ row.status }}</el-tag></template
              ></el-table-column
            ><el-table-column label="操作" width="100" fixed="right"
              ><template #default="{ row }"
                ><el-button link type="primary" @click="openTodo(row)">去处理</el-button></template
              ></el-table-column
            ></el-table
          >
        </div>
        <div v-if="!todoRows.length" class="dashboard-empty">暂无待办，今天也很顺利。</div>
        <footer class="table-footer">
          <span>共 {{ todoTotal }} 条记录</span
          ><el-pagination
            v-model:current-page="todoQuery.page"
            v-model:page-size="todoQuery.pageSize"
            :total="todoTotal"
            layout="prev,pager,next"
            @change="loadTodos"
          />
        </footer>
      </div>
    </template>

    <template v-else-if="resource === 'messages'">
      <div class="panel message-center">
        <aside class="message-categories">
          <button
            v-for="category in categories"
            :key="category"
            :class="{ active: messageCategory === category }"
            @click="messageCategory = category"
          >
            <el-icon><Bell /></el-icon><span>{{ category }}</span
            ><b>{{ categoryCount(category) }}</b>
          </button>
        </aside>
        <div class="message-list">
          <button
            v-for="item in filteredMessages"
            :key="item.id"
            class="message-row"
            :class="{ unread: !item.isRead }"
            @click="readMessage(item)"
          >
            <span class="message-icon"
              ><el-icon
                ><Warning v-if="item.category === '预警消息'" /><CircleCheck
                  v-else-if="item.category === '审批消息'" /><Bell v-else /></el-icon></span
            ><span class="message-copy"
              ><strong>{{ item.title }}<i v-if="!item.isRead" /></strong
              ><small>{{ item.content || '暂无消息内容' }}</small
              ><time>{{ dateText(item.createdAt) }}</time></span
            ><b>›</b>
          </button>
          <div v-if="!filteredMessages.length" class="dashboard-empty">
            {{ messageCategory === '全部消息' ? '暂无消息' : `暂无${messageCategory}` }}
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="resource === 'shortcuts'">
      <div class="shortcut-grid">
        <button @click="quick('/sales/orders')">
          <el-icon><Goods /></el-icon
          ><span><strong>销售订单</strong><small>查询与处理客户订单</small></span
          ><b>›</b>
        </button>
        <button @click="quick('/purchase/orders')">
          <el-icon><ShoppingCart /></el-icon
          ><span><strong>采购订单</strong><small>查看采购执行情况</small></span
          ><b>›</b>
        </button>
        <button @click="quick('/inventory/stocks')">
          <el-icon><Box /></el-icon
          ><span><strong>库存查询</strong><small>查看仓库即时库存</small></span
          ><b>›</b>
        </button>
        <button @click="quick('/production/plans')">
          <el-icon><DataAnalysis /></el-icon
          ><span><strong>生产计划</strong><small>查看生产与缺料状态</small></span
          ><b>›</b>
        </button>
        <button @click="quick('/purchase/receipts', 'create')">
          <el-icon><ShoppingCart /></el-icon
          ><span><strong>采购入库</strong><small>快速创建采购入库单</small></span
          ><b>›</b>
        </button>
        <button @click="quick('/sales/outputs', 'create')">
          <el-icon><Goods /></el-icon
          ><span><strong>销售出库</strong><small>快速创建销售出库单</small></span
          ><b>›</b>
        </button>
        <button @click="quick('/requisitions/applications', 'create')">
          <el-icon><Tickets /></el-icon
          ><span><strong>领用申请</strong><small>快速发起物资领用</small></span
          ><b>›</b>
        </button>
        <button @click="quick('/dashboard/messages')">
          <el-icon><Bell /></el-icon
          ><span><strong>消息中心</strong><small>查看审批与预警消息</small></span
          ><b>›</b>
        </button>
      </div>
    </template>

    <template v-else>
      <div class="metric-grid">
        <article>
          <el-icon><DataAnalysis /></el-icon><span>本月销售额</span
          ><strong>{{ money(dashboard.salesAmount) }}</strong
          ><small>实时统计</small>
        </article>
        <article>
          <el-icon><ShoppingCart /></el-icon><span>本月采购额</span
          ><strong>{{ money(dashboard.purchaseAmount) }}</strong
          ><small>实时统计</small>
        </article>
        <article>
          <el-icon><Box /></el-icon><span>库存总值</span
          ><strong>{{ money(dashboard.inventoryValue) }}</strong
          ><small>按即时结存</small>
        </article>
        <article>
          <el-icon><Clock /></el-icon><span>待审核单据</span
          ><strong>{{ dashboard.pendingCount }} 笔</strong><small>全部业务模块</small>
        </article>
      </div>

      <div class="dashboard-grid">
        <article class="dashboard-card trend-card">
          <header>
            <div>
              <h3>采购 / 销售趋势</h3>
              <small>近 14 日 · 按创建日汇总</small>
            </div>
            <span class="legend"><i />销售 <i />采购</span>
          </header>
          <div class="trend-chart">
            <div v-for="item in dashboard.trend" :key="item.date" class="trend-day">
              <div class="bars">
                <i
                  :style="{ height: `${Math.max(4, (item.sales / maxTrend) * 150)}px` }"
                  :title="`销售 ${money(item.sales)}`"
                /><i
                  :style="{ height: `${Math.max(4, (item.purchase / maxTrend) * 150)}px` }"
                  :title="`采购 ${money(item.purchase)}`"
                />
              </div>
              <small>{{ item.date.slice(5).replace('-', '/') }}</small>
            </div>
          </div>
        </article>

        <article class="dashboard-card health-card">
          <header>
            <div>
              <h3>库存健康度</h3>
              <small>按即时结存测算</small>
            </div>
            <button @click="router.push('/inventory/stocks')">查看明细 ›</button>
          </header>
          <div class="health-content">
            <div
              class="health-ring"
              :style="{
                background: `conic-gradient(#078c68 0 ${dashboard.healthScore}%,#e9edf2 ${dashboard.healthScore}% 100%)`,
              }"
            >
              <span
                ><strong>{{ dashboard.healthScore }}</strong
                ><small>健康分</small></span
              >
            </div>
            <div class="health-counts">
              <p>
                <i class="good" />库存充足
                <strong>{{
                  Math.max(dashboard.inventoryCount - dashboard.lowStockCount, 0)
                }}</strong>
              </p>
              <p>
                <i class="low" />低库存 <strong>{{ dashboard.lowStockCount }}</strong>
              </p>
            </div>
          </div>
          <div v-if="dashboard.lowStockItem" class="stock-warning">
            <el-icon><Warning /></el-icon
            ><span
              ><strong>{{ dashboard.lowStockItem.name }}</strong
              ><small
                >当前库存 {{ dashboard.lowStockItem.stock }} · 安全库存
                {{ dashboard.lowStockItem.safetyStock }}</small
              ></span
            ><button @click="quick('/purchase/applications', 'create')">去补货</button>
          </div>
          <div v-else class="stock-clear">暂无库存预警</div>
        </article>

        <article class="dashboard-card todo-card">
          <header>
            <div>
              <h3>待办事项</h3>
              <small>需您处理的业务任务</small>
            </div>
            <button @click="router.push('/dashboard/todos')">全部待办 ›</button>
          </header>
          <button
            v-for="item in dashboard.todos"
            :key="item.id"
            class="todo-row"
            @click="openTodo(item)"
          >
            <el-icon><Clock /></el-icon
            ><span
              ><strong>{{ item.docType }} · {{ item.docNo }}</strong
              ><small
                >{{ item.businessModule }} · {{ item.counterparty || item.creator }}</small
              ></span
            ><span
              ><b>{{ money(item.amount) }}</b
              ><small>{{ item.date }}</small></span
            ><b>›</b>
          </button>
          <div v-if="!dashboard.todos?.length" class="dashboard-empty">
            暂无待办，今天也很顺利。
          </div>
        </article>

        <div class="dashboard-side">
          <article class="dashboard-card quick-card">
            <header>
              <div>
                <h3>快捷功能</h3>
                <small>高频业务快速发起</small>
              </div>
            </header>
            <div>
              <button @click="quick('/purchase/receipts', 'create')">
                <el-icon><ShoppingCart /></el-icon>采购入库单</button
              ><button @click="quick('/sales/outputs', 'create')">
                <el-icon><Goods /></el-icon>销售出库单</button
              ><button @click="quick('/requisitions/applications', 'create')">
                <el-icon><Tickets /></el-icon>领用申请单</button
              ><button @click="quick('/inventory/checks', 'create')">
                <el-icon><CircleCheck /></el-icon>库存盘点
              </button>
            </div>
          </article>
          <article
            class="dashboard-card message-summary"
            @click="router.push('/dashboard/messages')"
          >
            <header>
              <div>
                <h3>消息中心</h3>
                <small>{{ dashboard.unreadCount }} 条未读</small>
              </div>
              <el-icon><Bell /></el-icon>
            </header>
            <p v-for="item in dashboard.messages" :key="item.id">
              <i :class="{ read: item.isRead }" /><span>{{ item.title }}</span
              ><time>{{ dateText(item.createdAt).slice(5) }}</time>
            </p>
            <div v-if="!dashboard.messages?.length" class="dashboard-empty">暂无消息</div>
          </article>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
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
