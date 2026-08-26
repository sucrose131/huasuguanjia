<script setup lang="ts">
import { ref } from 'vue';
import PurchaseDocumentPage from './PurchaseDocumentPage.vue';
import { purchaseOrderConfig } from './configs/purchase-order';
import PurchaseOrderCancelPendingDialog from '@/components/purchase/PurchaseOrderCancelPendingDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { canPageAction } from '@/utils/permission';

const auth = useAuthStore();
const cancelDialogRef = ref<InstanceType<typeof PurchaseOrderCancelPendingDialog> | null>(null);

function canCancelPending(row: Record<string, any>) {
  return (
    canPageAction(auth.user, '/purchase/orders', 'cancel-pending') &&
    row.canCancelUnarrived === true &&
    Number(row.normalAvailableQuantity ?? 0) > 0
  );
}

function openCancelPending(row: Record<string, any>) {
  void cancelDialogRef.value?.open(row);
}
</script>

<template>
  <PurchaseDocumentPage :config="purchaseOrderConfig" resource="orders">
    <template #more-actions="{ row }">
      <el-dropdown-item
        v-if="canCancelPending(row)"
        class="table-action-warning"
        @click="openCancelPending(row)"
        >退回未到货</el-dropdown-item
      >
    </template>
    <template #business-dialogs="{ refresh }">
      <PurchaseOrderCancelPendingDialog
        ref="cancelDialogRef"
        @completed="refresh"
      />
    </template>
  </PurchaseDocumentPage>
</template>
