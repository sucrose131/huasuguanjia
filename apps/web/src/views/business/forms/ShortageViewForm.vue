<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'cancel'): void }>();

const form = computed(() => props.modelValue);
const items = computed(() => [
  ['缺料清单编号', form.value.shortageNo ?? '—'],
  ['生产计划', form.value.planNo ?? '—'],
  ['生产成品', form.value.productGoodsName ?? '—'],
  ['原料编码', form.value.goodsCode ?? '—'],
  ['原料名称', form.value.goodsName ?? '—'],
  ['总需求', form.value.requireQty ?? 0],
  ['当前库存', form.value.factQty ?? 0],
  ['缺口数量', form.value.gapQty ?? 0],
  ['建议采购数量', form.value.purchaseQty ?? 0],
  ['采购申请', form.value.purchaseId ?? '—'],
  ['状态', form.value.statusName ?? '—'],
  ['操作人', form.value.updatedByName ?? '—'],
]);
</script>

<template>
  <el-descriptions :column="2" border>
    <el-descriptions-item v-for="[label, value] in items" :key="label" :label="label">
      {{ value }}
    </el-descriptions-item>
  </el-descriptions>
  <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px">
    <el-button @click="emit('cancel')">关闭</el-button>
  </div>
</template>
