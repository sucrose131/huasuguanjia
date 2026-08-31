<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import {
  filterGoodsByWarehouseType,
  filterMappedGoodsByKeyword,
  warehouseTypeOf,
} from '@/utils/goods-warehouse';
import RemoteSelect from '@/components/RemoteSelect.vue';
import PurchaseQuickCatalogDialog from '@/components/purchase/PurchaseQuickCatalogDialog.vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const options = reactive<Record<string, any>>({
  orgs: [],
  depts: [],
  warehouses: [],
  units: [],
  users: [],
  contextGoods: [],
});
const isView = computed(() => props.mode === 'view');
const quickCatalogRef = ref<InstanceType<typeof PurchaseQuickCatalogDialog>>();
const applicantLabel = computed(() => {
  if (form.value.applicantName) return form.value.applicantName;
  const creatorId = form.value.createdBy ?? form.value.created_by;
  const creator = options.users.find(
    (item: any) => String(item.value ?? item.id) === String(creatorId ?? ''),
  );
  return creator?.raw?.nickname || creator?.label || form.value.createdByName || '系统自动生成';
});

function openQuickCatalog(line: any, mode: 'goods' | 'sku') {
  quickCatalogRef.value?.open(line, mode);
}

async function selectExistingGoods(line: any, goods: any) {
  delete line.newGoods;
  delete line.newSku;
  line.goodsId = goods.id;
  await lineGoodsChanged(line);
}

function quickCatalogStaged() {
  if (form.value.warehouseId) warehouseChanged();
}

function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    unitType: 0,
    quantity: 1,
    goodsCode: '',
    goodsName: '',
    skuSpec: '',
    remark: '',
    goodsWarehouseType: 0,
  };
}

async function loadOrgScopedOptions(orgId: unknown) {
  if (!orgId) {
    options.depts = [];
    options.warehouses = [];
    return;
  }
  const [depts, warehouses] = await Promise.all([
    api.get('/base-data/departments/options', { params: { orgId } }).catch(() => []),
    api.get('/base-data/warehouses/options', { params: { orgId } }).catch(() => []),
  ]);
  options.depts = depts as any[];
  options.warehouses = warehouses as any[];
}

/** 按单据组织加载全部可用商品（后端返回分类 warehouse_type，供仓库兼容匹配），组织为空时清空 */
async function loadContextGoods() {
  if (!form.value.orgId) {
    options.contextGoods = [];
    return;
  }
  options.contextGoods = (await api
    .get('/purchase/all-goods-options', { params: { orgId: String(form.value.orgId) } })
    .catch(() => [])) as any[];
}

/** 明细商品的唯一分类仓库类型：全部同类型则返回该类型（仓库只能选该类型），否则 0（不限） */
const documentWarehouseType = computed(() => {
  const types = new Set(
    (form.value.details ?? [])
      .map((line: any) => Number(line.goodsWarehouseType ?? 0))
      .filter(Boolean),
  );
  return types.size === 1 ? [...types][0] : 0;
});

/** 当前所选仓库的类型（双向联动：选仓库后商品按该类型过滤；未选仓库为 0=不限） */
const selectedWarehouseType = computed(() =>
  warehouseTypeOf(options.warehouses ?? [], form.value.warehouseId),
);

/** 仓库选项：按明细商品分类类型过滤（先选商品后选仓库场景） */
const warehouseOptions = computed(() =>
  (options.warehouses ?? []).filter(
    (w: any) =>
      !documentWarehouseType.value ||
      Number(w.raw?.warehouseType ?? w.warehouseType ?? 0) === documentWarehouseType.value,
  ),
);

function warehouseChanged() {
  // 先选商品后选仓库：换仓库只校验兼容性，不清空明细
  const current = warehouseOptions.value.find(
    (w: any) => String(w.value) === String(form.value.warehouseId),
  );
  if (documentWarehouseType.value && !current) {
    form.value.warehouseId = '';
    ElMessage.warning('所选仓库类型与明细商品不匹配，请重新选择仓库');
  }
}

async function searchGoodsOptions(keyword: string) {
  const list = filterMappedGoodsByKeyword(
    filterGoodsByWarehouseType(options.contextGoods, selectedWarehouseType.value),
    keyword,
  );
  return list.map((g: any) => ({
    value: g.id,
    label: `${g.queryCode || ''} ${g.goodsName || ''}`.trim(),
  }));
}

