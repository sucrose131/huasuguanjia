<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { productionBomConfig } from './configs/production-bom';
</script>

<template>
  <BusinessDocumentPage :config="productionBomConfig" />
</template>
