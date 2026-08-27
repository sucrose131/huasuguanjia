<script setup lang="ts">
import { computed, onMounted, reactive, ref, useSlots, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { moneyText } from '@/utils/format';
import SummaryStrip from '@/components/SummaryStrip.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import BusinessDocumentTrace from '@/components/business/BusinessDocumentTrace.vue';
import RemoteSelect from '@/components/RemoteSelect.vue';
import StatusTag from '@/components/StatusTag.vue';
import DocumentAttachments from '@/components/DocumentAttachments.vue';
import { useBusinessDocumentPermissions } from './use-business-document-permissions';
import { useBusinessDocumentOptions } from './use-business-document-options';
import type {
  BusinessDocumentConfig,
  BusinessDocumentContext,
  ColumnRenderContext,
  RowAction,
} from './business-document-config';

const props = defineProps<{ config: BusinessDocumentConfig }>();
const route = useRoute();
const router = useRouter();
const slots = useSlots();

const rows = ref<Record<string, any>[]>([]);
const total = ref(0);
const loading = ref(false);
const summary = reactive<Record<string, any>>({});
const query = reactive<Record<string, any>>({ keyword: '', page: 1, pageSize: 20 });

// 表单对话框
const formDialog = ref(false);
const formMode = ref<'create' | 'edit' | 'view'>('create');
const form = ref<Record<string, any>>({});
const formDialogTitle = computed(() => {
  if (props.config.dialogTitle) return props.config.dialogTitle(formMode.value);
  const prefix = { create: '新增', edit: '编辑', view: '查看' }[formMode.value];
  return `${prefix}${props.config.title}`;
});
const detailLoading = ref(false);
const traceRef = ref<InstanceType<typeof BusinessDocumentTrace>>();
const { canCreate, canRunAction } = useBusinessDocumentPermissions(() => props.config);
const {
  dicts,
  options,
  dynamicOptions,
  statusOptions,
  organizationTree,
  fieldOptions,
  loadDicts,
  loadOptionBags,
  loadFieldOptions,
  clearDynamicOptions,
} = useBusinessDocumentOptions(() => props.config, query);

for (const field of props.config.queryFields ?? []) query[field.key] = field.type === 'date-range' ? [] : '';

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

/** 字段联动：依赖字段变化时，清空下游字段值并递归处理更下游、刷新查询 */
async function handleQueryFieldChange(field: any) {
  for (const f of props.config.queryFields ?? []) {
    if (f.dependsOn === field.key) {
      query[f.key] = '';
      await handleQueryFieldChange(f);
    }
  }
  await loadFieldOptions(field);
  query.page = 1;
  await load();
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
  creator: (row: Record<string, any>) => {
    const value = row.createdBy ?? row.created_by;
    if (value === undefined || value === null || value === '') return '—';
    const user = (options.users ?? []).find(
      (item: any) => String(item.value ?? item.id) === String(value),
    );
    if (!user) return '—';
    return user.raw?.nickname || user.raw?.username || user.label || String(value);
  },
};

async function load() {
  loading.value = true;
  try {
    const params: Record<string, any> = { ...query };
    // 过滤空值参数：空字符串/空数组不传给后端，避免被 Number('') 误判为状态 0
    for (const key of Object.keys(params)) {
      const value = params[key];
      if (value === '' || (Array.isArray(value) && !value.length)) delete params[key];
    }
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
    if (action.verify) {
      const problem = await action.verify(row);
      if (problem) {
        ElMessage.warning(problem);
        return;
      }
    }
    if (action.confirm) {
      const text = typeof action.confirm === 'function' ? action.confirm(row) : action.confirm;
      const actionLabel = typeof action.label === 'function' ? action.label(row) : action.label;
      const title =
        typeof action.confirmTitle === 'function'
          ? action.confirmTitle(row)
          : action.confirmTitle || actionLabel || '操作确认';
      await ElMessageBox.confirm(text, title, {
        type: action.confirmType ?? 'warning',
        confirmButtonText: action.confirmButtonText ?? '确认',
        cancelButtonText: action.cancelButtonText ?? '取消',
      });
    }
    await action.handler(row, ctx);
    await load();
  } catch (error) {
    const action =
      typeof error === 'object' && error && 'action' in error
        ? String((error as { action?: unknown }).action ?? '')
        : String(error ?? '');
    if (!['cancel', 'close'].includes(action))
      ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

const visibleActions = (row: Record<string, any>) =>
  (props.config.rowActions ?? []).filter((action) =>
    canRunAction(action) && (action.show ? action.show(row) : true),
  );

// 主操作平铺（默认），次要操作收进“更多”下拉（primary: false）
const primaryActions = (row: Record<string, any>) =>
  visibleActions(row).filter((action) => action.primary !== false);
const moreActions = (row: Record<string, any>) =>
  visibleActions(row).filter((action) => action.primary === false);
const hasMoreActions = (row: Record<string, any>) =>
  moreActions(row).length > 0 || Boolean(slots['more-actions']) || Boolean(props.config.documentType);

function openCreate(initial: Record<string, any> = {}) {
  formMode.value = 'create';
  form.value = { ...(props.config.createPreset?.() ?? {}), ...initial };
  formDialog.value = true;
}
async function resolveDetail(row: Record<string, any>) {
  if (!props.config.loadDetail || row.id == null) return { ...row };
  detailLoading.value = true;
  try {
    const detail = await props.config.loadDetail(row.id);
    // 部分旧详情接口仅返回数据库原始主键名；统一保留列表标准 id，避免编辑和附件丢失单据身份。
    return { ...detail, id: detail.id ?? row.id };
  } finally {
    detailLoading.value = false;
  }
}
async function openEdit(row: Record<string, any>) {
  formMode.value = 'edit';
  form.value = await resolveDetail(row);
  formDialog.value = true;
}
async function openView(row: Record<string, any>) {
  formMode.value = 'view';
  form.value = await resolveDetail(row);
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

defineExpose({ ctx, load, openCreate, openEdit, openView });

watch(
  () => props.config.key,
  async () => {
    for (const key of Object.keys(query)) delete query[key];
    Object.assign(query, { keyword: '', page: 1, pageSize: 20 });
    for (const field of props.config.queryFields ?? []) query[field.key] = field.type === 'date-range' ? [] : '';
    clearDynamicOptions();
    await loadDicts();
    await loadOptionBags();
    // 深链/回显场景：依赖字段已有值时先加载下游选项
    for (const field of props.config.queryFields ?? []) {
      if (field.dependsOn && (query[field.dependsOn] || field.loadOnEmptyDep))
        await loadFieldOptions(field);
    }
    await load();
  },
);

onMounted(async () => {
  await loadDicts();
  await loadOptionBags();
  // 深链/回显场景：依赖字段已有值时先加载下游选项
  for (const field of props.config.queryFields ?? []) {
    if (field.dependsOn && (query[field.dependsOn] || field.loadOnEmptyDep))
      await loadFieldOptions(field);
  }
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
        <slot name="page-actions" :refresh="load" :open-create="openCreate" />
        <el-button
          v-if="canCreate"
          type="primary"
          @click="openCreate()"
          >{{ config.createText || '新增' + config.title }}</el-button
        >
      </div>
    </header>

    <div class="panel">
      <slot
        v-if="$slots.summary"
        name="summary"
        :summary="summary"
        :rows="rows"
        :total="total"
      />
      <SummaryStrip v-else-if="summaryItems.length" :items="summaryItems" />

      <slot name="query-tools" :query="query" :load="load" :total="total" />

      <div class="query-bar">
        <el-input
          v-model="query.keyword"
          class="query-field keyword"
          clearable
          :placeholder="config.keywordPlaceholder || '单号 / 关键字'"
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
            @change="handleQueryFieldChange(field)"
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
            @change="handleQueryFieldChange(field)"
          />
          <el-select
            v-else
            v-model="query[field.key]"
            class="query-field"
            clearable
            filterable
            :placeholder="field.label"
            @change="handleQueryFieldChange(field)"
          >
            <el-option
              v-for="item in fieldOptions(field)"
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
              clearDynamicOptions();
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
            :show-overflow-tooltip="column.tooltip"
          >
            <template #default="s">
              <button
                v-if="column.link"
                type="button"
                class="document-link"
                @click="openView(s.row)"
              >
                {{ displayCell(s.row, column) }}
              </button>
              <el-progress
                v-else-if="column.kind === 'progress'"
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
            v-if="(config.rowActions ?? []).length || $slots['row-actions']"
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
                <slot
                  name="row-actions"
                  :row="s.row"
                  :refresh="load"
                  :open-view="openView"
                  :open-edit="openEdit"
                />
                <template v-if="hasMoreActions(s.row)" #more>
                  <el-dropdown-item
                    v-for="action in moreActions(s.row)"
                    :key="action.key"
                    :class="action.kind === 'danger' ? 'table-action-danger' : action.kind === 'warning' ? 'table-action-warning' : action.kind === 'success' ? 'table-action-success' : ''"
                    @click="runAction(action, s.row)"
                    >{{ typeof action.label === 'function' ? action.label(s.row) : action.label }}</el-dropdown-item
                  >
                  <slot name="more-actions" :row="s.row" :refresh="load" />
                  <el-dropdown-item
                    v-if="config.documentType"
                    @click="traceRef?.open(s.row)"
                  >全链路追溯</el-dropdown-item>
                </template>
              </TableRowActions>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div v-if="config.pagination !== false" class="table-footer">
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
      :title="formDialogTitle"
      :width="config.dialog?.width || '720px'"
      :top="config.dialog?.top || '3vh'"
      :class="config.dialog?.className"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <component
        :is="config.formComponent"
        v-if="config.formComponent"
        v-model="form"
        :mode="formMode"
        @saved="closeForm(); load()"
        @cancel="closeForm"
      />
      <slot name="form-extra" :form="form" :mode="formMode" />
      <DocumentAttachments
        v-if="formMode !== 'create' && config.documentType && form.id"
        :document-type="config.documentType"
        :document-id="form.id"
      />
      <div
        v-if="formMode === 'view' && !config.viewCloseInForm"
        class="business-view-footer"
      >
        <el-button @click="closeForm">关闭</el-button>
      </div>
    </el-dialog>
    <slot name="business-dialogs" :refresh="load" />
    <BusinessDocumentTrace
      v-if="config.documentType"
      ref="traceRef"
      :document-type="config.documentType"
      :document-no-field="config.no"
    />
  </section>
</template>

<style scoped>
.document-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--hs-color-primary);
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}
.document-link:hover {
  text-decoration: underline;
}
.business-view-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 18px;
}
</style>
