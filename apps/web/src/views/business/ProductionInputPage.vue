<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { productionInputConfig } from './configs/production-input';
</script>

<template>
  <BusinessDocumentPage :config="productionInputConfig" />
</template>
