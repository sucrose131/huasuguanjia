<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText, moneyText } from '@/utils/format';
import { createRequestId } from '@/utils/random-id';
import OverflowTooltipCell from '@/components/business/OverflowTooltipCell.vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const dicts = reactive<Record<string, any[]>>({});

const canViewAmount = computed(() => auth.amountAccess.canViewAmount);
const canEditAmount = computed(() => auth.amountAccess.canEditAmount);
const flows = computed(() => (form.value.flows ?? []) as any[]);
const canRecord = computed(
  () =>
    Number(form.value.remainingAmount ?? 0) > 0 &&
    [0, 1].includes(Number(form.value.refundStatus ?? 0)) &&
    canEditAmount.value,
);

const flowForm = reactive({
  refundAmount: 0,
  refundChannel: 1,
  refundDate: dateText(new Date()),
  supplierSerialNo: '',
  receiveAccount: '',
  remark: '',
  requestKey: '',
});

function money(value: unknown) {
  return canViewAmount.value ? `¥ ${moneyText(value)}` : '****';
}

function dictLabel(code: string, value: unknown) {
  return dicts[code]?.find((item) => String(item.value) === String(value))?.label ?? '—';
}

async function loadDicts() {
  const codes = ['payment_channel', 'purchase_refund_status', 'purchase_refund_source'];
  const values = await Promise.all(
    codes.map((code) => api.get(`/dictionaries/${code}`).catch(() => [])),
  );
  codes.forEach((code, index) => (dicts[code] = values[index] as any[]));
}

function resetFlowForm() {
  flowForm.refundAmount = Number(form.value.remainingAmount ?? 0);
  flowForm.refundChannel = Number(dicts.payment_channel?.[0]?.value ?? 1);
  flowForm.refundDate = dateText(new Date());
  flowForm.supplierSerialNo = '';
  flowForm.receiveAccount = '';
  flowForm.remark = '';
  flowForm.requestKey = createRequestId();
}

async function loadDetail() {
  if (!form.value.id) return;
  const detail: any = await api.get(`/purchase/refunds/${form.value.id}`).catch(() => null);
  if (detail) Object.assign(form.value, detail);
  resetFlowForm();
}

