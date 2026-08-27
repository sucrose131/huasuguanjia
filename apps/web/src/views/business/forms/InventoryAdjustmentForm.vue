<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import RemoteSelect from '@/components/RemoteSelect.vue';
import { fetchScopedStockOptions } from '../use-scoped-stock-options';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const options = reactive<Record<string, any>>({
  orgs: [],
  warehouses: [],
  units: [],
  stocks: [],
});
const dicts = reactive<Record<string, any[]>>({ adjustTypes: [] });

const isView = computed(() => props.mode === 'view');

function blankLine() {
  return {
    stockKey: '',
    goodsId: '',
    goodsCode: '',
    goodsName: '',
    skuId: '',
    skuSpec: '',
    warehouseId: '',
    warehouseName: '',
    batchNo: '',
    unitType: 0,
    unitName: '',
    inventoryQty: 0,
    beforeQty: 0,
    afterQty: 0,
    adjustType: dicts.adjustTypes?.[0]?.value ?? 1,
    quantity: 1,
    remark: '',
    stocks: [],
  };
}

function recalcLine(line: any) {
  line.beforeQty = Number(line.inventoryQty ?? line.beforeQty ?? 0);
  line.afterQty =
    Number(line.beforeQty) +
    (Number(line.adjustType) === 1 ? Number(line.quantity ?? 0) : -Number(line.quantity ?? 0));
  return line;
}

function unitName(line: any) {
  const unit = (options.units ?? []).find(
    (u: any) => String(u.value ?? u.id) === String(line.unitType),
  );
  return unit?.label ?? unit?.name ?? '—';
}

function stockKeyOf(stock: any) {
  return `${stock.goodsId}-${stock.skuId}-${stock.warehouseId}-${stock.batchNo ?? ''}`;
}

function lineStocks(line: any) {
  const pool = Array.isArray(line.stocks) && line.stocks.length ? line.stocks : options.stocks;
  return pool.filter(
    (s: any) =>
      (!line.goodsId || String(s.goodsId) === String(line.goodsId)) &&
      (!line.warehouseId || String(s.warehouseId) === String(line.warehouseId)),
  );
}

function stockChanged(line: any) {
  const pool = Array.isArray(line.stocks) && line.stocks.length ? line.stocks : options.stocks;
  const stock = (pool ?? []).find((s: any) => stockKeyOf(s) === line.stockKey);
  if (!stock) return;
  Object.assign(line, {
    goodsId: stock.goodsId,
    goodsCode: stock.goodsCode,
    goodsName: stock.goodsName,
    skuId: stock.skuId,
    skuSpec: stock.skuSpec,
    warehouseId: stock.warehouseId,
    warehouseName: stock.warehouseName,
    batchNo: stock.batchNo ?? '',
    unitType: stock.unitType,
    unitName: stock.unitName,
    inventoryQty: Number(stock.inventoryQty ?? 0),
  });
  recalcLine(line);
}

async function searchGoodsOptions(line: any, keyword: string) {
  // 商品选项取自该行仓库库存（按 orgId+warehouseId 后端过滤），未选仓库时为空
  if (!form.value.orgId || !line.warehouseId) return [];
  const kw = String(keyword ?? '')
    .trim()
    .toLowerCase();
  const pool = Array.isArray(line.stocks) && line.stocks.length ? line.stocks : options.stocks;
  const seen = new Map<string, any>();
  for (const s of pool ?? []) {
    if (String(s.warehouseId) !== String(line.warehouseId)) continue;
    if (kw && !`${s.goodsCode ?? ''} ${s.goodsName ?? ''}`.toLowerCase().includes(kw)) continue;
    if (!seen.has(String(s.goodsId))) seen.set(String(s.goodsId), s);
  }
  return [...seen.values()].map((s: any) => ({
    value: s.goodsId,
    label: `${s.goodsCode || ''} ${s.goodsName || ''}`.trim(),
  }));
}

