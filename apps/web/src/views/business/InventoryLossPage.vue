<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { inventoryLossConfig } from './configs/inventory-loss';
</script>

<template>
  <BusinessDocumentPage :config="inventoryLossConfig" />
</template>
