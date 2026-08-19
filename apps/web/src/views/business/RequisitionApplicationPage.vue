<script setup lang="ts">
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { requisitionApplicationConfig } from './configs/requisition-application';
</script>

<template>
  <BusinessDocumentPage :config="requisitionApplicationConfig" />
</template>
