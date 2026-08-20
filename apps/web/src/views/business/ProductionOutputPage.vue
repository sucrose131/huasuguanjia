<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { productionOutputConfig } from './configs/production-output';
import type { BusinessDocumentConfig, RowAction } from './business-document-config';
import ExecuteOutDialog from '@/components/production/ExecuteOutDialog.vue';
import TempSupplementDialog from '@/components/production/TempSupplementDialog.vue';
import BomReturnDialog from '@/components/production/BomReturnDialog.vue';
import SupplementHistoryDialog from '@/components/production/SupplementHistoryDialog.vue';

type B = Record<string, any>;

const selectedOutRow = ref<B | null>(null);
const executeOutVisible = ref(false);
const tempSupplVisible = ref(false);
const bomReturnVisible = ref(false);
const supplementHistoryVisible = ref(false);

let resolveExecute: (() => void) | null = null;
let resolveTempSuppl: (() => void) | null = null;
let resolveBomReturn: (() => void) | null = null;

function openDialog(flag: 'execute' | 'temp-suppl' | 'bom-return', row: B) {
  selectedOutRow.value = row;
  if (flag === 'execute') {
    executeOutVisible.value = true;
    return new Promise<void>((resolve) => {
      resolveExecute = resolve;
    });
  }
  if (flag === 'temp-suppl') {
    tempSupplVisible.value = true;
    return new Promise<void>((resolve) => {
      resolveTempSuppl = resolve;
    });
  }
  bomReturnVisible.value = true;
  return new Promise<void>((resolve) => {
    resolveBomReturn = resolve;
  });
}

function onDialogDone(flag: 'execute' | 'temp-suppl' | 'bom-return') {
  if (flag === 'execute') {
    executeOutVisible.value = false;
    resolveExecute?.();
    resolveExecute = null;
  } else if (flag === 'temp-suppl') {
    tempSupplVisible.value = false;
    resolveTempSuppl?.();
    resolveTempSuppl = null;
  } else {
    bomReturnVisible.value = false;
    resolveBomReturn?.();
    resolveBomReturn = null;
  }
}

// 用户直接关闭弹窗时也结束等待，避免 runAction 挂起
watch(executeOutVisible, (v) => {
  if (!v && resolveExecute) {
    resolveExecute();
    resolveExecute = null;
  }
});
watch(tempSupplVisible, (v) => {
  if (!v && resolveTempSuppl) {
    resolveTempSuppl();
    resolveTempSuppl = null;
  }
});
watch(bomReturnVisible, (v) => {
  if (!v && resolveBomReturn) {
    resolveBomReturn();
    resolveBomReturn = null;
  }
});

const shellActions: RowAction[] = [
  {
    key: 'execute-out',
    label: '执行出库',
    kind: 'success',
    show: (row) =>
      Number(row.outType) === 1 && Number(row.confirmStatus ?? row.status) === 0,
    handler: (row) => openDialog('execute', row),
    permission: 'confirm',
  },
  {
    key: 'temp-suppl',
    label: '临时补料',
    show: (row) => Number(row.outType) === 1 && Number(row.confirmStatus) === 1,
    handler: (row) => openDialog('temp-suppl', row),
    permission: 'create-material-return',
  },
  {
    key: 'bom-return',
    label: '材料退回',
    show: (row) =>
      Number(row.outType) === 1 && Number(row.confirmStatus) === 1,
    handler: (row) => openDialog('bom-return', row),
    permission: 'create-material-return',
  },
  {
    key: 'supplement-history',
    label: '补料明细',
    primary: false,
    show: (row) => Number(row.outType) === 1,
    permission: 'production:outputs',
    handler: (row) => {
      selectedOutRow.value = row;
      supplementHistoryVisible.value = true;
    },
  },
];

const config = computed<BusinessDocumentConfig>(() => ({
  ...productionOutputConfig,
  rowActions: [...(productionOutputConfig.rowActions ?? []), ...shellActions],
}));
</script>

<template>
  <BusinessDocumentPage :config="config" />
  <ExecuteOutDialog
    v-model="executeOutVisible"
    :out-doc="selectedOutRow ?? {}"
    @done="onDialogDone('execute')"
  />
  <TempSupplementDialog
    v-model="tempSupplVisible"
    :out-doc="selectedOutRow ?? {}"
    @done="onDialogDone('temp-suppl')"
  />
  <BomReturnDialog
    v-model="bomReturnVisible"
    :out-row="selectedOutRow ?? {}"
    @done="onDialogDone('bom-return')"
  />
  <SupplementHistoryDialog
    v-model="supplementHistoryVisible"
    :out-doc="selectedOutRow ?? {}"
  />
</template>
