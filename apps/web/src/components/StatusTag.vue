<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { loadDictionary } from '@/utils/dictionary-cache';
type TagType = 'primary' | 'success' | 'warning' | 'danger' | 'info';
const props = defineProps<{
  value: string | number | boolean | null | undefined;
  kind?: string;
  dictCode?: string;
  label?: string;
  options?: Array<{ value: string | number; label: string }>;
}>();
const loadedOptions = ref<Array<{ value: string | number; label: string }>>([]);
async function loadDefaultDictionary() {
  if (props.label || props.options?.length) return;
  loadedOptions.value = await loadDictionary(props.dictCode ?? 'enabled_status');
}
onMounted(loadDefaultDictionary);
watch(() => props.dictCode, loadDefaultDictionary);
const state = computed(() => {
  const label =
    props.label ??
    (props.options ?? loadedOptions.value).find(
      (item) => String(item.value) === String(props.value),
    )?.label ??
    String(props.value ?? '—');
  let type: TagType = 'info';
  if (/驳回|拒绝|失败|异常|不足|缺料|过期|作废|关闭|退货/.test(label)) type = 'danger';
  else if (/待|草稿|预警|部分|处理中|采购中/.test(label)) type = 'warning';
  else if (/启用|正常|通过|已审批|已确认|已完成|已入库|已出库|已收款|已退款|充足/.test(label))
    type = 'success';
  else if (/进行中|生产中/.test(label)) type = 'primary';
  return { label, type };
});
</script>
<template>
  <el-tag :type="state.type" effect="light" round>{{ state.label }}</el-tag>
</template>
