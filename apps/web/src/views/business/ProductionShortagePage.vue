<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { productionShortageConfig } from './configs/production-shortage';
</script>

<template>
  <BusinessDocumentPage :config="productionShortageConfig" />
</template>
