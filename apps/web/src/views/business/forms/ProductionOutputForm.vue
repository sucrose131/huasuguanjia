<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import { lineUnitName, type UnitOption } from '@/utils/unit-name';
import BatchMaterialTable from '@/components/production/BatchMaterialTable.vue';
import RemoteSelect from '@/components/RemoteSelect.vue';

type B = Record<string, any>;

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const loading = ref(false);
const error = ref('');
const rows = ref<B[]>([]);
const allStocks = ref<B[]>([]);
const options = reactive<Record<string, any>>({
  orgs: [],
  warehouses: [],
  plans: [],
  goods: [],
  units: [],
  destinations: [],
  outputTypes: [],
});

const isView = computed(() => props.mode === 'view');
const isLab = computed(() => Number(form.value.outType) === 3);

const organizationTree = computed(() => {
  const build = (items: any[], parentId?: string): any[] =>
    items
      .filter((item: any) => (item.raw?.parentId ?? item.parentId ?? null) === (parentId ?? null))
      .map((item: any) => ({
        value: item.value,
        label: item.label,
        children: build(items, item.value),
      }));
  return build(options.orgs);
});
const warehouseOptions = computed(() =>
  (options.warehouses ?? []).filter(
    (w: any) =>
      !form.value.orgId ||
      String(w.raw?.orgId ?? w.orgId ?? '') === String(form.value.orgId),
  ),
);

function blankRow(): B {
  return {
    goodsId: '',
    skuId: '',
    goodsCode: '',
    goodsName: '',
    skuSpec: '',
    unitName: '',
    stockQty: 0,
    batchRows: [{ batchNo: '', avail: 0, qty: 0 }],
  };
}

function refreshRowStock(row: B) {
  const stocks = allStocks.value.filter(
    (stock: B) =>
      String(stock.goodsId) === String(row.goodsId) &&
      String(stock.skuId) === String(row.skuId),
  );
  row.stockQty = stocks.reduce(
    (sum: number, stock: B) => sum + Number(stock.inventoryQty ?? 0),
    0,
  );
  for (const batchRow of row.batchRows ?? []) {
    const stock = stocks.find((item: B) => String(item.batchNo) === String(batchRow.batchNo));
    batchRow.avail = Number(stock?.inventoryQty ?? 0);
    if (Number(batchRow.qty ?? 0) > batchRow.avail) batchRow.qty = batchRow.avail;
  }
}
function refreshAllRowStocks() {
  rows.value.forEach(refreshRowStock);
}

async function reloadStocks() {
  if (!form.value.warehouseId) {
    allStocks.value = [];
    options.goods = [];
    rows.value = [blankRow()];
    return;
  }
  const [stocks, goods] = (await Promise.all([
    api
      .get('/inventory/stock-options', {
        params: { orgId: form.value.orgId, warehouseId: form.value.warehouseId },
      })
      .catch(() => []),
    api
      .get('/production/product-options', {
        params: { orgId: form.value.orgId, warehouseId: form.value.warehouseId },
      })
      .catch(() => []),
  ])) as any[];
  allStocks.value = stocks;
  options.goods = goods;
  rows.value = [blankRow()];
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
  const sku = g.skus?.[0];
  row.skuId = sku?.id ?? '';
  row.unitType = sku?.unitType ?? 1;
  row.goodsCode = g.queryCode ?? '';
  row.goodsName = g.goodsName ?? '';
  row.skuSpec = sku?.spec_models ?? '';
  row.unitName = lineUnitName(options.units as UnitOption[], row);
  refreshRowStock(row);
}

function organizationChanged() {
  form.value.warehouseId = '';
  allStocks.value = [];
  options.goods = [];
  rows.value = [blankRow()];
}

