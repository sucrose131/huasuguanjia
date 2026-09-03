<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '@/api';

const props = defineProps<{
  query: Record<string, any>;
  load: () => void;
  total: number;
  warehouseCounts?: Record<string, number>;
}>();

const tabs = ref<any[]>([]);

async function loadTabs() {
  tabs.value = (await api
    .get('/inventory/warehouses/tabs', {
      params: { orgId: props.query.orgId || undefined },
    })
    .catch(() => [])) as any[];
}

function selectWarehouse(value: unknown) {
  props.query.warehouseId = String(value ?? '');
  props.query.page = 1;
  props.load();
}

onMounted(loadTabs);
watch(
  () => props.query.orgId,
  async () => {
    props.query.warehouseId = '';
    await loadTabs();
  },
);
</script>

<template>
  <div class="warehouse-tabs">
    <button
      :class="{ active: !query.warehouseId }"
      @click="selectWarehouse('')"
    >
      全部 <span>{{ total }}</span>
    </button>
    <button
      v-for="item in tabs"
      :key="item.value"
      :class="{ active: String(query.warehouseId) === String(item.value) }"
      @click="selectWarehouse(item.value)"
    >
      {{ item.label }}
      <span>{{
        warehouseCounts != null
          ? (warehouseCounts[String(item.value)] ?? 0)
          : (item.count ?? 0)
      }}</span>
    </button>
  </div>
</template>

<style scoped>
.warehouse-tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 12px;
  padding: 2px;
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface-muted);
  overflow-x: auto;
}
.warehouse-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--hs-radius-sm);
  background: transparent;
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-body);
  white-space: nowrap;
  cursor: pointer;
}
.warehouse-tabs button.active {
  background: var(--hs-color-surface);
  color: var(--hs-color-text-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.06);
}
.warehouse-tabs button span {
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-helper);
}
</style>
