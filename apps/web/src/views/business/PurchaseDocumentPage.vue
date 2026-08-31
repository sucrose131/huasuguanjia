<script setup lang="ts">
import { ref } from 'vue';
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import PurchaseOperationHistoryDialog from '@/components/PurchaseOperationHistoryDialog.vue';
import type { BusinessDocumentConfig } from './business-document-config';

defineProps<{ config: BusinessDocumentConfig; resource: string }>();

const historyVisible = ref(false);
const historyRow = ref<Record<string, any>>({});

function openHistory(row: Record<string, any>) {
  historyRow.value = row;
  historyVisible.value = true;
}
</script>

<template>
  <BusinessDocumentPage :config="config">
    <template #more-actions="scope">
      <slot name="more-actions" v-bind="scope" />
      <el-dropdown-item @click="openHistory(scope.row)">操作记录</el-dropdown-item>
    </template>
    <template #business-dialogs="scope">
      <slot name="business-dialogs" v-bind="scope" />
      <PurchaseOperationHistoryDialog
        v-model="historyVisible"
        :resource="resource"
        :document-id="historyRow.id || ''"
        :document-no="String(historyRow[config.no] ?? '')"
      />
    </template>
  </BusinessDocumentPage>
</template>
