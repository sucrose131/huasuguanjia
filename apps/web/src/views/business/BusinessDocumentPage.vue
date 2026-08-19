<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { moneyText } from '@/utils/format';
import SummaryStrip from '@/components/SummaryStrip.vue';
import type { BusinessDocumentConfig, BusinessDocumentContext, RowAction } from './business-document-config';

const props = defineProps<{ config: BusinessDocumentConfig }>();
const route = useRoute();
const router = useRouter();

const rows = ref<Record<string, any>[]>([]);
const total = ref(0);
const loading = ref(false);
const summary = reactive<Record<string, any>>({});
const dicts = reactive<Record<string, any[]>>({});
const query = reactive<Record<string, any>>({ keyword: '', page: 1, pageSize: 20 });

// 表单对话框
const formDialog = ref(false);
const formMode = ref<'create' | 'edit' | 'view'>('create');
const form = ref<Record<string, any>>({});

for (const field of props.config.queryFields ?? []) query[field.key] = '';

const statusOptions = computed(() => {
  const code = (props.config.dictionaries ?? []).find((item) => item.includes('status'));
  return code ? (dicts[code] ?? []) : [];
});
const queryOptions = (fieldKey: string) => {
  const field = (props.config.queryFields ?? []).find((f) => f.key === fieldKey);
  if (field?.dictionary) return dicts[field.dictionary] ?? [];
  return field?.options ?? [];
};

// 摘要卡片（对齐旧页 summary-strip 三列布局）
const summaryItems = computed<Array<{ label: string; value: number | string }>>(() => {
  if (!props.config.summaryLabels?.length) return [];
  return props.config.summaryLabels.map((item) => {
    const raw = summary[item.key];
    const value = raw == null || raw === '' ? 0 : Number(raw);
    if (item.kind === 'money') return { label: item.label, value: `¥ ${moneyText(value)}` };
    if (item.kind === 'number') return { label: item.label, value: value.toLocaleString('zh-CN') };
    return { label: item.label, value: String(raw ?? '0') };
  });
});

async function loadDicts() {
  for (const code of props.config.dictionaries ?? []) {
    if (dicts[code]) continue;
    dicts[code] = (await api.get(`/dictionaries/${code}`).catch(() => [])) as any[];
  }
}

async function load() {
  loading.value = true;
  try {
    const params: Record<string, any> = { ...query };
    const data = (await api.get(props.config.endpoint, { params })) as any;
    rows.value = data.items ?? [];
    total.value = data.total ?? rows.value.length;
    Object.keys(summary).forEach((k) => delete summary[k]);
    Object.assign(summary, data.summary ?? {});
  } finally {
    loading.value = false;
  }
}

function displayCell(row: Record<string, any>, column: { prop: string; kind?: string }) {
  const value = row[column.prop];
  if (value === null || value === undefined) return '—';
  if (column.kind === 'date') return String(value).slice(0, 10);
  if (column.kind === 'datetime') return String(value).replace('T', ' ').slice(0, 16);
  if (column.kind === 'money') return moneyText(value);
  if (column.kind === 'number') return Number(value).toLocaleString();
  return String(value);
}

