<script setup lang="ts">
import { computed } from 'vue';
import PurchaseOrderSectionHeader from './PurchaseOrderSectionHeader.vue';

const props = defineProps<{
  form: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
  applicantName: string;
  organizations: any[];
  oaOrganizations: any[];
  warehouses: any[];
  receivers: any[];
}>();

const emit = defineEmits<{
  (event: 'cost-organization-change'): void;
  (event: 'oa-organization-change'): void;
  (event: 'warehouse-change'): void;
}>();

const isView = computed(() => props.mode === 'view');
const oaOptions = computed(() => {
  const result = [...props.oaOrganizations];
  if (
    props.form.oaOrgId &&
    !result.some((item) => String(item.value) === String(props.form.oaOrgId))
  ) {
    result.push({
      value: props.form.oaOrgId,
      label: props.form.oaOrgName || String(props.form.oaOrgId),
      deptId: props.form.deptId,
      deptName: props.form.deptName || '',
    });
  }
  return result;
});
const receiverOptions = computed(() => {
  const result = [...props.receivers];
  if (
    props.form.receiverId &&
    !result.some((item) => String(item.value) === String(props.form.receiverId))
  ) {
    result.push({
      value: props.form.receiverId,
      label: props.form.receiverName || String(props.form.receiverId),
    });
  }
  return result;
});
</script>

<template>
  <section class="purchase-application-section">
    <PurchaseOrderSectionHeader
      title="基本信息"
      description="申请身份、费用归属与收货责任分别记录"
    />

    <div class="purchase-application-master-grid">
      <el-form-item label="申请人">
        <el-input :model-value="applicantName || '—'" disabled />
      </el-form-item>
      <el-form-item label="推送 OA 组织" required>
        <el-select
          v-model="form.oaOrgId"
          filterable
          :disabled="isView"
          placeholder="选择本次审批发起组织"
          @change="emit('oa-organization-change')"
        >
          <el-option
            v-for="item in oaOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <div v-if="!isView" class="field-hint">仅展示申请人在 OA 中的有效组织身份</div>
      </el-form-item>
      <el-form-item label="申请部门">
        <el-input :model-value="form.deptName || '—'" disabled />
      </el-form-item>

      <el-form-item label="成本承担组织" required>
        <el-select
          v-model="form.orgId"
          filterable
          :disabled="isView || organizations.length <= 1"
          placeholder="选择承担本次采购成本的组织"
          @change="emit('cost-organization-change')"
        >
          <el-option
            v-for="item in organizations"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="目标仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || !form.orgId"
          placeholder="选择成本承担组织下的仓库"
          @change="emit('warehouse-change')"
        >
          <el-option
            v-for="item in warehouses"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="收货人" required>
        <el-select
          v-model="form.receiverId"
          filterable
          :disabled="isView || !form.orgId"
          placeholder="选择成本承担组织下的收货人"
        >
          <el-option
            v-for="item in receiverOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="申请原因" required class="span-all">
        <el-input v-model="form.reason" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>
  </section>
</template>

<style scoped>
.purchase-application-section {
  display: grid;
  gap: var(--hs-space-3);
}
.purchase-application-master-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--hs-space-3) var(--hs-space-4);
}
.purchase-application-master-grid :deep(.el-form-item) {
  margin-bottom: 0;
}
.purchase-application-master-grid :deep(.el-select) {
  width: 100%;
}
.purchase-application-master-grid :deep(.is-disabled) {
  opacity: 1;
}
.purchase-application-master-grid :deep(.is-disabled .el-input__inner),
.purchase-application-master-grid :deep(.is-disabled .el-select__selected-item) {
  color: var(--hs-color-text-primary);
  -webkit-text-fill-color: var(--hs-color-text-primary);
}
.span-all {
  grid-column: 1 / -1;
}
.field-hint {
  margin-top: var(--hs-space-1);
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-helper);
}
@media (max-width: 960px) {
  .purchase-application-master-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
