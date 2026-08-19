<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { inventoryCheckConfig } from './configs/inventory-check';
</script>

<template>
  <BusinessDocumentPage :config="inventoryCheckConfig" />
</template>