async function runAction(action: RowAction, row: Record<string, any>) {
  try {
    if (action.confirm) {
      const text = typeof action.confirm === 'function' ? action.confirm(row) : action.confirm;
      await ElMessageBox.confirm(text, '提示', { type: 'warning' });
    }
    await action.handler(row, ctx);
    await load();
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

function openCreate(initial: Record<string, any> = {}) {
  formMode.value = 'create';
  form.value = { ...(props.config.createPreset?.() ?? {}), ...initial };
  formDialog.value = true;
}
function openEdit(row: Record<string, any>) {
  formMode.value = 'edit';
  form.value = { ...row };
  formDialog.value = true;
}
function openView(row: Record<string, any>) {
  formMode.value = 'view';
  form.value = { ...row };
  formDialog.value = true;
}
function closeForm() {
  formDialog.value = false;
}

const ctx: BusinessDocumentContext = {
  refresh: load,
  openCreate,
  openEdit,
  openView,
  navigate: async (path, query) => {
    await router.push({ path, query });
  },
};

watch(
  () => props.config.key,
  async () => {
    for (const key of Object.keys(query)) delete query[key];
    Object.assign(query, { keyword: '', page: 1, pageSize: 20 });
    for (const field of props.config.queryFields ?? []) query[field.key] = '';
    await loadDicts();
    await load();
  },
);

onMounted(async () => {
  await loadDicts();
  await load();
  if (String(route.query.create ?? '') === '1') {
    const initial: Record<string, any> = { ...route.query };
    delete initial.create;
    openCreate(initial);
  } else if (props.config.openFromRoute && Object.keys(route.query).length) {
    await props.config.openFromRoute(route.query, ctx);
  }
});
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>{{ config.title }}</h2>
        <p class="page-subtitle">{{ config.subtitle || '真实业务数据、来源追溯与库存事务处理' }}</p>
      </div>
      <div class="page-actions">
        <el-button
          v-if="config.creatable !== false"
          type="primary"
          @click="openCreate()"
          >{{ config.createText || '新增' + config.title }}</el-button
        >
      </div>
    </header>

    <div class="panel">
      <SummaryStrip v-if="summaryItems.length" :items="summaryItems" />

      <div class="query-bar">
        <el-input v-model="query.keyword" class="query-field keyword" clearable placeholder="单号 / 关键字" @keyup.enter="query.page = 1; load()" />
        <el-select
          v-for="field in config.queryFields ?? []"
          :key="field.key"
          v-model="query[field.key]"
          class="query-field"
          clearable
          :placeholder="field.label"
        >
          <el-option
            v-for="item in queryOptions(field.key)"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select v-if="statusOptions.length" v-model="query.status" class="query-field" clearable placeholder="业务状态">
          <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <span class="query-actions">
          <el-button type="primary" @click="query.page = 1; load()">查询</el-button>
          <el-button
            @click="
              query.keyword = '';
              query.status = '';
              for (const field of config.queryFields ?? []) query[field.key] = '';
              load();
            "
            >重置</el-button
          >
        </span>
      </div>

      <div class="table-wrap">
        <el-table :data="rows" v-loading="loading" border stripe row-key="id">
          <el-table-column type="index" label="序号" width="65" fixed="left" />
          <el-table-column prop="id" label="ID" width="100" fixed="left" />
          <el-table-column
            v-for="column in config.columns"
            :key="column.prop"
            :label="column.label"
            :width="column.width"
            :min-width="column.minWidth"
            show-overflow-tooltip
          >
            <template #default="s">
              <el-progress
                v-if="column.kind === 'progress'"
                :percentage="Math.round(Number(s.row[column.prop] || 0))"
                :stroke-width="7"
              />
              <el-tag v-else-if="column.kind === 'status'" effect="plain">{{ displayCell(s.row, column) }}</el-tag>
              <span v-else>{{ displayCell(s.row, column) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            v-if="(config.rowActions ?? []).length"
            label="操作"
            width="200"
            fixed="right"
            align="center"
          >
            <template #default="s">
              <el-button
                v-for="action in config.rowActions ?? []"
                :key="action.key"
                v-show="action.show ? action.show(s.row) : true"
                link
                :type="action.kind ?? 'primary'"
                @click="runAction(action, s.row)"
                >{{ typeof action.label === 'function' ? action.label(s.row) : action.label }}</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="table-footer">
        <span class="result-total">共 {{ total }} 条</span>
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="load"
          @size-change="query.page = 1; load()"
        />
      </div>
    </div>

    <el-dialog
      v-model="formDialog"
      :title="config.title"
      width="720px"
      top="3vh"
      :close-on-click-modal="false"
    >
      <component
        :is="config.formComponent"
        v-if="config.formComponent"
        v-model="form"
        :mode="formMode"
        @saved="closeForm(); load()"
        @cancel="closeForm"
      />
    </el-dialog>
  </section>
</template>
