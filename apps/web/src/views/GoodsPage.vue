<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import SummaryStrip from '@/components/SummaryStrip.vue';
import StatusTag from '@/components/StatusTag.vue';
import DataState from '@/components/DataState.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import { dateText, display, moneyText } from '@/utils/format';
import { buildCategoryTree } from '@/utils/category-tree';
import { useAuthStore } from '@/stores/auth';
const auth = useAuthStore();
const canEditAmount = computed(() => auth.amountAccess.canEditAmount);
const rows = ref<any[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref(''),
  dialog = ref(false),
  mode = ref<'create' | 'edit' | 'view'>('create'),
  editing = ref(''),
  saving = ref(false);
const categories = ref<any[]>([]),
  units = ref<any[]>([]),
  properties = ref<any[]>([]),
  supplyTypes = ref<any[]>([]),
  goodsTypes = ref<any[]>([]),
  statuses = ref<any[]>([]);
const summary = reactive({ total: 0, active: 0, inactive: 0 }),
  query = reactive<any>({
    page: 1,
    pageSize: 20,
    keyword: '',
    categoryId: '',
    supplyType: '',
    goodsType: '',
    status: '',
  }),
  form = reactive<any>({});
const summaryItems = computed(() => [
  { label: '商品总数', value: summary.total },
  { label: '启用商品', value: summary.active },
  { label: '停用商品', value: summary.inactive },
]);
const selectedCategory = computed(() =>
  categories.value.find((item) => String(item.id) === String(form.categoryId)),
);
const categoryTree = computed(() => buildCategoryTree(categories.value));
const categoryTreeProps = { value: 'id', label: 'name', children: 'children' };
const selectableCategoryTreeProps = { ...categoryTreeProps, disabled: 'disabled' };
const markSelectableCategories = (nodes: any[]): any[] =>
  nodes.map((item) => ({
    ...item,
    disabled: Number(item.status) !== 1 || Number(item.warehouseType) <= 0,
    children: markSelectableCategories(item.children ?? []),
  }));
const selectableCategoryTree = computed(() => markSelectableCategories(categoryTree.value));
const inheritedProperties = computed(() =>
  properties.value.filter((item) =>
    selectedCategory.value?.propertyIds?.some((id: any) => String(id) === String(item.id)),
  ),
);
const skuLine = (isDefault = false) => ({
  specModels: '',
  pcsQty: 1,
  costPrice: 0,
  salePrice: 0,
  unitType: form.unitType || '',
  isDefault: isDefault ? 1 : 0,
  status: 1,
  sort: form.skus?.length ?? 0,
  remark: '',
  alertQty: 0,
  isAlertPeriod: 0,
  freeWarrantyPeriod: 0,
});
const dict = (items: any[], value: any) =>
  items.find((item) => String(item.value) === String(value))?.label ?? '—';
async function loadOptions() {
  const result = (await Promise.all([
    api.get('/goods/categories'),
    api.get('/base-data/units/options'),
    api.get('/goods/properties', { params: { pageSize: 100 } }),
    api.get('/dictionaries/product_supply_type'),
    api.get('/dictionaries/product_form'),
    api.get('/dictionaries/enabled_status'),
  ])) as any[];
  categories.value = result[0].items;
  units.value = result[1];
  properties.value = result[2].items;
  supplyTypes.value = result[3];
  goodsTypes.value = result[4];
  statuses.value = result[5];
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== ''));
    const data = (await api.get('/goods', { params })) as any;
    rows.value = data.items;
    total.value = data.total;
    Object.assign(summary, data.summary);
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? '商品资料加载失败';
  } finally {
    loading.value = false;
  }
}
function resetForm() {
  Object.assign(form, {
    queryCode: '',
    goodsName: '',
    shortName: '',
    brandName: '',
    specModels: '',
    unitType: '',
    categoryId: '',
    supplyType: 2,
    goodsType: 1,
    costPrice: 0,
    salePrice: 0,
    status: 1,
    sort: 0,
    remark: '',
    propertyIds: [],
    skus: [],
  });
  form.skus = [skuLine(true)];
}
async function open(next: 'create' | 'edit' | 'view', row?: any) {
  mode.value = next;
  editing.value = row?.id ?? '';
  resetForm();
  if (row) {
    try {
      Object.assign(form, await api.get(`/goods/${row.id}`));
    } catch {
      ElMessage.error('商品详情加载失败，请重试');
      return;
    }
  }
  dialog.value = true;
}
function selectCategory() {
  const validIds = inheritedProperties.value.map((item) => String(item.id));
  form.propertyIds = (form.propertyIds ?? []).filter((id: any) => validIds.includes(String(id)));
}
function setDefault(index: number) {
  form.skus.forEach((sku: any, i: number) => (sku.isDefault = i === index ? 1 : 0));
}
function addSku() {
  form.skus.push(skuLine());
}
function removeSku(index: number) {
  if (form.skus.length === 1 || form.skus[index].isDefault) return;
  form.skus.splice(index, 1);
}
async function save() {
  if (!form.goodsName.trim() || !form.categoryId || !form.unitType) {
    ElMessage.warning('请完整填写商品名称、分类和基础单位');
    return;
  }
  if (form.skus.filter((sku: any) => sku.isDefault === 1).length !== 1) {
    ElMessage.warning('必须且只能设置一个默认 SKU');
    return;
  }
  saving.value = true;
  try {
    if (mode.value === 'edit') await api.patch(`/goods/${editing.value}`, form);
    else await api.post('/goods', form);
    ElMessage.success(mode.value === 'edit' ? '商品修改已保存' : '商品资料已保存');
    dialog.value = false;
    load();
  } finally {
    saving.value = false;
  }
}
async function changeStatus(row: any) {
  const next = row.status === 1 ? 2 : 1,
    action = dict(statuses.value, next);
  await ElMessageBox.confirm(
    `确认${action}“${row.goodsName}”？${next !== 1 ? `${action}后不能用于新的业务单据。` : ''}`,
    '商品状态变更',
    { type: 'warning' },
  );
  await api.patch(`/goods/${row.id}/status`, { status: next });
  ElMessage.success(`${action}成功`);
  load();
}
async function remove(row: any) {
  await ElMessageBox.confirm(
    `删除前将检查“${row.goodsName}”是否存在库存或业务引用，是否继续？`,
    '删除商品',
    { type: 'warning' },
  );
  await api.delete(`/goods/${row.id}`);
  ElMessage.success('商品已删除');
  load();
}
function search() {
  query.page = 1;
  load();
}
function reset() {
  Object.assign(query, {
    page: 1,
    pageSize: 20,
    keyword: '',
    categoryId: '',
    supplyType: '',
    goodsType: '',
    status: '',
  });
  load();
}
onMounted(async () => {
  await loadOptions();
  await load();
});
</script>
<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>商品资料</h2>
        <p class="page-subtitle">维护商品主档、分类继承属性与 SKU 明细</p>
      </div>
      <div class="page-actions">
        <el-button type="primary" @click="open('create')">新增商品</el-button>
      </div>
    </header>
    <div class="panel">
      <SummaryStrip :items="summaryItems" />
      <div class="query-bar">
        <el-input
          v-model="query.keyword"
          class="query-field keyword"
          clearable
          placeholder="名称、简称、速查码、品牌或规格"
          @keyup.enter="search"
        /><el-tree-select
          v-model="query.categoryId"
          :data="categoryTree"
          :props="categoryTreeProps"
          class="query-field"
          clearable
          filterable
          check-strictly
          default-expand-all
          placeholder="商品分类"
        /><el-select v-model="query.supplyType" class="query-field" clearable placeholder="供应方式"
          ><el-option
            v-for="item in supplyTypes"
            :key="item.value"
            :label="item.label"
            :value="item.value" /></el-select
        ><el-select v-model="query.goodsType" class="query-field" clearable placeholder="商品形态"
          ><el-option
            v-for="item in goodsTypes"
            :key="item.value"
            :label="item.label"
            :value="item.value" /></el-select
        ><el-select v-model="query.status" class="query-field" clearable placeholder="状态"
          ><el-option
            v-for="item in statuses"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <div class="query-actions">
          <el-button type="primary" @click="search">查询</el-button
          ><el-button @click="reset">重置</el-button>
        </div>
      </div>
      <DataState
        v-if="error || (!rows.length && !loading)"
        :error="error"
        :empty="!rows.length"
        :loading="loading"
        title="商品资料"
        can-create
        @retry="load"
        @create="open('create')"
      />
      <div v-else class="table-wrap">
        <el-table :data="rows" v-loading="loading"
          ><el-table-column type="index" label="序号" width="65" fixed="left" /><el-table-column
            prop="id"
            label="ID"
            width="100"
            fixed="left"
          /><el-table-column prop="queryCode" label="速查码" width="110" /><el-table-column
            prop="goodsName"
            label="商品名称"
            min-width="160"
            show-overflow-tooltip
          /><el-table-column prop="brandName" label="品牌" width="110" /><el-table-column
            prop="specModels"
            label="规格型号"
            min-width="140"
          /><el-table-column prop="unitName" label="单位" width="80" /><el-table-column
            prop="categoryName"
            label="分类"
            min-width="130"
          /><el-table-column label="供应方式" width="100"
            ><template #default="s">{{
              dict(supplyTypes, s.row.supplyType)
            }}</template></el-table-column
          ><el-table-column label="商品形态" width="100"
            ><template #default="s">{{
              dict(goodsTypes, s.row.goodsType)
            }}</template></el-table-column
          ><el-table-column label="参考基础件成本" width="135" align="right"
            ><template #default="s">{{ moneyText(s.row.costPrice) }}</template></el-table-column
          ><el-table-column label="销售价" width="105" align="right"
            ><template #default="s">{{ moneyText(s.row.salePrice) }}</template></el-table-column
          ><el-table-column prop="skuCount" label="SKU数" width="80" /><el-table-column
            label="状态"
            width="90"
            ><template #default="s"><StatusTag :value="s.row.status" /></template></el-table-column
          ><el-table-column prop="operatorName" label="操作人" width="110" /><el-table-column
            label="操作时间"
            width="168"
            ><template #default="s">{{
              dateText(s.row.updatedAt || s.row.createdAt, true)
            }}</template></el-table-column
          ><el-table-column label="操作" width="176" fixed="right" align="center"
            ><template #default="s"
              ><TableRowActions
                ><el-button link type="primary" @click="open('view', s.row)">查看</el-button
                ><el-button link type="primary" @click="open('edit', s.row)">编辑</el-button
                ><template #more
                  ><el-dropdown-item
                    :class="s.row.status === 1 ? 'table-action-warning' : 'table-action-success'"
                    @click="changeStatus(s.row)"
                    >{{ s.row.status === 1 ? '停用' : '启用' }}</el-dropdown-item
                  ><el-dropdown-item class="table-action-danger" @click="remove(s.row)"
                    >删除</el-dropdown-item
                  ></template
                ></TableRowActions
              ></template
            ></el-table-column
          ></el-table
        >
      </div>
      <footer v-if="rows.length" class="table-footer">
        <span class="result-total">共 {{ total }} 条商品资料</span
        ><el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          layout="prev,pager,next,sizes"
          @change="load"
        />
      </footer>
    </div>
    <el-dialog
      v-model="dialog"
      :title="`${mode === 'view' ? '查看' : mode === 'edit' ? '编辑' : '新增'}商品资料`"
      width="1040"
      top="3vh"
      :close-on-click-modal="false"
      ><template v-if="false"
        ><div class="form-section-title">商品基础信息</div>
        <div class="detail-grid">
          <div
            v-for="item in [
              { l: '商品名称', v: form.goodsName },
              { l: '速查码', v: form.queryCode },
              { l: '商品分类', v: form.categoryName },
              { l: '基础单位', v: form.unitName },
              { l: '供应方式', v: dict(supplyTypes, form.supplyType) },
              { l: '商品形态', v: dict(goodsTypes, form.goodsType) },
              { l: '品牌', v: form.brandName },
              { l: '规格型号', v: form.specModels },
              { l: '状态', v: dict(statuses, form.status) },
              { l: '参考基础件成本', v: moneyText(form.costPrice) },
              { l: '销售价', v: moneyText(form.salePrice) },
              { l: '排序', v: form.sort },
              { l: '备注', v: form.remark },
            ]"
            :key="item.l"
            class="detail-item"
          >
            <span class="detail-label">{{ item.l }}</span
            >{{ display(item.v) }}
          </div>
        </div>
        <div class="form-section-title" style="margin-top: 18px">分类继承属性</div>
        <div class="detail-grid">
          <div v-for="item in inheritedProperties" :key="item.id" class="detail-item">
            <span class="detail-label">{{ item.name }}</span
            >{{
              form.propertyIds?.some((id: any) => String(id) === String(item.id)) ? '已关联' : '—'
            }}
          </div>
        </div>
        <div class="form-section-title" style="margin-top: 18px">SKU 明细</div>
        <div class="table-wrap">
          <el-table :data="form.skus" border
            ><el-table-column type="index" label="序号" width="65" /><el-table-column
              prop="specModels"
              label="规格型号"
              min-width="160" /><el-table-column
              prop="pcsQty"
              label="基础件数系数"
              width="100" /><el-table-column label="基础件成本" width="110"
              ><template #default="s">{{ moneyText(s.row.costPrice) }}</template></el-table-column
            ><el-table-column label="销售价" width="100"
              ><template #default="s">{{ moneyText(s.row.salePrice) }}</template></el-table-column
            ><el-table-column label="默认 SKU" width="100"
              ><template #default="s">{{
                s.row.isDefault === 1 ? '是' : '否'
              }}</template></el-table-column
            ><el-table-column label="状态" width="90"
              ><template #default="s"
                ><StatusTag :value="s.row.status" /></template></el-table-column
            ><el-table-column prop="remark" label="备注" min-width="150"
          /></el-table></div
      ></template>
      <el-form v-else label-position="top" :disabled="mode === 'view'"
        ><div class="form-section-title">商品基础信息</div>
        <div class="master-grid">
          <el-form-item label="商品名称" required
            ><el-input v-model="form.goodsName" /></el-form-item
          ><el-form-item label="速查码"><el-input v-model="form.queryCode" /></el-form-item
          ><el-form-item label="商品分类" required
            ><el-tree-select
              v-model="form.categoryId"
              :data="selectableCategoryTree"
              :props="selectableCategoryTreeProps"
              filterable
              check-strictly
              default-expand-all
              style="width: 100%"
              @change="selectCategory" /></el-form-item
          ><el-form-item label="基础单位" required
            ><el-select v-model="form.unitType" filterable style="width: 100%"
              ><el-option
                v-for="item in units"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)" /></el-select></el-form-item
          ><el-form-item label="供应方式" required
            ><el-select
              v-model="form.supplyType"
              :disabled="mode === 'edit' || mode === 'view'"
              style="width: 100%"
              ><el-option
                v-for="item in supplyTypes"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)" /></el-select></el-form-item
          ><el-form-item label="商品形态" required
            ><el-select
              v-model="form.goodsType"
              :disabled="mode === 'edit' || mode === 'view'"
              style="width: 100%"
              ><el-option
                v-for="item in goodsTypes"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)" /></el-select></el-form-item
          ><el-form-item label="品牌"><el-input v-model="form.brandName" /></el-form-item
          ><el-form-item label="规格型号"><el-input v-model="form.specModels" /></el-form-item
          ><el-form-item label="状态"
            ><el-select v-model="form.status" style="width: 100%"
              ><el-option
                v-for="item in statuses"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)" /></el-select></el-form-item
          ><el-form-item label="参考基础件成本"
            ><el-input-number
              v-model="form.costPrice"
              :disabled="mode === 'view' || !canEditAmount"
              :min="0"
              :precision="2"
              style="width: 100%" /></el-form-item
          ><el-form-item label="销售价"
            ><el-input-number
              v-model="form.salePrice"
              :disabled="mode === 'view' || !canEditAmount"
              :min="0"
              :precision="2"
              style="width: 100%" /></el-form-item
          ><el-form-item label="排序"
            ><el-input-number v-model="form.sort" :min="0" style="width: 100%"
          /></el-form-item>
        </div>
        <div class="form-section-title">分类继承属性</div>
        <div v-if="inheritedProperties.length" class="detail-grid">
          <label v-for="item in inheritedProperties" :key="item.id" class="detail-item"
            ><span class="detail-label">{{ item.name }} · {{ item.description || '可选属性' }}</span
            ><el-checkbox
              :model-value="form.propertyIds.some((id: any) => String(id) === String(item.id))"
              @change="
                (checked: boolean) =>
                  (form.propertyIds = checked
                    ? [...form.propertyIds, item.id]
                    : form.propertyIds.filter((id: any) => String(id) !== String(item.id)))
              "
              >关联此属性</el-checkbox
            ></label
          >
        </div>
        <el-alert v-else title="当前分类没有关联属性" type="info" :closable="false" />
        <div class="form-section-title" style="margin-top: 18px">
          SKU 明细（{{ form.skus.length }}）
        </div>
        <div class="table-wrap">
          <el-table :data="form.skus" border style="min-width: 920px"
            ><el-table-column type="index" label="序号" width="60" /><el-table-column
              label="规格型号"
              min-width="150"
              ><template #default="s"
                ><el-input v-model="s.row.specModels" /></template></el-table-column
            ><el-table-column label="基础件数系数" width="150"
              ><template #default="s"
                ><el-input-number
                  v-model="s.row.pcsQty"
                  :min="1"
                  :precision="0"
                  :step="1" /></template></el-table-column
            ><el-table-column label="单位" width="130"
              ><template #default="s"
                ><el-select v-model="s.row.unitType"
                  ><el-option
                    v-for="item in units"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select></template></el-table-column
            ><el-table-column label="基础件成本" width="130"
              ><template #default="s"
                ><el-input-number
                  v-model="s.row.costPrice"
                  :disabled="mode === 'view' || !canEditAmount"
                  :min="0"
                  :precision="2" /></template></el-table-column
            ><el-table-column label="销售价" width="130"
              ><template #default="s"
                ><el-input-number
                  v-model="s.row.salePrice"
                  :disabled="mode === 'view' || !canEditAmount"
                  :min="0"
                  :precision="2" /></template></el-table-column
            ><el-table-column label="默认 SKU" width="105"
              ><template #default="s"
                ><el-radio
                  :model-value="s.row.isDefault === 1"
                  :value="true"
                  @change="setDefault(s.$index)"
                  >默认</el-radio
                ></template
              ></el-table-column
            ><el-table-column label="状态" width="115"
              ><template #default="s"
                ><el-select v-model="s.row.status"
                  ><el-option
                    v-for="item in statuses"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select></template></el-table-column
            ><el-table-column label="安全库存" width="130"
              ><template #default="s"
                ><el-input-number
                  v-model="s.row.alertQty"
                  :min="0"
                  :precision="0"
                  :step="1" /></template></el-table-column
            ><el-table-column label="备注" min-width="140"
              ><template #default="s"
                ><el-input v-model="s.row.remark" /></template></el-table-column
            ><el-table-column v-if="mode !== 'view'" label="操作" width="70" fixed="right"
              ><template #default="s"
                ><el-button
                  link
                  type="danger"
                  :disabled="form.skus.length === 1 || s.row.isDefault === 1"
                  @click="removeSku(s.$index)"
                  >删除</el-button
                ></template
              ></el-table-column
            ></el-table
          >
        </div>
        <el-button v-if="mode !== 'view'" style="margin-top: 12px" @click="addSku"
          >添加 SKU</el-button
        ><el-form-item label="备注" style="margin-top: 18px"
          ><el-input v-model="form.remark" type="textarea" /></el-form-item></el-form
      ><template #footer
        ><el-button @click="dialog = false">{{ mode === 'view' ? '关闭' : '取消' }}</el-button
        ><el-button
          v-if="mode !== 'view'"
          type="primary"
          :loading="saving"
          :disabled="saving"
          @click="save"
          >{{ mode === 'edit' ? '保存修改' : '保存商品' }}</el-button
        ></template
      ></el-dialog
    >
  </section>
</template>
