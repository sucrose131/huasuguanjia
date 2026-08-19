<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue';
import { api } from '@/api';
import { dateText } from '@/utils/format';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'cancel'): void }>();

const form = computed(() => props.modelValue);
const options = reactive<Record<string, any>>({ orgs: [], warehouses: [] });

function lookup(list: any[], value: unknown, fallback: unknown = '—') {
  return list.find((x) => String(x.value) === String(value))?.label ?? fallback;
}

const orgName = computed(() => form.value.orgName ?? lookup(options.orgs, form.value.orgId));
const warehouseName = computed(
  () => form.value.warehouseName ?? lookup(options.warehouses, form.value.warehouseId),
);

onMounted(async () => {
  const [orgs, warehouses] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/warehouses/options').catch(() => []),
  ]);
  options.orgs = orgs;
  options.warehouses = warehouses;
  if (form.value.id) {
    const detail: any = await api
      .get(`/inventory/overflow-inputs/${form.value.id}`)
      .catch(() => null);
    if (detail) Object.assign(form.value, detail);
  }
});
</script>

<template>
  <el-descriptions :column="2" border>
    <el-descriptions-item label="入库单号">{{ form.businessNo || '—' }}</el-descriptions-item>
    <el-descriptions-item label="来源盘盈单">{{ form.sourceOverflowNo || '—' }}</el-descriptions-item>
    <el-descriptions-item label="组织">{{ orgName }}</el-descriptions-item>
    <el-descriptions-item label="仓库">{{ warehouseName }}</el-descriptions-item>
    <el-descriptions-item label="入库时间">{{ dateText(form.inputDate || form.date, true) }}</el-descriptions-item>
    <el-descriptions-item label="原因" :span="2">{{ form.reason || '—' }}</el-descriptions-item>
  </el-descriptions>

  <div class="details-header"><span class="details-title">明细</span></div>
  <el-table :data="form.details ?? []" border size="small">
    <el-table-column prop="goodsName" label="商品名称" min-width="140" />
    <el-table-column prop="skuSpec" label="SKU/规格" min-width="120" />
    <el-table-column label="批号" min-width="120">
      <template #default="s">{{ s.row.batchNo || '无批号' }}</template>
    </el-table-column>
    <el-table-column prop="unitName" label="单位" width="80" />
    <el-table-column label="数量" width="100">
      <template #default="s">{{ Number(s.row.quantity ?? 0).toLocaleString() }}</template>
    </el-table-column>
    <el-table-column label="金额" width="120">
      <template #default="s">{{
        Number(s.row.amount ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
      }}</template>
    </el-table-column>
  </el-table>

  <div class="form-actions">
    <el-button @click="emit('cancel')">关闭</el-button>
  </div>
</template>

<style scoped>
.details-header {
  margin: 12px 0 8px;
}
.details-title {
  font-weight: 600;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
