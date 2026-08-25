<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import { filterGoodsByWarehouseType, warehouseTypeOf } from '@/utils/goods-warehouse';
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
  depts: [],
  warehouses: [],
  vendors: [],
  units: [],
  receivers: [],
  contextGoods: [],
});
const dicts = reactive<Record<string, any[]>>({});
const isView = computed(() => props.mode === 'view');
const canEditAmount = computed(() => auth.amountAccess.canEditAmount);
const canViewAmount = computed(() => auth.amountAccess.canViewAmount);

function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    unitType: 0,
    quantity: 1,
    totalAmount: 0,
    goodsCode: '',
    goodsName: '',
    skuSpec: '',
    remark: '',
    goodsWarehouseType: 0,
  };
}

function lineAmount(line: any) {
  return Number(Number(line.totalAmount ?? 0).toFixed(2));
}

function lineUnitPrice(line: any) {
  const quantity = Number(line.quantity ?? 0);
  return quantity > 0 ? Number((lineAmount(line) / quantity).toFixed(2)) : 0;
}

const orderTotal = computed(() =>
  (form.value.details ?? []).reduce((sum: number, line: any) => sum + lineAmount(line), 0),
);
const orderQuantity = computed(() =>
  (form.value.details ?? []).reduce((sum: number, line: any) => sum + Number(line.quantity ?? 0), 0),
);

async function loadDicts() {
  const [arrivalType, settlementType] = await Promise.all([
    api.get('/dictionaries/purchase_arrival_type').catch(() => []),
    api.get('/dictionaries/purchase_settlement_type').catch(() => []),
  ]);
  dicts.purchase_arrival_type = arrivalType as any[];
  dicts.purchase_settlement_type = settlementType as any[];
}

async function loadOrgScopedOptions(orgId: unknown) {
  if (!orgId) {
    options.depts = [];
    options.warehouses = [];
    return;
  }
  const [depts, warehouses] = await Promise.all([
    api.get('/base-data/departments/options', { params: { orgId } }).catch(() => []),
    api.get('/base-data/warehouses/options', { params: { orgId } }).catch(() => []),
  ]);
  options.depts = depts as any[];
  options.warehouses = warehouses as any[];
}

function organizationChanged() {
  form.value.deptId = '';
  form.value.warehouseId = '';
  form.value.details = [blankLine()];
  options.contextGoods = [];
  loadOrgScopedOptions(form.value.orgId);
  loadContextGoods();
}

/** 按单据组织加载全部可用商品（后端返回分类 warehouse_type，供仓库兼容匹配），组织为空时清空 */
async function loadContextGoods() {
  if (!form.value.orgId) {
    options.contextGoods = [];
    return;
  }
  options.contextGoods = (await api
    .get('/purchase/all-goods-options', { params: { orgId: String(form.value.orgId) } })
    .catch(() => [])) as any[];
}

/** 明细商品的唯一分类仓库类型：全部同类型则返回该类型（仓库只能选该类型），否则 0（不限） */
const documentWarehouseType = computed(() => {
  const types = new Set(
    (form.value.details ?? [])
      .map((line: any) => Number(line.goodsWarehouseType ?? 0))
      .filter(Boolean),
  );
  return types.size === 1 ? [...types][0] : 0;
});

/** 当前所选仓库的类型（双向联动：选仓库后商品按该类型过滤；未选仓库为 0=不限） */
const selectedWarehouseType = computed(() =>
  warehouseTypeOf(options.warehouses ?? [], form.value.warehouseId),
);

/** 仓库选项：按明细商品分类类型过滤（先选商品后选仓库场景） */
const warehouseOptions = computed(() =>
  (options.warehouses ?? []).filter(
    (w: any) =>
      !documentWarehouseType.value ||
      Number(w.raw?.warehouseType ?? w.warehouseType ?? 0) === documentWarehouseType.value,
  ),
);

function warehouseChanged() {
  // 先选商品后选仓库：换仓库只校验兼容性，不清空明细
  const current = warehouseOptions.value.find(
    (w: any) => String(w.value) === String(form.value.warehouseId),
  );
  if (documentWarehouseType.value && !current) {
    form.value.warehouseId = '';
    ElMessage.warning('所选仓库类型与明细商品不匹配，请重新选择仓库');
  }
}

async function searchGoodsOptions(keyword: string) {
  const kw = String(keyword ?? '').trim().toLowerCase();
  const list = filterGoodsByWarehouseType(
    options.contextGoods,
    selectedWarehouseType.value,
  ).filter((g: any) =>
    kw ? `${g.queryCode ?? ''} ${g.goodsName ?? ''}`.toLowerCase().includes(kw) : true,
  );
  return list.map((g: any) => ({
    value: g.id,
    label: `${g.queryCode || ''} ${g.goodsName || ''}`.trim(),
  }));
}

