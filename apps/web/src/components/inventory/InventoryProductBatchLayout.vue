<script setup lang="ts">
import { computed, ref, watch } from 'vue';

type ProductGroup = Record<string, any> & {
  key: string;
  batches?: any[];
};

const props = withDefaults(
  defineProps<{
    groups: ProductGroup[];
    productTitle?: string;
    productEmptyText?: string;
    batchEmptyText?: string;
    height?: number;
  }>(),
  {
    productTitle: '盘点商品',
    productEmptyText: '暂无商品',
    batchEmptyText: '请先从左侧选择商品查看对应批次',
    height: 360,
  },
);

const emit = defineEmits<{ (event: 'select', group?: ProductGroup): void }>();
const selected = ref<ProductGroup>();
const batches = computed(() => selected.value?.batches ?? []);

function selectProduct(group?: ProductGroup) {
  selected.value = group;
  emit('select', group);
}

watch(
  () => props.groups,
  (groups) => {
    const currentKey = selected.value?.key;
    selectProduct(groups.find((group) => group.key === currentKey) ?? groups[0]);
  },
  { immediate: true },
);
</script>

<template>
  <div class="inventory-product-batch-layout">
    <div class="inventory-product-panel">
      <div class="inventory-panel-heading">
        <strong>{{ productTitle }}</strong>
        <span>共 {{ groups.length }} 项，点击切换</span>
      </div>
      <el-table
        :data="groups"
        border
        highlight-current-row
        row-key="key"
        :height="height"
        :empty-text="productEmptyText"
        class="inventory-product-table"
        @current-change="selectProduct"
      >
        <el-table-column label="商品编码 / 名称 / 规格" min-width="220" show-overflow-tooltip>
          <template #default="scope">
            <div class="inventory-product-cell">
              <strong>{{ scope.row.goodsCode || '—' }} · {{ scope.row.goodsName || '—' }}</strong>
              <span>{{ scope.row.skuSpec || '默认规格' }} · {{ scope.row.unitName || '—' }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="批次" width="56" align="center">
          <template #default="scope">{{ scope.row.batches?.length ?? 0 }}</template>
        </el-table-column>
      </el-table>
    </div>

    <div class="inventory-batch-panel">
      <div class="inventory-panel-heading">
        <strong>{{ selected ? `${selected.goodsName}的批次明细` : '批次明细' }}</strong>
        <span v-if="selected">
          {{ selected.goodsCode }} · {{ selected.skuSpec || '默认规格' }} · 共
          {{ batches.length }} 个批次
        </span>
        <span v-else>请先从左侧选择商品</span>
      </div>
      <slot name="batches" :group="selected" :batches="batches">
        <el-empty :description="batchEmptyText" />
      </slot>
    </div>
  </div>
</template>

<style scoped>
.inventory-product-batch-layout {
  display: grid;
  grid-template-columns: minmax(288px, 28%) minmax(0, 1fr);
  gap: var(--hs-space-3);
  align-items: stretch;
}
.inventory-product-panel,
.inventory-batch-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface);
}
.inventory-panel-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--hs-space-3);
  min-height: 44px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--hs-color-border);
  background: var(--hs-color-surface-muted);
}
.inventory-panel-heading strong {
  min-width: 0;
  overflow: hidden;
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-section);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inventory-panel-heading span {
  flex: none;
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-helper);
}
.inventory-product-cell {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.inventory-product-cell strong,
.inventory-product-cell span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inventory-product-cell strong {
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-body);
}
.inventory-product-cell span {
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-helper);
}
:deep(.inventory-product-table .el-table__header-wrapper th) {
  background: var(--hs-color-surface-muted);
  color: var(--hs-color-text-primary);
  font-weight: 650;
}
:deep(.inventory-product-table .el-table__body td) {
  height: var(--hs-list-row-height);
}
@media (max-width: 960px) {
  .inventory-product-batch-layout {
    grid-template-columns: 1fr;
  }
}
</style>