async function recordFlow() {
  const amount = Number(flowForm.refundAmount ?? 0);
  if (!(amount > 0)) {
    ElMessage.warning('本次退款金额必须大于0');
    return;
  }
  if (amount > Number(form.value.remainingAmount ?? 0)) {
    ElMessage.warning('本次退款不能超过剩余应退金额');
    return;
  }
  if (!flowForm.refundChannel || !flowForm.refundDate) {
    ElMessage.warning('请选择退款渠道和退款日期');
    return;
  }
  try {
    await ElMessageBox.confirm(`确认记录本次退款 ¥ ${moneyText(amount)} ？`, '确认采购退款', {
      type: 'warning',
      confirmButtonText: '确认退款',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  saving.value = true;
  try {
    const result: any = await api.post(`/purchase/refunds/${form.value.id}/flows`, {
      refundAmount: amount,
      refundChannel: Number(flowForm.refundChannel),
      refundDate: flowForm.refundDate,
      supplierSerialNo: flowForm.supplierSerialNo ?? '',
      receiveAccount: flowForm.receiveAccount ?? '',
      remark: flowForm.remark ?? '',
      requestKey: flowForm.requestKey || createRequestId(),
    });
    ElMessage.success(result?.message ?? '采购退款已记录');
    await loadDetail();
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

async function voidFlow(flow: any) {
  if (!canEditAmount.value) {
    ElMessage.warning('当前账号没有金额编辑权限，不能撤销退款流水');
    return;
  }
  try {
    await ElMessageBox.confirm('作废后会重算累计已退和退款状态，是否继续？', '作废退款流水', {
      type: 'warning',
      confirmButtonText: '确认作废',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }
  const result: any = await api.delete(`/purchase/refunds/flows/${flow.id}`);
  ElMessage.success(result?.message ?? '退款流水已作废');
  await loadDetail();
}

onMounted(async () => {
  await loadDicts();
  await loadDetail();
});
</script>

<template>
  <el-form class="refund-view" label-position="top">
    <div class="section-title"><strong>退款信息</strong></div>
    <div class="form-grid">
      <el-form-item label="采购订单">
        <el-input :model-value="form.orderNo || '—'" readonly />
      </el-form-item>
      <el-form-item label="来源退货单">
        <el-input :model-value="form.returnNo || '—'" readonly />
      </el-form-item>
      <el-form-item label="供应商">
        <el-input :model-value="form.vendorName || '—'" readonly />
      </el-form-item>
      <el-form-item label="退款来源">
        <el-input :model-value="dictLabel('purchase_refund_source', form.sourceType)" readonly />
      </el-form-item>
      <el-form-item label="应退金额">
        <el-input :model-value="money(form.returnAmount)" readonly />
      </el-form-item>
      <el-form-item label="可退金额">
        <el-input :model-value="money(form.refundableAmount)" readonly />
      </el-form-item>
      <el-form-item label="已退金额">
        <el-input :model-value="money(form.refundedAmount)" readonly />
      </el-form-item>
      <el-form-item label="待退金额">
        <el-input :model-value="money(form.remainingAmount)" readonly />
      </el-form-item>
      <el-form-item label="退款状态">
        <el-input :model-value="dictLabel('purchase_refund_status', form.refundStatus)" readonly />
      </el-form-item>
      <el-form-item label="退货日期">
        <el-input :model-value="form.returnDate ? dateText(form.returnDate) : '—'" readonly />
      </el-form-item>
    </div>

    <div class="section-title">
      <strong>退款流水</strong>
      <span class="muted">共 {{ flows.length }} 条</span>
    </div>
    <el-table :data="flows" border size="small">
      <el-table-column prop="flowNo" label="流水号" min-width="150" />
      <el-table-column label="本次退款" width="120" align="right">
        <template #default="s">{{ money(s.row.refundAmount) }}</template>
      </el-table-column>
      <el-table-column label="退款渠道" width="110">
        <template #default="s">{{ dictLabel('payment_channel', s.row.refundChannel) }}</template>
      </el-table-column>
      <el-table-column label="退款日期" width="110">
        <template #default="s">{{ s.row.refundDate ? dateText(s.row.refundDate) : '—' }}</template>
      </el-table-column>
      <el-table-column prop="supplierSerialNo" label="供应商流水号" min-width="140">
        <template #default="s">
          <OverflowTooltipCell :content="s.row.supplierSerialNo">{{
            s.row.supplierSerialNo
          }}</OverflowTooltipCell>
        </template>
      </el-table-column>
      <el-table-column prop="receiveAccount" label="收款账户" min-width="140">
        <template #default="s">
          <OverflowTooltipCell :content="s.row.receiveAccount">{{
            s.row.receiveAccount
          }}</OverflowTooltipCell>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="140">
        <template #default="s">
          <OverflowTooltipCell :content="s.row.remark">{{ s.row.remark }}</OverflowTooltipCell>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="88" fixed="right">
        <template #default="s">
          <el-button v-if="canEditAmount" link type="danger" @click="voidFlow(s.row)">撤销</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template v-if="canRecord">
      <div class="section-title"><strong>登记退款流水</strong></div>
      <div class="form-grid">
        <el-form-item label="本次退款金额" required>
          <el-input-number
            v-model="flowForm.refundAmount"
            :min="0.01"
            :max="Number(form.remainingAmount ?? 0)"
            :precision="2"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="退款日期" required>
          <el-date-picker
            v-model="flowForm.refundDate"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="退款渠道" required>
          <el-select v-model="flowForm.refundChannel" style="width: 100%">
            <el-option
              v-for="item in dicts.payment_channel || []"
              :key="item.value"
              :label="item.label"
              :value="Number(item.value)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="供应商流水号">
          <el-input v-model="flowForm.supplierSerialNo" />
        </el-form-item>
        <el-form-item label="收款账户" class="span-2">
          <el-input v-model="flowForm.receiveAccount" />
        </el-form-item>
        <el-form-item label="本次退款备注" class="span-2">
          <el-input v-model="flowForm.remark" />
        </el-form-item>
      </div>
    </template>

    <div class="form-actions">
      <el-button @click="emit('cancel')">关闭</el-button>
      <el-button v-if="canRecord" type="primary" :loading="saving" @click="recordFlow">
        登记退款
      </el-button>
    </div>
  </el-form>
</template>

<style scoped>
.refund-view {
  max-height: 70vh;
  overflow-y: auto;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 16px;
}
.span-2 {
  grid-column: 1 / -1;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.muted {
  color: #909399;
  font-size: 12px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
