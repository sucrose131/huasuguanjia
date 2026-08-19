<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { salesOutputConfig } from './configs/sales-output';
</script>

<template>
  <BusinessDocumentPage :config="salesOutputConfig" />
</template>
