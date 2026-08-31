<script setup lang="ts">
import { computed } from 'vue';
import { moneyText } from '@/utils/format';
import RemoteSelect from '@/components/RemoteSelect.vue';
import PurchaseOrderSectionHeader from './PurchaseOrderSectionHeader.vue';

const props = defineProps<{
  form: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
  canViewAmount: boolean;
  canEditAmount: boolean;
  orderQuantity: number;
  orderTotal: number;
  units: any[];
  searchGoodsOptions: (keyword: string) => Promise<any[]>;
  lineUnitPrice: (line: any) => number;
}>();

const emit = defineEmits<{
  (event: 'add'): void;
  (event: 'remove', index: number): void;
  (event: 'goods-change', line: any): void;
  (event: 'quick-catalog', line: any, mode: 'goods' | 'sku'): void;
}>();

const isView = computed(() => props.mode === 'view');
const canEditLines = computed(() => !isView.value && !props.form.applicationId);

function unitName(line: any) {
  const unit = props.units.find(
    (item: any) => String(item.value ?? item.id) === String(line.unitType),
  );
  return unit?.label ?? unit?.name ?? '—';
}

function protectedMoney(value: unknown) {
  return props.canViewAmount ? `¥ ${moneyText(value)}` : '****';
}
</script>

<template>
  <section class="purchase-order-section">
    <PurchaseOrderSectionHeader title="订单明细" :meta="`共 ${form.details?.length ?? 0} 项`" />

    <el-table :data="form.details ?? []" border class="purchase-order-detail-table">
      <el-table-column label="商品编码" width="128" show-overflow-tooltip>
        <template #default="scope">
          <span class="readonly-cell">{{ scope.row.goodsCode || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="商品名称" min-width="170">
        <template #default="scope">
          <div v-if="canEditLines" class="quick-catalog-cell">
            <RemoteSelect
              v-model="scope.row.goodsId"
              :fetch="searchGoodsOptions"
              :current-label="scope.row.goodsName || scope.row.goodsId"
              :disabled="!form.orgId"
              placeholder="输入商品名称或编码搜索"
              @change="emit('goods-change', scope.row)"
            />
            <el-button
              link
              type="primary"
              @click="emit('quick-catalog', scope.row, 'goods')"
            >
              快捷新增商品
            </el-button>
            <el-tag v-if="scope.row.newGoods" type="warning" size="small">待创建</el-tag>
          </div>
          <span v-else class="readonly-cell">
            {{ scope.row.goodsName || scope.row.goodsCode || scope.row.goodsId || '—' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="分类" min-width="112" show-overflow-tooltip>
        <template #default="scope">
          <span class="readonly-cell">{{ scope.row.categoryName || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="136">
        <template #default="scope">
          <div class="sku-cell">
            <span class="readonly-cell">{{ scope.row.skuSpec || scope.row.skuId || '—' }}</span>
            <el-button
              v-if="canEditLines && scope.row.goodsId && !scope.row.newGoods"
              link
              type="primary"
              @click="emit('quick-catalog', scope.row, 'sku')"
            >
              补充 SKU
            </el-button>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="单位" width="72" align="center">
        <template #default="scope">{{ unitName(scope.row) }}</template>
      </el-table-column>
      <el-table-column label="采购数量" width="112" align="right">
        <template #default="scope">
          <el-input-number
            v-if="canEditLines"
            v-model="scope.row.quantity"
            :min="1"
            :precision="0"
            :step="1"
            controls-position="right"
          />
          <span v-else class="readonly-cell number-cell">{{ scope.row.quantity }}</span>
        </template>
      </el-table-column>
      <el-table-column label="明细总价" width="132" align="right">
        <template #default="scope">
          <el-input-number
            v-if="canEditLines && canEditAmount"
            v-model="scope.row.totalAmount"
            :min="0"
            :precision="2"
            :step="1"
            controls-position="right"
          />
          <span v-else class="readonly-cell number-cell">
            {{ protectedMoney(scope.row.totalAmount) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="反算单价" width="120" align="right">
        <template #default="scope">
          <span class="readonly-cell number-cell">{{ protectedMoney(lineUnitPrice(scope.row)) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="140" show-overflow-tooltip>
        <template #default="scope">
          <el-input v-if="canEditLines" v-model="scope.row.remark" />
          <span v-else class="readonly-cell">{{ scope.row.remark || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column
        v-if="canEditLines"
        label="操作"
        width="72"
        fixed="right"
        align="center"
      >
        <template #default="scope">
          <el-button
            link
            type="danger"
            :disabled="form.details.length === 1"
            @click="emit('remove', scope.$index)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-button v-if="canEditLines" class="add-line" @click="emit('add')">添加明细行</el-button>

    <div class="purchase-order-total">
      合计：{{ orderQuantity }} 件　订单金额 {{ protectedMoney(orderTotal) }}
    </div>
  </section>
</template>

<style scoped>
.purchase-order-section {
  margin-top: var(--hs-space-5);
}
.purchase-order-detail-table {
  width: 100%;
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
:deep(.purchase-order-detail-table th.el-table__cell) {
  height: var(--hs-detail-header-height);
  padding: 0;
  background: var(--hs-color-surface-muted);
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-label);
  font-weight: 600;
}
:deep(.purchase-order-detail-table td.el-table__cell) {
  height: var(--hs-detail-row-height);
  padding: var(--hs-space-1) 0;
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-body);
}
:deep(.purchase-order-detail-table .el-select),
:deep(.purchase-order-detail-table .el-input-number) {
  width: 100%;
}
.readonly-cell {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.number-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.quick-catalog-cell,
.sku-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
}
.quick-catalog-cell :deep(.el-select) {
  width: 100%;
}
.add-line {
  height: var(--hs-control-height);
  margin-top: var(--hs-space-2);
  font-size: var(--hs-font-body);
}
.purchase-order-total {
  padding: var(--hs-space-3) var(--hs-space-1) 0;
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-body);
  font-weight: 600;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
</style>