async function lineGoodsChanged(line: any) {
  line.skuId = '';
  line.unitType = 0;
  line.goodsCode = '';
  line.goodsName = '';
  line.skuSpec = '';
  line.goodsWarehouseType = 0;
  if (!line.goodsId) return;
  const matched = (options.contextGoods ?? []).find(
    (g: any) => String(g.id) === String(line.goodsId),
  );
  line.goodsWarehouseType = Number(matched?.categoryWarehouseType ?? 0);
  const g: any = await api.get(`/goods/${line.goodsId}`);
  const sku = (g.skus ?? []).find((x: any) => x.isDefault === 1) ?? g.skus?.[0];
  line.skuId = sku?.id ?? '';
  line.unitType = sku?.unitType ?? 0;
  line.goodsCode = g.queryCode ?? '';
  line.goodsName = g.goodsName ?? '';
  line.skuSpec = sku?.specModels ?? '';
  if (canEditAmount.value && !Number(line.totalAmount)) {
    line.totalAmount = Number(
      (Number(sku?.costPrice ?? g.costPrice ?? 0) * Number(line.quantity ?? 0)).toFixed(2),
    );
  }
  // 商品分类类型变化后，若已选仓库类型不匹配则清空仓库
  if (form.value.warehouseId && documentWarehouseType.value) {
    const current = (options.warehouses ?? []).find(
      (w: any) => String(w.value) === String(form.value.warehouseId),
    );
    if (
      !current ||
      Number(current.raw?.warehouseType ?? current.warehouseType ?? 0) !==
        documentWarehouseType.value
    ) {
      form.value.warehouseId = '';
      ElMessage.warning('明细商品类型已变化，请重新选择匹配的仓库');
    }
  }
}

async function enrichLine(line: any) {
  if (!line.goodsId) return;
  try {
    const g: any = await api.get(`/goods/${line.goodsId}`);
    const sku =
      (g.skus ?? []).find((x: any) => String(x.id) === String(line.skuId)) ?? g.skus?.[0];
    line.goodsCode = line.goodsCode || g.queryCode || '';
    line.goodsName = line.goodsName || g.goodsName || '';
    line.skuSpec = sku?.specModels ?? '';
    if (!line.skuId) line.skuId = sku?.id ?? '';
    if (!Number(line.unitType)) line.unitType = sku?.unitType ?? 0;
  } catch {
    // 商品不存在时保留原始值
  }
}

function unitName(line: any) {
  const unit = options.units.find((u: any) => String(u.value ?? u.id) === String(line.unitType));
  return unit?.label ?? unit?.name ?? '—';
}

function normalizeOrder(data: any) {
  const planArrivalDate = data.planArrivalDate ?? data.plan_arrival_date;
  const planPayDate = data.planPayDate ?? data.plan_pay_date;
  return {
    ...data,
    id: data.id ?? data.po_id,
    applicationId: data.applicationId ?? data.pur_id ?? '',
    orgId: data.orgId ?? data.org_id,
    deptId: data.deptId ?? data.dept_id,
    warehouseId: data.warehouseId ?? data.warehouse_id,
    receiverId: data.receiverId ?? data.receiver_id,
    vendorId: data.vendorId ?? data.vendor_id,
    arrivalType: data.arrivalType ?? data.arrival_type,
    planArrivalDate: planArrivalDate ? dateText(planArrivalDate) : '',
    deliveryType: data.deliveryType ?? data.delivery_type,
    deliveryNo: data.deliveryNo ?? data.delivery_no,
    paymentType: data.paymentType ?? data.pay_type,
    planPayDate: planPayDate ? dateText(planPayDate) : '',
  };
}

async function applicationChanged() {
  if (!form.value.applicationId) return;
  const source: any = await api.get(`/purchase/applications/${form.value.applicationId}`);
  Object.assign(form.value, {
    orgId: source.orgId ?? source.org_id ?? '',
    deptId: source.deptId ?? source.dept_id ?? '',
    warehouseId: source.warehouseId ?? source.warehouse_id ?? '',
    applicationNo: source.applicationNo ?? '',
  });
  await loadOrgScopedOptions(form.value.orgId);
  form.value.details = (source.details ?? []).map((line: any) => ({
    ...blankLine(),
    goodsId: line.goodsId,
    skuId: line.skuId,
    unitType: line.unitType,
    quantity: Number(line.quantity ?? 0),
    totalAmount: Number(
      (Number(line.referencePrice ?? 0) * Number(line.quantity ?? 0)).toFixed(2),
    ),
    remark: line.remark ?? '',
    goodsWarehouseType: Number(line.goodsWarehouseType ?? 0),
  }));
  await Promise.all(form.value.details.map((line: any) => enrichLine(line)));
  await loadContextGoods();
}

