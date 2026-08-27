<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BusinessDocumentPage from './BusinessDocumentPage.vue';
import { productionOutputConfig } from './configs/production-output';
import type { BusinessDocumentConfig, RowAction } from './business-document-config';
import ExecuteOutDialog from '@/components/production/ExecuteOutDialog.vue';
import TempSupplementDialog from '@/components/production/TempSupplementDialog.vue';
import BomReturnDialog from '@/components/production/BomReturnDialog.vue';
import SupplementHistoryDialog from '@/components/production/SupplementHistoryDialog.vue';
import LabOutboundDialog from '@/components/production/LabOutboundDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { canPageAction } from '@/utils/permission';

type B = Record<string, any>;

const auth = useAuthStore();
const pageRef = ref<InstanceType<typeof BusinessDocumentPage> | null>(null);
const supplementHistoryRef = ref<InstanceType<typeof SupplementHistoryDialog> | null>(null);
const selectedOutRow = ref<B | null>(null);
const executeOutVisible = ref(false);
const tempSupplVisible = ref(false);
const bomReturnVisible = ref(false);
const supplementHistoryVisible = ref(false);
const labOutVisible = ref(false);
const canCreateTemporaryOutput = computed(() =>
  canPageAction(auth.user, '/production/outputs', 'create'),
);

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

async function onDialogDone(flag: 'execute' | 'temp-suppl' | 'bom-return') {
  let handledByRowAction = false;
  if (flag === 'execute') {
    executeOutVisible.value = false;
    handledByRowAction = Boolean(resolveExecute);
    resolveExecute?.();
    resolveExecute = null;
  } else if (flag === 'temp-suppl') {
    tempSupplVisible.value = false;
    handledByRowAction = Boolean(resolveTempSuppl);
    resolveTempSuppl?.();
    resolveTempSuppl = null;
  } else {
    bomReturnVisible.value = false;
    handledByRowAction = Boolean(resolveBomReturn);
    resolveBomReturn?.();
    resolveBomReturn = null;
  }
  if (!handledByRowAction) await pageRef.value?.load();
  if (supplementHistoryVisible.value) await supplementHistoryRef.value?.load();
}

async function onLabOutboundDone() {
  labOutVisible.value = false;
  await pageRef.value?.load();
}

function openSupplementBomReturn(row: B) {
  selectedOutRow.value = row;
  bomReturnVisible.value = true;
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
    label: 'BOM退库',
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
  <BusinessDocumentPage ref="pageRef" :config="config">
    <template #page-actions>
      <el-button
        v-if="canCreateTemporaryOutput"
        type="primary"
        @click="labOutVisible = true"
        >新增临时出库</el-button
      >
    </template>
  </BusinessDocumentPage>
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
    ref="supplementHistoryRef"
    v-model="supplementHistoryVisible"
    :out-doc="selectedOutRow ?? {}"
    @updated="pageRef?.load()"
    @bom-return="openSupplementBomReturn"
  />
  <LabOutboundDialog v-model="labOutVisible" @done="onLabOutboundDone" />
</template>
