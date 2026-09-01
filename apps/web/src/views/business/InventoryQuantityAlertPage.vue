<script setup lang="ts">
import { ref } from 'vue';
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import WarehouseTabs from '@/components/business/WarehouseTabs.vue';
import InventoryLedgerDialog from '@/components/inventory/InventoryLedgerDialog.vue';
import { sumWarehouseCounts } from '@/utils/warehouse-counts';
import { inventoryQuantityAlertConfig } from './configs/inventory-quantity-alert';

const ledgerRef = ref<InstanceType<typeof InventoryLedgerDialog>>();
function showLedger(row: any) {
  ledgerRef.value?.showLedger(row);
}
</script>

<template>
  <BusinessDocumentPage :config="inventoryQuantityAlertConfig">
    <template #query-tools="{ query, load, warehouseCounts }">
      <WarehouseTabs
        :query="query"
        :load="load"
        :total="sumWarehouseCounts(warehouseCounts)"
        :warehouse-counts="warehouseCounts"
      />
    </template>
    <template #row-actions="{ row }">
      <el-button link type="primary" @click="showLedger(row)">查看</el-button>
    </template>
  </BusinessDocumentPage>
  <InventoryLedgerDialog ref="ledgerRef" />
</template>
