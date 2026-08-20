<script setup lang="ts">
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import PurchaseDocumentPage from './PurchaseDocumentPage.vue';
import { purchaseApplicationConfig } from './configs/purchase-application';
import PurchaseApplicationOrderPreviewDialog from '@/components/purchase/PurchaseApplicationOrderPreviewDialog.vue';
import { useAuthStore } from '@/stores/auth';
import { canPageAction } from '@/utils/permission';

type PreviewMode = 'all' | 'partial' | 'related';
const auth = useAuthStore();
const route = useRoute();
const previewVisible = ref(false);
const applicationId = ref('');
const previewMode = ref<PreviewMode>('all');
const refreshAfterGenerate = ref<null | (() => Promise<void>)>(null);

const canUpdate = () => canPageAction(auth.user, route.path, 'update');
const canGenerate = (row: Record<string, any>) =>
  canUpdate() && Number(row.approveStatus) === 1;

function openPreview(row: Record<string, any>, mode: PreviewMode, refresh: () => Promise<void>) {
  if (mode !== 'related' && !auth.amountAccess.canEditAmount) {
    ElMessage.warning('当前账号没有金额编辑权限，不能生成采购订单');
    return;
  }
  applicationId.value = String(row.id);
  previewMode.value = mode;
  refreshAfterGenerate.value = refresh;
  previewVisible.value = true;
}

async function generated() {
  await refreshAfterGenerate.value?.();
}
</script>

<template>
  <PurchaseDocumentPage :config="purchaseApplicationConfig" resource="applications">
    <template #more-actions="{ row, refresh }">
      <el-dropdown-item v-if="canGenerate(row)" @click="openPreview(row, 'all', refresh)">
        整单生成
      </el-dropdown-item>
      <el-dropdown-item v-if="canGenerate(row)" @click="openPreview(row, 'partial', refresh)">
        选品生成
      </el-dropdown-item>
      <el-dropdown-item v-if="canGenerate(row)" @click="openPreview(row, 'related', refresh)">
        关联订单
      </el-dropdown-item>
    </template>
    <template #business-dialogs>
      <PurchaseApplicationOrderPreviewDialog
        v-model="previewVisible"
        :application-id="applicationId"
        :mode="previewMode"
        :can-view-amount="auth.amountAccess.canViewAmount"
        :can-edit-amount="auth.amountAccess.canEditAmount"
        @generated="generated"
      />
    </template>
  </PurchaseDocumentPage>
</template>
