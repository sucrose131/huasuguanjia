<script setup lang="ts">
import PurchaseDocumentPage from './PurchaseDocumentPage.vue';
import { purchasePaymentConfig } from './configs/purchase-payment';
</script>

<template>
  <PurchaseDocumentPage :config="purchasePaymentConfig" resource="payments" />
</template>
