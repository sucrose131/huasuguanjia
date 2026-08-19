<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText, moneyText } from '@/utils/format';
import RemoteSelect from '@/components/RemoteSelect.vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const presetOrder = ref(false);
const options = reactive<Record<string, any>>({
  orgs: [],
  depts: [],
  warehouses: [],
  vendors: [],
});
const dicts = reactive<Record<string, any[]>>({});

const isView = computed(() => props.mode === 'view');
const canEditAmount = computed(() => auth.amountAccess.canEditAmount);
const canViewAmount = computed(() => auth.amountAccess.canViewAmount);

const maxAmount = computed(() => {
  const remaining = Number(form.value.orderRemaining ?? 0);
  return remaining > 0 ? remaining : undefined;
});

const optionOrgId = (item: any) => item.orgId ?? item.raw?.orgId ?? item.raw?.org_id ?? '';
const filteredDepts = computed(() => {
  if (!form.value.orgId) return [];
  return (options.depts ?? []).filter(
    (d: any) => String(optionOrgId(d)) === String(form.value.orgId),
  );
});
const filteredWarehouses = computed(() => {
  if (!form.value.orgId) return [];
  return (options.warehouses ?? []).filter(
    (w: any) => String(optionOrgId(w)) === String(form.value.orgId),
  );
});

function money(value: unknown) {
  return canViewAmount.value ? `¥ ${moneyText(value)}` : '****';
}

function vendorLabel(id: unknown) {
  const v = options.vendors.find((x: any) => String(x.value ?? x.id) === String(id));
  return v?.label ?? v?.name ?? '';
}

async function loadDicts() {
  const values = await Promise.all([
    api.get('/dictionaries/payment_channel').catch(() => []),
  ]);
  dicts.payment_channel = values[0] as any[];
}

async function searchPurchaseOrderOptions(keyword: string) {
  const kw = String(keyword ?? '').trim();
  const r: any = await api.get('/purchase/orders', { params: { keyword: kw, pageSize: 50 } });
  return (r.items ?? []).map((item: any) => ({
    value: item.id,
    label: `${item.orderNo ?? ''}${item.vendorName ? ` · ${item.vendorName}` : ''}`.trim(),
  }));
}

async function orderChanged() {
  if (!form.value.orderId) {
    form.value.orderNo = '';
    form.value.vendorName = '';
    form.value.effectivePayable = 0;
    form.value.orderRemaining = 0;
    return;
  }
  const order: any = await api.get(`/purchase/orders/${form.value.orderId}`);
  const vendorId = order.vendorId ?? order.vendor_id ?? '';
  form.value.orderNo = order.orderNo ?? order.po_no ?? '';
  form.value.vendorId = vendorId;
  form.value.vendorName = vendorLabel(vendorId);
  form.value.orgId = order.orgId ?? order.org_id ?? form.value.orgId;
  form.value.deptId = order.deptId ?? order.dept_id ?? '';
  form.value.warehouseId = order.warehouseId ?? order.warehouse_id ?? '';
  form.value.effectivePayable = Number(order.effectivePayable ?? 0);
  form.value.orderRemaining = Number(order.remainingPayable ?? order.effectivePayable ?? 0);
  form.value.paymentAmount = Math.min(
    Number(form.value.paymentAmount ?? 0),
    Number(form.value.orderRemaining ?? 0),
  );
}

