<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import BatchMaterialTable from './BatchMaterialTable.vue';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';
import { fetchScopedStockOptions } from '@/views/business/use-scoped-stock-options';

type B = Record<string, any>;
const auth = useAuthStore();

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'done'): void }>();

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const rows = ref<B[]>([]);
const allStocks = ref<B[]>([]);
const form = ref<B>({
  orgId: auth.user?.orgId ?? '',
  warehouseId: '',
  destinationType: 1,
  remark: '',
});
const options = ref<B>({ orgs: [], warehouses: [], goods: [], destinations: [] });
const organizationTree = computed(() =>
  buildOrganizationTree(options.value.orgs as OrganizationTreeNode[]),
);

const visible = computed({ get: () => props.modelValue, set: (v) => emit('update:modelValue', v) });
const warehouseOptions = computed(() =>
  (options.value.warehouses ?? []).filter(
    (warehouse: B) =>
      !form.value.orgId ||
      String(warehouse.raw?.orgId ?? warehouse.orgId ?? '') === String(form.value.orgId),
  ),
);

function refreshRowStock(row: B) {
  const stocks = allStocks.value.filter(
    (stock: B) =>
      String(stock.goodsId) === String(row.goodsId) && String(stock.skuId) === String(row.skuId),
  );
  row.stockQty = stocks.reduce((sum: number, stock: B) => sum + Number(stock.inventoryQty ?? 0), 0);
  for (const batchRow of row.batchRows ?? []) {
    const stock = stocks.find((item: B) => String(item.batchNo) === String(batchRow.batchNo));
    batchRow.avail = Number(stock?.inventoryQty ?? 0);
    if (Number(batchRow.qty ?? 0) > batchRow.avail) batchRow.qty = batchRow.avail;
  }
}

function refreshAllRowStocks() {
  rows.value.forEach(refreshRowStock);
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [o, w, destinations] = (await Promise.all([
      api.get('/base-data/organizations/options'),
      api.get('/base-data/warehouses/options'),
      api.get('/dictionaries/temporary_outbound_destination'),
    ])) as any[];
    options.value = { orgs: o, warehouses: w, goods: [], destinations };
    allStocks.value = [];
    form.value.orgId = auth.user?.orgId ?? '';
    if (!rows.value.length)
      rows.value = [
        {
          goodsId: '',
          skuId: '',
          goodsCode: '',
          goodsName: '',
          skuSpec: '',
          unitName: '',
          stockQty: 0,
          batchRows: [{ batchNo: '', avail: 0, qty: 0 }],
        },
      ];
  } catch (e: any) {
    error.value = e.response?.data?.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
}

function onRowsChanged(newRows: B[]) {
  rows.value = newRows;
}
async function onGoodsChanged(row: B) {
  row.batchRows = [{ batchNo: '', avail: 0, qty: 0 }];
  if (!row.goodsId) {
    row.stockQty = 0;
    return;
  }
  const g: any = await api.get(`/goods/${row.goodsId}`);
  row.skuId = g.skus?.[0]?.id ?? '';
  row.unitType = g.skus?.[0]?.unitType ?? 1;
  row.goodsCode = g.queryCode ?? '';
  row.goodsName = g.goodsName ?? '';
  row.skuSpec = g.skus?.[0]?.spec_models ?? '';
  row.unitName = g.skus?.[0]?.unitName ?? '';
  refreshRowStock(row);
}

async function submit() {
  if (!form.value.orgId || !form.value.warehouseId || !form.value.destinationType) {
    ElMessage.warning('请选择所属组织、仓库和出库去向');
    return;
  }
  const lines: B[] = [];
  for (const row of rows.value) {
    if (!row.goodsId) continue;
    for (const br of row.batchRows ?? []) {
      if (Number(br.qty) <= 0) continue;
      lines.push({
        goodsId: row.goodsId,
        skuId: row.skuId,
        batchNo: br.batchNo,
        unitType: row.unitType ?? 1,
        quantity: Number(br.qty),
      });
    }
  }
  if (!lines.length) {
    ElMessage.warning('请选择商品并填写出库数量');
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    const result: any = await api.post('/production/outputs', {
      outType: 3,
      outDate: new Date().toISOString().slice(0, 10),
      orgId: form.value.orgId,
      warehouseId: form.value.warehouseId,
      destinationType: Number(form.value.destinationType),
      remark: form.value.remark,
      details: lines,
    });
    await api.post(`/production/outputs/${result.id}/confirm`, {
      comment: form.value.remark || '临时出库',
      details: lines,
    });
    ElMessage.success('临时出库已确认出库');
    visible.value = false;
    emit('done');
  } catch (e: any) {
    error.value = e.response?.data?.message ?? '保存失败';
  } finally {
    saving.value = false;
  }
}

