<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { inventoryTransferConfig } from './configs/inventory-transfer';
</script>

<template>
  <BusinessDocumentPage :config="inventoryTransferConfig" />
</template>
