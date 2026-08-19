<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { inventoryQuantityAlertConfig } from './configs/inventory-quantity-alert';
</script>

<template>
  <BusinessDocumentPage :config="inventoryQuantityAlertConfig" />
</template>
