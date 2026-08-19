<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { salesPaymentConfig } from './configs/sales-payment';
</script>

<template>
  <BusinessDocumentPage :config="salesPaymentConfig" />
</template>
