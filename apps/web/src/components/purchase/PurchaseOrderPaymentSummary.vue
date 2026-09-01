<script setup lang="ts">
import { moneyText } from '@/utils/format';
import PurchaseOrderSectionHeader from './PurchaseOrderSectionHeader.vue';

const props = defineProps<{
  form: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
  dicts: Record<string, any[]>;
  canViewAmount: boolean;
  orderTotal: number;
  effectivePayable: number;
  netPaidAmount: number;
  remainingAfterPayment: number;
  previewProgressStatus: number;
}>();

function protectedMoney(value: unknown) {
  return props.canViewAmount ? `¥ ${moneyText(value)}` : '****';
}

function dictLabel(code: string, value: unknown) {
  return (
    (props.dicts[code] ?? []).find((item: any) => String(item.value) === String(value))?.label ??
    '—'
  );
}
</script>

<template>
  <section class="purchase-order-section">
    <PurchaseOrderSectionHeader
      title="金额与付款"
      description="订单金额自动汇总；付款统一从采购订单操作列登记"
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
      <el-form-item label="剩余应付">
        <el-input :model-value="protectedMoney(remainingAfterPayment)" disabled />
      </el-form-item>
      <el-form-item label="付款进度">
        <el-input
          :model-value="dictLabel('purchase_payment_progress_status', previewProgressStatus)"
          disabled
        />
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
@media (max-width: 960px) {
  .purchase-order-payment-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
