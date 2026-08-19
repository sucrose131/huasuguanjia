<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
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
  boms: [],
  plans: [],
  planOrders: [],
});
const dicts = reactive<Record<string, any[]>>({});

const isView = computed(() => props.mode === 'view');

function goodsOf(row: any) {
  return options.goods.find((g: any) => String(g.id) === String(row.goodsId)) ?? {};
}
function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}

async function loadDicts() {
  const codes = [
    'production_plan_status',
    'production_material_status',
    'production_stock_check_status',
    'production_outbound_status',
    'approval_status',
  ];
  const values = await Promise.all(codes.map((code) => api.get(`/dictionaries/${code}`).catch(() => [])));
  codes.forEach((code, index) => (dicts[code] = values[index] as any[]));
}

async function loadPlanOrderOptions() {
  if (!form.value.goodsId || !form.value.skuId) {
    options.planOrders = [];
    return;
  }
  options.planOrders = (await api.get('/production/plan-source-options', {
    params: {
      goodsId: form.value.goodsId,
      skuId: form.value.skuId,
      orgId: form.value.orgId || undefined,
      excludePlanId: form.value.id || undefined,
    },
  })) as any[];
  if (
    form.value.sourceId &&
    !options.planOrders.some((item: any) => String(item.id) === String(form.value.sourceId))
  ) {
    if (props.mode === 'create') form.value.sourceId = '';
    else
      options.planOrders.unshift({
        id: form.value.sourceId,
        orderNo: form.value.sourceOrderNo || form.value.sourceId,
        customerName: '',
        goodsId: form.value.goodsId,
        skuId: form.value.skuId,
        orgId: form.value.orgId,
        warehouseId: form.value.productWarehouseId,
        remainingQty: Number(form.value.planQty),
      });
  }
}

function planSourceChanged() {
  const selected = options.planOrders.find(
    (item: any) => String(item.id) === String(form.value.sourceId),
  );
  if (!selected) {
    form.value.maxPlanQty = 0;
    return;
  }
  Object.assign(form.value, {
    orgId: selected.orgId,
    productWarehouseId: selected.warehouseId,
    sourceOrderNo: selected.orderNo,
    maxPlanQty: Number(selected.remainingQty),
  });
  if (props.mode === 'create' && Number(form.value.planQty) > Number(form.value.maxPlanQty))
    form.value.planQty = Number(form.value.maxPlanQty);
  planQuantityChanged();
}

function planQuantityChanged() {
  for (const line of form.value.details ?? []) {
    const unitQty = Number(line.bomUnitQty ?? 0),
      quantity = unitQty * Number(form.value.planQty ?? 0);
    Object.assign(line, { standardQty: quantity, quantity, planOutQty: quantity });
  }
}

async function bomChanged() {
  if (!form.value.bomId) {
    form.value.details = [];
    return;
  }
  const b: any = await api.get(`/production/boms/${form.value.bomId}`);
  Object.assign(form.value, {
    orgId: b.orgId,
    warehouseId: b.warehouseId,
    goodsId: b.goodsId,
    skuId: b.skuId,
    bomNo: b.bomNo,
    bomName: b.bomName,
    goodsName: b.goodsName,
  });
  form.value.details = (b.details ?? []).map((x: any) => ({
    ...blankLine(),
    ...x,
    bomUnitQty: x.quantity,
    standardQty: Number(x.quantity) * Number(form.value.planQty),
    quantity: Number(x.quantity) * Number(form.value.planQty),
    planOutQty: Number(x.quantity) * Number(form.value.planQty),
  }));
  await loadPlanOrderOptions();
}

function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    unitType: 0,
    quantity: 1,
    bomUnitQty: 0,
    standardQty: 0,
    planOutQty: 0,
    currentStock: 0,
    remark: '',
  };
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

async function searchBomOptions(keyword: string) {
  if (!String(keyword ?? '').trim())
    return options.boms.map((x: any) => ({ value: x.id, label: x.bomName ?? x.bomNo ?? '' }));
  const r: any = await api.get('/production/boms', {
    params: { keyword, pageSize: 50, status: 1 },
  });
  return (r.items ?? []).map((x: any) => ({ value: x.id, label: x.bomName ?? x.bomNo ?? '' }));
}

