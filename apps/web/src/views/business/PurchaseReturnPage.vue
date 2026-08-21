<script setup lang="ts">
import PurchaseDocumentPage from './PurchaseDocumentPage.vue';
import { purchaseReturnConfig } from './configs/purchase-return';
</script>

<template>
  <PurchaseDocumentPage :config="purchaseReturnConfig" resource="returns" />
</template>
