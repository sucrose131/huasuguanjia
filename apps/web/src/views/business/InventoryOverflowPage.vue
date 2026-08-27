<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { inventoryOverflowConfig } from './configs/inventory-overflow';
</script>

<template>
  <BusinessDocumentPage :config="inventoryOverflowConfig" />
</template>
