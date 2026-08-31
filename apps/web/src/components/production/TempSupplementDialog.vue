<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { dateText } from '@/utils/format';
import BatchMaterialTable from './BatchMaterialTable.vue';

type B = Record<string, any>;

const props = defineProps<{ modelValue: boolean; outDoc: B }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'done'): void }>();

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const rows = ref<B[]>([]);
const allStocks = ref<B[]>([]);
const remark = ref('临时补料');

const visible = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) });

function stockFor(row: B) {
  return (allStocks.value as B[]).filter(
    (s: B) => String(s.goodsId) === String(row.goodsId) && String(s.skuId) === String(row.skuId),
  );
}
function availFor(row: B, batchNo: string) {
  const s = (allStocks.value as B[]).find(
    (x: B) =>
      x.batchNo === batchNo &&
      String(x.goodsId) === String(row.goodsId) &&
      String(x.skuId) === String(row.skuId),
  );
  return s ? Number(s.inventoryQty) : 0;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const doc = props.outDoc;
    const [plan, stockData, outDetail] = (await Promise.all([
      api.get(`/production/plans/${doc.planId}`),
      api.get('/inventory/stocks', {
        params: {
          orgId: doc.orgId,
          warehouseId: doc.warehouseId,
          inStockOnly: true,
          pageSize: 200,
        },
      }),
      api.get(`/production/outputs/${doc.id}`),
    ])) as any[];
    allStocks.value = stockData.items ?? [];
    const supps = outDetail.supplements ?? [];
    const suppMap = new Map<string, number>();
    for (const s of supps) {
      for (const d of s.details ?? []) {
        const k = `${d.goodsId}-${d.skuId}`;
        suppMap.set(k, (suppMap.get(k) ?? 0) + Number(d.quantity));
      }
    }
    rows.value = (plan.details ?? []).map((item: B) => {
      const planQty = Number(item.planOutQty ?? item.quantity ?? 0);
      const alreadySupplied = suppMap.get(`${item.goodsId}-${item.skuId}`) ?? 0;
      const stockQty = item.currentStock ?? 0;
      // Init one batch row
      const batchRows: B[] = [{ batchNo: '', avail: 0, qty: 0 }];
      return {
        ...item,
        planQty,
        alreadySupplied,
        stockQty,
        batchRows,
        goodsName: item.goodsName ?? '',
        goodsCode: item.goodsCode ?? '',
        skuSpec: item.skuSpec ?? '',
        unitName: item.unitName ?? '—',
      };
    });
  } catch (e: any) {
    error.value = e.response?.data?.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

function batchChanged(row: B, br: B) {
  br.avail = availFor(row, br.batchNo);
  br.qty = 0;
}
function addBatchRow(row: B) {
  row.batchRows.push({ batchNo: '', avail: 0, qty: 0 });
}
function removeBatchRow(row: B, idx: number) {
  if (row.batchRows.length <= 1) return;
  row.batchRows.splice(idx, 1);
}

const allBatchRows = computed(() => {
  const result: B[] = [];
  for (const row of rows.value) {
    for (let i = 0; i < (row.batchRows as B[]).length; i++) {
      result.push({
        ...row,
        _bi: i,
        _br: (row.batchRows as B[])[i],
        _len: (row.batchRows as B[]).length,
      });
    }
  }
  return result;
});

const isFirstBatchRow = (r: B) => r._bi === 0;
const isLastBatchRow = (r: B) => r._bi === (r._len as number) - 1;

const validationError = computed(() => {
  const hasQty = rows.value.some((r) => (r.batchRows as B[]).some((g: B) => Number(g.qty) > 0));
  if (!hasQty) return '请至少为一种原料填写补料数量';
  for (const row of rows.value) {
    for (const br of row.batchRows as B[]) {
      if (Number(br.qty) > 0 && !String(br.batchNo ?? '').trim())
        return `${row.goodsName}：请选择补料批号`;
      if (Number(br.qty) > Number(br.avail))
        return `${row.goodsName} 批号「${br.batchNo}」合计 ${Number(br.qty).toFixed(4)} 超过可用 ${br.avail}`;
    }
  }
  return '';
});

async function submit() {
  if (validationError.value) {
    error.value = validationError.value;
    return;
  }
  saving.value = true;
  error.value = '';
  let createdId: string | number | undefined;
  try {
    const lines: B[] = [];
    for (const row of rows.value) {
      for (const br of row.batchRows as B[]) {
        if (Number(br.qty) <= 0) continue;
        lines.push({
          goodsId: row.goodsId,
          skuId: row.skuId,
          batchNo: br.batchNo,
          unitType: row.unitType,
          quantity: Number(br.qty),
        });
      }
    }
    const result: any = await api.post('/production/outputs', {
      planId: props.outDoc.planId,
      outType: 2,
      outDate: new Date().toISOString().slice(0, 10),
      remark: remark.value,
      orgId: props.outDoc.orgId,
      warehouseId: props.outDoc.warehouseId,
      receiverId: '',
      details: lines,
    });
    createdId = result.id;
    await api.post(`/production/outputs/${result.id}/confirm`, {
      comment: remark.value,
      details: lines,
    });
    ElMessage.success('临时补料已确认出库');
    visible.value = false;
    emit('done');
  } catch (e: any) {
    if (createdId !== undefined) {
      try {
        await api.delete(`/production/outputs/${createdId}`);
      } catch {
        /* 保留原始确认错误 */
      }
    }
    error.value = e.response?.data?.message ?? '保存失败';
  } finally {
    saving.value = false;
  }
}

watch(visible, (v) => {
  if (v) load();
});
</script>

<template>
  <el-dialog
    v-model="visible"
    title="临时补料"
    width="min(1280px, calc(100vw - 32px))"
    top="3vh"
    :close-on-click-modal="false"
  >
    <div v-if="loading" style="text-align: center; padding: 40px">加载中…</div>
    <template v-else>
      <!-- Header fields: 2x2 grid -->
      <div class="ts-header-grid">
        <div class="ts-field">
          <span class="ts-fld-label">关联生产计划</span
          ><span class="ts-fld-val">{{ outDoc.planNo ?? '—' }}</span>
        </div>
        <div class="ts-field">
          <span class="ts-fld-label">绑定BOM编号</span
          ><span class="ts-fld-val">{{ outDoc.bomNo ?? '—' }}</span>
        </div>
        <div class="ts-field">
          <span class="ts-fld-label">生产成品</span
          ><span class="ts-fld-val">{{ outDoc.goodsName ?? '—' }}</span>
        </div>
        <div class="ts-field">
          <span class="ts-fld-label">仓库</span
          ><span class="ts-fld-val">{{ outDoc.warehouseName ?? outDoc.warehouseId }}</span>
        </div>
      </div>
      <div class="ts-batch-field">
        <span class="ts-fld-label">补料说明</span>
        <el-input v-model="remark" style="width: 100%" />
      </div>

      <!-- Section title -->
      <div class="ts-sec-title">
        BOM 原料明细 · 填写数量即纳入本次补料；右侧「增加批号」添加子行
      </div>
      <div v-if="error" class="ts-error">{{ error }}</div>
      <BatchMaterialTable :rows="rows" :stocks="allStocks" :editable="true" mode="supplement" />
    </template>
    <template #footer>
      <el-button @click="visible = false" :disabled="saving">关闭</el-button>
      <el-button
        type="primary"
        :loading="saving"
        :disabled="!!validationError || !rows.length"
        @click="submit"
        >确认补料出库</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.ts-header-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 20px;
  margin-bottom: 8px;
}
.ts-field {
  display: flex;
  flex-direction: column;
}
.ts-fld-label {
  font-size: 11px;
  color: #7b8798;
  margin-bottom: 2px;
}
.ts-fld-val {
  font-weight: 600;
  color: #1f2a44;
  font-size: 14px;
}
.ts-batch-field {
  margin-bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ts-sec-title {
  margin: 14px 0 8px;
  font-weight: 700;
  color: #27334a;
  font-size: 14px;
}
.ts-error {
  background: #fef0f0;
  color: #e53e3e;
  padding: 10px 14px;
  border-radius: 4px;
  margin-bottom: 10px;
  font-size: 13px;
}
.ts-table-wrap {
  border: 1px solid #e5e9f0;
  border-radius: 4px;
  overflow: hidden;
}
.ts-thead {
  display: flex;
  background: #f7f9fc;
  border-bottom: 1px solid #e5e9f0;
}
.ts-th {
  padding: 10px 8px;
  font-size: 12px;
  font-weight: 700;
  color: #5f6b7c;
  border-right: 1px solid #e5e9f0;
}
.ts-th:last-child {
  border-right: none;
}
.ts-row {
  display: flex;
  border-bottom: 1px solid #f0f2f5;
}
.ts-row-last {
  border-bottom: 1px solid #e5e9f0;
}
.ts-row:last-child {
  border-bottom: none;
}
.ts-cell {
  padding: 8px;
  font-size: 13px;
  color: #1f2a44;
  display: flex;
  align-items: center;
  border-right: 1px solid #f0f2f5;
}
.ts-cell:last-child {
  border-right: none;
}
.ts-cell.muted {
  color: #8a94a6;
}
.ts-subrow {
  background: #fafcfd;
}
.ts-actions {
  gap: 6px;
  white-space: nowrap;
}
.ts-batch-sel {
  width: 100%;
}
</style>
