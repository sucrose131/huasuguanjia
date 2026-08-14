<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import SummaryStrip from '@/components/SummaryStrip.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';

type Mode = 'create' | 'edit' | 'view';
type TaskType = { code: string; name: string; occupied: boolean };
type TaskRow = {
  id: string;
  taskCode: string;
  taskTypeName: string;
  taskName: string;
  cronExpr: string;
  status: number;
  statusName: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: number | null;
  lastStatusName: string;
  lastMessage: string;
  remark: string;
};

type RunRow = {
  id: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  status: number;
  statusName: string;
  message: string;
  triggerTypeName: string;
};

const auth = useAuthStore();
const can = (permission: string) =>
  !!auth.user?.permissions?.some((item) => item === '*' || item === permission);

const rows = ref<TaskRow[]>([]);
const types = ref<TaskType[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const keyword = ref('');
const statusFilter = ref<string | number>('');
const dialog = ref(false);
const mode = ref<Mode>('create');
const current = ref<TaskRow | null>(null);
const form = reactive({
  taskCode: '',
  taskName: '',
  cronExpr: '0 1 * * *',
  status: 0,
  remark: '',
});
const previewNext = ref('');
const runsDialog = ref(false);
const runsTask = ref<TaskRow | null>(null);
const runs = ref<RunRow[]>([]);
const runsLoading = ref(false);
const runsError = ref('');

const availableTypes = computed(() => types.value.filter((item) => !item.occupied));
const filteredRows = computed(() =>
  rows.value.filter((row) => {
    if (statusFilter.value !== '' && String(row.status) !== String(statusFilter.value)) return false;
    const word = keyword.value.trim();
    if (!word) return true;
    return [row.taskName, row.taskCode, row.taskTypeName, row.cronExpr, row.remark]
      .join(' ')
      .includes(word);
  }),
);
const summaryItems = computed(() => [
  { label: '任务总数', value: rows.value.length },
  { label: '已启用', value: rows.value.filter((row) => row.status === 1).length },
  { label: '已停用', value: rows.value.filter((row) => row.status !== 1).length },
]);

function timeText(value: unknown) {
  if (!value) return '—';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`;
}

async function loadTypes() {
  types.value = ((await api.get('/system/scheduled-task-types')) as TaskType[]) ?? [];
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    await loadTypes();
    rows.value = ((await api.get('/system/scheduled-tasks')) as TaskRow[]) ?? [];
  } catch (caught: any) {
    error.value = caught?.response?.data?.message ?? '无法读取任务管理';
  } finally {
    loading.value = false;
  }
}

async function refreshPreview() {
  const expr = form.cronExpr.trim();
  if (expr.split(/\s+/).length !== 5) {
    previewNext.value = '';
    return;
  }
  try {
    const result = (await api.get('/system/scheduled-task-cron-preview', {
      params: { cronExpr: expr },
    })) as { nextRunAt?: string | null };
    previewNext.value = result.nextRunAt ? timeText(result.nextRunAt) : '无法计算';
  } catch {
    previewNext.value = '表达式无效';
  }
}

function resetForm() {
  const first = availableTypes.value[0];
  Object.assign(form, {
    taskCode: first?.code ?? '',
    taskName: first?.name ?? '',
    cronExpr: '0 1 * * *',
    status: 0,
    remark: '',
  });
  previewNext.value = '';
}

function open(nextMode: Mode, row?: TaskRow) {
  mode.value = nextMode;
  current.value = row ?? null;
  if (row) {
    Object.assign(form, {
      taskCode: row.taskCode,
      taskName: row.taskName,
      cronExpr: row.cronExpr,
      status: row.status,
      remark: row.remark ?? '',
    });
  } else {
    resetForm();
  }
  dialog.value = true;
  refreshPreview();
}

function onTypeChange(code: string) {
  const type = types.value.find((item) => item.code === code);
  if (type && (!form.taskName || SCHEDULED_DEFAULT_NAMES.has(form.taskName))) {
    form.taskName = type.name;
  }
}

const SCHEDULED_DEFAULT_NAMES = new Set(types.value.map((item) => item.name));

watch(
  types,
  () => {
    SCHEDULED_DEFAULT_NAMES.clear();
    types.value.forEach((item) => SCHEDULED_DEFAULT_NAMES.add(item.name));
  },
  { immediate: true },
);

watch(
  () => form.cronExpr,
  () => {
    if (dialog.value) refreshPreview();
  },
);

async function save() {
  saving.value = true;
  try {
    if (mode.value === 'edit' && current.value) {
      await api.put(`/system/scheduled-tasks/${current.value.id}`, {
        taskName: form.taskName,
        cronExpr: form.cronExpr,
        status: form.status,
        remark: form.remark,
      });
      ElMessage.success('修改已保存，将按新的执行时间调度');
    } else {
      await api.post('/system/scheduled-tasks', {
        taskCode: form.taskCode,
        taskName: form.taskName,
        cronExpr: form.cronExpr,
        status: form.status,
        remark: form.remark,
      });
      ElMessage.success('新增成功');
    }
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(row: TaskRow, enabled: boolean) {
  await api.put(`/system/scheduled-tasks/${row.id}`, {
    taskName: row.taskName,
    cronExpr: row.cronExpr,
    status: enabled ? 1 : 0,
    remark: row.remark,
  });
  ElMessage.success(enabled ? '已启用' : '已停用');
  await load();
}

async function runNow(row: TaskRow) {
  await ElMessageBox.confirm(`确认立即执行“${row.taskName}”？不会修改已保存的执行时间。`, '立即执行', {
    type: 'warning',
    confirmButtonText: '开始执行',
  });
  const result = (await api.post(`/system/scheduled-tasks/${row.id}/run`)) as {
    message?: string;
    skipped?: boolean;
    runId?: string | null;
  };
  ElMessage.success(
    result.runId ? `${result.message ?? '已开始执行'}（记录 ${result.runId}）` : (result.message ?? '已开始执行'),
  );
  await load();
}

async function removeTask(row: TaskRow) {
  await ElMessageBox.confirm(`确认删除任务“${row.taskName}”？删除后不再自动调度，可按同一类型再新增。`, '删除任务', {
    type: 'warning',
    confirmButtonText: '确认删除',
  });
  await api.delete(`/system/scheduled-tasks/${row.id}`);
  ElMessage.success('任务已删除');
  await load();
}

function durationText(ms: number | null) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} 毫秒`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  return `${Math.round(ms / 60_000)} 分钟`;
}

async function openRuns(row: TaskRow) {
  runsTask.value = row;
  runsDialog.value = true;
  runsLoading.value = true;
  runsError.value = '';
  try {
    runs.value = ((await api.get(`/system/scheduled-tasks/${row.id}/runs`)) as RunRow[]) ?? [];
  } catch (caught: any) {
    runsError.value = caught?.response?.data?.message ?? '无法读取执行记录';
    runs.value = [];
  } finally {
    runsLoading.value = false;
  }
}

function createTask() {
  if (!availableTypes.value.length) {
    ElMessage.warning('请先删除已有任务或直接编辑');
    return;
  }
  open('create');
}

onMounted(load);
</script>

<template>
  <div class="panel">
    <SummaryStrip :items="summaryItems" />
    <div class="system-toolbar">
      <div class="status-filter">
        <span>启用状态</span>
        <el-select v-model="statusFilter" style="width: 130px">
          <el-option label="全部" value="" />
          <el-option label="启用" :value="1" />
          <el-option label="停用" :value="0" />
        </el-select>
      </div>
      <div class="toolbar-actions">
        <el-input v-model="keyword" clearable placeholder="搜索任务管理" style="width: 230px">
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-button :icon="Refresh" aria-label="刷新列表" title="刷新列表" @click="load" />
        <el-button v-if="can('system:create')" type="primary" :icon="Plus" @click="createTask">
          新增任务
        </el-button>
      </div>
    </div>

    <div v-if="error" class="system-state">
      <strong>无法读取任务管理</strong>
      <p>{{ error }}</p>
      <el-button @click="load">重新加载</el-button>
    </div>
    <div v-else class="table-wrap" v-loading="loading">
      <el-table :data="filteredRows" stripe min-width="1180">
        <el-table-column type="index" label="序号" width="65" />
        <el-table-column prop="taskName" label="任务名称" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <strong>{{ row.taskName }}</strong>
          </template>
        </el-table-column>
        <el-table-column label="任务类型" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.taskTypeName }} / {{ row.taskCode }}</template>
        </el-table-column>
        <el-table-column prop="cronExpr" label="Cron" width="140" />
        <el-table-column label="启用" width="90">
          <template #default="{ row }">
            <el-switch
              :model-value="row.status === 1"
              :disabled="!can('system:update')"
              @change="(value: string | number | boolean) => toggleStatus(row, Boolean(value))"
            />
          </template>
        </el-table-column>
        <el-table-column label="下次执行（北京时间）" width="180">
          <template #default="{ row }">{{ timeText(row.nextRunAt) }}</template>
        </el-table-column>
        <el-table-column label="最近执行（北京时间）" width="180">
          <template #default="{ row }">{{ timeText(row.lastRunAt) }}</template>
        </el-table-column>
        <el-table-column label="最近结果" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag
              v-if="row.lastStatusName !== '—'"
              :type="row.lastStatus === 1 ? 'success' : row.lastStatus === 2 ? 'warning' : row.lastStatus === 3 ? 'info' : 'danger'"
            >
              {{ row.lastStatusName }}
            </el-tag>
            <span v-if="row.lastMessage"> {{ row.lastMessage }}</span>
            <span v-else-if="row.lastStatusName === '—'">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right" align="center">
          <template #default="{ row }">
            <TableRowActions :show-more="can('system:delete') || can('system:update')">
              <el-button link type="primary" @click="open('view', row)">查看</el-button>
              <el-button link type="primary" @click="openRuns(row)">执行记录</el-button>
              <el-button v-if="can('system:update')" link type="primary" @click="open('edit', row)">
                编辑
              </el-button>
              <template #more>
                <el-dropdown-item v-if="can('system:update')" @click="runNow(row)">
                  立即执行
                </el-dropdown-item>
                <el-dropdown-item
                  v-if="can('system:delete')"
                  class="table-action-danger"
                  @click="removeTask(row)"
                >
                  删除任务
                </el-dropdown-item>
              </template>
            </TableRowActions>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!loading && !filteredRows.length" class="system-state">
        <strong>暂无定时任务</strong>
        <p>可新增已实现的任务类型，或调整搜索条件。</p>
      </div>
    </div>
    <footer class="table-footer">
      <span class="result-total">共 {{ filteredRows.length }} 条记录</span>
      <el-pagination
        :total="filteredRows.length"
        :page-size="Math.max(filteredRows.length, 1)"
        layout="prev, pager, next"
        disabled
      />
    </footer>

    <el-dialog v-model="dialog" width="640" :close-on-click-modal="mode === 'view'">
      <template #header>
        <div>
          <strong>{{
            mode === 'create' ? '新增任务' : mode === 'edit' ? '编辑任务' : current?.taskName
          }}</strong>
          <small class="dialog-subtitle">执行时间使用 Linux 五段 Cron（北京时间），保存后无需重启即可生效</small>
        </div>
      </template>
      <el-form label-position="top" :disabled="mode === 'view'">
        <div class="dialog-grid">
          <el-form-item label="任务类型 *">
            <el-select
              v-model="form.taskCode"
              :disabled="mode !== 'create'"
              style="width: 100%"
              @change="onTypeChange"
            >
              <el-option
                v-for="item in mode === 'create' ? availableTypes : types"
                :key="item.code"
                :label="`${item.name}（${item.code}）`"
                :value="item.code"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="任务名称 *">
            <el-input v-model="form.taskName" maxlength="100" />
          </el-form-item>
          <el-form-item label="执行时间 Cron *">
            <el-input v-model="form.cronExpr" placeholder="0 1 * * *" />
            <div class="cron-hint">
              分 时 日 月 周，按北京时间。示例：<code>0 1 * * *</code> 每天 01:00；<code>*/10 * * * *</code> 每
              10 分钟。下次执行：{{ previewNext || '—' }}
            </div>
          </el-form-item>
          <el-form-item label="启用">
            <el-switch v-model="form.status" :active-value="1" :inactive-value="0" />
          </el-form-item>
          <el-form-item class="full" label="备注">
            <el-input v-model="form.remark" maxlength="255" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">{{ mode === 'view' ? '关闭' : '取消' }}</el-button>
        <el-button v-if="mode !== 'view'" type="primary" :loading="saving" @click="save">
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="runsDialog" width="860" destroy-on-close>
      <template #header>
        <div>
          <strong>{{ runsTask?.taskName }} · 执行记录</strong>
          <small class="dialog-subtitle">最近 50 次；失败记录保留原始错误，便于排查</small>
        </div>
      </template>
      <div v-if="runsError" class="system-state" style="min-height: 120px">
        <strong>无法读取执行记录</strong>
        <p>{{ runsError }}</p>
      </div>
      <el-table v-else v-loading="runsLoading" :data="runs" stripe max-height="420">
        <el-table-column prop="id" label="记录编号" width="90" />
        <el-table-column label="触发" width="80">
          <template #default="{ row }">{{ row.triggerTypeName }}</template>
        </el-table-column>
        <el-table-column label="开始（北京时间）" width="160">
          <template #default="{ row }">{{ timeText(row.startedAt) }}</template>
        </el-table-column>
        <el-table-column label="结束（北京时间）" width="160">
          <template #default="{ row }">{{ timeText(row.finishedAt) }}</template>
        </el-table-column>
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ durationText(row.durationMs) }}</template>
        </el-table-column>
        <el-table-column label="结果" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <el-tag
              :type="row.status === 1 ? 'success' : row.status === 2 ? 'warning' : row.status === 3 ? 'info' : 'danger'"
            >
              {{ row.statusName }}
            </el-tag>
            <span v-if="row.message"> {{ row.message }}</span>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="runsDialog = false">关闭</el-button>
        <el-button :loading="runsLoading" @click="runsTask && openRuns(runsTask)">刷新</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.system-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--hs-border);
  background: #fafbfd;
}
.status-filter,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 9px;
}
.status-filter span {
  color: #5f6a7c;
  font-size: 11px;
}
.system-state {
  min-height: 230px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.system-state strong {
  font-size: 14px;
}
.system-state p {
  color: var(--hs-muted);
}
.table-wrap :deep(.el-table) {
  min-width: 1180px;
}
.cron-hint {
  margin-top: 6px;
  color: var(--hs-muted);
  font-size: 12px;
  line-height: 1.5;
}
.cron-hint code {
  padding: 0 4px;
  background: #f3f5f8;
  border-radius: 3px;
}
.dialog-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.dialog-grid .full {
  grid-column: 1 / -1;
}
.dialog-subtitle {
  display: block;
  margin-top: 4px;
  color: var(--hs-muted);
  font-size: 10px;
  font-weight: 400;
}
@media (max-width: 820px) {
  .system-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .toolbar-actions {
    flex-wrap: wrap;
  }
}
</style>
