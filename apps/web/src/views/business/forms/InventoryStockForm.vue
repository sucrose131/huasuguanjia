<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '@/api';
import { dateText } from '@/utils/format';

/**
 * 库存查询只读表单：展示当前批次基本信息 + 库存台账流水。
 * 无保存/编辑，仅查看（mode 固定为 'view' 使用）。
 */
const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const form = computed(() => props.modelValue);

const ledger = ref<Record<string, any>[]>([]);
const ledgerLoading = ref(false);

function text(value: unknown) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}
function quantity(value: unknown) {
  const n = Number(value);
  return value === null || value === undefined || value === '' || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('zh-CN');
}
function money(value: unknown) {
  const n = Number(value);
  return value === null || value === undefined || value === '' || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadLedger() {
  const row = form.value;
  if (!row.goodsId || !row.skuId || !row.warehouseId) return;
  ledgerLoading.value = true;
  try {
    const params: Record<string, any> = {
      goodsId: String(row.goodsId),
      skuId: String(row.skuId),
      warehouseId: String(row.warehouseId),
    };
    if (row.batchNo) params.batchNo = String(row.batchNo);
    const data: any = await api.get('/inventory/ledger', { params });
    ledger.value = data?.items ?? [];
  } catch {
    ledger.value = [];
  } finally {
    ledgerLoading.value = false;
  }
}

onMounted(loadLedger);
</script>

<template>
  <el-form label-position="top" :disabled="true">
    <div class="form-grid">
      <el-form-item label="商品">
        <el-input :model-value="text(form.goodsName)" readonly />
      </el-form-item>
      <el-form-item label="商品编码">
        <el-input :model-value="text(form.goodsCode)" readonly />
      </el-form-item>
      <el-form-item label="SKU/规格">
        <el-input :model-value="text(form.skuSpec)" readonly />
      </el-form-item>
      <el-form-item label="批号">
        <el-input :model-value="text(form.batchNo)" readonly />
      </el-form-item>
      <el-form-item label="组织">
        <el-input :model-value="text(form.orgName)" readonly />
      </el-form-item>
      <el-form-item label="仓库">
        <el-input :model-value="text(form.warehouseName)" readonly />
      </el-form-item>
      <el-form-item label="当前库存">
        <el-input :model-value="quantity(form.inventoryQty)" readonly />
      </el-form-item>
      <el-form-item label="可用数量">
        <el-input :model-value="quantity(form.availableQty)" readonly />
      </el-form-item>
      <el-form-item label="库存金额">
        <el-input :model-value="money(form.inventoryAmount)" readonly />
      </el-form-item>
    </div>

    <div class="ledger-header">
      <span class="ledger-title">库存流水</span>
    </div>
    <el-table :data="ledger" v-loading="ledgerLoading" border size="small" max-height="360">
      <el-table-column label="操作类型" min-width="110">
        <template #default="s">{{
          s.row.operationTypeName || s.row.operationType || '—'
        }}</template>
      </el-table-column>
      <el-table-column label="数量" width="110" align="right">
        <template #default="s">{{ quantity(s.row.operationQty) }}</template>
      </el-table-column>
      <el-table-column label="结存" width="110" align="right">
        <template #default="s">{{ quantity(s.row.afterQty) }}</template>
      </el-table-column>
      <el-table-column label="关联单号" min-width="140">
        <template #default="s">{{ text(s.row.sourceNo) }}</template>
      </el-table-column>
      <el-table-column label="操作人" width="100">
        <template #default="s">{{ text(s.row.operatorName) }}</template>
      </el-table-column>
      <el-table-column label="时间" width="160">
        <template #default="s">{{ dateText(s.row.createdAt, true) }}</template>
      </el-table-column>
    </el-table>

    <div class="form-actions">
      <el-button @click="emit('cancel')">关闭</el-button>
    </div>
  </el-form>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0 16px;
}
.ledger-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 8px;
}
.ledger-title {
  font-weight: 600;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
