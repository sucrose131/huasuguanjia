<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const options = reactive<Record<string, any>>({ outputs: [], orgs: [], units: [] });
const dicts = reactive<Record<string, any[]>>({});
const isView = computed(() => props.mode === 'view');

async function loadDicts() {
  const [status, confirm] = await Promise.all([
    api.get('/dictionaries/requisition_status').catch(() => []),
    api.get('/dictionaries/requisition_confirm_status').catch(() => []),
  ]);
  dicts.requisition_status = status as any[];
  dicts.requisition_confirm_status = confirm as any[];
}

async function sourceOutputChanged() {
  if (!form.value.outputId) return;
  const o: any = await api.get(`/requisitions/outputs/${form.value.outputId}`);
  Object.assign(form.value, {
    applicationId: o.applicationId,
    applicantId: o.applicantId,
    orgId: o.orgId,
    warehouseId: o.warehouseId,
    deptId: o.deptId,
    receiverId: o.receiverId ?? o.applicantId,
  });
  form.value.details = (o.details ?? [])
    .filter((x: any) => Boolean(x.returnable) && Number(x.remainingQty) > 0)
    .map((x: any) => ({
      goodsId: x.goodsId,
      skuId: x.skuId,
      goodsName: x.goodsName ?? '',
      skuSpec: x.skuSpec ?? '',
      batchNo: x.batchNo ?? '',
      quantity: x.remainingQty,
      issuedQty: x.quantity,
      historicalQty: x.historicalQty,
      remainingQty: x.remainingQty,
      outputDetailId: x.id,
      unitType: x.unitType ?? 0,
      returnable: true,
    }));
}

function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}

function validate(submit: boolean) {
  if (!form.value.outputId) {
    ElMessage.warning('请选择来源出库单');
    return false;
  }
  if (!(form.value.details ?? []).some((line: any) => Number(line.quantity) > 0)) {
    ElMessage.warning('请至少填写一条退回数量大于 0 的明细');
    return false;
  }
  void submit;
  return true;
}

async function save(submit = false) {
  if (!validate(submit)) return;
  saving.value = true;
  try {
    const payload: Record<string, any> = { ...form.value };
    const url = '/requisitions/returns';
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
  const [outputs, orgs, units] = await Promise.all([
    api.get('/requisitions/output-options').catch(() => []),
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
  ]);
  options.outputs = outputs;
  options.orgs = orgs;
  options.units = units;
  await loadDicts();
  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      deptId: '',
      warehouseId: '',
      receiverId: '',
      returnDate: dateText(new Date()),
      reason: '',
      details: [],
    });
  } else if (form.value.id) {
    const detail: any = await api
      .get(`/requisitions/returns/${form.value.id}`)
      .catch(() => null);
    if (detail) Object.assign(form.value, detail);
  }
  // 编辑/查看已有来源出库时回填明细
  if (form.value.outputId && !(form.value.details ?? []).length) await sourceOutputChanged();
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="来源出库" required>
        <el-select
          v-model="form.outputId"
          filterable
          :disabled="mode !== 'create'"
          @change="sourceOutputChanged"
        >
          <el-option v-for="x in options.outputs" :key="x.id" :label="x.outputNo" :value="x.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="所属组织" required>
        <el-select v-model="form.orgId" disabled>
          <el-option v-for="x in options.orgs" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="退回日期" required>
        <el-date-picker v-model="form.returnDate" type="date" value-format="YYYY-MM-DD" :disabled="isView" />
      </el-form-item>
      <el-form-item label="原因">
        <el-input v-model="form.reason" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-title">退回明细</div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="200">
        <template #default="s">{{ s.row.goodsName || s.row.goodsId || '—' }}</template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="120">
        <template #default="s">{{ s.row.skuSpec || s.row.skuId || '—' }}</template>
      </el-table-column>
      <el-table-column label="批号" min-width="120">
        <template #default="s">{{ s.row.batchNo || '无批号' }}</template>
      </el-table-column>
      <el-table-column label="已出数量" width="100">
        <template #default="s">{{ s.row.issuedQty ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="可退数量" width="100">
        <template #default="s">{{ s.row.remainingQty ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="本次退回" width="130">
        <template #default="s">
          <el-input-number
            v-model="s.row.quantity"
            :min="0"
            :max="Number(s.row.remainingQty ?? 0)"
            :precision="0"
            :step="1"
            :disabled="isView"
          />
        </template>
      </el-table-column>
      <el-table-column label="单位" width="90">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
    </el-table>

    <div v-if="!isView" class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save(false)">保存</el-button>
    </div>
  </el-form>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 16px;
}
.details-title {
  font-weight: 600;
  margin: 8px 0;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
