<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { purchasePaymentConfig } from './configs/purchase-payment';
</script>

<template>
  <BusinessDocumentPage :config="purchasePaymentConfig" />
</template>