async function lineGoodsChanged(line: any) {
  line.skuId = '';
  line.unitType = 0;
  line.goodsCode = '';
  line.goodsName = '';
  line.skuSpec = '';
  line.goodsWarehouseType = 0;
  if (!line.goodsId) return;
  const matched = (options.contextGoods ?? []).find(
    (g: any) => String(g.id) === String(line.goodsId),
  );
  line.goodsWarehouseType = Number(matched?.categoryWarehouseType ?? 0);
  const otherTypes = new Set(
    (form.value.details ?? [])
      .filter((item: any) => item !== line)
      .map((item: any) => Number(item.goodsWarehouseType ?? 0))
      .filter(Boolean),
  );
  if (
    line.goodsWarehouseType > 0 &&
    otherTypes.size > 0 &&
    !otherTypes.has(line.goodsWarehouseType)
  ) {
    Object.assign(line, blankLine());
    ElMessage.warning('同一采购申请只能选择相同仓库类型的商品，请拆分申请单');
    return;
  }
  const g: any = await api.get(`/goods/${line.goodsId}`);
  const sku = (g.skus ?? []).find((x: any) => x.isDefault === 1) ?? g.skus?.[0];
  line.skuId = sku?.id ?? '';
  line.unitType = sku?.unitType ?? 0;
  line.goodsCode = g.queryCode ?? '';
  line.goodsName = g.goodsName ?? '';
  line.skuSpec = sku?.specModels ?? '';
  // 商品分类类型变化后，若已选仓库类型不匹配则清空仓库
  if (form.value.warehouseId && documentWarehouseType.value) {
    const current = (options.warehouses ?? []).find(
      (w: any) => String(w.value) === String(form.value.warehouseId),
    );
    if (
      !current ||
      Number(current.raw?.warehouseType ?? current.warehouseType ?? 0) !==
        documentWarehouseType.value
    ) {
      form.value.warehouseId = '';
      ElMessage.warning('明细商品类型已变化，请重新选择匹配的仓库');
    }
  }
}

async function enrichLine(line: any) {
  if (!line.goodsId) return;
  try {
    const g: any = await api.get(`/goods/${line.goodsId}`);
    const sku =
      (g.skus ?? []).find((x: any) => String(x.id) === String(line.skuId)) ?? g.skus?.[0];
    line.goodsCode = line.goodsCode || g.queryCode || '';
    line.goodsName = line.goodsName || g.goodsName || '';
    line.skuSpec = sku?.specModels ?? '';
    if (!line.skuId) line.skuId = sku?.id ?? '';
    if (!Number(line.unitType)) line.unitType = sku?.unitType ?? 0;
  } catch {
    // 商品不存在时保留原始值
  }
}

function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (!form.value.orgId || !form.value.deptId) {
    ElMessage.warning('请选择所属组织和目标部门');
    return false;
  }
  const hasGoods = (form.value.details ?? []).some((line: any) => line.goodsId);
  if (!form.value.warehouseId) {
    ElMessage.warning(
      hasGoods ? '请选择与商品匹配的目标仓库' : '请选择所属组织、目标部门和目标仓库',
    );
    return false;
  }
  if (hasGoods && documentWarehouseType.value) {
    const current = (options.warehouses ?? []).find(
      (w: any) => String(w.value) === String(form.value.warehouseId),
    );
    if (
      !current ||
      Number(current.raw?.warehouseType ?? current.warehouseType ?? 0) !==
        documentWarehouseType.value
    ) {
      ElMessage.warning('所选仓库类型与明细商品不匹配，请重新选择仓库');
      return false;
    }
  }
  if (!String(form.value.reason ?? '').trim()) {
    ElMessage.warning('请输入申请原因');
    return false;
  }
  if (!(form.value.details ?? []).length) {
    ElMessage.warning('至少需要一条采购明细');
    return false;
  }
  for (const line of form.value.details) {
    if (!line.goodsId || !line.skuId) {
      ElMessage.warning('请选择商品和规格');
      return false;
    }
    if (!(Number(line.quantity) > 0)) {
      ElMessage.warning('明细数量必须大于 0');
      return false;
    }
  }
  return true;
}

