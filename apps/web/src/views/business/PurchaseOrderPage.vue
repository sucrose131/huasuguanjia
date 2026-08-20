<script setup lang="ts">
import PurchaseDocumentPage from './PurchaseDocumentPage.vue';
import { purchaseOrderConfig } from './configs/purchase-order';
</script>

<template>
  <PurchaseDocumentPage :config="purchaseOrderConfig" resource="orders" />
</template>
