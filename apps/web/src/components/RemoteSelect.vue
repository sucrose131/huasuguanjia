<script setup lang="ts">
import { computed, ref, watch } from 'vue';

export interface RemoteOption {
  value: string | number;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null;
    fetch: (keyword: string) => Promise<RemoteOption[]>;
    placeholder?: string;
    clearable?: boolean;
    disabled?: boolean;
    size?: '' | 'small' | 'default' | 'large';
    /** 当前已选值在搜索结果中不存在时，用于回显的标签。 */
    currentLabel?: string;
  }>(),
  {
    placeholder: '输入关键字搜索',
    clearable: true,
    disabled: false,
    size: 'default',
    currentLabel: '',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string | number | ''): void;
  (e: 'change', value: string | number | ''): void;
}>();

const options = ref<RemoteOption[]>([]);
const loading = ref(false);
const selectedLabel = ref('');
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

async function remoteMethod(keyword: string) {
  const kw = String(keyword ?? '').trim();
  const current = ++version;
  clearTimeout(timer);
  loading.value = true;
  timer = setTimeout(async () => {
    try {
      const items = await props.fetch(kw);
      if (current !== version) return;
      options.value = items ?? [];
    } catch {
      if (current !== version) return;
      options.value = [];
    } finally {
      if (current === version) loading.value = false;
    }
  }, kw ? 250 : 0);
}

function onVisibleChange(visible: boolean) {
  if (visible) remoteMethod('');
}

const displayOptions = computed<RemoteOption[]>(() => {
  const current = props.modelValue;
  if (current === undefined || current === null || current === '') return options.value;
  if (options.value.some((item) => String(item.value) === String(current))) return options.value;
  const label = selectedLabel.value || props.currentLabel || String(current);
  return [{ value: current as string | number, label }, ...options.value];
});

watch(
  () => props.modelValue,
  (value) => {
    if (value === undefined || value === null || value === '') selectedLabel.value = '';
  },
);

function onChange(value: string | number | '') {
  const matched = options.value.find((item) => String(item.value) === String(value));
  if (matched) selectedLabel.value = matched.label;
  emit('update:modelValue', value);
  emit('change', value);
}
</script>

<template>
  <el-select
    :model-value="modelValue"
    filterable
    remote
    reserve-keyword
    :remote-method="remoteMethod"
    :loading="loading"
    :clearable="clearable"
    :disabled="disabled"
    :size="size"
    :placeholder="placeholder"
    teleported
    :popper-options="{
      placement: 'bottom-start',
      strategy: 'fixed',
      modifiers: [{ name: 'offset', options: { offset: [0, 4] } }],
    }"
    @visible-change="onVisibleChange"
    @update:model-value="onChange"
  >
    <el-option
      v-for="item in displayOptions"
      :key="String(item.value)"
      :label="item.label"
      :value="item.value"
    />
  </el-select>
</template>
