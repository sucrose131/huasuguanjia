<script setup lang="ts">
import { computed } from 'vue';
import PurchaseOrderSectionHeader from './PurchaseOrderSectionHeader.vue';

const props = defineProps<{
  form: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
  options: Record<string, any[]>;
  dicts: Record<string, any[]>;
  organizationTree: any[];
  warehouseOptions: any[];
  documentWarehouseType: number;
}>();

const emit = defineEmits<{
  (event: 'organization-change'): void;
  (event: 'warehouse-change'): void;
  (event: 'department-change'): void;
}>();

const isView = computed(() => props.mode === 'view');
</script>

<template>
  <section class="purchase-order-section">
    <PurchaseOrderSectionHeader title="基本信息" />

    <div class="purchase-order-master-grid">
      <el-form-item label="来源采购申请">
        <el-input
          :model-value="form.applicationNo || (form.applicationId ? form.applicationId : '直接采购')"
          disabled
        />
      </el-form-item>
      <el-form-item label="供应商" required>
        <el-select v-model="form.vendorId" filterable clearable :disabled="isView">
          <el-option
            v-for="item in options.vendors"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="所属组织" required>
        <el-tree-select
          v-model="form.orgId"
          :data="organizationTree"
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          :disabled="isView || Boolean(form.applicationId)"
          @change="emit('organization-change')"
        />
      </el-form-item>
      <el-form-item label="目标仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || !form.orgId"
          @change="emit('warehouse-change')"
        >
          <el-option
            v-for="item in warehouseOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <div
          v-if="documentWarehouseType && form.details?.some((line: any) => line.goodsId)"
          class="purchase-order-warehouse-hint"
        >
          已按明细商品类型匹配仓库
        </div>
      </el-form-item>
      <el-form-item label="接收部门" required>
        <el-select
          v-model="form.deptId"
          filterable
          :disabled="isView || !form.orgId"
          @change="emit('department-change')"
        >
          <el-option
            v-for="item in options.depts"
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
          clearable
          :disabled="isView || !form.orgId || !form.deptId"
          placeholder="请选择接收部门下的收货人"
        >
          <el-option
            v-for="item in options.receivers"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="到货方式">
        <el-select v-model="form.arrivalType" :disabled="isView">
          <el-option
            v-for="item in dicts.purchase_arrival_type || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="计划到货日期" required>
        <el-date-picker
          v-model="form.planArrivalDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="运输方式">
        <el-select v-model="form.deliveryType" :disabled="isView">
          <el-option
            v-for="item in dicts.purchase_delivery_type || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="物流单号">
        <el-input v-model="form.deliveryNo" :disabled="isView" />
      </el-form-item>
      <el-form-item label="结算方式">
        <el-select v-model="form.paymentType" :disabled="isView">
          <el-option
            v-for="item in dicts.purchase_settlement_type || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="计划付款日期">
        <el-date-picker
          v-model="form.planPayDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="备注" class="span-all">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>
  </section>
</template>

<style scoped>
.purchase-order-master-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--hs-space-3) var(--hs-space-4);
}
.purchase-order-master-grid :deep(.el-form-item) {
  margin-bottom: 0;
}
.purchase-order-master-grid :deep(.el-form-item__label) {
  height: auto;
  margin-bottom: var(--hs-space-1);
  padding: 0;
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-label);
  line-height: var(--hs-line-label);
}
.purchase-order-master-grid :deep(.el-select),
.purchase-order-master-grid :deep(.el-date-editor),
.purchase-order-master-grid :deep(.el-tree-select) {
  width: 100%;
}
.purchase-order-master-grid :deep(.is-disabled) {
  opacity: 1;
}
.purchase-order-master-grid :deep(.is-disabled .el-input__inner),
.purchase-order-master-grid :deep(.is-disabled .el-select__selected-item) {
  color: var(--hs-color-text-primary);
  -webkit-text-fill-color: var(--hs-color-text-primary);
}
.span-all {
  grid-column: 1 / -1;
}
.purchase-order-warehouse-hint {
  margin-top: var(--hs-space-1);
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-helper);
}
@media (max-width: 960px) {
  .purchase-order-master-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
