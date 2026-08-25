<script setup lang="ts">
import { ref } from 'vue';
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import WarehouseTabs from '@/components/business/WarehouseTabs.vue';
import InventoryLedgerDialog from '@/components/inventory/InventoryLedgerDialog.vue';
import { inventoryExpiryAlertConfig } from './configs/inventory-expiry-alert';

const ledgerRef = ref<InstanceType<typeof InventoryLedgerDialog>>();
function showLedger(row: any) {
  ledgerRef.value?.showLedger(row);
}
</script>

<template>
  <BusinessDocumentPage :config="inventoryExpiryAlertConfig">
    <template #query-tools="{ query, load, total }">
      <WarehouseTabs :query="query" :load="load" :total="total" />
    </template>
    <template #row-actions="{ row }">
      <el-button link type="primary" @click="showLedger(row)">查看</el-button>
    </template>
    <InventoryLedgerDialog ref="ledgerRef" />
  </BusinessDocumentPage>
</template>
