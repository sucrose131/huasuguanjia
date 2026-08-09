<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { dateText, moneyText } from '@/utils/format';
import BatchMaterialTable from './BatchMaterialTable.vue';
import DocumentAttachments from '@/components/DocumentAttachments.vue';

type B = Record<string, any>;

const props = defineProps<{ modelValue: boolean; outDoc: B }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'done'): void }>();

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const rows = ref<B[]>([]);
const allStocks = ref<B[]>([]);

const visible = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) });

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const doc = props.outDoc;
    const [plan, stockData] = (await Promise.all([
      api.get(`/production/plans/${doc.planId}`),
      api.get('/inventory/stocks', { params: { warehouseId: doc.warehouseId, pageSize: 200 } }),
    ])) as any[];
    allStocks.value = stockData.items ?? [];
    rows.value = (plan.details ?? []).map((item: B) => {
      const planQty = Number(item.planOutQty ?? item.quantity ?? 0);
      const stockQty = item.currentStock ?? 0;
      const batchRows: B[] = [{ batchNo: '', avail: 0, qty: 0 }];
      return {
        ...item,
        planQty,
        stockQty,
        batchRows,
        goodsName: item.goodsName ?? '',
        goodsCode: item.goodsCode ?? '',
        skuSpec: item.skuSpec ?? '',
        unitName: item.unitName ?? '—',
        bomUnitQty: item.bomUnitQty ?? '',
        totalDemand: item.standardQty ?? item.planQty,
      };
    });
  } catch (e: any) {
    error.value = e.response?.data?.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

const validationError = computed(() => {
  for (const row of rows.value) {
    let sum = 0;
    for (const g of row.batchRows as B[]) sum += Number(g.qty);
    if (sum === 0) return `${row.goodsName}：请填写出库数量`;
    if (sum > Number(row.planQty) + 0.001)
      return `${row.goodsName}：各批号合计 ${sum.toFixed(4)}，不能超过计划出库量 ${row.planQty}`;
    if (sum < Number(row.planQty) - 0.001)
      return `${row.goodsName}：这是整单出库，各批号合计 ${sum.toFixed(4)}，须等于计划出库量 ${row.planQty}`;
    for (const g of row.batchRows as B[]) {
      if (Number(g.qty) > Number(g.avail))
        return `${row.goodsName} 批号「${g.batchNo}」合计 ${Number(g.qty).toFixed(4)} 超过可用 ${g.avail}`;
    }
  }
  return '';
});

const hasAllocatedQuantity = computed(() =>
  rows.value.some((row) => (row.batchRows ?? []).some((batch: B) => Number(batch.qty ?? 0) > 0)),
);
const displayedError = computed(
  () => error.value || (hasAllocatedQuantity.value ? validationError.value : ''),
);

async function submit() {
  if (validationError.value) {
    error.value = validationError.value;
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const lines: B[] = [];
    for (const row of rows.value) {
      for (const g of row.batchRows as B[]) {
        if (Number(g.qty) <= 0) continue;
        lines.push({
          goodsId: row.goodsId,
          skuId: row.skuId,
          batchNo: g.batchNo,
          unitType: row.unitType,
          quantity: Number(g.qty),
        });
      }
    }
    await api.post(`/production/outputs/${props.outDoc.id}/confirm`, {
      comment: '生产BOM执行出库',
      details: lines,
    });
    ElMessage.success('出库执行成功');
    visible.value = false;
    emit('done');
  } catch (e: any) {
    error.value = e.response?.data?.message ?? '执行失败';
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
    title="执行出库 · BOM整单出库"
    width="min(1280px, calc(100vw - 32px))"
    top="3vh"
    :close-on-click-modal="false"
  >
    <div v-if="loading" style="text-align: center; padding: 40px">加载中…</div>
    <template v-else>
      <!-- Header fields: 3-column grid for 11 fields -->
      <div class="eo-hdr-grid">
        <div class="eo-fld">
          <span class="eo-fld-lb">关联生产计划</span
          ><span class="eo-fld-vl">{{ outDoc.planNo ?? '—' }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">绑定BOM编号</span
          ><span class="eo-fld-vl">{{ outDoc.bomNo ?? '—' }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">生产成品</span
          ><span class="eo-fld-vl">{{ outDoc.goodsName ?? '—' }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">库存校验状态</span
          ><span class="eo-fld-vl">{{ outDoc.stockCheckStatus }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">仓库</span
          ><span class="eo-fld-vl">{{ outDoc.warehouseName ?? outDoc.warehouseId }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">备注</span
          ><span class="eo-fld-vl">{{ outDoc.remark || '—' }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">状态</span><span class="eo-fld-vl">{{ outDoc.status }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">日期</span
          ><span class="eo-fld-vl">{{ dateText(outDoc.outDate) }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">金额</span
          ><span class="eo-fld-vl">¥ {{ moneyText(outDoc.totalAmount ?? 0) }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">操作人</span
          ><span class="eo-fld-vl">{{ outDoc.updatedByName ?? '—' }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">操作时间</span
          ><span class="eo-fld-vl">{{ dateText(outDoc.updatedAt, true) }}</span>
        </div>
      </div>

      <div class="eo-sec-title">
        BOM 原料明细 · {{ rows.length }} 种原料 · 同原料可增加批号子行，合计须等于计划量
      </div>
      <div v-if="displayedError" class="eo-error">{{ displayedError }}</div>
      <BatchMaterialTable :rows="rows" :stocks="allStocks" :editable="true" mode="execute" />
      <DocumentAttachments
        v-if="outDoc.id"
        document-type="production_material_output"
        :document-id="outDoc.id"
      />
    </template>
    <template #footer>
      <el-button @click="visible = false" :disabled="saving">关闭</el-button>
      <el-button
        type="primary"
        :loading="saving"
        :disabled="!!validationError || !rows.length"
        @click="submit"
        >确认出库</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.eo-hdr-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px 20px;
  margin-bottom: 12px;
}
.eo-fld {
  display: flex;
  flex-direction: column;
}
.eo-fld-lb {
  font-size: 11px;
  color: #7b8798;
  margin-bottom: 1px;
}
.eo-fld-vl {
  font-weight: 600;
  color: #1f2a44;
  font-size: 13px;
}
.eo-sec-title {
  margin: 14px 0 8px;
  font-weight: 700;
  color: #27334a;
  font-size: 14px;
}
.eo-error {
  background: #fef0f0;
  color: #e53e3e;
  padding: 10px 14px;
  border-radius: 4px;
  margin-bottom: 10px;
  font-size: 13px;
}
.eo-table-wrap {
  border: 1px solid #e5e9f0;
  border-radius: 4px;
  overflow: hidden;
}
.eo-thead {
  display: flex;
  background: #f7f9fc;
  border-bottom: 1px solid #e5e9f0;
}
.eo-th {
  padding: 9px 6px;
  font-size: 11px;
  font-weight: 700;
  color: #5f6b7c;
  border-right: 1px solid #e5e9f0;
}
.eo-th:last-child {
  border-right: none;
}
.eo-row {
  display: flex;
  border-bottom: 1px solid #f0f2f5;
}
.eo-row-end {
  border-bottom: 1px solid #e5e9f0;
}
.eo-row:last-child {
  border-bottom: none;
}
.eo-cl {
  padding: 6px;
  font-size: 12px;
  color: #1f2a44;
  display: flex;
  align-items: center;
  border-right: 1px solid #f0f2f5;
}
.eo-cl:last-child {
  border-right: none;
}
.eo-cl.muted {
  color: #8a94a6;
}
.eo-subr {
  background: #fcfdfe;
}
.eo-acts {
  gap: 4px;
  white-space: nowrap;
}
</style>
