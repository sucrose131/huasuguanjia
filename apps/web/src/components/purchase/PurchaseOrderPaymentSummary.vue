<script setup lang="ts">
import { computed } from 'vue';
import { moneyText } from '@/utils/format';
import PurchaseOrderSectionHeader from './PurchaseOrderSectionHeader.vue';

const props = defineProps<{
  form: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
  dicts: Record<string, any[]>;
  canViewAmount: boolean;
  canEditAmount: boolean;
  orderTotal: number;
  effectivePayable: number;
  netPaidAmount: number;
  remainingAfterPayment: number;
  previewProgressStatus: number;
}>();

const isCreate = computed(() => props.mode === 'create');

function protectedMoney(value: unknown) {
  return props.canViewAmount ? `¥ ${moneyText(value)}` : '****';
}

function dictLabel(code: string, value: unknown) {
  return (props.dicts[code] ?? []).find(
    (item: any) => String(item.value) === String(value),
  )?.label ?? '—';
}
</script>

<template>
  <section class="purchase-order-section">
    <PurchaseOrderSectionHeader
      title="金额与付款"
      description="订单金额自动汇总；本次付款可为0，后续仍可从订单操作列分次付款"
    />

    <div class="purchase-order-payment-grid">
      <el-form-item label="订单总金额">
        <el-input :model-value="protectedMoney(orderTotal)" disabled />
      </el-form-item>
      <el-form-item label="退货后应付">
        <el-input :model-value="protectedMoney(effectivePayable)" disabled />
      </el-form-item>
      <el-form-item label="累计付款">
        <el-input :model-value="protectedMoney(form.paidAmount ?? 0)" disabled />
      </el-form-item>
      <el-form-item label="累计退款">
        <el-input :model-value="protectedMoney(form.refundedAmount ?? 0)" disabled />
      </el-form-item>
      <el-form-item label="净已付款">
        <el-input :model-value="protectedMoney(netPaidAmount)" disabled />
      </el-form-item>
      <el-form-item label="本次付款金额">
        <el-input-number
          v-if="isCreate && canEditAmount"
          v-model="form.currentPaymentAmount"
          :min="0"
          :max="orderTotal"
          :precision="2"
          controls-position="right"
        />
        <el-input v-else model-value="—" disabled />
      </el-form-item>
      <el-form-item label="付款后待付">
        <el-input :model-value="protectedMoney(remainingAfterPayment)" disabled />
      </el-form-item>
      <el-form-item label="付款进度">
        <el-input
          :model-value="dictLabel('purchase_payment_progress_status', previewProgressStatus)"
          disabled
        />
      </el-form-item>
      <el-form-item label="本次付款日期">
        <el-date-picker
          v-if="isCreate"
          v-model="form.currentPaymentDate"
          value-format="YYYY-MM-DD"
          :disabled="!Number(form.currentPaymentAmount)"
        />
        <el-input v-else model-value="—" disabled />
      </el-form-item>
      <el-form-item label="本次付款渠道">
        <el-select
          v-if="isCreate"
          v-model="form.currentPaymentChannel"
          :disabled="!Number(form.currentPaymentAmount)"
        >
          <el-option
            v-for="item in dicts.payment_channel || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
        <el-input v-else model-value="—" disabled />
      </el-form-item>
      <el-form-item label="付款备注" class="span-2">
        <el-input
          v-if="isCreate"
          v-model="form.currentPaymentRemark"
          :disabled="!Number(form.currentPaymentAmount)"
        />
        <el-input v-else model-value="—" disabled />
      </el-form-item>
    </div>
  </section>
</template>

<style scoped>
.purchase-order-section {
  margin-top: var(--hs-space-5);
}
.purchase-order-payment-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--hs-space-3) var(--hs-space-4);
}
.purchase-order-payment-grid :deep(.el-form-item) {
  margin-bottom: 0;
}
.purchase-order-payment-grid :deep(.el-form-item__label) {
  height: auto;
  margin-bottom: var(--hs-space-1);
  padding: 0;
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-label);
  line-height: var(--hs-line-label);
}
.purchase-order-payment-grid :deep(.el-input-number),
.purchase-order-payment-grid :deep(.el-select),
.purchase-order-payment-grid :deep(.el-date-editor) {
  width: 100%;
}
.purchase-order-payment-grid :deep(.is-disabled) {
  opacity: 1;
}
.purchase-order-payment-grid :deep(.is-disabled .el-input__inner),
.purchase-order-payment-grid :deep(.is-disabled .el-select__selected-item) {
  color: var(--hs-color-text-primary);
  -webkit-text-fill-color: var(--hs-color-text-primary);
}
.span-2 {
  grid-column: span 2;
}
@media (max-width: 960px) {
  .purchase-order-payment-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
