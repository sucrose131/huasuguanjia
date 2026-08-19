<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { purchaseReturnConfig } from './configs/purchase-return';
</script>

<template>
  <BusinessDocumentPage :config="purchaseReturnConfig" />
</template>