function validate() {
  if (!form.value.bomId) {
    ElMessage.warning('请选择BOM');
    return false;
  }
  if (!form.value.sourceId) {
    ElMessage.warning('生产计划必须关联销售订单');
    return false;
  }
  if (!(Number(form.value.planQty) > 0)) {
    ElMessage.warning('请填写生产数量');
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload: Record<string, any> = { ...form.value };
    const url = '/production/plans';
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
  const [orgs, warehouses, units, goodsResult, boms] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/warehouses/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api
      .get('/goods', { params: { pageSize: 100, status: 1 } })
      .catch(() => ({ items: [] as any[] })),
    api.get('/production/boms', { params: { pageSize: 100, status: 1 } }).catch(() => ({ items: [] })),
  ]);
  options.orgs = orgs;
  options.warehouses = warehouses;
  options.units = units;
  options.goods = (goodsResult as any).items ?? [];
  options.boms = (boms as any).items ?? [];
  await loadDicts();

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      bomId: '',
      planQty: 1,
      planDate: dateText(new Date()),
      warehouseId: '',
      productWarehouseId: '',
      sourceId: '',
      sourceOrderNo: '',
      maxPlanQty: 0,
      remark: '',
      details: [],
    });
  } else if (form.value.id) {
    const detail: any = await api.get(`/production/plans/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
    form.value.details = (form.value.details ?? []).map((x: any) => ({
      ...blankLine(),
      ...x,
    }));
    await loadPlanOrderOptions();
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="BOM" required>
        <RemoteSelect
          v-model="form.bomId"
          :fetch="searchBomOptions"
          :current-label="form.bomName || form.bomNo"
          :disabled="mode !== 'create'"
          placeholder="输入BOM名称或编号搜索"
          @change="bomChanged"
        />
      </el-form-item>
      <el-form-item v-if="form.bomId" label="成品">
        <el-input :model-value="form.goodsName || goodsOf(form).goodsName || form.goodsId" readonly />
      </el-form-item>
      <el-form-item label="关联销售订单" required>
        <el-select
          v-model="form.sourceId"
          filterable
          :disabled="mode !== 'create'"
          @change="planSourceChanged"
        >
          <el-option
            v-for="x in options.planOrders"
            :key="`${x.id}-${x.goodsId}-${x.skuId}`"
            :label="`${x.orderNo} · ${x.customerName} · 剩余可计划 ${x.remainingQty}`"
            :value="x.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="销售订单剩余可计划">
        <el-input :model-value="form.sourceId ? form.maxPlanQty : '请先选择BOM和销售订单'" readonly />
      </el-form-item>
      <el-form-item label="生产数量" required>
        <el-input-number
          v-model="form.planQty"
          :min="1"
          :max="Number(form.maxPlanQty) || undefined"
          :precision="0"
          :step="1"
          :disabled="isView"
          @change="planQuantityChanged"
        />
      </el-form-item>
      <el-form-item label="计划日期">
        <el-date-picker v-model="form.planDate" type="date" value-format="YYYY-MM-DD" :disabled="isView" />
      </el-form-item>
      <el-form-item label="成品仓库">
        <el-select v-model="form.productWarehouseId" disabled>
          <el-option v-for="x in options.warehouses" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="操作人">
        <el-input :model-value="auth.user?.username" readonly />
      </el-form-item>
    </div>

    <div class="details-title">BOM原料明细</div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="220">
        <template #default="s">{{ s.row.goodsName || goodsOf(s.row).goodsName || s.row.goodsId }}</template>
      </el-table-column>
      <el-table-column label="商品编码" width="125">
        <template #default="s">{{ s.row.goodsCode || '—' }}</template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="125">
        <template #default="s">{{ s.row.skuSpec || s.row.skuId || '—' }}</template>
      </el-table-column>
      <el-table-column label="单位" width="90">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column prop="bomUnitQty" label="BOM单件用量" width="125" />
      <el-table-column prop="standardQty" label="BOM标准需求" width="125" />
      <el-table-column label="当前库存" width="100">
        <template #default="s">{{ s.row.currentStock ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="计划出库量" width="130">
        <template #default="s">
          <el-input-number
            v-model="s.row.planOutQty"
            :min="0"
            :precision="0"
            :step="1"
            :disabled="isView"
          />
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="140">
        <template #default="s"><el-input v-model="s.row.remark" :disabled="isView" /></template>
      </el-table-column>
    </el-table>

    <div v-if="isView" class="status-grid">
      <el-form-item label="计划状态">
        <el-input :model-value="form.planStatusName || '—'" readonly />
      </el-form-item>
      <el-form-item label="物料状态">
        <el-input :model-value="form.materialStatusName || '—'" readonly />
      </el-form-item>
      <el-form-item label="库存校验">
        <el-input :model-value="form.stockCheckStatusName || '—'" readonly />
      </el-form-item>
      <el-form-item label="出库状态">
        <el-input :model-value="form.outboundStatusName || '—'" readonly />
      </el-form-item>
      <el-form-item label="审批状态">
        <el-input :model-value="form.approveStatusName || '—'" readonly />
      </el-form-item>
    </div>

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
.details-title {
  font-weight: 600;
  margin: 8px 0;
}
.status-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 16px;
  margin-top: 12px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
