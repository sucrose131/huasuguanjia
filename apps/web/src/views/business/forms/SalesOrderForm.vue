<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText, moneyText } from '@/utils/format';
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
  customers: [],
  goodsSkus: [],
  units: [],
  contextGoods: [],
  stocks: [],
});
const dicts = reactive<Record<string, any[]>>({});

const isView = computed(() => props.mode === 'view');
const canEditAmount = computed(() => auth.amountAccess.canEditAmount);

function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    unitType: 0,
    quantity: 1,
    price: 0,
    factAmount: null,
    remark: '',
  };
}
function lineActual(line: any) {
  return line.factAmount == null
    ? Number(line.quantity || 0) * Number(line.price || 0)
    : Number(line.factAmount);
}
function lineUnitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}
const orderTotals = computed(() => {
  const quantity = (form.value.details ?? []).reduce(
    (s: number, x: any) => s + Number(x.quantity || 0),
    0,
  );
  const orderAmount = (form.value.details ?? []).reduce(
    (s: number, x: any) => s + Number(x.quantity || 0) * Number(x.price || 0),
    0,
  );
  const discount = (form.value.details ?? []).reduce(
    (s: number, x: any) =>
      s + Math.max(0, Number(x.quantity || 0) * Number(x.price || 0) - lineActual(x)),
    0,
  );
  const factAmount = (form.value.details ?? []).reduce((s: number, x: any) => s + lineActual(x), 0);
  return { quantity, orderAmount, discount, factAmount };
});

async function loadDicts() {
  const codes = [
    'sales_order_type',
    'sales_order_source',
    'sales_order_property',
    'sales_order_status',
    'sales_delivery_status',
    'sales_service_status',
  ];
  const values = await Promise.all(
    codes.map((code) => api.get(`/dictionaries/${code}`).catch(() => [])),
  );
  codes.forEach((code, index) => (dicts[code] = values[index] as any[]));
}