function addLine() {
  (form.value.details ??= []).push(blankLine());
}
function removeLine(index: number) {
  form.value.details.splice(index, 1);
}

function validate() {
  if (!form.value.vendorId) {
    ElMessage.warning('请选择供应商');
    return false;
  }
  if (!form.value.orgId || !form.value.deptId) {
    ElMessage.warning('请选择所属组织和部门');
    return false;
  }
  const hasGoods = (form.value.details ?? []).some((line: any) => line.goodsId);
  if (!form.value.warehouseId) {
    ElMessage.warning(
      hasGoods ? '请选择与商品匹配的目标仓库' : '请选择所属组织、目标仓库和部门',
    );
    return false;
  }
  if (hasGoods && documentWarehouseType.value) {
    const current = (options.warehouses ?? []).find(
      (w: any) => String(w.value) === String(form.value.warehouseId),
    );
    if (
      !current ||
      Number(current.raw?.warehouseType ?? current.warehouseType ?? 0) !==
        documentWarehouseType.value
    ) {
      ElMessage.warning('所选仓库类型与明细商品不匹配，请重新选择仓库');
      return false;
    }
  }
  if (!form.value.planArrivalDate) {
    ElMessage.warning('请选择计划到货日期');
    return false;
  }
  if (!(form.value.details ?? []).length) {
    ElMessage.warning('至少需要一条采购明细');
    return false;
  }
  for (const line of form.value.details) {
    if (!line.goodsId || !line.skuId) {
      ElMessage.warning('请选择商品和规格');
      return false;
    }
    if (!(Number(line.quantity) > 0)) {
      ElMessage.warning('明细数量必须大于 0');
      return false;
    }
    if (!(Number(line.totalAmount) > 0)) {
      ElMessage.warning('明细总金额必须大于 0');
      return false;
    }
  }
  return true;
}

async function save() {
  if (!validate()) return;
  saving.value = true;
  try {
    const url = '/purchase/orders';
    const payload: Record<string, any> = {
      ...form.value,
      details: (form.value.details ?? []).map((line: any) => ({
        ...line,
        quantity: Number(line.quantity),
        totalAmount: lineAmount(line),
        unitPrice: lineUnitPrice(line),
      })),
    };
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
  const [orgs, units, vendors, receivers] = await Promise.all([
    api.get('/base-data/organizations/options').catch(() => []),
    api.get('/base-data/units/options').catch(() => []),
    api.get('/base-data/vendors/options').catch(() => []),
    api.get('/purchase/receiver-options').catch(() => []),
  ]);
  options.orgs = orgs as any[];
  options.units = units as any[];
  options.vendors = vendors as any[];
  options.receivers = receivers as any[];
  await loadDicts();

  if (props.mode === 'create') {
    Object.assign(form.value, {
      applicationId: form.value.applicationId ?? '',
      orgId: form.value.orgId ?? auth.user?.orgId ?? '',
      deptId: form.value.deptId ?? auth.user?.deptId ?? '',
      warehouseId: '',
      receiverId: form.value.receiverId ?? auth.user?.id ?? '',
      vendorId: '',
      arrivalType: 1,
      planArrivalDate: '',
      deliveryType: 1,
      deliveryNo: '',
      paymentType: 1,
      planPayDate: '',
      remark: '',
      details: [blankLine()],
    });
    if (form.value.applicationId) await applicationChanged();
    else await loadOrgScopedOptions(form.value.orgId);
  } else if (form.value.id) {
    const detail: any = await api.get(`/purchase/orders/${form.value.id}`).catch(() => null);
    if (detail) {
      Object.assign(form.value, normalizeOrder(detail));
      form.value.details = (form.value.details ?? []).map((line: any) => ({
        ...line,
        totalAmount: Number(
          line.totalAmount ?? Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0),
        ),
      }));
    }
    if (Array.isArray(form.value.details)) {
      await Promise.all(form.value.details.map((line: any) => enrichLine(line)));
    }
    await loadOrgScopedOptions(form.value.orgId);
  }
  await loadContextGoods();
  // 编辑回显：为已有明细行补商品分类类型，确保仓库下拉按类型过滤
  for (const line of form.value.details ?? []) {
    if (line.goodsId && !Number(line.goodsWarehouseType)) {
      const matched = (options.contextGoods ?? []).find(
        (g: any) => String(g.id) === String(line.goodsId),
      );
      line.goodsWarehouseType = Number(matched?.categoryWarehouseType ?? 0);
    }
  }
});
</script>

