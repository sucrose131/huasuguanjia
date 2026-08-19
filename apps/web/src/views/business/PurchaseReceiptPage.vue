<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { purchaseReceiptConfig } from './configs/purchase-receipt';
</script>

<template>
  <BusinessDocumentPage :config="purchaseReceiptConfig" />
</template>