async function reloadStocks() {
  if (!form.value.warehouseId) {
    allStocks.value = [];
    options.value.goods = [];
    refreshAllRowStocks();
    return;
  }
  const [stocks, goods] = (await Promise.all([
    fetchScopedStockOptions(form.value.orgId, form.value.warehouseId),
    api.get('/production/product-options', {
      params: { orgId: form.value.orgId, warehouseId: form.value.warehouseId },
    }),
  ])) as any[];
  allStocks.value = stocks;
  options.value.goods = goods;
  rows.value = [
    {
      goodsId: '',
      skuId: '',
      goodsCode: '',
      goodsName: '',
      skuSpec: '',
      unitName: '',
      stockQty: 0,
      batchRows: [{ batchNo: '', avail: 0, qty: 0 }],
    },
  ];
  refreshAllRowStocks();
}
function organizationChanged() {
  form.value.warehouseId = '';
  allStocks.value = [];
  options.value.goods = [];
  rows.value = [
    {
      goodsId: '',
      skuId: '',
      goodsCode: '',
      goodsName: '',
      skuSpec: '',
      unitName: '',
      stockQty: 0,
      batchRows: [{ batchNo: '', avail: 0, qty: 0 }],
    },
  ];
  refreshAllRowStocks();
}
watch(visible, (v) => {
  if (v) {
    form.value.destinationType = 1;
    rows.value = [
      {
        goodsId: '',
        skuId: '',
        goodsCode: '',
        goodsName: '',
        skuSpec: '',
        unitName: '',
        stockQty: 0,
        batchRows: [{ batchNo: '', avail: 0, qty: 0 }],
      },
    ];
    load();
  }
});
watch(() => form.value.warehouseId, reloadStocks);
</script>

<template>
  <el-dialog
    v-model="visible"
    title="新增临时出库"
    width="min(1280px, calc(100vw - 32px))"
    top="3vh"
    :close-on-click-modal="false"
  >
    <div v-if="loading" style="text-align: center; padding: 40px">加载中…</div>
    <template v-else>
      <div class="lab-hdr-grid">
        <div class="lab-fld">
          <span class="lab-fld-lb">所属组织</span
          ><el-tree-select
            v-model="form.orgId"
            :data="organizationTree"
            filterable
            check-strictly
            node-key="value"
            :props="{ label: 'label', children: 'children' }"
            size="small"
            @change="organizationChanged"
          />
        </div>
        <div class="lab-fld">
          <span class="lab-fld-lb">仓库</span
          ><el-select v-model="form.warehouseId" :disabled="!form.orgId" filterable size="small"
            ><el-option
              v-for="x in warehouseOptions"
              :key="x.value"
              :label="x.label"
              :value="x.value"
          /></el-select>
        </div>
        <div class="lab-fld">
          <span class="lab-fld-lb">经办人</span
          ><span class="lab-fld-vl">{{ auth.user?.username || '—' }}</span>
        </div>
        <div class="lab-fld">
          <span class="lab-fld-lb">出库去向</span
          ><el-select v-model="form.destinationType" size="small">
            <el-option
              v-for="x in options.destinations"
              :key="x.value"
              :label="x.label"
              :value="Number(x.value)"
            />
          </el-select>
        </div>
      </div>
      <div class="lab-remark">
        <span class="lab-fld-lb">备注</span
        ><el-input v-model="form.remark" placeholder="填写业务背景、交付要求或异常说明…" />
      </div>

      <div class="lab-sec-title">商品明细 — 支持同商品多批号出库，选择商品后自动加载批号库存</div>
      <div v-if="error" class="lab-error">{{ error }}</div>

      <BatchMaterialTable
        :rows="rows"
        :stocks="allStocks"
        :editable="true"
        :goods-editable="true"
        mode="lab"
        :goodsSelect="options.goods || []"
        @update:rows="onRowsChanged"
        @goodsChanged="onGoodsChanged"
      />
    </template>
    <template #footer>
      <el-button @click="visible = false" :disabled="saving">关闭</el-button>
      <el-button type="primary" :loading="saving" @click="submit">确认出库</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.lab-hdr-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 20px;
  margin-bottom: 8px;
}
.lab-fld {
  display: flex;
  flex-direction: column;
}
.lab-fld-lb {
  font-size: 11px;
  color: #7b8798;
  margin-bottom: 2px;
}
.lab-fld-vl {
  font-weight: 600;
  color: #1f2a44;
  font-size: 14px;
}
.lab-remark {
  margin-bottom: 12px;
}
.lab-sec-title {
  margin: 14px 0 8px;
  font-weight: 700;
  color: #27334a;
  font-size: 14px;
}
.lab-error {
  background: #fef0f0;
  color: #e53e3e;
  padding: 10px 14px;
  border-radius: 4px;
  margin-bottom: 10px;
  font-size: 13px;
}
</style>