function validate() {
  if (!form.value.orderId) {
    ElMessage.warning('请选择采购订单');
    return false;
  }
  if (!form.value.orgId) {
    ElMessage.warning('请选择所属组织');
    return false;
  }
  if (!form.value.deptId) {
    ElMessage.warning('请选择部门');
    return false;
  }
  if (!form.value.paymentChannel) {
    ElMessage.warning('请选择付款渠道');
    return false;
  }
  if (!form.value.paymentDate) {
    ElMessage.warning('请选择付款日期');
    return false;
  }
  const amount = Number(form.value.paymentAmount ?? 0);
  if (!(amount > 0)) {
    ElMessage.warning('付款金额必须大于0');
    return false;
  }
  if (amount > Number(form.value.orderRemaining ?? 0)) {
    ElMessage.warning('付款金额不能超过剩余应付');
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/purchase/payments';
    const payload: Record<string, any> = {
      orderId: form.value.orderId,
      orgId: form.value.orgId,
      deptId: form.value.deptId,
      warehouseId: form.value.warehouseId ?? '',
      paymentChannel: Number(form.value.paymentChannel),
      paymentAmount: Number(form.value.paymentAmount),
      paymentDate: form.value.paymentDate,
      remark: form.value.remark ?? '',
    };
    const result: any =
      props.mode === 'edit'
        ? await api.patch(`${url}/${form.value.id}`, payload)
        : await api.post(url, payload);
    ElMessage.success(result?.message ?? '付款已生效');
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const [orgs, depts, warehouses, vendors] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/departments/options').catch(() => []),
    api.get('/base-data/warehouses/options').catch(() => []),
    api.get('/base-data/vendors/options').catch(() => []),
  ]);
  options.orgs = orgs;
  options.depts = depts;
  options.warehouses = warehouses;
  options.vendors = vendors;
  await loadDicts();

  if (props.mode === 'create') {
    presetOrder.value = Boolean(form.value.orderId);
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      deptId: auth.user?.deptId ?? '',
      warehouseId: '',
      paymentChannel: Number(dicts.payment_channel?.[0]?.value ?? 1),
      paymentDate: dateText(new Date()),
      paymentAmount: 0,
      remark: '',
    });
    if (form.value.orderId) await orderChanged();
  } else if (form.value.id) {
    const detail: any = await api.get(`/purchase/payments/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="采购订单" required>
        <RemoteSelect
          v-if="mode === 'create' && !presetOrder"
          v-model="form.orderId"
          :fetch="searchPurchaseOrderOptions"
          placeholder="输入采购订单号搜索"
          @change="orderChanged"
        />
        <el-input v-else :model-value="form.orderNo || '—'" disabled />
      </el-form-item>
      <el-form-item label="供应商">
        <el-input :model-value="form.vendorName || '—'" disabled />
      </el-form-item>
      <el-form-item label="所属组织" required>
        <el-select v-model="form.orgId" filterable :disabled="Boolean(form.orderId)">
          <el-option v-for="x in options.orgs" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="部门" required>
        <el-select
          v-model="form.deptId"
          filterable
          :disabled="Boolean(form.orderId) || !form.orgId"
        >
          <el-option v-for="x in filteredDepts" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="仓库">
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="Boolean(form.orderId) || !form.orgId"
        >
          <el-option
            v-for="x in filteredWarehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="付款渠道" required>
        <el-select v-model="form.paymentChannel" :disabled="!canEditAmount">
          <el-option
            v-for="item in dicts.payment_channel || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="付款金额" required>
        <el-input-number
          v-model="form.paymentAmount"
          :min="0.01"
          :max="maxAmount"
          :precision="2"
          controls-position="right"
          style="width: 100%"
          :disabled="!canEditAmount"
        />
      </el-form-item>
      <el-form-item label="付款日期" required>
        <el-date-picker
          v-model="form.paymentDate"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
    </div>

    <div class="money-ref">
      <span>退货后应付：<strong>{{ money(form.effectivePayable) }}</strong></span>
      <span>剩余应付：<strong>{{ money(form.orderRemaining) }}</strong></span>
    </div>

    <el-form-item label="备注" class="span-2">
      <el-input v-model="form.remark" type="textarea" :rows="2" />
    </el-form-item>

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
.money-ref {
  display: flex;
  gap: 20px;
  margin: 4px 0 12px;
  font-size: 13px;
  color: #606266;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