async function planChanged() {
  if (!form.value.planId) {
    form.value.details = [];
    rows.value = [];
    return;
  }
  const p: any = await api.get(`/production/plans/${form.value.planId}`);
  Object.assign(form.value, {
    orgId: p.orgId,
    warehouseId: p.warehouseId,
    bomId: p.bomId,
    bomNo: p.bomNo,
    goodsName: p.goodsName,
    stockCheckStatus: p.stockCheckStatus,
    planStatus: p.planStatus,
    planNo: p.planNo,
  });
  const flat = (p.details ?? []).map((x: B) => ({
    ...x,
    goodsCode: x.goodsCode ?? '',
    goodsName: x.goodsName ?? '',
    skuSpec: x.skuSpec ?? '',
    unitName: x.unitName ?? lineUnitName(options.units as UnitOption[], x),
    planQty: Number(x.planOutQty ?? x.quantity ?? 0),
    stockQty: Number(x.currentStock ?? 0),
    totalDemand: Number(x.standardQty ?? x.planOutQty ?? x.quantity ?? 0),
    bomUnitQty: x.bomUnitQty ?? '—',
    batchRows: [{ batchNo: '', avail: 0, qty: 0 }],
  }));
  form.value.details = flat;
  rows.value = flat;
}

async function searchPlanOptions(keyword: string) {
  if (!String(keyword ?? '').trim()) {
    const base = (options.plans ?? []).filter((p: B) =>
      Number(p.planStatus) === 3 &&
      Number(p.approveStatus) === 1 &&
      Number(p.outboundStatus) === 0,
    );
    return base.map((x: B) => ({ value: x.id, label: x.planNo }));
  }
  const r: any = await api.get('/production/plans', { params: { keyword, pageSize: 50 } });
  return (r.items ?? [])
    .filter(
      (p: B) =>
        Number(p.planStatus) === 3 &&
        Number(p.approveStatus) === 1 &&
        Number(p.outboundStatus) === 0,
    )
    .map((x: B) => ({ value: x.id, label: x.planNo }));
}

function flattenLines(): B[] {
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
        remark: row.remark ?? '',
      });
    }
  }
  return lines;
}

