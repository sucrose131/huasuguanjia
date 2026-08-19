<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { moneyText } from '@/utils/format';
import { useAuthStore } from '@/stores/auth';
import SummaryStrip from '@/components/SummaryStrip.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import RemoteSelect from '@/components/RemoteSelect.vue';
import StatusTag from '@/components/StatusTag.vue';
import type {
  BusinessDocumentConfig,
  BusinessDocumentContext,
  ColumnRenderContext,
  OptionBagName,
  RowAction,
} from './business-document-config';

const props = defineProps<{ config: BusinessDocumentConfig }>();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const rows = ref<Record<string, any>[]>([]);
const total = ref(0);
const loading = ref(false);
const summary = reactive<Record<string, any>>({});
const dicts = reactive<Record<string, any[]>>({});
const query = reactive<Record<string, any>>({ keyword: '', page: 1, pageSize: 20 });
const options = reactive<Record<string, any[]>>({});

// 表单对话框
const formDialog = ref(false);
const formMode = ref<'create' | 'edit' | 'view'>('create');
const form = ref<Record<string, any>>({});

for (const field of props.config.queryFields ?? []) query[field.key] = field.type === 'date-range' ? [] : '';

const statusOptions = computed(() => {
  if (props.config.autoStatusFilter === false) return [];
  const code = (props.config.dictionaries ?? []).find((item) => item.includes('status'));
  return code ? (dicts[code] ?? []) : [];
});
const queryOptions = (field: { type?: string; options?: Array<{ value: string | number; label: string }>; dictionary?: string; optionBag?: string }) => {
  if (field.dictionary) return dicts[field.dictionary] ?? [];
  if (field.optionBag) return options[field.optionBag] ?? [];
  return field.options ?? [];
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

// 预加载公共 options 集合（供列 render 的 lookup/byId 使用）
const OPTION_BAG_ENDPOINTS: Record<OptionBagName, string> = {
  orgs: '/base-data/organizations/options',
  warehouses: '/base-data/warehouses/options',
  depts: '/base-data/departments/options',
  vendors: '/base-data/vendors/options',
  users: '/base-data/users/options',
  units: '/base-data/units/options',
  goods: '/goods',
};

async function loadOptionBags() {
  const bags = props.config.optionBags ?? [];
  const results = await Promise.all(
    bags.map((name) =>
      api
        .get(OPTION_BAG_ENDPOINTS[name], {
          ...(name === 'goods' ? { params: { pageSize: 200, status: 1 } } : {}),
        })
        .catch(() => []),
    ),
  );
  bags.forEach((name, index) => {
    const data: any = results[index];
    options[name] = (Array.isArray(data) ? data : data?.items ?? []) as any[];
  });
}

const columnRenderCtx: ColumnRenderContext = {
  lookup: (name: string, value: unknown) =>
    (options[name] ?? []).find(
      (item: any) => String(item.value ?? item.id) === String(value),
    )?.label ?? '—',
  byId: (name: string, value: unknown) =>
    (options[name] ?? []).find(
      (item: any) => String(item.id ?? item.value) === String(value),
    ),
  dictLabel: (code: string, value: unknown) =>
    (dicts[code] ?? []).find((item) => String(item.value) === String(value))?.label ?? '—',
  creator: (row: Record<string, any>) =>
    String(row.createdBy) === String(auth.user?.id) ? auth.user?.username ?? '' : '—',
};

async function load() {
  loading.value = true;
  try {
    const params: Record<string, any> = { ...query };
    // date-range 字段拆成 start/end 参数
    for (const field of props.config.queryFields ?? []) {
      if (field.type !== 'date-range') continue;
      const value = query[field.key];
      if (Array.isArray(value) && value.length === 2) {
        const base = field.param ?? field.key;
        params[`${base}Start`] = value[0];
        params[`${base}End`] = value[1];
        delete params[field.key];
      } else {
        delete params[field.key];
      }
    }
    const data = (await api.get(props.config.endpoint, { params })) as any;
    rows.value = data.items ?? [];
    total.value = data.total ?? rows.value.length;
    Object.keys(summary).forEach((k) => delete summary[k]);
    Object.assign(summary, data.summary ?? {});
  } finally {
    loading.value = false;
  }
}

// 组织树（tree-select 用）：由 orgs options 构建
const organizationTree = computed(() => {
  const build = (items: any[], parentId?: string): any[] =>
    items
      .filter((item: any) => (item.raw?.parentId ?? item.parentId ?? null) === (parentId ?? null))
      .map((item: any) => ({
        value: item.value,
        label: item.label,
        children: build(items, item.value),
      }));
  return build(options.orgs ?? []);
});

function displayCell(
  row: Record<string, any>,
  column: { prop: string; kind?: string; render?: (row: Record<string, any>, ctx: ColumnRenderContext) => string },
) {
  if (column.render) {
    const text = column.render(row, columnRenderCtx);
    return column.kind === 'money' ? protectedMoney(text) : text;
  }
  const value = row[column.prop];
  if (value === null || value === undefined) return '—';
  if (column.kind === 'date') return String(value).slice(0, 10);
  if (column.kind === 'datetime') return String(value).replace('T', ' ').slice(0, 16);
  if (column.kind === 'money') return protectedMoney(value);
  if (column.kind === 'number') return Number(value).toLocaleString();
  return String(value);
}

// 金额：无查看权限掩码，有权限加 ¥ 前缀
const protectedMoney = (value: unknown) => {
  const text = moneyText(value);
  return text === '****' ? text : `¥ ${text}`;
};

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

const visibleActions = (row: Record<string, any>) =>
  (props.config.rowActions ?? []).filter((action) =>
    action.show ? action.show(row) : true,
  );

// 主操作平铺（默认），次要操作收进“更多”下拉（primary: false）
const primaryActions = (row: Record<string, any>) =>
  visibleActions(row).filter((action) => action.primary !== false);
const moreActions = (row: Record<string, any>) =>
  visibleActions(row).filter((action) => action.primary === false);

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
    for (const field of props.config.queryFields ?? []) query[field.key] = field.type === 'date-range' ? [] : '';
    await loadDicts();
    await loadOptionBags();
    await load();
  },
);