<template>
  <el-form label-position="top" :disabled="isView">
    <div class="form-grid">
      <el-form-item label="来源采购申请">
        <el-input
          :model-value="form.applicationNo || (form.applicationId ? form.applicationId : '直接采购')"
          disabled
        />
      </el-form-item>
      <el-form-item label="供应商" required>
        <el-select v-model="form.vendorId" filterable clearable :disabled="isView">
          <el-option
            v-for="x in options.vendors"
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
          :disabled="isView || Boolean(form.applicationId)"
          @change="organizationChanged"
        >
          <el-option v-for="x in options.orgs" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="目标仓库" required>
        <el-select
          v-model="form.warehouseId"
          filterable
          :disabled="isView || Boolean(form.applicationId) || !form.orgId"
          @change="warehouseChanged"
        >
          <el-option
            v-for="x in warehouseOptions"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
        <div
          v-if="documentWarehouseType && form.details?.some((l: any) => l.goodsId)"
          class="warehouse-hint"
        >
          已按明细商品类型匹配仓库
        </div>
      </el-form-item>
      <el-form-item label="接收部门" required>
        <el-select
          v-model="form.deptId"
          filterable
          :disabled="isView || Boolean(form.applicationId)"
        >
          <el-option v-for="x in options.depts" :key="x.value" :label="x.label" :value="x.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="收货人">
        <el-select
          v-model="form.receiverId"
          filterable
          :disabled="isView"
          placeholder="请选择收货人"
        >
          <el-option
            v-for="x in options.receivers"
            :key="x.value"
            :label="x.label"
            :value="x.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="到货方式">
        <el-select v-model="form.arrivalType" :disabled="isView">
          <el-option
            v-for="item in dicts.purchase_arrival_type || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="计划到货日期" required>
        <el-date-picker
          v-model="form.planArrivalDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="结算方式">
        <el-select v-model="form.paymentType" :disabled="isView">
          <el-option
            v-for="item in dicts.purchase_settlement_type || []"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="计划付款日期">
        <el-date-picker
          v-model="form.planPayDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="isView"
        />
      </el-form-item>
      <el-form-item label="备注" class="span-2">
        <el-input v-model="form.remark" type="textarea" :rows="2" :disabled="isView" />
      </el-form-item>
    </div>

    <div class="details-header">
      <span class="details-title">订单明细</span>
      <el-button v-if="!isView" link type="primary" @click="addLine">+ 添加明细</el-button>
    </div>
    <el-table :data="form.details ?? []" border size="small">
      <el-table-column label="商品" min-width="200">
        <template #default="s">
          <RemoteSelect
            v-if="!isView"
            v-model="s.row.goodsId"
            :fetch="searchGoodsOptions"
            :current-label="s.row.goodsName || s.row.goodsId"
            :disabled="!form.orgId"
            placeholder="输入商品名称或编码搜索"
            @change="lineGoodsChanged(s.row)"
          />
          <span v-else>{{ s.row.goodsName || s.row.goodsCode || s.row.goodsId || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="SKU/规格" min-width="120">
        <template #default="s">{{ s.row.skuSpec || s.row.skuId || '—' }}</template>
      </el-table-column>
      <el-table-column label="单位" width="80">
        <template #default="s">{{ unitName(s.row) }}</template>
      </el-table-column>
      <el-table-column label="采购数量" width="120">
        <template #default="s">
          <el-input-number
            v-model="s.row.quantity"
            :min="1"
            :precision="0"
            :step="1"
            :disabled="isView"
          />
        </template>
      </el-table-column>
      <el-table-column label="总金额" width="155" align="right">
        <template #default="s">
          <el-input-number
            v-if="canViewAmount"
            v-model="s.row.totalAmount"
            :min="0"
            :precision="2"
            :step="1"
            controls-position="right"
            :disabled="isView || !canEditAmount"
          />
          <span v-else>****</span>
        </template>
      </el-table-column>
      <el-table-column label="计算单价" width="120" align="right">
        <template #default="s">
          {{ canViewAmount ? lineUnitPrice(s.row).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '****' }}
        </template>
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

    <div class="form-total">
      合计：{{ orderQuantity }} 件　订单金额 {{ canViewAmount ? `¥ ${orderTotal.toFixed(2)}` : '****' }}
    </div>

    <div v-if="!isView" class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canEditAmount" @click="save">
        保存
      </el-button>
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
.warehouse-hint {
  font-size: 12px;
  color: var(--hs-muted, #909399);
  margin-top: 2px;
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
.form-total {
  margin-top: 12px;
  text-align: right;
  color: #606266;
  font-variant-numeric: tabular-nums;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
</style>
