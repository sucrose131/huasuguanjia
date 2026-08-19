<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { requisitionOutputConfig } from './configs/requisition-output';
</script>

<template>
  <BusinessDocumentPage :config="requisitionOutputConfig" />
</template>
