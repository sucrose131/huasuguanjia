<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import RemoteSelect from '@/components/RemoteSelect.vue';

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
  departments: [],
  stocks: [],
});
const dicts = reactive<Record<string, any[]>>({});

const isView = computed(() => props.mode === 'view');

const filteredWarehouses = computed(() =>
  !form.value.orgId
    ? (options.warehouses as any[])
    : (options.warehouses as any[]).filter(
        (w) => String(w.raw?.orgId ?? w.orgId) === String(form.value.orgId),
      ),
);

function blankLine() {
  return {
    stockKey: '',
    goodsId: '',
    goodsCode: '',
    goodsName: '',
    skuId: '',
    skuSpec: '',
    batchNo: '',
    unitType: 0,
    unitName: '',
    inventoryQty: 0,
    unitPrice: 0,
    quantity: 1,
    amount: 0,
    remark: '',
  };
}

function stockKey(stock: any) {
  return `${stock.goodsId}-${stock.skuId}-${stock.warehouseId}-${stock.batchNo ?? ''}`;
}

function lineStockOptions(line: any) {
  return (options.stocks as any[]).filter(
    (s) =>
      (!line.goodsId || String(s.goodsId) === String(line.goodsId)) &&
      (!line.skuId || String(s.skuId) === String(line.skuId)),
  );
}

function recalcLine(line: any) {
  line.amount = Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0);
}

async function loadDicts() {
  const [overflowType] = await Promise.all([
    api.get('/dictionaries/inventory_overflow_type').catch(() => []),
  ]);
  dicts.inventory_overflow_type = overflowType as any[];
}

async function loadStocks() {
  if (!form.value.warehouseId || !form.value.orgId) {
    options.stocks = [];
    return;
  }
  options.stocks = (await api
    .get('/inventory/stock-options', {
      params: { warehouseId: form.value.warehouseId, orgId: form.value.orgId },
    })
    .catch(() => [])) as any[];
}

async function searchGoodsOptions(keyword: string) {
  const r: any = await api.get('/goods', { params: { keyword, pageSize: 50, status: 1 } });
  return (r.items ?? []).map((g: any) => ({
    value: g.id,
    label: `${g.queryCode || ''} ${g.goodsName || ''}`.trim(),
  }));
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
  line.batchNo = '';
  line.inventoryQty = 0;
  line.unitPrice = 0;
}

