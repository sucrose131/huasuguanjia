<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import { dateText } from '@/utils/format';
import { canPageAction } from '@/utils/permission';
import { useAuthStore } from '@/stores/auth';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';
import TableRowActions from '@/components/business/TableRowActions.vue';
import OverflowTooltipCell from '@/components/business/OverflowTooltipCell.vue';
import StatusTag from '@/components/StatusTag.vue';

type Row = Record<string, any>;

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const rows = ref<Row[]>([]);
const total = ref(0);
const loading = ref(false);
const summary = reactive<Record<string, any>>({ itemCount: 0, totalAmount: 0, warningCount: 0 });
const recentLedger = ref<Row[]>([]);
const ledger = ref<Row[]>([]);
const ledgerDialog = ref(false);
const ledgerContext = reactive({ title: '', subtitle: '' });

const organizationTree = computed(() =>
  buildOrganizationTree(options.orgs as OrganizationTreeNode[]),
);
const stockScopeReady = computed(() => Boolean(query.orgId));
const stockView = ref<'inventory' | 'requisition'>('inventory');

const query = reactive<Record<string, any>>({
  page: 1,
  pageSize: 20,
  keyword: '',
  orgId: '',
  warehouseId: '',
  batchNo: '',
  inStockOnly: true,
  departmentId: '',
  receiverId: '',
  holdingStatus: 'all',
  dateRange: [] as string[],
});

const options = reactive<Record<string, any>>({
  orgs: [],
  warehouses: [],
  depts: [],
  employees: [],
  warehouseTabs: [],
});

const stockDepartments = computed(() =>
  (options.depts ?? []).filter(
    (item: any) =>
      !query.orgId || String(item.raw?.orgId ?? item.orgId ?? '') === String(query.orgId),
  ),
);
const stockReceivers = computed(() =>
  (options.employees ?? []).filter(
    (item: any) =>
      !query.orgId || String(item.raw?.orgId ?? item.orgId ?? '') === String(query.orgId),
  ),
);

