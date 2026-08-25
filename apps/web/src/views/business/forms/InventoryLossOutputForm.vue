<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue';
import { api } from '@/api';
import { dateText, moneyText } from '@/utils/format';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'cancel'): void }>();

const form = computed(() => props.modelValue);
const options = reactive<Record<string, any>>({
  orgs: [],
  warehouses: [],
  departments: [],
});
const dicts = reactive<Record<string, any[]>>({ lossOutputType: [] });

const quantity = (value: unknown) =>
  Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const organizationTree = computed(() =>
  buildOrganizationTree(options.orgs as OrganizationTreeNode[]),
);

const orgName = computed(() => form.value.orgName ?? '—');
const warehouseName = computed(() => form.value.warehouseName ?? '—');
const deptName = computed(() => form.value.deptName ?? '—');
const documentTypeName = computed(
  () =>
    form.value.documentTypeName ??
    (dicts.lossOutputType ?? []).find(
      (x) => String(x.value) === String(form.value.documentType),
    )?.label ??
    '—',
);
const sourceLabel = computed(
  () =>
    form.value.sourceCheckNo ??
    (form.value.sourceLossNo ? `历史来源：${form.value.sourceLossNo}` : '—'),
);

const totalQuantity = computed(() =>
  (form.value.details ?? []).reduce(
    (sum: number, line: any) => sum + Number(line.quantity ?? 0),
    0,
  ),
);
const totalAmount = computed(() =>
  (form.value.details ?? []).reduce(
    (sum: number, line: any) => sum + Number(line.amount ?? 0),
    0,
  ),
);

onMounted(async () => {
  const [orgs, warehouses, departments, lossOutputType] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/warehouses/options').catch(() => []),
    api.get('/base-data/departments/options').catch(() => []),
    api.get('/dictionaries/inventory_loss_output_type').catch(() => []),
  ]);
  options.orgs = orgs;
  options.warehouses = warehouses;
  options.departments = departments;
  dicts.lossOutputType = lossOutputType as any[];
  if (form.value.id) {
    const detail: any = await api
      .get(`/inventory/loss-outputs/${form.value.id}`)
      .catch(() => null);
    if (detail) Object.assign(form.value, detail);
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="true">
    <div class="master-grid">
      <el-form-item label="来源盘点单" class="span-2">
        <el-input :model-value="sourceLabel" disabled />
      </el-form-item>
      <el-form-item label="组织">
        <el-tree-select
          :model-value="form.orgId"
          :data="organizationTree"
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          disabled
        />
      </el-form-item>
      <el-form-item label="仓库">
        <el-select :model-value="form.warehouseId" disabled>
          <el-option
            v-for="item in options.warehouses"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="部门">
        <el-select :model-value="form.deptId" disabled>
          <el-option
            v-for="item in options.departments"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="报亏类型">
        <el-input :model-value="documentTypeName" disabled />
      </el-form-item>
      <el-form-item label="日期">
        <el-input :model-value="dateText(form.date)" disabled />
      </el-form-item>
      <el-form-item label="经办人">
        <el-input :model-value="form.operatorName || '—'" disabled />
      </el-form-item>
      <el-form-item label="原因" class="span-2">
        <el-input :model-value="form.reason || '—'" disabled />
      </el-form-item>
      <el-form-item label="备注" class="span-all">
        <el-input :model-value="form.remark || '—'" disabled />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">报亏明细</span>
      <span class="muted">共 {{ form.details?.length ?? 0 }} 项</span>
    </div>
    <el-table :data="form.details ?? []" border size="small" table-layout="fixed">
      <el-table-column prop="goodsCode" label="商品编码" width="115" />
      <el-table-column prop="goodsName" label="商品名称" min-width="130" />
      <el-table-column prop="skuSpec" label="SKU/规格" min-width="110" />
      <el-table-column prop="unitName" label="单位" width="70" />
      <el-table-column label="当前库存" width="95" align="right">
        <template #default="s">{{ quantity(s.row.inventoryQty) }}</template>
      </el-table-column>
      <el-table-column label="报亏数量" width="145">
        <template #default="s">{{ quantity(s.row.quantity) }}</template>
      </el-table-column>
      <el-table-column label="单价" width="130">
        <template #default="s">¥ {{ moneyText(s.row.unitPrice) }}</template>
      </el-table-column>
      <el-table-column label="金额" width="100" align="right">
        <template #default="s">¥ {{ moneyText(s.row.amount) }}</template>
      </el-table-column>
      <el-table-column prop="batchNo" label="批号" min-width="120" />
    </el-table>
    <div v-if="(form.details ?? []).length" class="modal-totals">
      <span>合计数量 <strong>{{ quantity(totalQuantity) }}</strong></span>
      <span>合计金额 <strong>¥ {{ moneyText(totalAmount) }}</strong></span>
    </div>

    <div class="form-actions">
      <el-button @click="emit('cancel')">关闭</el-button>
    </div>
  </el-form>
</template>

<style scoped>
.master-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px 16px;
}
.span-2 {
  grid-column: span 2;
}
.span-all {
  grid-column: 1 / -1;
}
.master-grid :deep(.el-form-item) {
  margin-bottom: 0;
}
.details-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0 8px;
}
.details-title {
  font-weight: 600;
}
.muted {
  color: #8791a5;
  font-size: 12px;
}
.modal-totals {
  display: flex;
  justify-content: flex-end;
  gap: 24px;
  padding: 10px 4px 0;
  font-size: 13px;
}
.modal-totals strong {
  color: #172033;
  font-weight: 600;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
