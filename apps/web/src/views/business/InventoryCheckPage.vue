<script setup lang="ts">
import { ref } from 'vue';
import { api } from '@/api';
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import WarehouseTabs from '@/components/business/WarehouseTabs.vue';
import { inventoryCheckConfig } from './configs/inventory-check';

const pageRef = ref<InstanceType<typeof BusinessDocumentPage>>();
const historyVisible = ref(false);
const historyRows = ref<any[]>([]);
const historyLoading = ref(false);

const quantity = (value: unknown) =>
  Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const dateText = (value: unknown) => (value ? String(value).slice(0, 10) : '—');

// 仓库筛选「全部」统计 = 各仓库盘点单数之和（与仓库 Tab 口径一致，不随选中仓库变化）
const orgWarehouseCheckTotal = (counts: Record<string, number>) =>
  Object.values(counts ?? {}).reduce((sum, value) => sum + Number(value ?? 0), 0);

function checkListSummary(rows: any[], total: number) {
  return {
    total,
    active: rows.filter(
      (row) => Number(row.status) === 0 && Number(row.approveStatus) === 0,
    ).length,
    pending: rows.filter(
      (row) => Number(row.status) === 1 && Number(row.approveStatus) === 0,
    ).length,
    abnormal: rows.filter(
      (row) =>
        Number(row.lessQty) > 0 || Number(row.overflowQty) > 0 || Number(row.damagedQty) > 0,
    ).length,
  };
}

async function openHistory() {
  historyVisible.value = true;
  historyLoading.value = true;
  try {
    const data: any = await api.get('/inventory/checks', { params: { page: 1, pageSize: 100 } });
    historyRows.value = data.items ?? [];
  } catch {
    historyRows.value = [];
  } finally {
    historyLoading.value = false;
  }
}

async function viewDetail(row: any) {
  historyVisible.value = false;
  const detail: any = await api.get(`/inventory/checks/${row.id}`).catch(() => null);
  if (!detail) return;
  pageRef.value?.openView({ ...detail, id: detail.id ?? row.id });
}
</script>

<template>
  <BusinessDocumentPage ref="pageRef" :config="inventoryCheckConfig">
    <template #summary="{ rows, total }">
      <div class="check-summary-strip">
        <div class="check-summary-item">
          <span>盘点单总数</span>
          <strong>{{ checkListSummary(rows, total).total }}</strong>
          <small>当前筛选范围</small>
        </div>
        <div class="check-summary-item check-summary-item--processing">
          <span>盘点进行中</span>
          <strong>{{ checkListSummary(rows, total).active }}</strong>
          <small>可继续录入实盘数量</small>
        </div>
        <div class="check-summary-item check-summary-item--warning">
          <span>待审批</span>
          <strong>{{ checkListSummary(rows, total).pending }}</strong>
          <small>等待确认盘点结果</small>
        </div>
        <div class="check-summary-item check-summary-item--danger">
          <span>存在差异</span>
          <strong>{{ checkListSummary(rows, total).abnormal }}</strong>
          <small>含盘亏、盘盈或损坏</small>
        </div>
      </div>
    </template>

    <template #query-tools="{ query, load, warehouseCounts }">
      <WarehouseTabs
        :query="query"
        :load="load"
        :total="orgWarehouseCheckTotal(warehouseCounts)"
        :warehouse-counts="warehouseCounts"
      />
    </template>

    <template #page-actions>
      <el-button @click="openHistory">盘点记录</el-button>
    </template>

    <el-dialog v-model="historyVisible" title="盘点记录" width="1280px" top="4vh">
      <div class="history-toolbar"><el-button @click="openHistory">重新加载</el-button></div>
      <el-table :data="historyRows" v-loading="historyLoading" border>
        <el-table-column prop="checkNo" label="盘点单号" width="150" />
        <el-table-column prop="checkTypeName" label="盘点类型" width="100" />
        <el-table-column prop="orgName" label="组织" min-width="110" />
        <el-table-column prop="warehouseName" label="仓库" min-width="110" />
        <el-table-column label="盘点日期" width="110">
          <template #default="s">{{ dateText(s.row.checkDate) }}</template>
        </el-table-column>
        <el-table-column prop="goodsCount" label="商品数" width="80" />
        <el-table-column label="盘亏 / 盘盈" width="120">
          <template #default="s"
            >{{ quantity(s.row.lessQty) }} / {{ quantity(s.row.overflowQty) }}</template
          >
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="s">
            <el-button link type="primary" @click="viewDetail(s.row)">查看明细</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="historyVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </BusinessDocumentPage>
</template>

<style scoped>
.check-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(160px, 1fr));
  border-bottom: 1px solid var(--hs-color-border);
  background: var(--hs-color-surface);
}
.check-summary-item {
  position: relative;
  min-height: 96px;
  padding: 16px 20px;
  border-right: 1px solid var(--hs-color-border);
}
.check-summary-item:last-child {
  border-right: 0;
}
.check-summary-item::before {
  content: '';
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 0;
  width: 3px;
  background: var(--hs-color-info);
}
.check-summary-item--processing::before {
  background: var(--hs-color-primary);
}
.check-summary-item--warning::before {
  background: var(--hs-color-warning);
}
.check-summary-item--danger::before {
  background: var(--hs-color-danger);
}
.check-summary-item span,
.check-summary-item small {
  display: block;
  color: var(--hs-color-text-secondary);
}
.check-summary-item span {
  font-size: 11px;
}
.check-summary-item strong {
  display: block;
  margin: 4px 0 2px;
  color: var(--hs-color-text-primary);
  font-size: 24px;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
}
.history-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}
</style>