async function customerChanged() {
  if (!form.value.customerId) return;
  const c: any = await api.get(`/base-data/customers/${form.value.customerId}`);
  const nextOrgId = c.orgId ?? c.org_id ?? form.value.orgId;
  const orgChanged = String(nextOrgId ?? '') !== String(form.value.orgId ?? '');
  Object.assign(form.value, {
    customerMobile: c.mobile ?? '',
    customerAddress: c.address ?? '',
    orgId: nextOrgId,
  });
  if (orgChanged) await organizationChanged();
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

async function organizationChanged() {
  form.value.warehouseId = '';
  form.value.details = [blankLine()];
  options.contextGoods = [];
  options.stocks = [];
  await loadOrgWarehouses(form.value.orgId);
}

async function warehouseChanged() {
  form.value.details = [blankLine()];
  await Promise.all([loadContextGoods(), loadScopedStocks()]);
}

async function loadScopedStocks() {
  options.stocks = await fetchScopedStockOptions(form.value.orgId, form.value.warehouseId).catch(
    () => [],
  );
}

/** 按单据组织+仓库加载匹配商品（后端按分类仓库类型过滤），未选组织/仓库时清空 */
async function loadContextGoods() {
  if (!form.value.orgId || !form.value.warehouseId) {
    options.contextGoods = [];
    return;
  }
  options.contextGoods = (await api
    .get('/sales/product-options', {
      params: { orgId: form.value.orgId, warehouseId: form.value.warehouseId },
    })
    .catch(() => [])) as any[];
}

async function lineGoodsChanged(line: any) {
  if (!line.goodsId) return;
  const g: any = await api.get(`/goods/${line.goodsId}`);
  options.goodsSkus = g.skus ?? [];
  const sku = (g.skus ?? []).find((x: any) => x.isDefault === 1) ?? g.skus?.[0];
  if (sku) {
    line.skuId = sku.id;
    line.unitType = sku.unitType;
    line.price = Number(sku.salePrice ?? 0);
  }
  line.goodsCode = g.queryCode ?? '';
  line.goodsName = g.goodsName ?? '';
  line.skuSpec = sku?.specModels ?? '';
}

function refreshAvailableStock(line: any) {
  if (!form.value.warehouseId || !line.goodsId || !line.skuId) {
    line.availableStock = null;
    return;
  }
  line.availableStock = options.stocks
    ?.filter(
      (stock: any) =>
        String(stock.warehouseId) === String(form.value.warehouseId) &&
        String(stock.goodsId) === String(line.goodsId) &&
        String(stock.skuId) === String(line.skuId),
    )
    .reduce((sum: number, stock: any) => sum + Number(stock.inventoryQty ?? 0), 0);
}
function stockChanged(line: any) {
  refreshAvailableStock(line);
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

async function searchGoodsOptions(keyword: string) {
  const kw = String(keyword ?? '')
    .trim()
    .toLowerCase();
  const list = options.contextGoods.filter((g: any) =>
    kw ? `${g.queryCode ?? ''} ${g.goodsName ?? ''}`.toLowerCase().includes(kw) : true,
  );
  return list.map((g: any) => ({
    value: g.id,
    label: `${g.queryCode || ''} ${g.goodsName ?? ''}`.trim(),
  }));
}

function validate() {
  if (!form.value.customerId) {
    ElMessage.warning('请选择客户');
    return false;
  }
  if (!form.value.orgId || !form.value.warehouseId) {
    ElMessage.warning('请选择所属组织和仓库');
    return false;
  }
  if (!(form.value.details ?? []).length) {
    ElMessage.warning('请至少录入一条商品明细');
    return false;
  }
  const keys = new Set<string>();
  for (const line of form.value.details) {
    if (!line.goodsId || !line.skuId || !(Number(line.quantity) > 0)) {
      ElMessage.warning('请完整填写每条明细的商品、SKU和销售数量');
      return false;
    }
    const key = `${line.goodsId}-${line.skuId}`;
    if (keys.has(key)) {
      ElMessage.warning('同一商品和SKU不能重复录入销售订单');
      return false;
    }
    keys.add(key);
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const payload: Record<string, any> = { ...form.value };
    const url = '/sales/orders';
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
  const [orgs, customers, units] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/customers/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
  ]);
  options.orgs = orgs;
  options.customers = customers;
  options.units = units;
  await loadDicts();

  if (props.mode === 'create') {
    Object.assign(form.value, {
      orgId: auth.user?.orgId ?? '',
      warehouseId: '',
      customerId: '',
      customerMobile: '',
      customerAddress: '',
      salesName: '',
      orderDate: dateText(new Date()),
      sourceType: 4,
      propertyType: 1,
      remark: '',
      details: [blankLine()],
    });
    if (form.value.orderId) {
      // 深链创建（直接出库/收款等）暂不支持从订单预填
    }
  } else if (form.value.id) {
    const detail: any = await api.get(`/sales/orders/${form.value.id}`).catch(() => null);
    if (detail) Object.assign(form.value, detail);
    form.value.details = (form.value.details ?? []).map((x: any) => ({
      ...blankLine(),
      ...x,
      factAmount: x.factAmount == null ? null : Number(x.factAmount),
    }));
  }
  await loadOrgWarehouses(form.value.orgId);
  await Promise.all([loadContextGoods(), loadScopedStocks()]);
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="客户" required>
        <el-select
          v-model="form.customerId"
          filterable
          :disabled="isView"
          @change="customerChanged"
        >
          <el-option
            v-for="x in options.customers"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="所属组织" required>
        <el-select
          v-model="form.orgId"
          filterable
          :disabled="isView || Boolean(form.orderId)"
          @change="organizationChanged"
        >
          <el-option v-for="x in options.orgs" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || !form.orgId"
          @change="warehouseChanged"
        >
          <el-option
            v-for="x in options.warehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="订单日期" required>
        <el-date-picker
          v-model="form.orderDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="订单来源">
        <el-select v-model="form.sourceType" :disabled="isView">
          <el-option
            v-for="item in dicts.sales_order_source || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="订单属性">
        <el-select v-model="form.propertyType" disabled>
          <el-option
            v-for="item in dicts.sales_order_property || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="客户手机">
        <el-input v-model="form.customerMobile" :disabled="isView" />
      </el-form-item>
      <el-form-item label="经办人">
        <el-input v-model="form.salesName" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">商品明细</span>
      <el-button v-if="!isView" link type="primary" @click="addLine">+ 添加商品</el-button>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="220">
        <template #default="s">
          <RemoteSelect
            v-model="s.row.goodsId"
            :fetch="searchGoodsOptions"
            :current-label="s.row.goodsName || '—'"
            :disabled="isView || !form.warehouseId"
            placeholder="请先选择组织与仓库，再搜索商品"
            @change="lineGoodsChanged(s.row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="商品编码" width="125">
        <template #default="s">{{ s.row.goodsCode || '—' }}</template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="125">
        <template #default="s">{{
          s.row.skuSpec || s.row.goodsSpec || s.row.skuId || '—'
        }}</template>
      </el-table-column>
      <el-table-column label="单位" width="90">
        <template #default="s">{{ lineUnitName(s.row) }}</template>
      </el-table-column>
      <el-table-column label="销售单价" width="130">
        <template #default="s">
          <el-input-number
            v-model="s.row.price"
            :min="0"
            :precision="2"
            :disabled="isView || !canEditAmount"
          />
        </template>
      </el-table-column>
      <el-table-column label="金额" width="120">
        <template #default="s">{{
          moneyText(Number(s.row.quantity || 0) * Number(s.row.price || 0))
        }}</template>
      </el-table-column>
      <el-table-column label="可用库存" width="100">
        <template #default="s">
          {{
            s.row.availableStock == null
              ? '—'
              : Number(s.row.availableStock).toLocaleString('zh-CN')
          }}
        </template>
      </el-table-column>
      <!-- 供应方式/商品形态：后端详情接口未富化这两类字段，且已不再加载全量商品列表反查，缺失时显示 '—' -->
      <el-table-column label="供应方式" width="110">
        <template #default="s">—</template>
      </el-table-column>
      <el-table-column label="商品形态" width="110">
        <template #default="s">—</template>
      </el-table-column>
      <el-table-column label="数量" width="130">
        <template #default="s">
          <el-input-number
            v-model="s.row.quantity"
            :min="1"
            :precision="0"
            :step="1"
            :disabled="isView"
            @change="stockChanged(s.row)"
          />
        </template>
      </el-table-column>
      <el-table-column label="备注" min-width="140">
        <template #default="s"><el-input v-model="s.row.remark" :disabled="isView" /></template>
      </el-table-column>
      <el-table-column v-if="!isView" label="" width="60">
        <template #default="s">
          <el-button link type="danger" @click="removeLine(s.$index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="(form.details ?? []).length" class="order-totals">
      <span
        >合计数量：<strong>{{ orderTotals.quantity.toLocaleString('zh-CN') }}</strong></span
      >
      <span
        >订单金额：<strong>¥ {{ moneyText(orderTotals.orderAmount) }}</strong></span
      >
      <span
        >旧物折价金额：<strong>¥ {{ moneyText(orderTotals.discount) }}</strong></span
      >
      <span
        >实付金额：<strong>¥ {{ moneyText(orderTotals.factAmount) }}</strong></span
      >
    </div>

    <div class="form-grid" style="margin-top: 12px">
      <el-form-item label="备注" class="span-2">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>

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
.order-totals {
  display: flex;
  gap: 20px;
  margin-top: 10px;
  font-size: 13px;
  color: #606266;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
