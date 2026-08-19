<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { purchaseRefundConfig } from './configs/purchase-refund';
</script>

<template>
  <BusinessDocumentPage :config="purchaseRefundConfig" />
</template>
