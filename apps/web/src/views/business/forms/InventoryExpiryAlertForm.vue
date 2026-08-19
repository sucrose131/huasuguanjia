<script setup lang="ts">
import { computed } from 'vue';
import { dateText } from '@/utils/format';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'cancel'): void }>();

const form = computed(() => props.modelValue);
</script>

<template>
  <el-descriptions :column="2" border>
    <el-descriptions-item label="商品编码">{{ form.goodsCode || '—' }}</el-descriptions-item>
    <el-descriptions-item label="商品名称">{{ form.goodsName || '—' }}</el-descriptions-item>
    <el-descriptions-item label="SKU/规格">{{ form.skuSpec || '默认规格' }}</el-descriptions-item>
    <el-descriptions-item label="批号">{{ form.batchNo || '无批号' }}</el-descriptions-item>
    <el-descriptions-item label="仓库">{{ form.warehouseName || '—' }}</el-descriptions-item>
    <el-descriptions-item label="有效期">{{ dateText(form.endDay) }}</el-descriptions-item>
    <el-descriptions-item label="剩余天数">{{ Number(form.remainingDays ?? 0).toLocaleString() }}</el-descriptions-item>
    <el-descriptions-item label="数量">{{ Number(form.inventoryQty ?? 0).toLocaleString() }}</el-descriptions-item>
  </el-descriptions>

  <div class="form-actions">
    <el-button @click="emit('cancel')">关闭</el-button>
  </div>
</template>

<style scoped>
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
