<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { recordAmountMasked, useAuthStore } from '@/stores/auth';
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
  depts: [],
  users: [],
  units: [],
  stocks: [],
  orders: [],
  destinationDict: [],
});

const isView = computed(() => props.mode === 'view');
const canEditAmount = computed(() => auth.amountAccess.canEditAmount);
/** 记录级金额掩码：无查看权，或（范围 own 且单据非本人创建）→ 金额统一以 **** 呈现 */
const amountHidden = computed(() => recordAmountMasked(form.value));

function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    unitType: 0,
    batchNo: '',
    quantity: 1,
    price: 0,
    orderQty: 0,
    historicalQty: 0,
    remainingQty: null,
    remark: '',
    stockKey: '',
  };
}

function nid(v: unknown) {
  return v == null || v === '' || v === 0 || v === '0' ? '' : v;
}

/** sales_order_type=4 无需出库，不能办理销售出库 */
function isNoOutputOrder(order: { orderType?: unknown }) {
  return Number(order.orderType) === 4;
}

function stockKeyOf(line: any, warehouseId: unknown) {
  return line.goodsId && line.skuId && warehouseId && line.batchNo
    ? `${line.goodsId}-${line.skuId}-${warehouseId}-${line.batchNo}`
    : '';
}

function stockChanged(line: any) {
  const s = options.stocks.find(
    (x: any) => `${x.goodsId}-${x.skuId}-${x.warehouseId}-${x.batchNo}` === line.stockKey,
  );
  if (s)
    Object.assign(line, {
      goodsId: s.goodsId,
      skuId: s.skuId,
      unitType: s.unitType,
      batchNo: s.batchNo,
      warehouseId: s.warehouseId,
    });
}

function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}

/** 按组织加载仓库/部门选项（走后端），组织为空时清空 */
async function loadOrgOptions(orgId: unknown) {
  if (!orgId) {
    options.warehouses = [];
    options.depts = [];
    options.users = [];
    return;
  }
  const [warehouses, depts, users] = await Promise.all([
    api.get('/base-data/warehouses/options', { params: { orgId: String(orgId) } }).catch(() => []),
    api.get('/base-data/departments/options', { params: { orgId: String(orgId) } }).catch(() => []),
    api.get('/inventory/users/options', { params: { orgId: String(orgId) } }).catch(() => []),
  ]);
  options.warehouses = warehouses as any[];
  options.depts = depts as any[];
  options.users = users as any[];
}

async function loadStocks() {
  options.stocks = await fetchScopedStockOptions(form.value.orgId, form.value.warehouseId).catch(
    () => [],
  );
}

function toOutputOrderOption(order: any) {
  return {
    value: order.id,
    label: `${order.orderNo ?? ''} · ${order.customerName ?? ''}`.trim(),
  };
}

async function searchSalesOrderOptions(keyword: string) {
  if (!String(keyword ?? '').trim()) {
    return (options.orders as any[]).filter((x) => !isNoOutputOrder(x)).map(toOutputOrderOption);
  }
  const r: any = await api.get('/sales/money-order-options', {
    params: { keyword, pageSize: 50 },
  });
  const items = (Array.isArray(r) ? r : (r.items ?? [])) as any[];
  return items.filter((x) => !isNoOutputOrder(x)).map(toOutputOrderOption);
}

async function enrichGoodsInfo(lines: any[], orderDetails?: any[]) {
  const orderMap = new Map(
    (orderDetails ?? []).map((d: any) => [`${d.goodsId}:${d.skuId}`, d]),
  );
  const ids = [
    ...new Set(
      lines
        .filter((line: any) => !line.goodsName || !line.goodsCode || !line.skuSpec)
        .map((line: any) => String(line.goodsId))
        .filter(Boolean),
    ),
  ];
  const goodsMap = new Map<string, any>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        goodsMap.set(id, await api.get(`/goods/${id}`));
      } catch {
        goodsMap.set(id, null);
      }
    }),
  );
  for (const line of lines) {
    const orderLine = orderMap.get(`${line.goodsId}:${line.skuId}`);
    if (orderLine) {
      line.goodsName ||= orderLine.goodsName ?? '';
      line.goodsCode ||= orderLine.goodsCode ?? '';
      line.skuSpec ||= orderLine.skuSpec ?? '';
      if (!line.unitType) line.unitType = orderLine.unitType ?? 0;
      if (line.price == null) line.price = Number(orderLine.price ?? 0);
    }
    const g = goodsMap.get(String(line.goodsId));
    if (g) {
      line.goodsName = line.goodsName || g.goodsName;
      line.goodsCode = line.goodsCode || g.queryCode;
      const sku =
        (g.skus ?? []).find((s: any) => String(s.id) === String(line.skuId)) ?? g.skus?.[0];
      if (sku) {
        line.skuSpec = line.skuSpec || sku.specModels || '';
        if (!line.unitType) line.unitType = sku.unitType;
      }
    }
    if (line.price == null) line.price = 0;
  }
}

