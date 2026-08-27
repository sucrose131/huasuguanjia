<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { inventoryLossOutputConfig } from './configs/inventory-loss-output';
</script>

<template>
  <BusinessDocumentPage :config="inventoryLossOutputConfig" />
</template>
