<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '@/api';
import { dateText } from '@/utils/format';
import BatchMaterialTable from './BatchMaterialTable.vue';
import DocumentAttachments from '@/components/DocumentAttachments.vue';

type B = Record<string, any>;

const props = defineProps<{ modelValue: boolean; outRow: B }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const loading = ref(false);
const error = ref('');
const detail = ref<B>({});
const rows = ref<B[]>([]);
const stocks = ref<B[]>([]);
const tableMode = computed<'execute' | 'lab'>(() =>
  Number(detail.value.outType ?? props.outRow.outType) === 1 ? 'execute' : 'lab',
);

function stockQuantity(goodsId: unknown, skuId: unknown) {
  return stocks.value
    .filter(
      (stock) => String(stock.goodsId) === String(goodsId) && String(stock.skuId) === String(skuId),
    )
    .reduce((sum, stock) => sum + Number(stock.inventoryQty ?? 0), 0);
}

function groupLines(lines: B[]) {
  const grouped = new Map<string, B>();
  for (const line of lines) {
    const groupKey = `${line.goodsId ?? ''}:${line.skuId ?? ''}`;
    const existing = grouped.get(groupKey);
    const batchRow = {
      batchNo: line.batchNo ?? '',
      qty: Number(line.quantity ?? line.planOutQty ?? 0),
      avail: Number(line.inventoryQty ?? 0),
    };
    if (existing) {
      existing.batchRows.push(batchRow);
      continue;
    }
    grouped.set(groupKey, {
      ...line,
      goodsCode: line.goodsCode ?? line.queryCode ?? '—',
      goodsName: line.goodsName ?? '—',
      skuSpec: line.skuSpec ?? line.goodsSpec ?? line.specModels ?? '—',
      unitName: line.unitName ?? line.unitTypeName ?? line.unitType ?? '—',
      bomUnitQty: line.bomUnitQty ?? '—',
      totalDemand: line.standardQty ?? line.totalDemand ?? line.planOutQty ?? line.quantity ?? 0,
      stockQty: line.currentStock ?? stockQuantity(line.goodsId, line.skuId),
      planQty: line.planOutQty ?? line.quantity ?? 0,
      batchRows: [batchRow],
    });
  }
  return [...grouped.values()];
}

async function load() {
  if (!props.outRow?.id) return;
  loading.value = true;
  error.value = '';
  try {
    const [document, stockData] = (await Promise.all([
      api.get(`/production/outputs/${props.outRow.id}`),
      api.get('/inventory/stocks', {
        params: { warehouseId: props.outRow.warehouseId, pageSize: 200 },
      }),
    ])) as any[];
    detail.value = document;
    stocks.value = stockData.items ?? stockData ?? [];
    rows.value = groupLines(document.details ?? []);
  } catch (reason: any) {
    error.value = reason.response?.data?.message ?? '生产出库明细加载失败';
  } finally {
    loading.value = false;
  }
}

watch(visible, (value) => {
  if (value) load();
});
</script>

<template>
  <el-dialog
    v-model="visible"
    title="查看生产出库单"
    width="min(1280px, calc(100vw - 32px))"
    top="3vh"
    :close-on-click-modal="false"
  >
    <div v-if="loading" class="vod-loading">加载中…</div>
    <template v-else>
      <div class="vod-master">
        <div>
          <span>出库单号</span><strong>{{ detail.outNo ?? outRow.outNo ?? '—' }}</strong>
        </div>
        <div>
          <span>出库类型</span
          ><strong>{{ detail.outTypeName ?? outRow.outTypeName ?? '—' }}</strong>
        </div>
        <div>
          <span>关联生产计划</span><strong>{{ detail.planNo ?? outRow.planNo ?? '—' }}</strong>
        </div>
        <div>
          <span>BOM编号</span><strong>{{ detail.bomNo ?? outRow.bomNo ?? '—' }}</strong>
        </div>
        <div>
          <span>生产成品</span><strong>{{ detail.goodsName ?? outRow.goodsName ?? '—' }}</strong>
        </div>
        <div>
          <span>仓库</span
          ><strong>{{ detail.warehouseName ?? outRow.warehouseName ?? '—' }}</strong>
        </div>
        <div>
          <span>出库日期</span><strong>{{ dateText(detail.outDate ?? outRow.outDate) }}</strong>
        </div>
        <div>
          <span>状态</span><strong>{{ detail.statusName ?? outRow.statusName ?? '—' }}</strong>
        </div>
        <div>
          <span>备注</span><strong>{{ detail.remark ?? outRow.remark ?? '—' }}</strong>
        </div>
      </div>
      <div class="vod-title">明细信息</div>
      <div v-if="error" class="vod-error">{{ error }}</div>
      <BatchMaterialTable
        v-else
        :rows="rows"
        :stocks="stocks"
        :editable="false"
        :mode="tableMode"
      />
      <DocumentAttachments
        v-if="detail.id || outRow.id"
        document-type="production_material_output"
        :document-id="detail.id || outRow.id"
      />
    </template>
    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.vod-loading {
  padding: 40px;
  text-align: center;
}
.vod-master {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 24px;
}
.vod-master > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
}
.vod-master span {
  margin-bottom: 2px;
  color: #7b8798;
  font-size: 11px;
}
.vod-master strong {
  overflow: hidden;
  color: #1f2a44;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vod-title {
  margin: 16px 0 8px;
  color: #27334a;
  font-size: 13px;
  font-weight: 700;
}
.vod-error {
  padding: 10px 14px;
  border-radius: 4px;
  background: #fef0f0;
  color: #e53e3e;
  font-size: 12px;
}
@media (max-width: 900px) {
  .vod-master {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
