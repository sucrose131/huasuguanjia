<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { productionPlanConfig } from './configs/production-plan';
</script>

<template>
  <BusinessDocumentPage :config="productionPlanConfig" />
</template>
