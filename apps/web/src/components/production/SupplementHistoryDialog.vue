<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '@/api';
import {
  confirmPendingSupplement as confirmSupplement,
  supplementHistoryAction,
} from './supplement-history-actions';
import { dateText } from '@/utils/format';

type BusinessRow = Record<string, any>;

const props = defineProps<{ modelValue: boolean; outDoc: BusinessRow }>();
const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'updated'): void;
  (event: 'bom-return', row: BusinessRow): void;
}>();

const loading = ref(false);
const error = ref('');
const items = ref<BusinessRow[]>([]);
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

async function load() {
  if (!props.outDoc?.id) return;
  loading.value = true;
  error.value = '';
  try {
    const detail: any = await api.get(`/production/outputs/${props.outDoc.id}`);
    items.value = detail.supplements ?? [];
  } catch (cause: any) {
    error.value = cause?.response?.data?.message ?? '补料明细加载失败';
    items.value = [];
  } finally {
    loading.value = false;
  }
}

async function confirmPendingSupplement(row: BusinessRow) {
  await confirmSupplement(row);
  await load();
  emit('updated');
}

watch(
  () => [props.modelValue, props.outDoc?.id],
  ([opened]) => {
    if (opened) load();
  },
);

defineExpose({ load });
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`补料明细 · ${outDoc.outNo ?? outDoc.id ?? ''}`"
    width="920px"
    :close-on-click-modal="false"
  >
    <div v-loading="loading" class="supplement-history">
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <el-empty
        v-else-if="!loading && !items.length"
        description="当前生产出库单暂无补料记录"
        :image-size="72"
      />
      <el-collapse v-else-if="!loading">
        <el-collapse-item
          v-for="item in items"
          :key="String(item.id)"
          :title="`${item.outNo ?? '补料单'} · ${dateText(item.outDate ?? item.createdAt)}`"
          :name="String(item.id)"
        >
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="补料单号">{{ item.outNo ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="仓库">{{ item.warehouseName ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="确认状态">{{ item.confirmStatusName ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="创建人">{{ item.createdByName ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="补料日期">{{ dateText(item.outDate ?? item.createdAt) }}</el-descriptions-item>
            <el-descriptions-item label="备注">{{ item.remark ?? '—' }}</el-descriptions-item>
          </el-descriptions>
          <el-table :data="item.details ?? []" border stripe class="detail-table">
            <el-table-column prop="goodsCode" label="商品编码" min-width="125" />
            <el-table-column prop="goodsName" label="物料名称" min-width="150" />
            <el-table-column prop="skuSpec" label="规格" min-width="120" />
            <el-table-column prop="batchNo" label="批号" min-width="120" />
            <el-table-column prop="quantity" label="补料数量" min-width="105" align="right" />
            <el-table-column prop="unitName" label="单位" width="90" />
            <el-table-column label="操作" width="120" align="center">
              <template #default>
                <el-button
                  v-if="supplementHistoryAction(item) === 'confirm'"
                  link
                  type="primary"
                  @click="confirmPendingSupplement(item)"
                  >确认出库</el-button
                >
                <el-button v-else link type="success" @click="emit('bom-return', item)"
                  >BOM退库</el-button
                >
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.supplement-history {
  min-height: 180px;
}
.detail-table {
  margin-top: 14px;
}
</style>
