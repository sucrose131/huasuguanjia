<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { salesReturnConfig } from './configs/sales-return';
</script>

<template>
  <BusinessDocumentPage :config="salesReturnConfig" />
</template>
