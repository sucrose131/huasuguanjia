<script setup lang="ts">
import PurchaseDocumentPage from './PurchaseDocumentPage.vue';
import { purchaseReceiptConfig } from './configs/purchase-receipt';
</script>

<template>
  <PurchaseDocumentPage :config="purchaseReceiptConfig" resource="receipts" />
</template>
