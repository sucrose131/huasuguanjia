<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import SummaryStrip from '@/components/SummaryStrip.vue';
import StatusTag from '@/components/StatusTag.vue';
import DataState from '@/components/DataState.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import { dateText, display } from '@/utils/format';
import {
  buildCategoryTree,
  filterCategoryTree,
  flattenCategoryTree,
} from '@/utils/category-tree';

const allCategories = ref<any[]>([]),
  properties = ref<any[]>([]),
  warehouseTypes = ref<any[]>([]),
  statuses = ref<any[]>([]),
  loading = ref(false),
  saving = ref(false),
  error = ref(''),
  dialog = ref(false),
  mode = ref<'create' | 'edit' | 'view'>('create'),
  editing = ref(''),
  total = ref(0);
const summary = reactive({ total: 0, active: 0, inactive: 0 }),
  query = reactive<any>({ keyword: '', parentId: '', warehouseType: '', status: '' }),
  appliedQuery = reactive<any>({ keyword: '', parentId: '', warehouseType: '', status: '' }),
  form = reactive<any>({});
const summaryItems = computed(() => [
  { label: '分类总数', value: summary.total },
  { label: '启用分类', value: summary.active },
  { label: '停用分类', value: summary.inactive },
]);
const categoryTree = computed(() => buildCategoryTree(allCategories.value));
const visibleTree = computed(() => filterCategoryTree(categoryTree.value, appliedQuery));
const visibleCount = computed(() => flattenCategoryTree(visibleTree.value).length);
const categoryOptions = computed(() =>
  flattenCategoryTree(categoryTree.value).map((item) => ({
    ...item,
    optionLabel: `${'　'.repeat(item.depth)}${item.name}`,
  })),
);
const parentOptions = computed(() =>
  categoryOptions.value.filter((item) => String(item.id) !== String(editing.value)),
);
const dict = (items: any[], value: any) =>
  items.find((item) => String(item.value) === String(value))?.label ?? '—';

