<script setup lang="ts">
import { ref } from 'vue';
import DocumentTraceDialog from '@/components/DocumentTraceDialog.vue';

const props = defineProps<{
  documentType: string;
  documentNoField: string;
}>();

const visible = ref(false);
const row = ref<Record<string, any>>({});

function open(document: Record<string, any>) {
  row.value = document;
  visible.value = true;
}

defineExpose({ open });
</script>

<template>
  <DocumentTraceDialog
    v-model="visible"
    :document-type="props.documentType"
    :document-id="row.id || ''"
    :document-no="String(row[props.documentNoField] ?? '')"
  />
</template>
