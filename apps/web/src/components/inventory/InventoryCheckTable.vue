<script setup lang="ts">
import BusinessStatusTag from '@/components/business/BusinessStatusTag.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import {
  inventoryCheckTableSchema,
  type InventoryCheckColumn,
} from '@/presentation/schemas/inventory-checks';

type Row = Record<string, any>;

const props = defineProps<{
  rows: Row[];
  loading: boolean;
  canEdit: (row: Row) => boolean;
  canApprove: (row: Row) => boolean;
  statusLabel: (row: Row) => string;
}>();

const emit = defineEmits<{
  view: [row: Row];
  trace: [row: Row];
  edit: [row: Row];
  approve: [row: Row];
  reject: [row: Row];
}>();

const quantity = (value: unknown) =>
  Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const dateText = (value: unknown) =>
  value ? new Date(String(value)).toLocaleDateString('zh-CN') : '—';
const progress = (row: Row) => {
  if (row.progressPct !== undefined && row.progressPct !== null)
    return Math.max(0, Math.min(100, Number(row.progressPct)));
  const total = Number(row.differenceQty ?? 0);
  return total > 0
    ? Math.max(0, Math.min(100, (Number(row.processedQty ?? 0) / total) * 100))
    : 100;
};
const statusSemantic = (row: Row) => {
  if (Number(row.approveStatus) === 1) return 'success' as const;
  if (Number(row.approveStatus) === 2) return 'danger' as const;
  if (Number(row.status) === 0) return 'processing' as const;
  return 'warning' as const;
};
const differenceClass = (column: InventoryCheckColumn, row: Row) => {
  const value = Number(row[column.key] ?? 0);
  if (value <= 0) return 'difference-value--empty';
  if (column.key === 'overflowQty') return 'difference-value--positive';
  return 'difference-value--negative';
};
</script>

<template>
  <el-table
    :data="props.rows"
    :row-key="inventoryCheckTableSchema.rowKey"
    :stripe="inventoryCheckTableSchema.stripe"
    v-loading="props.loading"
    class="business-table inventory-check-table"
    height="calc(100vh - 360px)"
    empty-text="暂无盘点单，可点击右上角新增盘点"
  >
    <el-table-column type="index" label="序号" width="62" fixed="left" align="center" />
    <el-table-column prop="id" label="ID" width="100" fixed="left" />
    <el-table-column
      v-for="column in inventoryCheckTableSchema.columns"
      :key="column.key"
      :prop="column.key"
      :label="column.label"
      :width="column.width"
      :min-width="column.minWidth"
      :fixed="column.fixed"
      :align="column.align"
      show-overflow-tooltip
    >
      <template #default="{ row }">
        <button
          v-if="column.key === 'checkNo'"
          type="button"
          class="document-link"
          @click="emit('view', row)"
        >
          {{ row.checkNo || '—' }}
        </button>
        <span v-else-if="column.kind === 'date'">{{ dateText(row[column.key]) }}</span>
        <span v-else-if="column.kind === 'quantity'" class="numeric-value">{{
          quantity(row[column.key])
        }}</span>
        <span
          v-else-if="column.kind === 'difference'"
          class="difference-value"
          :class="differenceClass(column, row)"
        >
          {{ quantity(row[column.key]) }}
        </span>
        <div v-else-if="column.kind === 'progress'" class="progress-cell">
          <el-progress
            :percentage="Math.round(progress(row))"
            :stroke-width="6"
            :show-text="false"
          />
          <span>{{ progress(row).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) }}%</span>
        </div>
        <BusinessStatusTag
          v-else-if="column.kind === 'status'"
          :semantic="statusSemantic(row)"
          :text="props.statusLabel(row)"
        />
        <span v-else>{{ row[column.key] ?? '—' }}</span>
      </template>
    </el-table-column>

    <el-table-column label="操作" width="176" fixed="right" align="center">
      <template #default="{ row }">
        <TableRowActions>
          <el-button link @click="emit('view', row)">查看</el-button>
          <el-button v-if="props.canEdit(row)" link type="primary" @click="emit('edit', row)"
            >继续盘点</el-button
          >
          <el-button
            v-else-if="props.canApprove(row)"
            link
            type="success"
            @click="emit('approve', row)"
            >审核通过</el-button
          >
          <template #more>
            <!-- 暂时隐藏“业务链路”入口，保留底层查询能力以便后续恢复。
            <el-dropdown-item @click="emit('trace', row)">查看业务链路</el-dropdown-item>
            -->
            <el-dropdown-item
              v-if="props.canApprove(row)"
              class="table-action-danger"
              divided
              @click="emit('reject', row)"
              >驳回盘点</el-dropdown-item
            >
          </template>
        </TableRowActions>
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.business-table {
  --el-table-header-bg-color: var(--hs-color-surface-muted);
  --el-table-row-hover-bg-color: var(--hs-color-primary-soft);
  color: var(--hs-color-text-regular);
}

.document-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--hs-color-primary);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.numeric-value,
.difference-value {
  display: block;
  font-variant-numeric: tabular-nums;
}

.difference-value--empty {
  color: var(--hs-color-text-secondary);
}

.difference-value--positive {
  color: var(--hs-color-success);
  font-weight: 650;
}

.difference-value--negative {
  color: var(--hs-color-danger);
  font-weight: 650;
}

.progress-cell {
  display: grid;
  grid-template-columns: minmax(58px, 1fr) 38px;
  align-items: center;
  gap: var(--hs-space-2);
  color: var(--hs-color-text-secondary);
  font-size: 10px;
}
</style>
