<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText, moneyText } from '@/utils/format';
import RemoteSelect from '@/components/RemoteSelect.vue';

const props = defineProps<{
  modelValue: Record<string, any>;
  mode: 'create' | 'edit' | 'view';
}>();
const emit = defineEmits<{ (e: 'saved'): void; (e: 'cancel'): void }>();

const auth = useAuthStore();
const form = computed(() => props.modelValue);
const saving = ref(false);
const orderLines = ref<any[]>([]);
const options = reactive<Record<string, any>>({
  orgs: [],
  warehouses: [],
  units: [],
  goods: [],
  orders: [],
  salesOutputs: [],
  disposalDict: [],
});

const isView = computed(() => props.mode === 'view');

function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    unitType: 0,
    batchNo: '',
    quantity: 1,
    price: 0,
    orderQty: 0,
    issuedQty: 0,
    historicalQty: 0,
    remainingQty: null,
    remark: '',
  };
}

function nid(v: unknown) {
  return v == null || v === '' || v === 0 || v === '0' ? '' : v;
}

function goodsOf(line: any) {
  return options.goods.find((g: any) => String(g.id) === String(line.goodsId)) ?? {};
}

function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}

const warehouseOptions = computed(() =>
  (options.warehouses as any[]).filter(
    (item: any) =>
      !form.value.orgId ||
      String(item.raw?.orgId ?? item.orgId ?? '') === String(form.value.orgId),
  ),
);

async function searchSalesOrderOptions(keyword: string) {
  if (!String(keyword ?? '').trim()) {
    return (options.orders as any[]).map((x: any) => ({
      value: x.id,
      label: `${x.orderNo ?? ''} · ${x.customerName ?? ''}`.trim(),
    }));
  }
  const r: any = await api.get('/sales/money-order-options', {
    params: { keyword, pageSize: 50 },
  });
  const items = (Array.isArray(r) ? r : r.items ?? []) as any[];
  return items.map((x: any) => ({
    value: x.id,
    label: `${x.orderNo ?? ''} · ${x.customerName ?? ''}`.trim(),
  }));
}

async function enrichGoodsInfo(lines: any[], orderDetails?: any[]) {
  const ids = [...new Set(lines.map((l: any) => String(l.goodsId)).filter(Boolean))];
  const priceMap = new Map(
    (orderDetails ?? []).map((d: any) => [`${d.goodsId}:${d.skuId}`, Number(d.price ?? 0)]),
  );
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
    if (line.price == null) line.price = priceMap.get(`${line.goodsId}:${line.skuId}`) ?? 0;
  }
}

async function loadOrderInfo(orderId: unknown) {
  const o: any = await api.get(`/sales/orders/${orderId}`);
  Object.assign(form.value, {
    orgId: o.orgId,
    warehouseId: o.warehouseId,
    customerName: o.customerName,
    orderNo: o.orderNo,
  });
  orderLines.value = o.details ?? [];
  options.salesOutputs = (await api
    .get('/sales/output-options', { params: { orderId } })
    .catch(() => [])) as any[];
  return o;
}

async function orderChanged() {
  form.value.sourceOutputId = '';
  form.value.details = [];
  if (!form.value.orderId) return;
  await loadOrderInfo(form.value.orderId);
}

async function sourceOutputChanged() {
  const sid = form.value.sourceOutputId;
  if (!sid) {
    form.value.details = [];
    return;
  }
  const out: any = await api.get(`/sales/outputs/${sid}`);
  Object.assign(form.value, { warehouseId: out.warehouseId });
  if (String(form.value.orderId ?? '') !== String(out.orderId ?? '')) {
    form.value.orderId = out.orderId;
    await loadOrderInfo(out.orderId);
  }
  form.value.details = (out.details ?? [])
    .map((x: any) => {
      const historicalQty = Number(x.returnedQuantity ?? 0);
      const remainingQty = Number(
        x.remainingReturnQuantity ?? Math.max(0, Number(x.quantity) - historicalQty),
      );
      return {
        ...blankLine(),
        ...x,
        orderQty: x.orderQty,
        issuedQty: x.quantity,
        historicalQty,
        remainingQty,
        quantity: remainingQty,
      };
    })
    .filter((line: any) => Number(line.remainingQty) > 0);
  if (!form.value.details.length) ElMessage.warning('该销售出库单已无可退数量');
  await enrichGoodsInfo(form.value.details, orderLines.value);
}