async function loadLineStocks(line: any) {
  if (!form.value.orgId || !line.warehouseId) {
    line.stocks = [];
    return;
  }
  line.stocks = await fetchScopedStockOptions(form.value.orgId, line.warehouseId).catch(() => []);
}

async function warehouseChanged(line: any) {
  line.stockKey = '';
  line.inventoryQty = 0;
  line.goodsId = '';
  line.skuId = '';
  line.goodsCode = '';
  line.goodsName = '';
  line.skuSpec = '';
  await loadLineStocks(line);
}

async function lineGoodsChanged(line: any) {
  if (!line.goodsId) return;
  const g: any = await api.get(`/goods/${line.goodsId}`);
  const sku = (g.skus ?? []).find((x: any) => x.isDefault === 1) ?? g.skus?.[0];
  line.skuId = sku?.id ?? '';
  line.unitType = sku?.unitType ?? 0;
  line.goodsCode = g.queryCode ?? '';
  line.goodsName = g.goodsName ?? '';
  line.skuSpec = sku?.specModels ?? '';
  line.stockKey = '';
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (!form.value.reason) {
    ElMessage.warning('请输入调整原因');
    return false;
  }
  const lines = form.value.details ?? [];
  if (!lines.length) {
    ElMessage.warning('请至少添加一条调整明细');
    return false;
  }
  for (const line of lines) {
    if (!line.goodsId || !line.skuId || !line.warehouseId || !line.stockKey) {
      ElMessage.warning('请选择完整的商品、仓库与库存批次');
      return false;
    }
    if (Number(line.quantity) <= 0) {
      ElMessage.warning('调整数量必须大于 0');
      return false;
    }
    const afterQty =
      Number(line.inventoryQty ?? 0) +
      (Number(line.adjustType) === 1 ? Number(line.quantity) : -Number(line.quantity));
    if (afterQty < 0) {
      ElMessage.warning(`${line.goodsName || '商品'} 调整后库存不能小于 0`);
      return false;
    }
  }
  return true;
}

