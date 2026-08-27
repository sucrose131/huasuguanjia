<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import InventoryProductBatchLayout from './InventoryProductBatchLayout.vue';

type StockRow = Record<string, any>;

const auth = useAuthStore();
const visible = ref(false);
const loading = ref(false);
const source = ref<StockRow>({});
const batchRows = ref<StockRow[]>([]);

const quantity = (value: unknown) =>
  Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 });

const groups = computed(() =>
  source.value.goodsId
    ? [
        {
          key: `${source.value.goodsId}:${source.value.skuId}`,
          goodsId: source.value.goodsId,
          skuId: source.value.skuId,
          goodsCode: source.value.goodsCode,
          goodsName: source.value.goodsName,
          skuSpec: source.value.skuSpec,
          unitName: source.value.unitName,
          batches: batchRows.value,
        },
      ]
    : [],
);

const summary = computed(() => {
  const beforeQty = batchRows.value.reduce(
    (total, line) => total + Number(line.beforeQty ?? 0),
    0,
  );
  const afterQty = batchRows.value.reduce(
    (total, line) => total + Number(line.afterQty ?? 0),
    0,
  );
  return { beforeQty, afterQty, differentQty: afterQty - beforeQty };
});

function sameId(left: unknown, right: unknown) {
  return String(left ?? '') === String(right ?? '');
}

function updateLine(line: StockRow) {
  line.afterQty = Math.max(0, Number(line.afterQty ?? 0));
  line.differentQty = line.afterQty - Number(line.beforeQty ?? 0);
  line.adjustType = line.differentQty > 0 ? 1 : line.differentQty < 0 ? 2 : 0;
}

function direction(line: StockRow) {
  if (Number(line.differentQty) > 0) return { text: '增加', type: 'success' as const };
  if (Number(line.differentQty) < 0) return { text: '减少', type: 'danger' as const };
  return { text: '不变', type: 'info' as const };
}

async function open(row: StockRow) {
  source.value = { ...row };
  batchRows.value = [];
  visible.value = true;
  loading.value = true;
  try {
    const stocks = (await api.get('/inventory/stock-options', {
      params: { orgId: row.orgId, warehouseId: row.warehouseId },
    })) as StockRow[];
    batchRows.value = (stocks ?? [])
      .filter((item) => sameId(item.goodsId, row.goodsId) && sameId(item.skuId, row.skuId))
      .map((item): StockRow => ({
        ...item,
        beforeQty: Number(item.inventoryQty ?? 0),
        afterQty: Number(item.inventoryQty ?? 0),
        differentQty: 0,
        adjustType: 0,
        remark: '',
      }))
      .sort((left, right) =>
        String(left.batchNo ?? '').localeCompare(String(right.batchNo ?? ''), 'zh-CN', {
          numeric: true,
        }),
      );
  } catch {
    batchRows.value = [];
  } finally {
    loading.value = false;
  }
}

function previewSubmit() {
  ElMessage.info('当前仅完成界面与字段映射，提交、审核及库存变更逻辑待界面确认后接入');
}

defineExpose({ open });
</script>

