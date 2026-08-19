<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { salesDiscountOrderConfig } from './configs/sales-discount-order';
</script>

<template>
  <BusinessDocumentPage :config="salesDiscountOrderConfig" />
</template>