function lineBatchChanged(line: any) {
  const stock = (options.stocks as any[]).find((s) => stockKey(s) === line.stockKey);
  if (!stock) return;
  Object.assign(line, {
    goodsId: stock.goodsId,
    goodsCode: stock.goodsCode,
    goodsName: stock.goodsName,
    skuId: stock.skuId,
    skuSpec: stock.skuSpec,
    batchNo: stock.batchNo,
    unitType: stock.unitType,
    unitName: stock.unitName,
    inventoryQty: Number(stock.inventoryQty ?? 0),
    unitPrice: Number(stock.unitPrice ?? 0),
  });
  recalcLine(line);
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (!form.value.orgId || !form.value.warehouseId) {
    ElMessage.warning('请选择所属组织和仓库');
    return false;
  }
  if (!String(form.value.reason ?? '').trim()) {
    ElMessage.warning('请输入原因');
    return false;
  }
  const details = form.value.details ?? [];
  if (!details.length) {
    ElMessage.warning('至少需要一条明细');
    return false;
  }
  for (const line of details) {
    if (!line.goodsId || !line.skuId) {
      ElMessage.warning('请选择有效库存商品');
      return false;
    }
    if (Number(line.quantity) <= 0) {
      ElMessage.warning('明细数量必须大于 0');
      return false;
    }
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/inventory/overflows';
    const payload: Record<string, any> = { ...form.value };
    const result: any =
      props.mode === 'edit'
        ? await api.patch(`${url}/${form.value.id}`, payload)
        : await api.post(url, payload);
    ElMessage.success(result?.message ?? '保存成功');
    emit('saved');
  } catch {
    // axios 拦截器已提示
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const [orgs, warehouses, departments] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/warehouses/options').catch(() => []),
    api.get('/base-data/departments/options').catch(() => []),
  ]);
  options.orgs = orgs;
  options.warehouses = warehouses;
  options.departments = departments;
  await loadDicts();

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      warehouseId: '',
      deptId: auth.user?.deptId ?? '',
      documentType: dicts.inventory_overflow_type?.[0]?.value ?? '',
      date: dateText(new Date()),
      reason: '',
      remark: '',
    });
    if (!(form.value.details ?? []).length) form.value.details = [blankLine()];
  } else if (form.value.id) {
    const detail: any = await api
      .get(`/inventory/overflows/${form.value.id}`)
      .catch(() => null);
    if (detail) {
      Object.assign(form.value, detail);
      form.value.documentType =
        form.value.documentType == null || form.value.documentType === ''
          ? ''
          : String(form.value.documentType);
    }
    form.value.details = (form.value.details ?? []).map((line: any) => {
      const mapped = { ...blankLine(), ...line };
      mapped.stockKey = stockKey({
        goodsId: line.goodsId,
        skuId: line.skuId,
        warehouseId: form.value.warehouseId,
        batchNo: line.batchNo ?? '',
      });
      recalcLine(mapped);
      return mapped;
    });
  }
  await loadStocks();
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="单据类型">
        <el-select v-model="form.documentType" :disabled="isView">
          <el-option
            v-for="item in dicts.inventory_overflow_type || []"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="所属组织" required>
        <el-select
          v-model="form.orgId"
          :disabled="isView"
          @change="
            form.warehouseId = '';
            loadStocks();
          "
        >
          <el-option v-for="x in options.orgs" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || !form.orgId"
          @change="loadStocks"
        >
          <el-option
            v-for="x in filteredWarehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="部门">
        <el-select v-model="form.deptId" filterable :disabled="isView">
          <el-option
            v-for="x in options.departments"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="日期">
        <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" :disabled="isView" />
      </el-form-item>
      <el-form-item label="原因" required class="span-2">
        <el-input v-model="form.reason" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
      <el-form-item label="备注" class="span-2">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">明细</span>
      <el-button v-if="!isView" link type="primary" @click="addLine">+ 添加明细</el-button>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="210">
        <template #default="s">
          <RemoteSelect
            v-if="!isView"
            v-model="s.row.goodsId"
            :fetch="searchGoodsOptions"
            :current-label="s.row.goodsName || s.row.goodsId"
            :disabled="isView"
            @change="lineGoodsChanged(s.row)"
          />
          <span v-else>{{ s.row.goodsName || s.row.goodsId || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="120">
        <template #default="s">{{ s.row.skuSpec || s.row.skuId || '—' }}</template>
      </el-table-column>
      <el-table-column label="批号" min-width="200">
        <template #default="s">
          <el-select
            v-if="!isView"
            v-model="s.row.stockKey"
            filterable
            placeholder="选择库存批次"
            @change="lineBatchChanged(s.row)"
          >
            <el-option
              v-for="x in lineStockOptions(s.row)"
              :key="stockKey(x)"
              :label="`${x.batchNo || '无批号'} · 库存 ${x.inventoryQty}`"
              :value="stockKey(x)"
            />
          </el-select>
          <span v-else>{{ s.row.batchNo || '无批号' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="当前库存" width="95">
        <template #default="s">{{ Number(s.row.inventoryQty ?? 0).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="单价" width="130">
        <template #default="s">
          <el-input-number
            v-model="s.row.unitPrice"
            :min="0"
            :precision="2"
            :disabled="isView"
            @change="recalcLine(s.row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="数量" width="130">
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
      <el-table-column label="金额" width="110">
        <template #default="s">{{ Number(s.row.amount ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}</template>
      </el-table-column>
      <el-table-column label="备注" min-width="130">
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
