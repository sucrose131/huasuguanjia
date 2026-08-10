<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import BatchMaterialTable from './BatchMaterialTable.vue';
import DocumentAttachments from '@/components/DocumentAttachments.vue';

type B = Record<string, any>;

const props = defineProps<{ modelValue: boolean; outRow: B }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'done'): void }>();

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const rows = ref<B[]>([]);
const allStocks = ref<B[]>([]);
const goodsOptions = ref<B[]>([]);

const visible = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) });

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = props.outRow;
    const [planDetail, outDetail, stockData, goodsData] = (await Promise.all([
      r.planId ? api.get(`/production/plans/${r.planId}`) : Promise.resolve(null),
      api.get(`/production/outputs/${r.id}`),
      api.get('/inventory/stocks', { params: { warehouseId: r.warehouseId, pageSize: 200 } }),
      Number(r.outType) === 3
        ? api.get('/goods', { params: { pageSize: 100, status: 1 } })
        : Promise.resolve({ items: [] }),
    ])) as any[];
    allStocks.value = stockData.items ?? [];
    goodsOptions.value = goodsData.items ?? [];

    // Build rows from plan details + existing out details
    const planDetails = planDetail?.details ?? [];
    const outDetails = outDetail.details ?? [];

    rows.value = planDetails.length
      ? planDetails.map((pd: B) => {
          const existing = outDetails.filter(
            (od: B) =>
              String(od.goodsId) === String(pd.goodsId) && String(od.skuId) === String(pd.skuId),
          );
          const batchRows: B[] = existing.length
            ? existing.map((od: B) => ({ batchNo: od.batchNo, qty: Number(od.quantity), avail: 0 }))
            : [{ batchNo: '', avail: 0, qty: 0 }];
          // Update avail for each batch
          for (const br of batchRows) {
            const s = (allStocks.value as B[]).find(
              (x: B) =>
                x.batchNo === br.batchNo &&
                String(x.goodsId) === String(pd.goodsId) &&
                String(x.skuId) === String(pd.skuId),
            );
            br.avail = s ? Number(s.inventoryQty) : 0;
          }
          const planQty = Number(pd.planOutQty ?? pd.quantity ?? 0);
          const stockQty = pd.currentStock ?? 0;
          return {
            ...pd,
            planQty,
            stockQty,
            batchRows,
            goodsName: pd.goodsName ?? '',
            goodsCode: pd.goodsCode ?? '',
            skuSpec: pd.skuSpec ?? '',
            unitName: pd.unitName ?? '—',
            bomUnitQty: pd.bomUnitQty ?? '',
            totalDemand: pd.standardQty ?? pd.planQty,
          };
        })
      : outDetails.map((od: B) => {
          const matchingStocks = (allStocks.value as B[]).filter(
            (stock: B) =>
              String(stock.goodsId) === String(od.goodsId) &&
              String(stock.skuId) === String(od.skuId),
          );
          const selectedStock = matchingStocks.find(
            (stock: B) => String(stock.batchNo) === String(od.batchNo),
          );
          return {
            ...od,
            goodsId: od.goodsId,
            skuId: od.skuId,
            goodsCode: od.goodsCode ?? od.queryCode ?? '—',
            goodsName: od.goodsName ?? '—',
            skuSpec: od.skuSpec ?? od.goodsSpec ?? od.specModels ?? '—',
            unitName: od.unitName ?? od.unitTypeName ?? od.unitType ?? '—',
            batchRows: [
              {
                batchNo: od.batchNo,
                qty: Number(od.quantity),
                avail: Number(selectedStock?.inventoryQty ?? od.quantity ?? 0),
              },
            ],
            planQty: Number(od.quantity),
            stockQty: matchingStocks.reduce(
              (sum: number, stock: B) => sum + Number(stock.inventoryQty ?? 0),
              0,
            ),
            bomUnitQty: od.bomUnitQty ?? '—',
            totalDemand: od.standardQty ?? Number(od.quantity),
          };
        });
  } catch (e: any) {
    error.value = e.response?.data?.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

function onRowsChanged(value: B[]) {
  rows.value = value;
}

async function onGoodsChanged(row: B) {
  if (!row.goodsId) return;
  const goods: any = await api.get(`/goods/${row.goodsId}`);
  const sku = goods.skus?.find((item: B) => Number(item.isDefault) === 1) ?? goods.skus?.[0];
  row.skuId = sku?.id ?? '';
  row.unitType = sku?.unitType ?? goods.unitType ?? 0;
  row.goodsCode = goods.queryCode ?? '';
  row.goodsName = goods.goodsName ?? '';
  row.skuSpec = sku?.specModels ?? sku?.spec_models ?? goods.specModels ?? '';
  row.unitName = goods.unitName ?? '';
  row.stockQty = allStocks.value
    .filter(
      (stock: B) =>
        String(stock.goodsId) === String(row.goodsId) && String(stock.skuId) === String(row.skuId),
    )
    .reduce((sum: number, stock: B) => sum + Number(stock.inventoryQty ?? 0), 0);
  row.batchRows = [{ batchNo: '', avail: 0, qty: 0 }];
}

async function submit() {
  saving.value = true;
  error.value = '';
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
    await api.patch(`/production/outputs/${props.outRow.id}`, {
      planId: props.outRow.planId,
      outType: props.outRow.outType,
      orgId: props.outRow.orgId,
      warehouseId: props.outRow.warehouseId,
      outDate: props.outRow.outDate,
      remark: props.outRow.remark,
      details: lines,
    });
    ElMessage.success('编辑已保存');
    visible.value = false;
    emit('done');
  } catch (e: any) {
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
    :title="`编辑 ${outRow.outTypeName || '生产出库单'}`"
    width="min(1280px, calc(100vw - 32px))"
    top="3vh"
    :close-on-click-modal="false"
  >
    <div v-if="loading" style="text-align: center; padding: 40px">加载中…</div>
    <template v-else>
      <div v-if="outRow.planId" class="eo-hdr-grid">
        <div class="eo-fld">
          <span class="eo-fld-lb">关联生产计划</span
          ><span class="eo-fld-vl">{{ outRow.planNo ?? '—' }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">BOM编号</span
          ><span class="eo-fld-vl">{{ outRow.bomNo ?? '—' }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">生产成品</span
          ><span class="eo-fld-vl">{{ outRow.goodsName ?? '—' }}</span>
        </div>
        <div class="eo-fld">
          <span class="eo-fld-lb">仓库</span
          ><span class="eo-fld-vl">{{ outRow.warehouseName ?? '—' }}</span>
        </div>
      </div>

      <div class="eo-sec-title">明细 · 可增加批号子行调整分配</div>
      <div v-if="error" class="eo-error">{{ error }}</div>
      <BatchMaterialTable
        :rows="rows"
        :stocks="allStocks"
        :editable="true"
        :goods-editable="Number(outRow.outType) === 3"
        :goods-select="goodsOptions"
        :mode="outRow.outType === 3 ? 'lab' : 'execute'"
        @update:rows="onRowsChanged"
        @goodsChanged="onGoodsChanged"
      />
      <DocumentAttachments
        v-if="outRow.id"
        document-type="production_material_output"
        :document-id="outRow.id"
      />
    </template>
    <template #footer>
      <el-button @click="visible = false" :disabled="saving">关闭</el-button>
      <el-button type="primary" :loading="saving" @click="submit">保存修改</el-button>
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
</style>
