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
  depts: [],
  warehouses: [],
  units: [],
  contextGoods: [],
});
const isView = computed(() => props.mode === 'view');

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

/** 按单据组织+仓库加载匹配商品（后端按分类仓库类型过滤），未选组织/仓库时清空 */
async function loadContextGoods() {
  if (!form.value.orgId || !form.value.warehouseId) {
    options.contextGoods = [];
    return;
  }
  options.contextGoods = (await api
    .get('/purchase/product-options', {
      params: { orgId: form.value.orgId, warehouseId: form.value.warehouseId },
    })
    .catch(() => [])) as any[];
}

function warehouseChanged() {
  if (!(form.value.details ?? []).length) return;
  // 仓库变化后重新加载匹配商品，并清空已选明细（避免跨仓库类型残留）
  loadContextGoods();
  form.value.details = [blankLine()];
}

async function searchGoodsOptions(keyword: string) {
  const kw = String(keyword ?? '').trim().toLowerCase();
  const list = options.contextGoods.filter((g: any) =>
    kw ? `${g.queryCode ?? ''} ${g.goodsName ?? ''}`.toLowerCase().includes(kw) : true,
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
  if (!line.goodsId) return;
  const g: any = await api.get(`/goods/${line.goodsId}`);
  const sku = (g.skus ?? []).find((x: any) => x.isDefault === 1) ?? g.skus?.[0];
  line.skuId = sku?.id ?? '';
  line.unitType = sku?.unitType ?? 0;
  line.goodsCode = g.queryCode ?? '';
  line.goodsName = g.goodsName ?? '';
  line.skuSpec = sku?.specModels ?? '';
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
  if (!form.value.orgId || !form.value.deptId || !form.value.warehouseId) {
    ElMessage.warning('请选择所属组织、目标部门和目标仓库');
    return false;
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

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/purchase/applications';
    const payload: Record<string, any> = { ...form.value };
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
  const [orgs, units] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
  ]);
  options.orgs = orgs as any[];
  options.units = units as any[];

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      deptId: auth.user?.deptId ?? '',
      warehouseId: '',
      reason: '',
      remark: '',
      details: [blankLine()],
    });
  } else if (form.value.id) {
    // 编辑/查看：拉取完整详情（列表行只有摘要字段）
    const detail: any = await api
      .get(`/purchase/applications/${form.value.id}`)
      .catch(() => null);
    if (detail) Object.assign(form.value, detail);
    if (Array.isArray(form.value.details)) {
      await Promise.all(form.value.details.map((line: any) => enrichLine(line)));
    }
  }
  await loadOrgScopedOptions(form.value.orgId);
  await loadContextGoods();
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
            v-for="x in options.warehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
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
            :disabled="!form.warehouseId"
            placeholder="请先选择目标仓库，再搜索商品"
            @change="lineGoodsChanged(s.row)"
          />
          <span v-else>{{ s.row.goodsName || s.row.goodsCode || s.row.goodsId || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="130">
        <template #default="s">{{ s.row.skuSpec || s.row.skuId || '—' }}</template>
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
