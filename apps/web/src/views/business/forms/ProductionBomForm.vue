<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import RemoteSelect from '@/components/RemoteSelect.vue';

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
  warehouses: [],
  units: [],
  goods: [],
  goodsSkus: [],
  contextGoods: [],
});
const dicts = reactive<Record<string, any[]>>({});

const isView = computed(() => props.mode === 'view');

function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    unitType: 0,
    quantity: 1,
    remark: '',
  };
}
function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}

async function loadDicts() {
  const [enabled] = await Promise.all([
    api.get('/dictionaries/enabled_status').catch(() => []),
  ]);
  dicts.enabled_status = enabled as any[];
}

async function loadContextGoods() {
  if (!form.value.orgId || !form.value.warehouseId) {
    options.contextGoods = [];
    return;
  }
  options.contextGoods = (await api.get('/production/product-options', {
    params: { orgId: form.value.orgId, warehouseId: form.value.warehouseId },
  })) as any[];
}

/** 按组织加载仓库选项（走后端），组织为空时清空 */
async function loadOrgWarehouses(orgId: unknown) {
  if (!orgId) {
    options.warehouses = [];
    return;
  }
  options.warehouses = (await api
    .get('/base-data/warehouses/options', { params: { orgId: String(orgId) } })
    .catch(() => [])) as any[];
}

function organizationChanged() {
  form.value.warehouseId = '';
  form.value.details = [blankLine()];
  options.contextGoods = [];
  loadOrgWarehouses(form.value.orgId);
}

function businessWarehouseChanged() {
  form.value.details = [blankLine()];
  loadContextGoods();
}

async function goodsChanged(line: any) {
  if (!line.goodsId) return;
  const g: any = await api.get(`/goods/${line.goodsId}`);
  options.goodsSkus = g.skus ?? [];
  const sku = (g.skus ?? []).find((x: any) => x.isDefault === 1) ?? g.skus?.[0];
  if (sku) {
    line.skuId = sku.id;
    line.unitType = sku.unitType;
  }
  if (line === form.value) {
    form.value.goodsCode = g.queryCode ?? '';
    form.value.goodsName = g.goodsName ?? '';
  }
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

async function searchGoodsOptions(keyword: string) {
  if (!String(keyword ?? '').trim())
    return options.goods.map((g: any) => ({
      value: g.id,
      label: `${g.queryCode || ''} ${g.goodsName ?? ''}`.trim(),
    }));
  const r: any = await api.get('/goods', { params: { keyword, pageSize: 50, status: 1 } });
  return (r.items ?? []).map((g: any) => ({
    value: g.id,
    label: `${g.queryCode || ''} ${g.goodsName ?? ''}`.trim(),
  }));
}

async function searchLineGoodsOptions(keyword: string) {
  const kw = String(keyword ?? '').trim().toLowerCase();
  const list = options.contextGoods.filter((g: any) =>
    kw ? `${g.queryCode ?? ''} ${g.goodsName ?? ''}`.toLowerCase().includes(kw) : true,
  );
  return list.map((g: any) => ({
    value: g.id,
    label: `${g.queryCode || ''} ${g.goodsName ?? ''}`.trim(),
  }));
}

function validate() {
  if (!String(form.value.bomName ?? '').trim()) {
    ElMessage.warning('请填写BOM名称');
    return false;
  }
  if (!form.value.goodsId) {
    ElMessage.warning('请选择成品');
    return false;
  }
  if (!form.value.orgId || !form.value.warehouseId) {
    ElMessage.warning('请选择所属组织和原料仓库');
    return false;
  }
  if (!(form.value.details ?? []).length) {
    ElMessage.warning('至少一条原料');
    return false;
  }
  const keys = new Set<string>();
  for (const line of form.value.details) {
    const key = `${line.goodsId}-${line.skuId ?? 0}`;
    if (String(line.goodsId) === String(form.value.goodsId)) {
      ElMessage.warning('成品不得作为自身原料');
      return false;
    }
    if (!line.goodsId || !(Number(line.quantity) > 0)) {
      ElMessage.warning('请完整填写每条原料的商品和单件需求量');
      return false;
    }
    if (keys.has(key)) {
      ElMessage.warning('同一原料和SKU不得重复');
      return false;
    }
    keys.add(key);
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload: Record<string, any> = { ...form.value };
    const url = '/production/boms';
    const result: any =
      props.mode === 'edit'
        ? await api.patch(`${url}/${form.value.id}`, payload)
        : await api.post(url, payload);
    ElMessage.success(result?.message ?? '保存成功');
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const [orgs, units, goodsResult] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api
      .get('/goods', { params: { pageSize: 100, status: 1 } })
      .catch(() => ({ items: [] as any[] })),
  ]);
  options.orgs = orgs;
  options.units = units;
  options.goods = (goodsResult as any).items ?? [];
  await loadDicts();

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      bomName: '',
      goodsId: '',
      skuId: '',
      warehouseId: '',
      status: 1,
      sort: 0,
      remark: '',
      details: [blankLine()],
    });
  } else if (form.value.id) {
    const detail: any = await api.get(`/production/boms/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
    form.value.details = (form.value.details ?? []).map((x: any) => ({
      ...blankLine(),
      ...x,
    }));
    await loadContextGoods();
  }
  await loadOrgWarehouses(form.value.orgId);
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="BOM名称" required>
        <el-input v-model="form.bomName" :disabled="isView" />
      </el-form-item>
      <el-form-item label="所属组织" required>
        <el-select v-model="form.orgId" :disabled="isView" @change="organizationChanged">
          <el-option v-for="x in options.orgs" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="成品" required>
        <RemoteSelect
          v-model="form.goodsId"
          :fetch="searchGoodsOptions"
          :current-label="form.goodsName"
          placeholder="输入商品名称或编码搜索"
          :disabled="isView"
          @change="goodsChanged(form)"
        />
      </el-form-item>
      <el-form-item label="成品SKU">
        <el-select v-model="form.skuId" :disabled="isView || !form.goodsId" clearable>
          <el-option
            v-for="s in options.goodsSkus || []"
            :key="s.id"
            :label="s.spec_models || s.specModels || '默认'"
            :value="s.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="原料仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || !form.orgId"
          @change="businessWarehouseChanged"
        >
          <el-option
            v-for="x in options.warehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="form.status" :disabled="isView">
          <el-option
            v-for="item in dicts.enabled_status || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number v-model="form.sort" :min="0" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">原料明细</span>
      <el-button v-if="!isView" link type="primary" @click="addLine">+ 添加原料</el-button>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="220">
        <template #default="s">
          <RemoteSelect
            v-model="s.row.goodsId"
            :fetch="searchLineGoodsOptions"
            :current-label="s.row.goodsName || s.row.goodsId"
            :disabled="isView"
            @change="goodsChanged(s.row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="130">
        <template #default="s">
          <el-select
            v-model="s.row.skuId"
            filterable
            :disabled="isView || !s.row.goodsId"
            clearable
          >
            <el-option
              v-for="sku in options.goodsSkus || []"
              :key="sku.id"
              :label="sku.spec_models || sku.specModels || '默认'"
              :value="sku.id"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="单位" width="90">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column label="单件需求量" width="130">
        <template #default="s">
          <el-input-number v-model="s.row.quantity" :min="0.0001" :precision="4" :step="1" :disabled="isView" />
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
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </div>
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
