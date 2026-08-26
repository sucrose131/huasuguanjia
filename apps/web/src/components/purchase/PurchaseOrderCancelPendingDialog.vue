<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import {
  cancelPendingPayload,
  cancelPendingValidationMessage,
  prepareCancelPendingLines,
  selectedCancelPendingLines,
} from './purchase-order-cancel-pending';

const emit = defineEmits<{
  (event: 'completed'): void;
}>();

const visible = ref(false);
const order = ref<Record<string, any>>({});
const detail = ref<Record<string, any>>({});
const form = reactive<{ returnReason: string; details: Record<string, any>[] }>({
  returnReason: '',
  details: [],
});
const saving = ref(false);

function goodsCode(line: Record<string, any>) {
  return line.goodsCode || '—';
}
function goodsName(line: Record<string, any>) {
  return line.goodsName || '—';
}
function skuText(line: Record<string, any>) {
  return (
    line.skuLabel ??
    line.skuName ??
    line.skuSpec ??
    (line.skuId ? `规格 ${line.skuId}` : '—')
  );
}

async function open(row: Record<string, any>) {
  const orderId = row.id;
  if (!orderId) return;
  try {
    const data = (await api.get(`/purchase/orders/${orderId}`)) as Record<string, any>;
    const lines = prepareCancelPendingLines(data.details ?? []);
    if (!lines.length) {
      ElMessage.warning('该订单没有可退回的未到货数量');
      return;
    }
    order.value = row;
    detail.value = data;
    form.returnReason = '';
    form.details = lines;
    visible.value = true;
  } catch {
    // axios 拦截器已提示
  }
}

async function confirmCancel() {
  if (!form.details.length) return;
  const selected = selectedCancelPendingLines(form.details);
  const validationMessage = cancelPendingValidationMessage(selected);
  if (validationMessage) {
    ElMessage.warning(validationMessage);
    return;
  }
  saving.value = true;
  try {
    const result = (await api.post(`/purchase/orders/${detail.value.id}/cancel-pending`, {
      reason: form.returnReason || '采购订单未到货退回',
      details: cancelPendingPayload(selected),
    })) as Record<string, any>;
    ElMessage.success(result.message ?? '未到货数量已退回');
    visible.value = false;
    emit('completed');
  } catch (error: any) {
    ElMessage.error(error.response?.data?.message ?? '退回失败');
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<template>
  <el-dialog
    v-model="visible"
    class="purchase-document-dialog"
    title="新增采购订单"
    width="1040"
    top="4vh"
    :close-on-click-modal="false"
  >
    <div class="purchase-dialog-content">
      <div class="section-title section-title--master"><strong>基本信息</strong></div>
      <div class="master-grid purchase-master-grid">
        <el-form-item label="采购订单">
          <el-input :model-value="detail.orderNo" disabled />
        </el-form-item>
        <el-form-item label="供应商">
          <el-input :model-value="detail.vendorName ?? order.vendorName ?? '—'" disabled />
        </el-form-item>
        <el-form-item label="退回原因" class="span-2">
          <el-input v-model="form.returnReason" placeholder="请输入未到货退回原因" />
        </el-form-item>
      </div>
      <div class="section-title">
        <strong>未到货退回明细</strong>
        <span class="muted">待入库数量已锁定，不在可退范围内</span>
      </div>
      <el-table :data="form.details" border class="detail-table">
        <el-table-column label="商品编码" width="128">
          <template #default="scope">{{ goodsCode(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="商品名称" min-width="160">
          <template #default="scope">{{ goodsName(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="规格" min-width="136">
          <template #default="scope">{{ skuText(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="采购数量" width="104" align="right">
          <template #default="scope">{{ scope.row.quantity }}</template>
        </el-table-column>
        <el-table-column label="已锁定/入库" width="104" align="right">
          <template #default="scope">{{ scope.row.arrivedQuantity ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="已取消" width="104" align="right">
          <template #default="scope">{{ scope.row.canceledQuantity ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="可退未到货" width="104" align="right">
          <template #default="scope">{{ scope.row.remainingQuantity }}</template>
        </el-table-column>
        <el-table-column label="本次退回" width="120">
          <template #default="scope">
            <el-input-number
              v-model="scope.row.cancelQuantity"
              :min="0"
              :max="Number(scope.row.remainingQuantity)"
              :precision="0"
              :step="1"
              controls-position="right"
            />
          </template>
        </el-table-column>
      </el-table>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="confirmCancel">确认退回</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.purchase-dialog-content {
  container-name: purchase-dialog;
  container-type: inline-size;
  min-width: 0;
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 40px;
  margin: 16px 0 12px;
  padding: 0 12px;
  border: 1px solid #e4e8ef;
  border-radius: 4px;
  background: #f7f9fc;
  color: #344054;
  font-size: var(--hs-font-section);
  line-height: var(--hs-line-section);
}
.section-title--master {
  margin-top: 0;
}
.section-title strong {
  font-size: var(--hs-font-section);
  font-weight: 600;
}
.muted {
  color: #8791a5;
  font-size: var(--hs-font-helper);
  font-weight: 400;
}
.master-grid.purchase-master-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px 16px;
}
.purchase-master-grid :deep(.el-form-item) {
  margin-bottom: 0;
}
.purchase-master-grid :deep(.el-form-item__label) {
  height: auto;
  margin-bottom: 5px;
  padding: 0;
  color: #667085;
  font-size: var(--hs-font-label);
  line-height: var(--hs-line-label);
}
.purchase-master-grid :deep(.el-input__wrapper) {
  min-height: var(--hs-control-height);
  font-size: var(--hs-font-body);
}
.purchase-master-grid :deep(.is-disabled) {
  opacity: 1;
}
.purchase-master-grid :deep(.is-disabled .el-input__inner) {
  color: #344054;
  -webkit-text-fill-color: #344054;
}
.detail-table {
  width: 100%;
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
.detail-table :deep(th.el-table__cell) {
  height: var(--hs-detail-header-height);
  padding: 0;
  background: #f7f9fc;
  color: #667085;
  font-size: var(--hs-font-label);
  font-weight: 600;
}
.detail-table :deep(td.el-table__cell) {
  height: var(--hs-detail-row-height);
  padding: 4px 0;
  color: #344054;
  font-size: var(--hs-font-body);
}
.detail-table :deep(.cell) {
  line-height: var(--hs-line-body);
}
.detail-table :deep(.el-input-number) {
  width: 100%;
  margin: 0;
}
.detail-table :deep(.el-input-number .el-input__wrapper) {
  min-height: var(--hs-detail-control-height);
  padding-top: 0;
  padding-bottom: 0;
  font-size: var(--hs-font-body);
}
@container purchase-dialog (max-width: 919px) {
  .master-grid.purchase-master-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container purchase-dialog (max-width: 519px) {
  .master-grid.purchase-master-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .purchase-master-grid :deep(.span-2),
  .purchase-master-grid :deep(.span-all) {
    grid-column: 1 / -1;
  }
}
</style>
