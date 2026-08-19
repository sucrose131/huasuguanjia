<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { purchaseOrderConfig } from './configs/purchase-order';
</script>

<template>
  <BusinessDocumentPage :config="purchaseOrderConfig" />
</template>