function validate() {
  if (isLab.value) {
    if (!form.value.orgId || !form.value.warehouseId || !form.value.destinationType) {
      ElMessage.warning('请选择所属组织、仓库和出库去向');
      return false;
    }
  } else if (!form.value.planId) {
    ElMessage.warning('请选择生产计划');
    return false;
  }
  if (!flattenLines().length) {
    ElMessage.warning('请选择商品、批号并填写出库数量');
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  error.value = '';
  try {
    const details = flattenLines();
    const payload: Record<string, any> = {
      ...form.value,
      details,
      outDate: form.value.outDate || dateText(new Date()),
    };
    const url = '/production/outputs';
    const result: any =
      props.mode === 'edit'
        ? await api.patch(`${url}/${form.value.id}`, payload)
        : await api.post(url, payload);
    ElMessage.success(result?.message ?? '保存成功');
    emit('saved');
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? '保存失败';
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  loading.value = true;
  try {
    const [o, w, destinations, outputTypes, plans, units] = (await Promise.all([
      api.get('/base-data/organizations/options').catch(() => []),
      api.get('/base-data/warehouses/options').catch(() => []),
      api.get('/dictionaries/temporary_outbound_destination').catch(() => []),
      api.get('/dictionaries/production_material_out_type').catch(() => []),
      api.get('/production/plans', { params: { pageSize: 100 } }).catch(() => ({ items: [] })),
      api.get('/base-data/units/options').catch(() => []),
    ])) as any[];
    options.orgs = o;
    options.warehouses = w;
    options.destinations = destinations;
    options.outputTypes = outputTypes;
    options.plans = plans.items ?? [];
    options.units = units;

    if (props.mode === 'create') {
      Object.assign(form.value, {
        orgId: auth.user?.orgId ?? '',
        warehouseId: '',
        destinationType: 1,
        outDate: dateText(new Date()),
        remark: '',
        outType: Number(form.value.outType ?? 3),
        details: [],
      });
      if (form.value.planId) {
        await planChanged();
        await reloadStocks();
      } else if (isLab.value) {
        rows.value = [blankRow()];
        await reloadStocks();
      }
    } else if (form.value.id) {
      const detail: any = await api.get(`/production/outputs/${form.value.id}`).catch(() => null);
      if (detail) Object.assign(form.value, detail);
      const grouped = new Map<string, B>();
      for (const line of form.value.details ?? []) {
        const key = `${line.goodsId ?? ''}:${line.skuId ?? ''}`;
        const existing = grouped.get(key);
        const batchRow = { batchNo: line.batchNo ?? '', qty: Number(line.quantity ?? 0), avail: Number(line.inventoryQty ?? 0) };
        if (existing) {
          existing.batchRows.push(batchRow);
          continue;
        }
        grouped.set(key, {
          ...line,
          goodsCode: line.goodsCode ?? '—',
          goodsName: line.goodsName ?? '—',
          skuSpec: line.skuSpec ?? line.goodsSpec ?? '—',
          unitName: line.unitName ?? lineUnitName(options.units as UnitOption[], line),
          bomUnitQty: line.bomUnitQty ?? '—',
          totalDemand: line.standardQty ?? line.totalDemand ?? line.quantity ?? 0,
          stockQty: line.currentStock ?? 0,
          planQty: line.planOutQty ?? line.quantity ?? 0,
          batchRows: [batchRow],
        });
      }
      rows.value = [...grouped.values()];
      await reloadStocks();
    }
  } catch (e: any) {
    error.value = e?.response?.data?.message ?? '加载失败';
  } finally {
    loading.value = false;
  }
});

watch(
  () => form.value.warehouseId,
  () => {
    if (isLab.value && props.mode === 'create') reloadStocks();
  },
);
</script>

<template>
  <div v-if="loading" style="text-align: center; padding: 40px">加载中…</div>
  <el-form v-else label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="出库类型" required>
        <el-select
          v-model="form.outType"
          :disabled="mode !== 'create'"
          @change="
            form.planId = '';
            form.details = [];
            rows = [];
            form.bomNo = '';
            form.goodsName = '';
          "
        >
          <el-option
            v-for="item in options.outputTypes || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="isLab" label="所属组织" required>
        <el-tree-select
          v-model="form.orgId"
          :data="organizationTree"
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          :disabled="isView"
          @change="organizationChanged"
        />
      </el-form-item>
      <el-form-item v-else label="生产计划" required>
        <RemoteSelect
          v-model="form.planId"
          :fetch="searchPlanOptions"
          :current-label="form.planNo"
          :disabled="mode !== 'create'"
          placeholder="输入计划编号搜索"
          @change="planChanged"
        />
      </el-form-item>
      <el-form-item label="仓库" required>
        <el-select v-model="form.warehouseId" filterable :disabled="isView || !form.orgId" @change="reloadStocks">
          <el-option v-for="x in warehouseOptions" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item v-if="isLab" label="出库去向" required>
        <el-select v-model="form.destinationType" :disabled="isView">
          <el-option
            v-for="x in options.destinations || []"
            :key="x.value"
            :label="x.label"
            :value="Number(x.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="出库日期" required>
        <el-date-picker v-model="form.outDate" type="date" value-format="YYYY-MM-DD" :disabled="isView" />
      </el-form-item>
      <template v-if="!isLab">
        <el-form-item label="BOM编号">
          <el-input :model-value="form.bomNo || '—'" readonly />
        </el-form-item>
        <el-form-item label="生产成品">
          <el-input :model-value="form.goodsName || '—'" readonly />
        </el-form-item>
      </template>
    </div>

    <div class="details-title">商品明细 — 支持同商品多批号出库，选择商品后自动加载批号库存</div>
    <div v-if="error" class="form-error">{{ error }}</div>
    <BatchMaterialTable
      :rows="rows"
      :stocks="allStocks"
      :editable="!isView"
      :goods-editable="isLab && !isView"
      :mode="isLab ? 'lab' : 'execute'"
      :goods-select="options.goods || []"
      @update:rows="onRowsChanged"
      @goods-changed="onGoodsChanged"
    />

    <el-form-item label="备注" style="margin-top: 12px">
      <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
    </el-form-item>

    <div v-if="!isView" class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </div>
  </el-form>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 16px;
}
.details-title {
  font-weight: 600;
  margin: 10px 0 8px;
}
.form-error {
  background: #fef0f0;
  color: #e53e3e;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 10px;
  font-size: 13px;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
