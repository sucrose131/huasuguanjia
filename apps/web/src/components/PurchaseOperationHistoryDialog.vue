<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '@/api';

type HistoryItem = {
  key: string;
  action: string;
  result: string;
  operatorId: string;
  operatorName: string;
  occurredAt: string | null;
  detail?: string;
  timeNote?: string;
};

const props = defineProps<{
  modelValue: boolean;
  resource: string;
  documentId: string | number | bigint;
  documentNo?: string;
}>();
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>();

const loading = ref(false);
const error = ref('');
const items = ref<HistoryItem[]>([]);
const loadedDocumentNo = ref('');
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const title = computed(
  () => `操作记录 · ${loadedDocumentNo.value || props.documentNo || props.documentId}`,
);

function dateTimeText(value: string | null) {
  if (!value) return '时间未单独记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

async function load() {
  if (!props.resource || !props.documentId) return;
  loading.value = true;
  error.value = '';
  try {
    const result = (await api.get(
      `/purchase/${props.resource}/${String(props.documentId)}/operation-history`,
    )) as any;
    loadedDocumentNo.value = String(result.documentNo ?? '');
    items.value = result.items ?? [];
  } catch (cause: any) {
    error.value = cause?.response?.data?.message ?? '操作记录加载失败';
    items.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.modelValue, props.resource, String(props.documentId)],
  ([opened]) => {
    if (opened) load();
  },
);
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="760px" :close-on-click-modal="false">
    <div v-loading="loading" class="operation-history">
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <el-empty
        v-else-if="!loading && !items.length"
        description="当前单据没有可展示的操作记录"
        :image-size="72"
      />
      <el-timeline v-else-if="!loading">
        <el-timeline-item
          v-for="item in items"
          :key="item.key"
          :timestamp="dateTimeText(item.occurredAt)"
          placement="top"
          :type="
            item.result.includes('驳回') || item.result.includes('撤销') ? 'danger' : 'primary'
          "
          :hollow="!item.occurredAt"
        >
          <article class="history-card">
            <header>
              <strong>{{ item.action }}</strong>
              <el-tag size="small" effect="plain">{{ item.result }}</el-tag>
            </header>
            <p><span>操作人</span>{{ item.operatorName }}</p>
            <p v-if="item.detail"><span>说明</span>{{ item.detail }}</p>
            <p v-if="item.timeNote" class="time-note"><span>时间说明</span>{{ item.timeNote }}</p>
          </article>
        </el-timeline-item>
      </el-timeline>
    </div>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button type="primary" :loading="loading" @click="load">刷新记录</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.operation-history {
  min-height: 220px;
  padding: 8px 4px 0;
}
.history-card {
  padding: 12px 14px;
  border: 1px solid #e5e9f0;
  background: #fafbfc;
}
.history-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.history-card header strong {
  color: #1f2a44;
}
.history-card p {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px;
  margin: 5px 0 0;
  color: #475467;
  font-size: var(--hs-font-helper);
}
.history-card p span {
  color: #8791a5;
}
.history-card .time-note {
  color: #9a6a16;
}
</style>
