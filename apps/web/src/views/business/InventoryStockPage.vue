<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { inventoryStockConfig } from './configs/inventory-stock';
</script>

<template>
  <BusinessDocumentPage :config="inventoryStockConfig" />
</template>