async function options() {
  const result = (await Promise.all([
    api.get('/goods/properties', { params: { pageSize: 100 } }),
    api.get('/dictionaries/warehouse_type'),
    api.get('/dictionaries/enabled_status'),
  ])) as any[];
  properties.value = result[0].items;
  warehouseTypes.value = result[1];
  statuses.value = result[2];
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = (await api.get('/goods/categories')) as any;
    allCategories.value = data.items;
    total.value = data.total;
    Object.assign(summary, data.summary);
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? '分类数据加载失败';
  } finally {
    loading.value = false;
  }
}
function resetForm() {
  Object.assign(form, {
    name: '',
    parentId: 0,
    warehouseType: '',
    propertyIds: [],
    sort: 0,
    status: 1,
    remark: '',
  });
}
function open(next: 'create' | 'edit' | 'view', row?: any) {
  mode.value = next;
  editing.value = row?.id ?? '';
  resetForm();
  if (row) {
    const { children: _children, depth: _depth, hierarchyWarning: _warning, ...record } = row;
    Object.assign(form, record);
  }
  dialog.value = true;
}
async function save() {
  if (!form.name.trim() || !form.warehouseType) {
    ElMessage.warning('请填写分类名称并选择仓库类型');
    return;
  }
  saving.value = true;
  try {
    if (mode.value === 'edit') await api.patch(`/goods/categories/${editing.value}`, form);
    else await api.post('/goods/categories', form);
    ElMessage.success(mode.value === 'edit' ? '分类修改已保存' : '分类已保存');
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}
async function changeStatus(row: any) {
  const next = row.status === 1 ? 2 : 1,
    action = dict(statuses.value, next);
  await ElMessageBox.confirm(`确认${action}“${row.name}”？`, '状态变更', { type: 'warning' });
  await api.patch(`/goods/categories/${row.id}/status`, { status: next });
  ElMessage.success(`${action}成功`);
  await load();
}
async function remove(row: any) {
  await ElMessageBox.confirm(`删除“${row.name}”前将检查子分类和关联商品，是否继续？`, '删除分类', {
    type: 'warning',
  });
  await api.delete(`/goods/categories/${row.id}`);
  ElMessage.success('分类已删除');
  await load();
}
function search() {
  Object.assign(appliedQuery, query);
}
function reset() {
  const emptyQuery = { keyword: '', parentId: '', warehouseType: '', status: '' };
  Object.assign(query, emptyQuery);
  Object.assign(appliedQuery, emptyQuery);
}
onMounted(async () => {
  await options();
  await load();
});
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>商品分类</h2>
        <p class="page-subtitle">以树形结构维护分类层级、仓库类型和继承属性</p>
      </div>
      <div class="page-actions">
        <el-button type="primary" @click="open('create')">新增商品分类</el-button>
      </div>
    </header>
    <div class="panel">
      <SummaryStrip :items="summaryItems" />
      <div class="query-bar">
        <el-input
          v-model="query.keyword"
          class="query-field keyword"
          clearable
          placeholder="分类名称"
          @keyup.enter="search"
        />
        <el-select v-model="query.parentId" class="query-field" clearable placeholder="分类范围">
          <el-option
            v-for="item in categoryOptions"
            :key="item.id"
            :label="item.optionLabel"
            :value="item.id"
          />
        </el-select>
        <el-select
          v-model="query.warehouseType"
          class="query-field"
          clearable
          placeholder="仓库类型"
        >
          <el-option
            v-for="item in warehouseTypes"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select v-model="query.status" class="query-field" clearable placeholder="状态">
          <el-option
            v-for="item in statuses"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <div class="query-actions">
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </div>
      </div>
      <DataState
        v-if="error || (!visibleTree.length && !loading)"
        :error="error"
        :empty="!visibleTree.length"
        :loading="loading"
        title="商品分类"
        can-create
        @retry="load"
        @create="open('create')"
      />
      <div v-else class="table-wrap">
        <el-table
          :data="visibleTree"
          v-loading="loading"
          row-key="id"
          default-expand-all
          :indent="16"
          :tree-props="{ children: 'children' }"
        >
          <el-table-column label="" width="88" fixed="left" class-name="category-tree-toggle">
            <template #default><span aria-hidden="true"></span></template>
          </el-table-column>
          <el-table-column type="index" label="序号" width="70" fixed="left" />
          <el-table-column prop="id" label="ID" width="100" fixed="left" />
          <el-table-column prop="name" label="分类名称" min-width="210" fixed="left">
            <template #default="s">
              <div class="category-name" :style="{ paddingLeft: `${s.row.depth * 20}px` }">
                <span>{{ s.row.name }}</span>
                <el-tooltip v-if="s.row.hierarchyWarning" :content="s.row.hierarchyWarning">
                  <el-tag class="hierarchy-warning" size="small" type="warning">层级异常</el-tag>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
          <!-- Parent category is already represented by the tree hierarchy.
          <el-table-column label="上级分类" min-width="140">
            <template #default="s">{{ s.row.parentName || '顶级分类' }}</template>
          </el-table-column>
          -->
          <el-table-column label="仓库类型" width="110">
            <template #default="s">{{ dict(warehouseTypes, s.row.warehouseType) }}</template>
          </el-table-column>
          <el-table-column label="关联属性" min-width="190" show-overflow-tooltip>
            <template #default="s">{{ s.row.propertyNames?.join('、') || '—' }}</template>
          </el-table-column>
          <el-table-column prop="propertyCount" label="属性数" width="80" />
          <el-table-column prop="goodsCount" label="商品数" width="80" />
          <el-table-column prop="childCount" label="子分类数" width="90" />
          <el-table-column prop="sort" label="排序" width="75" />
          <el-table-column label="状态" width="90">
            <template #default="s"><StatusTag :value="s.row.status" /></template>
          </el-table-column>
          <el-table-column label="操作时间" width="168">
            <template #default="s">{{ dateText(s.row.updatedAt || s.row.createdAt, true) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="176" fixed="right" align="center">
            <template #default="s">
              <TableRowActions>
                <el-button link type="primary" @click="open('view', s.row)">查看</el-button>
                <el-button link type="primary" @click="open('edit', s.row)">编辑</el-button>
                <template #more>
                  <el-dropdown-item
                    :class="s.row.status === 1 ? 'table-action-warning' : 'table-action-success'"
                    @click="changeStatus(s.row)"
                  >
                    {{ s.row.status === 1 ? '停用' : '启用' }}
                  </el-dropdown-item>
                  <el-dropdown-item class="table-action-danger" @click="remove(s.row)">
                    删除
                  </el-dropdown-item>
                </template>
              </TableRowActions>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <footer v-if="allCategories.length" class="table-footer">
        <span class="result-total">当前显示 {{ visibleCount }} 条，共 {{ total }} 条商品分类</span>
      </footer>
    </div>
    <el-dialog
      v-model="dialog"
      :title="`${mode === 'view' ? '查看' : mode === 'edit' ? '编辑' : '新增'}商品分类`"
      width="520"
      :close-on-click-modal="false"
    >
      <template v-if="mode === 'view'">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">分类名称</span><span>{{ display(form.name) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">上级分类</span><span>{{ form.parentName || '顶级分类' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">仓库类型</span>
            <span>{{ dict(warehouseTypes, form.warehouseType) }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">状态</span><StatusTag :value="form.status" />
          </div>
          <div class="detail-item full">
            <span class="detail-label">关联属性</span>
            <span>{{ form.propertyNames?.join('、') || '—' }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">商品数</span><span>{{ form.goodsCount ?? 0 }}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">子分类数</span><span>{{ form.childCount ?? 0 }}</span>
          </div>
          <div class="detail-item full">
            <span class="detail-label">备注</span><span>{{ display(form.remark) }}</span>
          </div>
        </div>
      </template>
      <el-form v-else label-position="top">
        <div class="dialog-grid">
          <el-form-item label="分类名称" required><el-input v-model="form.name" /></el-form-item>
          <el-form-item label="上级分类">
            <el-select v-model="form.parentId" style="width: 100%">
              <el-option label="顶级分类" :value="0" />
              <el-option
                v-for="item in parentOptions"
                :key="item.id"
                :label="item.optionLabel"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="仓库类型" required>
            <el-select v-model="form.warehouseType" style="width: 100%">
              <el-option
                v-for="item in warehouseTypes"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="form.status" style="width: 100%">
              <el-option
                v-for="item in statuses"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="关联属性" class="full">
            <el-select v-model="form.propertyIds" multiple filterable style="width: 100%">
              <el-option
                v-for="item in properties"
                :key="item.id"
                :label="`${item.name}${item.description ? ' · ' + item.description : ''}`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="排序">
            <el-input-number v-model="form.sort" :min="0" style="width: 100%" />
          </el-form-item>
          <el-form-item label="备注" class="full">
            <el-input v-model="form.remark" type="textarea" />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">{{ mode === 'view' ? '关闭' : '取消' }}</el-button>
        <el-button v-if="mode !== 'view'" type="primary" :loading="saving" @click="save">
          {{ mode === 'edit' ? '保存修改' : '保存分类' }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.hierarchy-warning {
  margin-left: 8px;
  vertical-align: middle;
}
.category-name {
  display: flex;
  align-items: center;
}
:deep(.category-tree-toggle .cell) {
  min-height: 23px;
}
</style>
