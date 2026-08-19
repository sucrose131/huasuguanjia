<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText, moneyText } from '@/utils/format';
import { createRequestId } from '@/utils/random-id';
import RemoteSelect from '@/components/RemoteSelect.vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const options = reactive<Record<string, any[]>>({ orgs: [], depts: [] });
const dicts = reactive<Record<string, any[]>>({ payment_channel: [] });

const isView = computed(() => props.mode !== 'create');
const canEditAmount = computed(() => auth.amountAccess.canEditAmount);
const orderActualAmount = computed(
  () => form.value.orderActualAmount ?? form.value.actualAmount ?? 0,
);
const moneyLimit = computed(() =>
  Math.max(0, Number(form.value.refundableAmount ?? form.value.availableAmount ?? 0) || 0),
);
const deptOptions = computed(() =>
  (options.depts as any[]).filter(
    (d: any) => !form.value.orgId || String(d.raw?.orgId ?? d.orgId) === String(form.value.orgId),
  ),
);

async function searchOrderOptions(keyword: string) {
  const r: any = await api.get('/sales/money-order-options', {
    params: { keyword, pageSize: 50 },
  });
  const items = (Array.isArray(r) ? r : r.items ?? []) as any[];
  return items.map((x: any) => ({
    value: x.id,
    label: `${x.orderNo ?? ''} · ${x.customerName ?? ''}`.trim(),
  }));
}

function normalizeDepartment() {
  if (!form.value.deptId) return;
  const selected = (options.depts as any[]).find(
    (d: any) => String(d.value) === String(form.value.deptId),
  );
  const selectedOrg = selected?.raw?.orgId ?? selected?.orgId;
  if (!selected || String(selectedOrg) !== String(form.value.orgId)) form.value.deptId = '';
}

async function orderChanged() {
  if (!form.value.orderId) {
    Object.assign(form.value, {
      orderNo: '',
      customerName: '',
      orderDate: '',
      actualAmount: null,
      receivedAmount: 0,
      refundedAmount: 0,
      netAmount: 0,
      unreceivedAmount: 0,
      refundableAmount: 0,
      availableAmount: 0,
      orgId: auth.user?.orgId ?? '',
    });
    normalizeDepartment();
    return;
  }
  const s: any = await api.get(`/sales/orders/${form.value.orderId}/payment-summary`);
  Object.assign(form.value, s, { orderId: s.orderId, amount: 0 });
  normalizeDepartment();
}