function quantity(value: unknown) {
  const n = Number(value);
  return value === null || value === undefined || value === '' || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
}
function money(value: unknown) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || Number.isNaN(n)) return '—';
  const level = localStorage.getItem('hspsi_amount_access') ?? 'none';
  if (!['view', 'edit'].includes(level)) return '****';
  return `¥ ${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function params() {
  const result: Record<string, any> = { page: query.page, pageSize: query.pageSize };
  for (const key of ['keyword', 'orgId', 'warehouseId', 'batchNo', 'departmentId', 'receiverId']) {
    if (query[key] !== '' && query[key] !== null && query[key] !== undefined)
      result[key] = query[key];
  }
  if (stockView.value === 'inventory') {
    if (query.inStockOnly) result.inStockOnly = true;
  } else {
    if (query.holdingStatus === 'holding') result.holdingStatus = 'holding';
    if (query.holdingStatus === 'returned') result.holdingStatus = 'returned';
    if (Array.isArray(query.dateRange) && query.dateRange.length === 2) {
      result.dateStart = query.dateRange[0];
      result.dateEnd = query.dateRange[1];
    }
  }
  return result;
}

async function loadWarehouseTabs(orgId: unknown) {
  options.warehouseTabs = orgId
    ? ((await api
        .get('/inventory/warehouses/tabs', { params: { orgId } })
        .catch(() => [])) as any[])
    : [];
}
function warehouseTabCount(item: any) {
  const key = String(item.value);
  if (stockView.value === 'requisition') return total;
  return rows.value.filter((r: Row) => String(r.warehouseId) === key).length;
}

async function load() {
  if (!stockScopeReady.value) {
    rows.value = [];
    total.value = 0;
    recentLedger.value = [];
    Object.assign(summary, { itemCount: 0, totalAmount: 0, warningCount: 0 });
    return;
  }
  loading.value = true;
  try {
    const endpoint = stockView.value === 'requisition' ? 'requisition-history' : 'stocks';
    const result = (await api.get(`/inventory/${endpoint}`, { params: params() })) as any;
    rows.value = result.items ?? [];
    total.value = Number(result.total ?? rows.value.length);
    Object.assign(summary, result.summary ?? {});
    if (stockView.value === 'inventory') {
      const recent = (await api.get('/inventory/ledger', {
        params: {
          page: 1,
          pageSize: 8,
          orgId: query.orgId,
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        },
      })) as any;
      recentLedger.value = recent.items ?? [];
    }
  } finally {
    loading.value = false;
  }
}

async function loadOptions() {
  const [orgs, depts, warehouses, employees] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/departments/options').catch(() => []),
    api.get('/base-data/warehouses/options').catch(() => []),
    // 领用人筛选按系统用户（领用出库 receiver_id 为 sys_user id）
    api.get('/inventory/users/options').catch(() => []),
  ]);
  options.orgs = orgs;
  options.depts = depts;
  options.warehouses = warehouses;
  options.employees = employees;
}

async function organizationChanged(value: unknown) {
  query.orgId = String(value ?? '');
  query.warehouseId = '';
  query.page = 1;
  query.departmentId = '';
  query.receiverId = '';
  rows.value = [];
  total.value = 0;
  recentLedger.value = [];
  Object.assign(summary, { itemCount: 0, totalAmount: 0, warningCount: 0 });
  await loadWarehouseTabs(query.orgId);
  options.employees = (await api
    .get('/inventory/users/options', { params: { orgId: query.orgId } })
    .catch(() => [])) as any[];
  await load();
}

function changeStockView(value: 'inventory' | 'requisition') {
  stockView.value = value;
  query.page = 1;
  query.warehouseId = '';
  rows.value = [];
  total.value = 0;
  load();
}

function resetQuery() {
  Object.assign(query, {
    page: 1,
    keyword: '',
    warehouseId: '',
    batchNo: '',
    inStockOnly: true,
    departmentId: '',
    receiverId: '',
    holdingStatus: 'all',
    dateRange: [],
  });
  load();
}

function selectWarehouse(value: unknown) {
  query.warehouseId = String(value ?? '');
  query.page = 1;
  load();
}

async function showLedger(row: Row) {
  const result = (await api.get('/inventory/ledger', {
    params: {
      goodsId: row.goodsId,
      skuId: row.skuId,
      warehouseId: row.warehouseId,
      ...(row.batchNo !== undefined ? { batchNo: row.batchNo } : {}),
      pageSize: 100,
    },
  })) as any;
  ledger.value = result.items ?? [];
  Object.assign(ledgerContext, {
    title: row.goodsName || '库存流水',
    subtitle: `${row.goodsCode || ''} · ${row.warehouseName || ''}`,
  });
  ledgerDialog.value = true;
}

function adjustStock(row: Row) {
  router.push({
    path: '/inventory/adjustments',
    query: {
      create: '1',
      goodsId: String(row.goodsId),
      skuId: String(row.skuId),
      warehouseId: String(row.warehouseId),
      batchNo: String(row.batchNo ?? ''),
    },
  });
}

onMounted(async () => {
  await loadOptions();
  await load();
});
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>库存查询</h2>
        <p class="page-subtitle">按仓库查看即时库存、库存金额及可追溯流水</p>
      </div>
    </header>

    <div class="panel">
      <div class="inventory-org-scope">
        <div class="inventory-org-scope__intro">
          <strong>库存组织</strong>
          <span>请先选择组织，再查看该组织下的仓库和库存</span>
        </div>
        <el-tree-select
          v-model="query.orgId"
          :data="organizationTree"
          class="inventory-org-scope__select"
          clearable
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          placeholder="请选择组织"
          @change="organizationChanged"
        />
        <el-radio-group
          v-if="stockScopeReady"
          :model-value="stockView"
          @update:model-value="changeStockView($event as 'inventory' | 'requisition')"
        >
          <el-radio-button value="inventory">仓库库存</el-radio-button>
          <el-radio-button value="requisition">领用记录</el-radio-button>
        </el-radio-group>
      </div>

      <div v-if="stockScopeReady" class="summary-strip">
        <template v-if="stockView === 'inventory'">
          <div class="summary-item">
            <span class="summary-label">库存品项</span
            ><strong class="summary-value">{{ summary.itemCount || total }}</strong>
          </div>
          <div class="summary-item">
            <span class="summary-label">库存总值</span
            ><strong class="summary-value">{{ money(summary.totalAmount) }}</strong>
          </div>
          <div class="summary-item">
            <span class="summary-label">库存预警</span
            ><strong class="summary-value">{{ summary.warningCount }}</strong>
          </div>
        </template>
        <template v-else>
          <div class="summary-item">
            <span class="summary-label">领用明细</span
            ><strong class="summary-value">{{ total }}</strong>
          </div>
          <div class="summary-item">
            <span class="summary-label">累计领用</span
            ><strong class="summary-value">{{ quantity(summary.issuedQty) }}</strong>
          </div>
          <div class="summary-item">
            <span class="summary-label">累计退回</span
            ><strong class="summary-value">{{ quantity(summary.returnedQty) }}</strong>
          </div>
          <div class="summary-item">
            <span class="summary-label">当前持有</span
            ><strong class="summary-value">{{ quantity(summary.holdingQty) }}</strong>
          </div>
        </template>
      </div>

      <div v-if="stockScopeReady && stockView === 'inventory'" class="warehouse-tabs">
        <button :class="{ active: !query.warehouseId }" @click="selectWarehouse('')">
          全部 <span>{{ summary.itemCount || total }}</span>
        </button>
        <button
          v-for="item in options.warehouseTabs"
          :key="item.value"
          :class="{ active: String(query.warehouseId) === String(item.value) }"
          @click="selectWarehouse(item.value)"
        >
          {{ item.label }} <span>{{ warehouseTabCount(item) }}</span>
        </button>
      </div>

      <div v-if="stockScopeReady" class="query-bar">
        <el-input
          v-model="query.keyword"
          class="query-field keyword"
          clearable
          placeholder="商品编码 / 名称 / SKU"
          @keyup.enter="query.page = 1; load()"
        />
        <el-select
          v-if="stockView === 'requisition'"
          v-model="query.departmentId"
          class="query-field"
          clearable
          filterable
          placeholder="全部部门"
        >
          <el-option v-for="item in stockDepartments" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select
          v-if="stockView === 'requisition'"
          v-model="query.receiverId"
          class="query-field"
          clearable
          filterable
          placeholder="全部领用人"
        >
          <el-option v-for="item in stockReceivers" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-input v-model="query.batchNo" class="query-field" clearable placeholder="批号" />
        <el-date-picker
          v-if="stockView === 'requisition'"
          v-model="query.dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="领用开始日期"
          end-placeholder="领用结束日期"
          class="query-date-range"
        />
        <el-select v-if="stockView === 'requisition'" v-model="query.holdingStatus" class="query-field">
          <el-option label="全部领用历史" value="all" />
          <el-option label="仅看持有结存" value="holding" />
          <el-option label="仅看已退清" value="returned" />
        </el-select>
        <el-checkbox v-if="stockView === 'inventory'" v-model="query.inStockOnly"
          >仅显示有库存</el-checkbox
        >
        <span class="query-actions">
          <el-button type="primary" @click="query.page = 1; load()">查询</el-button>
          <el-button @click="resetQuery">重置</el-button>
        </span>
      </div>

      <div v-if="!stockScopeReady" class="inventory-org-empty">
        <el-empty description="请先选择组织，再查看该组织下的仓库与库存数据" />
      </div>

      <div v-if="stockScopeReady" class="table-wrap">
        <el-table :data="rows" v-loading="loading" border stripe row-key="id">
          <template v-if="stockView === 'inventory'">
            <el-table-column prop="goodsCode" label="商品编码" width="125" />
            <el-table-column prop="goodsName" label="商品名称" min-width="150" />
            <el-table-column prop="skuSpec" label="规格" min-width="120" />
            <el-table-column prop="orgName" label="组织" min-width="110" />
            <el-table-column prop="warehouseName" label="所在仓库" min-width="120" />
            <el-table-column label="即时结存" width="100" align="right">
              <template #default="s">{{ quantity(s.row.inventoryQty) }}</template>
            </el-table-column>
            <el-table-column label="累计入库" width="100" align="right">
              <template #default="s">{{ quantity(s.row.inputQty) }}</template>
            </el-table-column>
            <el-table-column label="累计出库" width="100" align="right">
              <template #default="s">{{ quantity(s.row.outputQty) }}</template>
            </el-table-column>
            <el-table-column label="单位成本" width="100" align="right">
              <template #default="s">{{ money(s.row.unitCost) }}</template>
            </el-table-column>
            <el-table-column label="库存金额" width="110" align="right">
              <template #default="s">{{ money(s.row.inventoryAmount) }}</template>
            </el-table-column>
            <el-table-column label="库存状态" width="90">
              <template #default="s">
                <StatusTag :value="Number(s.row.inventoryQty) > 0 ? '正常' : '无库存'" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="132" fixed="right" align="center">
              <template #default="s">
                <TableRowActions>
                  <el-button link type="primary" @click="showLedger(s.row)">查看</el-button>
                  <el-button
                    v-if="canPageAction(auth.user, '/inventory/adjustments', 'create')"
                    link
                    type="primary"
                    @click="adjustStock(s.row)"
                    >调整</el-button
                  >
                </TableRowActions>
              </template>
            </el-table-column>
          </template>
          <template v-else>
            <el-table-column prop="outputNo" label="领用出库单" width="165" />
            <el-table-column prop="applicationNo" label="领用申请单" width="165" />
            <el-table-column label="领用日期" width="112">
              <template #default="s">{{ dateText(s.row.outputDate) }}</template>
            </el-table-column>
            <el-table-column prop="departmentName" label="部门" min-width="110" />
            <el-table-column prop="receiverName" label="领用人" width="100" />
            <el-table-column prop="goodsCode" label="商品编码" width="125" />
            <el-table-column prop="goodsName" label="商品名称" min-width="145" />
            <el-table-column prop="skuSpec" label="SKU规格" min-width="130" />
            <el-table-column prop="batchNo" label="批号" width="135" />
            <el-table-column prop="warehouseName" label="领出仓库" min-width="120" />
            <el-table-column label="领用数量" width="92" align="right">
              <template #default="s">{{ quantity(s.row.issuedQty) }}</template>
            </el-table-column>
            <el-table-column label="已退数量" width="92" align="right">
              <template #default="s">{{ quantity(s.row.returnedQty) }}</template>
            </el-table-column>
            <el-table-column label="持有结存" width="92" align="right">
              <template #default="s">{{
                s.row.returnable ? quantity(s.row.remainingQty) : '—'
              }}</template>
            </el-table-column>
            <el-table-column label="归还状态" width="95" fixed="right">
              <template #default="s">
                <StatusTag :value="s.row.holdingStatusName || '—'" />
              </template>
            </el-table-column>
          </template>
        </el-table>
      </div>

      <div v-if="stockScopeReady" class="table-footer">
        <span class="result-total">共 {{ total }} 条</span>
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="load"
          @size-change="query.page = 1; load()"
        />
      </div>
    </div>

    <div v-if="stockScopeReady && stockView === 'inventory'" class="panel recent-panel">
      <div class="panel-title">最近库存流水</div>
      <el-table :data="recentLedger" border>
        <el-table-column label="发生时间" width="150">
          <template #default="s">{{ dateText(s.row.createdAt, true) }}</template>
        </el-table-column>
        <el-table-column prop="goodsName" label="商品" min-width="140" />
        <el-table-column label="业务模式" width="130">
          <template #default="s">{{ s.row.businessModeName || s.row.sourceType }}</template>
        </el-table-column>
        <el-table-column prop="sourceNo" label="来源单号" width="145" />
        <el-table-column label="入库" width="85" align="right">
          <template #default="s">{{ quantity(s.row.inputQty) }}</template>
        </el-table-column>
        <el-table-column label="出库" width="85" align="right">
          <template #default="s">{{ quantity(s.row.outputQty) }}</template>
        </el-table-column>
        <el-table-column label="变动后库存" width="105" align="right">
          <template #default="s">{{ quantity(s.row.afterQty) }}</template>
        </el-table-column>
        <el-table-column prop="operatorName" label="操作人" width="90" />
      </el-table>
    </div>

    <el-dialog v-model="ledgerDialog" :title="ledgerContext.title" width="1120px" top="5vh">
      <p class="muted" style="margin: 0 0 12px">{{ ledgerContext.subtitle }}</p>
      <el-table :data="ledger" border size="small" max-height="460">
        <el-table-column label="时间" width="155">
          <template #default="s">{{ dateText(s.row.createdAt, true) }}</template>
        </el-table-column>
        <el-table-column label="操作类型" min-width="110">
          <template #default="s">{{ s.row.operationTypeName || s.row.operationType || '—' }}</template>
        </el-table-column>
        <el-table-column label="业务模式/单据类型" width="150">
          <template #default="s">{{ s.row.businessModeName || s.row.sourceType || '—' }}</template>
        </el-table-column>
        <el-table-column label="入库" width="90" align="right">
          <template #default="s">{{ quantity(s.row.inputQty) }}</template>
        </el-table-column>
        <el-table-column label="出库" width="90" align="right">
          <template #default="s">{{ quantity(s.row.outputQty) }}</template>
        </el-table-column>
        <el-table-column label="结存" width="95" align="right">
          <template #default="s">{{ quantity(s.row.afterQty) }}</template>
        </el-table-column>
        <el-table-column prop="sourceNo" label="来源单号" min-width="140" />
        <el-table-column label="批号" width="120">
          <template #default="s">{{ s.row.batchNo || '无批号' }}</template>
        </el-table-column>
        <el-table-column prop="operatorName" label="操作人" width="90" />
        <el-table-column label="备注" min-width="140">
          <template #default="s">
            <OverflowTooltipCell :content="s.row.remark || '—'">{{
              s.row.remark || '—'
            }}</OverflowTooltipCell>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </section>
</template>

<style scoped>
.inventory-org-scope {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--hs-border);
  background: #fafbfd;
}
.inventory-org-scope__intro {
  display: flex;
  flex-direction: column;
}
.inventory-org-scope__intro strong {
  font-size: 13px;
  color: #172238;
}
.inventory-org-scope__intro span {
  font-size: 10px;
  color: #7b8798;
}
.inventory-org-scope__select {
  width: 280px;
}
.inventory-org-empty {
  padding: 24px 0;
}
.warehouse-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--hs-border);
}
.warehouse-tabs button {
  border: 1px solid var(--hs-border);
  background: #fff;
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 12px;
  color: #46516a;
  cursor: pointer;
}
.warehouse-tabs button.active {
  border-color: var(--hs-primary);
  color: var(--hs-primary);
  background: rgba(24, 104, 253, 0.06);
}
.warehouse-tabs button span {
  color: #9aa4b5;
  margin-left: 4px;
}
.query-date-range {
  width: 250px;
}
.recent-panel {
  margin-top: 14px;
}
.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: #172238;
  padding: 12px 14px;
  border-bottom: 1px solid var(--hs-border);
}
</style>