async function save(submit = false) {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/inventory/adjustments';
    const payload: Record<string, any> = {
      reason: form.value.reason,
      applicantDate: form.value.applicantDate,
      remark: form.value.remark,
      submit,
      details: (form.value.details ?? []).map((line: any) => ({
        goodsId: line.goodsId,
        skuId: line.skuId,
        warehouseId: line.warehouseId,
        batchNo: line.batchNo ?? '',
        adjustType: line.adjustType,
        quantity: line.quantity,
        remark: line.remark ?? '',
      })),
    };
    const result: any =
      props.mode === 'edit'
        ? await api.patch(`${url}/${form.value.id}`, payload)
        : await api.post(url, payload);
    ElMessage.success(result?.message ?? (submit ? '已保存并提交审核' : '草稿已保存'));
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

/** 按组织加载仓库选项（走后端），组织为空时清空 */
async function loadOrgWarehouses(orgId: unknown) {
  if (!orgId) {
    options.warehouses = [];
    return;
  }
  options.warehouses = (await api
    .get('/base-data/warehouses/options', { params: { orgId: String(orgId) } })
    .catch(() => [])) as any[];
}

onMounted(async () => {
  const [orgs, units, adjustTypes] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api.get('/dictionaries/inventory_adjust_type').catch(() => []),
  ]);
  options.orgs = orgs;
  options.units = units;
  dicts.adjustTypes = adjustTypes as any[];

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      applicantDate: dateText(new Date()),
      reason: '',
      remark: '',
      details: [blankLine()],
    });
  } else if (form.value.id) {
    const detail: any = await api.get(`/inventory/adjustments/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
    form.value.details = (form.value.details ?? []).map((line: any) => ({
      ...line,
      quantity: Number(line.quantity ?? 0),
      inventoryQty: Number(line.beforeQty ?? 0),
      stockKey: `${line.goodsId}-${line.skuId}-${line.warehouseId}-${line.batchNo ?? ''}`,
    }));
    form.value.details.forEach(recalcLine);
    await Promise.all(form.value.details.map((line: any) => loadLineStocks(line)));
  }
  await loadOrgWarehouses(form.value.orgId);
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="申请日期" required>
        <el-date-picker
          v-model="form.applicantDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="经办人">
        <el-input :model-value="form.operatorName || auth.user?.username || '—'" disabled />
      </el-form-item>
      <el-form-item label="调整原因" required>
        <el-input v-model="form.reason" :disabled="isView" />
      </el-form-item>
      <el-form-item label="备注" class="span-2">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">调整明细</span>
      <el-button v-if="!isView" link type="primary" @click="addLine">+ 添加明细</el-button>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="200">
        <template #default="s">
          <RemoteSelect
            v-if="!isView"
            v-model="s.row.goodsId"
            :fetch="(kw: string) => searchGoodsOptions(s.row, kw)"
            :current-label="s.row.goodsName"
            :disabled="!s.row.warehouseId"
            placeholder="请先选择仓库，再搜索库存商品"
            @change="lineGoodsChanged(s.row)"
          />
          <span v-else>{{ s.row.goodsName || s.row.goodsId || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="110">
        <template #default="s">{{ s.row.skuSpec || s.row.skuId || '—' }}</template>
      </el-table-column>
      <el-table-column label="仓库" min-width="140">
        <template #default="s">
          <el-select
            v-if="!isView"
            v-model="s.row.warehouseId"
            filterable
            placeholder="选择仓库"
            @change="warehouseChanged(s.row)"
          >
            <el-option
              v-for="w in options.warehouses"
              :key="w.value"
              :label="w.label"
              :value="w.value"
            />
          </el-select>
          <span v-else>{{ s.row.warehouseName || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="单位" width="80">
        <template #default="s">{{ s.row.unitName || unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column label="库存批次" min-width="190">
        <template #default="s">
          <el-select
            v-if="!isView"
            v-model="s.row.stockKey"
            filterable
            placeholder="选择批次"
            :disabled="!s.row.warehouseId"
            @change="stockChanged(s.row)"
          >
            <el-option
              v-for="x in lineStocks(s.row)"
              :key="stockKeyOf(x)"
              :label="`${x.goodsName || ''} · ${x.batchNo || '无批号'} · 库存 ${x.inventoryQty ?? 0}`"
              :value="stockKeyOf(x)"
            />
          </el-select>
          <span v-else>{{ s.row.batchNo || '无批号' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="当前库存" width="95">
        <template #default="s">{{ s.row.inventoryQty ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="调整类型" width="115">
        <template #default="s">
          <el-select v-if="!isView" v-model="s.row.adjustType" @change="recalcLine(s.row)">
            <el-option
              v-for="item in dicts.adjustTypes"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
          <span v-else>{{ s.row.adjustTypeName || s.row.adjustType }}</span>
        </template>
      </el-table-column>
      <el-table-column label="调整数量" width="130">
        <template #default="s">
          <el-input-number
            v-model="s.row.quantity"
            :min="1"
            :precision="0"
            :step="1"
            :disabled="isView"
            @change="recalcLine(s.row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="调整后数量" width="105" align="right">
        <template #default="s">{{ Number(s.row.afterQty ?? 0).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="备注" min-width="120">
        <template #default="s"><el-input v-model="s.row.remark" :disabled="isView" /></template>
      </el-table-column>
      <el-table-column v-if="!isView" label="" width="60">
        <template #default="s">
          <el-button link type="danger" @click="removeLine(s.$index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="!isView" class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button :loading="saving" @click="save(false)">保存草稿</el-button>
      <el-button type="primary" :loading="saving" @click="save(true)">保存并提交审核</el-button>
    </div>
  </el-form>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 16px;
}
.span-2 {
  grid-column: 1 / -1;
}
.details-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.details-title {
  font-weight: 600;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