function validate() {
  if (!form.value.orderId) {
    ElMessage.warning('请选择销售订单');
    return false;
  }
  if (!form.value.orgId) {
    ElMessage.warning('缺少组织信息');
    return false;
  }
  if (!form.value.deptId) {
    ElMessage.warning('请选择所属部门');
    return false;
  }
  if (!form.value.paymentMode) {
    ElMessage.warning('请选择退款方式');
    return false;
  }
  if (!form.value.paymentDate) {
    ElMessage.warning('请选择退款日期');
    return false;
  }
  if (Number(form.value.amount) <= 0) {
    ElMessage.warning('本次退款金额必须大于0');
    return false;
  }
  if (Number(form.value.amount) > moneyLimit.value + 0.000001) {
    ElMessage.warning('本次退款金额不能超过可退金额');
    return false;
  }
  if (!String(form.value.remark ?? '').trim()) {
    ElMessage.warning('请填写退款原因');
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    await ElMessageBox.confirm('退款只处理资金，不执行商品返库，是否继续？', '确认', {
      type: 'warning',
    });
    form.value.requestKey = form.value.requestKey || createRequestId();
    const payload: Record<string, any> = {
      orderId: form.value.orderId,
      orgId: form.value.orgId,
      deptId: form.value.deptId,
      paymentMode: form.value.paymentMode,
      paymentDate: form.value.paymentDate,
      amount: form.value.amount,
      remark: String(form.value.remark ?? '').trim(),
      requestKey: form.value.requestKey,
    };
    const result: any = await api.post('/sales/refunds', payload);
    ElMessage.success(result?.message ?? '退款成功');
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  if (props.mode === 'create' && !canEditAmount.value) {
    ElMessage.warning('当前账号没有金额编辑权限，只能查看金额相关单据');
    emit('cancel');
    return;
  }
  const [orgs, depts, paymentChannels] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/departments/options').catch(() => []),
    api.get('/dictionaries/payment_channel').catch(() => []),
  ]);
  options.orgs = orgs as any[];
  options.depts = depts as any[];
  dicts.payment_channel = paymentChannels as any[];

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: form.value.orgId ?? auth.user?.orgId ?? '',
      deptId: form.value.deptId ?? auth.user?.deptId ?? '',
      paymentMode: form.value.paymentMode ?? 1,
      paymentDate: form.value.paymentDate ?? dateText(new Date()),
      amount: 0,
      remark: form.value.remark ?? '',
      requestKey: form.value.requestKey || createRequestId(),
    });
    if (form.value.orderId) await orderChanged();
  } else if (form.value.id) {
    const detail: any = await api.get(`/sales/refunds/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <el-form-item v-if="mode === 'create' && !form.orderId" label="销售订单" required>
      <RemoteSelect
        v-model="form.orderId"
        :fetch="searchOrderOptions"
        placeholder="输入订单号或客户搜索"
        @change="orderChanged"
      />
    </el-form-item>

    <div class="funds-section">
      <div class="funds-title">订单摘要</div>
      <div class="form-grid">
        <el-form-item label="订单号">
          <el-input :model-value="form.orderNo || '—'" readonly />
        </el-form-item>
        <el-form-item label="客户">
          <el-input :model-value="form.customerName || '—'" readonly />
        </el-form-item>
        <el-form-item label="订单日期">
          <el-input :model-value="form.orderDate ? dateText(form.orderDate) : '—'" readonly />
        </el-form-item>
        <el-form-item label="订单实际金额">
          <el-input :model-value="moneyText(orderActualAmount)" readonly />
        </el-form-item>
      </div>
    </div>

    <div class="funds-section">
      <div class="funds-title">资金摘要</div>
      <div class="form-grid">
        <el-form-item label="累计收款">
          <el-input :model-value="moneyText(form.receivedAmount)" readonly />
        </el-form-item>
        <el-form-item label="累计退款">
          <el-input :model-value="moneyText(form.refundedAmount)" readonly />
        </el-form-item>
        <el-form-item label="净收款">
          <el-input :model-value="moneyText(form.netAmount)" readonly />
        </el-form-item>
        <el-form-item label="可退金额">
          <el-input :model-value="moneyText(moneyLimit)" readonly />
        </el-form-item>
      </div>
    </div>

    <div class="form-grid">
      <el-form-item label="本次退款金额" required class="span-2">
        <el-input-number
          v-model="form.amount"
          :min="moneyLimit > 0 ? 0.01 : 0"
          :max="moneyLimit"
          :step="0.01"
          :precision="2"
          :disabled="isView || !canEditAmount"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="退款方式" required>
        <el-select v-model="form.paymentMode" filterable>
          <el-option
            v-for="x in dicts.payment_channel"
            :key="x.value"
            :label="x.label"
            :value="Number(x.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="退款日期" required>
        <el-date-picker v-model="form.paymentDate" type="date" value-format="YYYY-MM-DD" />
      </el-form-item>
      <el-form-item label="组织">
        <el-select v-model="form.orgId" disabled>
          <el-option v-for="x in options.orgs" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="部门" required>
        <el-select v-model="form.deptId" filterable>
          <el-option v-for="x in deptOptions" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="退款原因" required class="span-2">
        <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="请填写退款原因" />
      </el-form-item>
    </div>

    <div v-if="isView" class="form-grid">
      <el-form-item label="退款单号">
        <el-input :model-value="form.paymentNo || '—'" readonly />
      </el-form-item>
      <el-form-item label="操作人">
        <el-input :model-value="form.createdByName || '—'" readonly />
      </el-form-item>
      <el-form-item label="创建时间">
        <el-input :model-value="form.createdAt ? dateText(form.createdAt, true) : '—'" readonly />
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
.funds-section {
  margin-bottom: 4px;
}
.funds-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: #303133;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