<template>
  <el-dialog
    v-model="visible"
    title="库存调整"
    width="min(1200px, 94vw)"
    top="5vh"
    append-to-body
    destroy-on-close
    class="inventory-quick-adjust-dialog"
  >
    <div class="adjust-dialog-section">
      <div class="adjust-dialog-section__heading">
        <div>
          <strong>调整范围</strong>
          <span>商品由库存查询行锁定；批次数据来自当前组织、仓库及商品 SKU 的即时库存</span>
        </div>
        <el-tag type="info" effect="plain">界面确认阶段</el-tag>
      </div>
      <div class="adjust-master-grid">
        <div><span>所属组织</span><strong>{{ source.orgName || '—' }}</strong></div>
        <div><span>所在仓库</span><strong>{{ source.warehouseName || '—' }}</strong></div>
        <div><span>调整人</span><strong>{{ auth.user?.username || '—' }}</strong></div>
        <div><span>库存批次</span><strong>{{ batchRows.length }}</strong></div>
      </div>
    </div>

    <el-alert
      title="本阶段只验证界面、交互和数据库字段映射，不会生成调整单，也不会改变库存。"
      type="info"
      :closable="false"
      show-icon
      class="adjust-stage-alert"
    />

    <div class="form-section-title">单品批次调整明细</div>
    <div v-loading="loading">
      <InventoryProductBatchLayout
        :groups="groups"
        product-title="调整商品"
        product-empty-text="正在载入当前商品"
      >
        <template #batches="{ batches }">
          <el-table
            :data="batches"
            border
            table-layout="fixed"
            max-height="360"
            empty-text="当前商品没有可调整的库存批次"
            class="adjust-batch-table"
          >
            <el-table-column prop="batchNo" label="批号" width="130" show-overflow-tooltip>
              <template #default="scope">{{ scope.row.batchNo || '无批号' }}</template>
            </el-table-column>
            <el-table-column prop="beforeQty" label="当前库存" width="100" align="right">
              <template #default="scope">{{ quantity(scope.row.beforeQty) }}</template>
            </el-table-column>
            <el-table-column prop="afterQty" label="调整后库存" width="152" align="center">
              <template #default="scope">
                <el-input-number
                  v-model="scope.row.afterQty"
                  :min="0"
                  :precision="0"
                  :step="1"
                  controls-position="right"
                  @change="updateLine(scope.row)"
                />
              </template>
            </el-table-column>
            <el-table-column prop="differentQty" label="调整差异" width="100" align="right">
              <template #default="scope">
                <strong
                  :class="{
                    'difference-positive': Number(scope.row.differentQty) > 0,
                    'difference-negative': Number(scope.row.differentQty) < 0,
                  }"
                >
                  {{ Number(scope.row.differentQty) > 0 ? '+' : '' }}{{ quantity(scope.row.differentQty) }}
                </strong>
              </template>
            </el-table-column>
            <el-table-column label="调整方向" width="90" align="center">
              <template #default="scope">
                <el-tag :type="direction(scope.row).type" effect="light">
                  {{ direction(scope.row).text }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="unitName" label="单位" width="72" align="center">
              <template #default="scope">{{ scope.row.unitName || '—' }}</template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="150">
              <template #default="scope">
                <el-input v-model="scope.row.remark" placeholder="填写该批次调整说明" />
              </template>
            </el-table-column>
          </el-table>
        </template>
      </InventoryProductBatchLayout>
    </div>

    <div class="adjust-summary">
      <span>当前库存合计 <strong>{{ quantity(summary.beforeQty) }}</strong></span>
      <span>调整后合计 <strong>{{ quantity(summary.afterQty) }}</strong></span>
      <span>
        净调整
        <strong
          :class="{
            'difference-positive': summary.differentQty > 0,
            'difference-negative': summary.differentQty < 0,
          }"
        >
          {{ summary.differentQty > 0 ? '+' : '' }}{{ quantity(summary.differentQty) }}
        </strong>
      </span>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="previewSubmit">提交调整</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.adjust-dialog-section {
  margin-bottom: var(--hs-space-4);
  padding: var(--hs-space-4);
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface-muted);
}
.adjust-dialog-section__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--hs-space-4);
  margin-bottom: var(--hs-space-4);
}
.adjust-dialog-section__heading strong,
.adjust-dialog-section__heading span {
  display: block;
}
.adjust-dialog-section__heading strong {
  margin-bottom: var(--hs-space-1);
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-section);
}
.adjust-dialog-section__heading span {
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-helper);
}
.adjust-master-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--hs-space-3);
}
.adjust-master-grid > div {
  display: grid;
  gap: var(--hs-space-1);
}
.adjust-master-grid span {
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-helper);
}
.adjust-master-grid strong {
  overflow: hidden;
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-body);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adjust-stage-alert {
  margin-bottom: var(--hs-space-4);
}
.form-section-title {
  min-height: 40px;
  margin: 0 0 var(--hs-space-2);
  padding: 0 12px;
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface-muted);
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-section);
  line-height: 40px;
  font-weight: 600;
}
.difference-positive {
  color: var(--hs-color-success);
}
.difference-negative {
  color: var(--hs-color-danger);
}
.adjust-summary {
  display: flex;
  justify-content: flex-end;
  gap: var(--hs-space-6);
  margin-top: var(--hs-space-4);
  padding: 12px 14px;
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface-muted);
  color: var(--hs-color-text-secondary);
}
.adjust-summary strong {
  margin-left: var(--hs-space-1);
  color: var(--hs-color-text-primary);
  font-variant-numeric: tabular-nums;
}
:deep(.adjust-batch-table .el-table__header-wrapper th) {
  background: var(--hs-color-surface);
}
:deep(.adjust-batch-table .el-table__cell) {
  height: var(--hs-detail-row-height);
}
@media (max-width: 960px) {
  .adjust-master-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