onMounted(async () => {
  await loadDicts();
  await loadOptionBags();
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
        <el-input
          v-model="query.keyword"
          class="query-field keyword"
          clearable
          placeholder="单号 / 关键字"
          @keyup.enter="query.page = 1; load()"
        />
        <template v-for="field in config.queryFields ?? []" :key="field.key">
          <el-tree-select
            v-if="field.type === 'tree-select'"
            v-model="query[field.key]"
            :data="organizationTree"
            class="query-field"
            clearable
            filterable
            check-strictly
            node-key="value"
            :props="{ label: 'label', children: 'children' }"
            :placeholder="field.label"
          />
          <el-date-picker
            v-else-if="field.type === 'date-range'"
            v-model="query[field.key]"
            class="query-field"
            type="daterange"
            range-separator="至"
            :start-placeholder="`${field.label}起`"
            :end-placeholder="`${field.label}止`"
            value-format="YYYY-MM-DD"
          />
          <RemoteSelect
            v-else-if="field.type === 'remote-select' && field.fetch"
            v-model="query[field.key]"
            class="query-field"
            :fetch="field.fetch"
            :current-label="field.currentLabel ? field.currentLabel(query[field.key]) : ''"
            clearable
            :placeholder="field.label"
          />
          <el-select
            v-else
            v-model="query[field.key]"
            class="query-field"
            clearable
            filterable
            :placeholder="field.label"
          >
            <el-option
              v-for="item in queryOptions(field)"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </template>
        <el-select v-if="statusOptions.length" v-model="query.status" class="query-field" clearable placeholder="业务状态">
          <el-option v-for="item in statusOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <span class="query-actions">
          <el-button type="primary" @click="query.page = 1; load()">查询</el-button>
          <el-button
            @click="
              query.keyword = '';
              query.status = '';
              for (const field of config.queryFields ?? []) query[field.key] = field.type === 'date-range' ? [] : '';
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
            :align="column.align"
            show-overflow-tooltip
          >
            <template #default="s">
              <el-progress
                v-if="column.kind === 'progress'"
                :percentage="Math.round(Number(s.row[column.prop] || 0))"
                :stroke-width="7"
              />
              <StatusTag
                v-else-if="column.kind === 'status'"
                :value="column.statusDict && column.render ? displayCell(s.row, column) : s.row[column.prop]"
                :dict-code="column.statusDict"
                :label="column.render && !column.statusDict ? displayCell(s.row, column) : undefined"
              />
              <span v-else>{{ displayCell(s.row, column) }}</span>
            </template>
          </el-table-column>
          <el-table-column
            v-if="(config.rowActions ?? []).length"
            label="操作"
            width="220"
            fixed="right"
            align="center"
          >
            <template #default="s">
              <TableRowActions>
                <el-button
                  v-for="action in primaryActions(s.row)"
                  :key="action.key"
                  link
                  :type="action.kind ?? 'primary'"
                  @click="runAction(action, s.row)"
                  >{{ typeof action.label === 'function' ? action.label(s.row) : action.label }}</el-button
                >
                <template v-if="moreActions(s.row).length" #more>
                  <el-dropdown-item
                    v-for="action in moreActions(s.row)"
                    :key="action.key"
                    :class="action.kind === 'danger' ? 'table-action-danger' : action.kind === 'warning' ? 'table-action-warning' : action.kind === 'success' ? 'table-action-success' : ''"
                    @click="runAction(action, s.row)"
                    >{{ typeof action.label === 'function' ? action.label(s.row) : action.label }}</el-dropdown-item
                  >
                </template>
              </TableRowActions>
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