async function orderChanged() {
  if (!form.value.orderId) {
    form.value.details = [];
    return;
  }
  const o: any = await api.get(`/sales/orders/${form.value.orderId}`);
  if (isNoOutputOrder(o)) {
    ElMessage.warning('无需出库订单不能办理销售出库');
    form.value.orderId = '';
    form.value.details = [];
    return;
  }
  Object.assign(form.value, {
    orgId: o.orgId,
    warehouseId: o.warehouseId,
    customerName: o.customerName,
    orderNo: o.orderNo,
    destination: Number(o.propertyType) === 2 ? 2 : Number(form.value.destination ?? 1),
    sourceLocked: Boolean(o.sourceLocked),
  });
  form.value.details = (o.details ?? []).map((x: any) => ({
    ...blankLine(),
    ...x,
    orderQty: x.quantity,
    historicalQty: 0,
    remainingQty: x.quantity,
    quantity: x.quantity,
    stockKey: '',
  }));
  await enrichGoodsInfo(form.value.details);
  await loadOrgOptions(form.value.orgId);
  await loadStocks();
}

function validate() {
  if (!form.value.orderId) {
    ElMessage.warning('请选择销售订单');
    return false;
  }
  if (
    !(form.value.details ?? []).some(
      (line: any) => line.goodsId && line.skuId && line.batchNo && Number(line.quantity) > 0,
    )
  ) {
    ElMessage.warning('请至少选择一条完整的库存批次并填写出库数量');
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/sales/outputs';
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
  const [orgs, units, orders, destinationDict] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api.get('/sales/money-order-options', { params: { pageSize: 100 } }).catch(() => []),
    api.get('/dictionaries/sales_output_destination').catch(() => []),
  ]);
  options.orgs = orgs;
  options.units = units;
  options.orders = Array.isArray(orders) ? orders : ((orders as any).items ?? []);
  options.destinationDict = destinationDict;

  if (props.mode === 'create') {
    Object.assign(form.value, {
      deptId: auth.user?.deptId ?? '',
      receiverId: auth.user?.staffId ?? auth.user?.id ?? '',
      outDate: dateText(new Date()),
      destination: form.value.destination ?? 1,
      remark: '',
    });
    if (form.value.orderId) await orderChanged();
  } else if (form.value.id) {
    const detail: any = await api.get(`/sales/outputs/${form.value.id}`).catch(() => null);
    if (detail) {
      const order: any = await api.get(`/sales/orders/${detail.orderId}`).catch(() => null);
      Object.assign(form.value, detail, {
        warehouseId: String(detail.warehouseId ?? detail.warehouse_id ?? ''),
        deptId: String(nid(detail.deptId ?? detail.dept_id)),
        receiverId: String(nid(detail.receiverId ?? detail.receiver_id)),
        orgId: String(order?.orgId ?? nid(detail.orgId ?? detail.org_id)),
        customerName: order?.customerName ?? detail.customerName ?? '',
        orderNo: order?.orderNo ?? detail.orderNo ?? '',
        sourceLocked: Boolean(order?.sourceLocked ?? detail.sourceLocked),
      });
      form.value.details = (form.value.details ?? []).map((line: any) => {
        const orderLine = (order?.details ?? []).find(
          (item: any) =>
            String(item.goodsId) === String(line.goodsId) &&
            String(item.skuId) === String(line.skuId),
        );
        const orderQty = Number(line.orderQty ?? orderLine?.quantity ?? 0);
        const currentQty = Number(line.quantity ?? 0);
        const confirmedTotal = Number(orderLine?.confirmedOutputQty ?? 0);
        const historicalQty = Math.max(
          0,
          confirmedTotal - (Number(detail.confirmStatus) === 1 ? currentQty : 0),
        );
        return {
          ...line,
          orderQty,
          historicalQty,
          remainingQty: Math.max(0, orderQty - historicalQty),
          price: line.price == null ? Number(orderLine?.price ?? 0) : Number(line.price),
          unitType: line.unitType || orderLine?.unitType || 0,
          stockKey: stockKeyOf(line, form.value.warehouseId),
        };
      });
      await enrichGoodsInfo(form.value.details, order?.details ?? []);
      await loadOrgOptions(form.value.orgId);
      await loadStocks();
    }
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="销售订单" required>
        <el-input v-if="isView" :model-value="form.orderNo || form.orderId || '—'" readonly />
        <RemoteSelect
          v-else
          v-model="form.orderId"
          :fetch="searchSalesOrderOptions"
          :current-label="form.orderNo"
          :disabled="mode !== 'create'"
          placeholder="输入销售订单号或客户搜索"
          @change="orderChanged"
        />
      </el-form-item>
      <el-form-item label="客户">
        <el-input :model-value="form.customerName || '—'" readonly />
      </el-form-item>
      <el-form-item label="仓库" required>
        <el-select v-model="form.warehouseId" filterable disabled>
          <el-option
            v-for="x in options.warehouses"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="出库类型">
        <el-select v-model="form.destination" :disabled="isView || Number(form.destination) === 3">
          <el-option
            v-for="x in options.destinationDict"
            :key="x.value"
            :label="x.label"
            :value="Number(x.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="出库日期" required>
        <el-date-picker
          v-model="form.outDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="部门">
        <el-select v-model="form.deptId" filterable clearable :disabled="isView">
          <el-option v-for="x in options.depts" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="经办/接收人">
        <el-select v-model="form.receiverId" filterable clearable :disabled="isView">
          <el-option v-for="x in options.users" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">出库明细</span>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="180">
        <template #default="s">{{ s.row.goodsName || '—' }}</template>
      </el-table-column>
      <el-table-column label="商品编码" width="125">
        <template #default="s">{{ s.row.goodsCode || '—' }}</template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="120">
        <template #default="s">{{ s.row.skuSpec || s.row.skuId || '—' }}</template>
      </el-table-column>
      <el-table-column label="单位" width="85">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column prop="orderQty" label="计划/订单量" width="115" />
      <el-table-column prop="historicalQty" label="历史已出" width="105" />
      <el-table-column prop="remainingQty" label="剩余可出" width="105" />
      <el-table-column label="库存批次" min-width="190">
        <template #default="s">
          <el-select
            v-if="!isView"
            v-model="s.row.stockKey"
            filterable
            @change="stockChanged(s.row)"
          >
            <el-option
              v-for="x in options.stocks.filter(
                (v: any) =>
                  (!s.row.goodsId || String(v.goodsId) === String(s.row.goodsId)) &&
                  (!form.warehouseId || String(v.warehouseId) === String(form.warehouseId)),
              )"
              :key="`${x.goodsId}-${x.skuId}-${x.warehouseId}-${x.batchNo}`"
              :label="`${x.goodsName} · ${x.batchNo} · ${x.inventoryQty}`"
              :value="`${x.goodsId}-${x.skuId}-${x.warehouseId}-${x.batchNo}`"
            />
          </el-select>
          <span v-else>{{ s.row.batchNo || '无批号' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="数量" width="130">
        <template #default="s">
          <el-input-number
            v-model="s.row.quantity"
            :min="1"
            :max="s.row.remainingQty == null ? undefined : Number(s.row.remainingQty)"
            :precision="0"
            :step="1"
            :disabled="isView"
          />
        </template>
      </el-table-column>
      <el-table-column label="单价" width="120">
        <template #default="s">
          <el-input-number
            v-model="s.row.price"
            :min="0"
            :precision="2"
            :disabled="isView || !canEditAmount"
          />
        </template>
      </el-table-column>
      <el-table-column label="金额" width="110">
        <template #default="s">{{
          moneyText(
            amountHidden ? null : Number(s.row.quantity || 0) * Number(s.row.price || 0),
          )
        }}</template>
      </el-table-column>
      <el-table-column label="备注" min-width="130">
        <template #default="s"><el-input v-model="s.row.remark" :disabled="isView" /></template>
      </el-table-column>
    </el-table>

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
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
