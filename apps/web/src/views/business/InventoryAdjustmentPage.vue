<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { inventoryAdjustmentConfig } from './configs/inventory-adjustment';
</script>

<template>
  <BusinessDocumentPage :config="inventoryAdjustmentConfig" />
</template>
