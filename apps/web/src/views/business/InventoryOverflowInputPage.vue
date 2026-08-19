<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { inventoryOverflowInputConfig } from './configs/inventory-overflow-input';
</script>

<template>
  <BusinessDocumentPage :config="inventoryOverflowInputConfig" />
</template>
