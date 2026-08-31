<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { requisitionReturnConfig } from './configs/requisition-return';
</script>

<template>
  <BusinessDocumentPage :config="requisitionReturnConfig" />
</template>
