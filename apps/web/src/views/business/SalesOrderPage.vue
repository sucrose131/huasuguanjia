<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { salesOrderConfig } from './configs/sales-order';
</script>

<template>
  <BusinessDocumentPage :config="salesOrderConfig" />
</template>