function validate() {
  if (!form.value.orderId) {
    ElMessage.warning('请选择销售订单');
    return false;
  }
  if (!form.value.sourceOutputId) {
    ElMessage.warning('请选择来源已确认销售出库单');
    return false;
  }
  if (!String(form.value.reason ?? '').trim()) {
    ElMessage.warning('请填写退货原因');
    return false;
  }
  if (
    !(form.value.details ?? []).some(
      (line: any) => line.goodsId && line.skuId && line.batchNo && Number(line.quantity) > 0,
    )
  ) {
    ElMessage.warning('请至少填写一条退货明细');
    return false;
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/sales/returns';
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
  const [orgs, warehouses, units, goodsResult, orders, disposalDict] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/warehouses/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api
      .get('/goods', { params: { pageSize: 100, status: 1 } })
      .catch(() => ({ items: [] as any[] })),
    api.get('/sales/money-order-options', { params: { pageSize: 100 } }).catch(() => []),
    api.get('/dictionaries/sales_return_disposal').catch(() => []),
  ]);
  options.orgs = orgs;
  options.warehouses = warehouses;
  options.units = units;
  options.goods = (goodsResult as any).items ?? [];
  options.orders = Array.isArray(orders) ? orders : ((orders as any).items ?? []);
  options.disposalDict = disposalDict;

  if (props.mode === 'create') {
    Object.assign(form.value, {
      returnDate: dateText(new Date()),
      disposalType: form.value.disposalType ?? 1,
      reason: '',
      remark: '',
    });
    if (form.value.orderId) await orderChanged();
    if (form.value.outputId) {
      form.value.sourceOutputId = form.value.outputId;
      await sourceOutputChanged();
    }
  } else if (form.value.id) {
    const detail: any = await api.get(`/sales/returns/${form.value.id}`).catch(() => null);
    if (detail) {
      Object.assign(form.value, detail, {
        orderId: detail.orderId ?? detail.so_id,
        sourceOutputId: detail.sourceOutputId ?? detail.source_output_id,
        warehouseId: detail.warehouseId ?? detail.warehouse_id,
        disposalType: detail.disposalType ?? detail.disposal_type ?? 1,
        reason: detail.reason ?? detail.exit_reson ?? '',
        returnDate: detail.exit_date
          ? dateText(detail.exit_date)
          : detail.returnDate ?? dateText(new Date()),
        orgId: nid(detail.orgId ?? detail.org_id),
        customerName: detail.customerName ?? detail.customer_name ?? '',
      });
      if (form.value.orderId) await loadOrderInfo(form.value.orderId);
      await enrichGoodsInfo(form.value.details ?? [], orderLines.value);
    }
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="销售订单" required>
        <RemoteSelect
          v-model="form.orderId"
          :fetch="searchSalesOrderOptions"
          :current-label="form.orderNo"
          :disabled="mode !== 'create'"
          placeholder="输入销售订单号或客户搜索"
          @change="orderChanged"
        />
      </el-form-item>
      <el-form-item label="来源已确认销售出库单" required>
        <el-select
          v-model="form.sourceOutputId"
          filterable
          :disabled="mode !== 'create'"
          @change="sourceOutputChanged"
        >
          <el-option v-for="x in options.salesOutputs" :key="x.id" :label="x.outputNo" :value="x.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="客户">
        <el-input :model-value="form.customerName || '—'" readonly />
      </el-form-item>
      <el-form-item label="仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || !form.orgId"
        >
          <el-option v-for="x in warehouseOptions" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="退货日期" required>
        <el-date-picker
          v-model="form.returnDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="退货后处理">
        <el-select v-model="form.disposalType" :disabled="isView">
          <el-option
            v-for="x in options.disposalDict"
            :key="x.value"
            :label="x.label"
            :value="Number(x.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="原因" required class="span-2">
        <el-input v-model="form.reason" maxlength="255" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">退货明细</span>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="180">
        <template #default="s">{{ goodsOf(s.row).goodsName || s.row.goodsName || '—' }}</template>
      </el-table-column>
      <el-table-column label="商品编码" width="125">
        <template #default="s">{{ goodsOf(s.row).queryCode || s.row.goodsCode || '—' }}</template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="120">
        <template #default="s">{{ s.row.skuSpec || s.row.skuId || '—' }}</template>
      </el-table-column>
      <el-table-column label="单位" width="85">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column prop="issuedQty" label="已领/订单量" width="115" />
      <el-table-column prop="historicalQty" label="历史已退" width="105" />
      <el-table-column prop="remainingQty" label="可退数量" width="105" />
      <el-table-column label="库存批次" min-width="160">
        <template #default="s">{{ s.row.batchNo || '无批号' }}</template>
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
      <el-table-column label="单价" width="110">
        <template #default="s">{{ moneyText(Number(s.row.price || 0)) }}</template>
      </el-table-column>
      <el-table-column label="金额" width="110">
        <template #default="s">{{
          moneyText(Number(s.row.quantity || 0) * Number(s.row.price || 0))
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