async function save(submit = false) {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/purchase/applications';
    const payload: Record<string, any> = { ...form.value };
    const result: any =
      props.mode === 'edit'
        ? await api.patch(`${url}/${form.value.id}`, payload)
        : await api.post(url, payload);
    if (submit) await api.post(`${url}/${result?.id ?? form.value.id}/submit`);
    ElMessage.success(submit ? '已提交审批' : (result?.message ?? '草稿已保存'));
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const [orgs, units, users] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api.get('/base-data/users/options').catch(() => []),
  ]);
  options.orgs = orgs as any[];
  options.units = units as any[];
  options.users = users as any[];

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      deptId: auth.user?.deptId ?? '',
      warehouseId: '',
      reason: '',
      remark: '',
      details: [blankLine()],
    });
  }
  await loadOrgScopedOptions(form.value.orgId);
  await loadContextGoods();
  // 详情接口本身已经返回商品名称、编码和规格；优先使用按单据组织加载的商品上下文补齐，
  // 避免跨组织查看时再次访问当前登录人本组织的商品详情接口并产生误报。
  for (const line of form.value.details ?? []) {
    const matched = (options.contextGoods ?? []).find(
      (g: any) => String(g.id) === String(line.goodsId),
    );
    if (matched) {
      line.goodsCode ||= matched.queryCode ?? matched.goodsCode ?? '';
      line.goodsName ||= matched.goodsName ?? '';
    }
  }
  if (props.mode === 'edit' && Array.isArray(form.value.details)) {
    await Promise.all(
      form.value.details
        .filter((line: any) => !line.goodsName || !line.goodsCode || !line.skuSpec)
        .map((line: any) => enrichLine(line)),
    );
  }
  // 编辑回显：为已有明细行补商品分类类型，确保仓库下拉按类型过滤
  for (const line of form.value.details ?? []) {
    if (line.goodsId && !Number(line.goodsWarehouseType)) {
      const matched = (options.contextGoods ?? []).find(
        (g: any) => String(g.id) === String(line.goodsId),
      );
      line.goodsWarehouseType = Number(matched?.categoryWarehouseType ?? 0);
    }
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="所属组织" required>
        <el-select v-model="form.orgId" disabled>
          <el-option v-for="x in options.orgs" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="目标部门" required>
        <el-select v-model="form.deptId" filterable :disabled="isView">
          <el-option v-for="x in options.depts" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="目标仓库" required>
        <el-select v-model="form.warehouseId" filterable :disabled="isView" @change="warehouseChanged">
          <el-option
            v-for="x in warehouseOptions"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
        <div
          v-if="documentWarehouseType && form.details?.some((l: any) => l.goodsId)"
          class="warehouse-hint"
        >
          已按明细商品类型匹配仓库
        </div>
      </el-form-item>
      <el-form-item label="申请人">
        <el-input :model-value="applicantLabel" disabled />
      </el-form-item>
      <el-form-item label="申请原因" required class="span-2">
        <el-input v-model="form.reason" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">采购明细</span>
      <el-button v-if="!isView" link type="primary" @click="addLine">+ 添加明细</el-button>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="220">
        <template #default="s">
          <RemoteSelect
            v-if="!isView"
            v-model="s.row.goodsId"
            :fetch="searchGoodsOptions"
            :current-label="s.row.goodsName || s.row.goodsId"
            :disabled="!form.orgId"
            placeholder="输入商品名称或编码搜索"
            @change="lineGoodsChanged(s.row)"
          />
          <el-button v-if="!isView" link type="primary" @click="openQuickCatalog(s.row, 'goods')">快捷新增商品</el-button>
          <el-tag v-if="s.row.newGoods" type="warning" size="small">待创建</el-tag>
          <span v-else>{{ s.row.goodsName || s.row.goodsCode || s.row.goodsId || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="130">
        <template #default="s">
          <span>{{ s.row.skuSpec || s.row.skuId || '—' }}</span>
          <el-button v-if="!isView && s.row.goodsId && !s.row.newGoods" link type="primary" @click="openQuickCatalog(s.row, 'sku')">补充 SKU</el-button>
        </template>
      </el-table-column>
      <el-table-column label="单位" width="90">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column label="数量" width="120">
        <template #default="s">
          <el-input-number
            v-model="s.row.quantity"
            :min="1"
            :precision="0"
            :step="1"
            :disabled="isView"
          />
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="140">
        <template #default="s"><el-input v-model="s.row.remark" :disabled="isView" /></template>
      </el-table-column>
      <el-table-column v-if="!isView" label="" width="60">
        <template #default="s">
          <el-button link type="danger" @click="removeLine(s.$index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="form-grid" style="margin-top: 12px">
      <el-form-item label="备注" class="span-2">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>

    <div v-if="!isView" class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button :loading="saving" @click="save(false)">保存草稿</el-button>
      <el-button type="primary" :loading="saving" @click="save(true)">提交审批</el-button>
    </div>
    <PurchaseQuickCatalogDialog ref="quickCatalogRef" :can-edit-amount="auth.amountAccess.canEditAmount" @selected-existing="selectExistingGoods" @staged="quickCatalogStaged" />
  </el-form>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 16px;
}
.span-2 {
  grid-column: 1 / -1;
}
.warehouse-hint {
  font-size: 12px;
  color: var(--hs-muted, #909399);
  margin-top: 2px;
}
.details-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.details-title {
  font-weight: 600;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
