<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import { generateBatchNo } from '@/utils/batch-number';
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
  plans: [],
});
const dicts = reactive<Record<string, any[]>>({});

const isView = computed(() => props.mode === 'view');

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

async function planChanged() {
  if (!form.value.planId) return;
  const p: any = await api.get(`/production/plans/${form.value.planId}`);
  Object.assign(form.value, {
    orgId: p.orgId,
    warehouseId: p.productWarehouseId,
    goodsId: p.goodsId,
    skuId: p.skuId,
    planNo: p.planNo,
    goodsName: p.goodsName,
    planQty: p.planQty,
    deliveredQty: p.deliveredQty,
  });
  form.value.batchNo = generateBatchNo();
  await loadOrgWarehouses(form.value.orgId);
}

async function searchPlanOptions(keyword: string) {
  if (!String(keyword ?? '').trim()) {
    const base = options.plans.filter(
      (p: any) => Number(p.planStatus) === 3 && Number(p.deliveredQty) < Number(p.planQty),
    );
    return base.map((x: any) => ({
      value: x.id,
      label: `${x.planNo} · ${x.goodsName ?? ''}`.trim(),
    }));
  }
  const r: any = await api.get('/production/plans', { params: { keyword, pageSize: 50 } });
  const items = (r.items ?? []).filter(
    (p: any) => Number(p.planStatus) === 3 && Number(p.deliveredQty) < Number(p.planQty),
  );
  return items.map((x: any) => ({
    value: x.id,
    label: `${x.planNo} · ${x.goodsName ?? ''}`.trim(),
  }));
}

function validate() {
  if (!form.value.planId) {
    ElMessage.warning('请选择生产计划');
    return false;
  }
  if (!(Number(form.value.quantity) > 0)) {
    ElMessage.warning('请填写本次入库数量');
    return false;
  }
  if (!form.value.batchNo) {
    ElMessage.warning('请填写批号');
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload: Record<string, any> = { ...form.value };
    const result: any = await api.post('/production/inputs', payload);
    ElMessage.success(result?.message ?? '保存成功');
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const [orgs, plans] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/production/plans', { params: { pageSize: 100 } }).catch(() => ({ items: [] })),
  ]);
  options.orgs = orgs;
  options.plans = (plans as any).items ?? [];

  if (props.mode === 'create') {
    const initialPlanId = form.value.planId ?? '';
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      warehouseId: '',
      planId: initialPlanId,
      goodsId: '',
      skuId: '',
      planQty: 0,
      deliveredQty: 0,
      quantity: 1,
      batchNo: generateBatchNo(),
      productDate: dateText(new Date()),
      validityPeriod: '',
      position: '',
      inputDate: dateText(new Date()),
      remark: '',
    });
    if (form.value.planId) await planChanged();
  } else if (form.value.id) {
    const detail: any = await api.get(`/production/inputs/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
    await loadOrgWarehouses(form.value.orgId);
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="生产计划" required>
        <RemoteSelect
          v-model="form.planId"
          :fetch="searchPlanOptions"
          :current-label="form.planNo"
          :disabled="mode !== 'create'"
          placeholder="输入计划编号搜索"
          @change="planChanged"
        />
      </el-form-item>
      <el-form-item label="入库成品">
        <el-input :model-value="form.goodsName || form.goodsId" readonly />
      </el-form-item>
      <el-form-item label="计划数量">
        <el-input :model-value="form.planQty ?? 0" readonly />
      </el-form-item>
      <el-form-item label="已入库">
        <el-input :model-value="form.deliveredQty ?? form.cumulativeQty ?? 0" readonly />
      </el-form-item>
      <el-form-item label="剩余可入">
        <el-input
          :model-value="
            Math.max(
              0,
              (Number(form.planQty) || 0) - (Number(form.deliveredQty ?? form.cumulativeQty) || 0),
            )
          "
          readonly
        />
      </el-form-item>
      <el-form-item label="本次入库数量" required>
        <el-input-number
          v-model="form.quantity"
          :min="1"
          :precision="0"
          :step="1"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="批号" required>
        <el-input v-model="form.batchNo" :disabled="isView" />
      </el-form-item>
      <el-form-item label="生产日期">
        <el-date-picker
          v-model="form.productDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="有效期">
        <el-date-picker
          v-model="form.validityPeriod"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="库位">
        <el-input v-model="form.position" :disabled="isView" />
      </el-form-item>
      <el-form-item label="入库日期" required>
        <el-date-picker
          v-model="form.inputDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="仓库" required>
        <el-select v-model="form.warehouseId" filterable :disabled="isView || !form.orgId">
          <el-option
            v-for="x in options.warehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="操作人">
        <el-input :model-value="auth.user?.username" readonly />
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
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
