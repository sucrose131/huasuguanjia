<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { salesRefundConfig } from './configs/sales-refund';
</script>

<template>
  <BusinessDocumentPage :config="salesRefundConfig" />
</template>
