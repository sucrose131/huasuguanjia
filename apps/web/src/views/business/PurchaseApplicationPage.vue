<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { purchaseApplicationConfig } from './configs/purchase-application';
</script>

<template>
  <BusinessDocumentPage :config="purchaseApplicationConfig" />
</template>
