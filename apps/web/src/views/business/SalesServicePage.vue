<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { salesServiceConfig } from './configs/sales-service';
</script>

<template>
  <BusinessDocumentPage :config="salesServiceConfig" />
</template>
