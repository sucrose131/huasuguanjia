<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { inventoryExpiryAlertConfig } from './configs/inventory-expiry-alert';
</script>

<template>
  <BusinessDocumentPage :config="inventoryExpiryAlertConfig" />
</template>
