<script setup lang="ts">
import PurchaseDocumentPage from './PurchaseDocumentPage.vue';
import { purchaseRefundConfig } from './configs/purchase-refund';
</script>

<template>
  <PurchaseDocumentPage :config="purchaseRefundConfig" resource="refunds" />
</template>
