<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText } from '@/utils/format';
import {
  filterGoodsByWarehouseType,
  filterMappedGoodsByKeyword,
  warehouseTypeOf,
} from '@/utils/goods-warehouse';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';
import PurchaseQuickCatalogDialog from '@/components/purchase/PurchaseQuickCatalogDialog.vue';
import PurchaseOrderBasicInfo from '@/components/purchase/PurchaseOrderBasicInfo.vue';
import PurchaseOrderDetailsSection from '@/components/purchase/PurchaseOrderDetailsSection.vue';
import PurchaseOrderPaymentSummary from '@/components/purchase/PurchaseOrderPaymentSummary.vue';

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
  receivers: [],
  vendors: [],
  units: [],
  contextGoods: [],
});
const dicts = reactive<Record<string, any[]>>({});
const isView = computed(() => props.mode === 'view');
const canEditAmount = computed(() => auth.amountAccess.canEditAmount);
const canViewAmount = computed(() => auth.amountAccess.canViewAmount);
const quickCatalogRef = ref<InstanceType<typeof PurchaseQuickCatalogDialog>>();
const organizationTree = computed(() =>
  buildOrganizationTree(options.orgs as OrganizationTreeNode[]),
);

function openQuickCatalog(line: any, mode: 'goods' | 'sku') {
  quickCatalogRef.value?.open(line, mode);
}

async function selectExistingGoods(line: any, goods: any) {
  delete line.newGoods;
  delete line.newSku;
  line.goodsId = goods.id;
  await lineGoodsChanged(line);
}

function quickCatalogStaged() {
  if (form.value.warehouseId) warehouseChanged();
}

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
  (form.value.details ?? []).reduce(
    (sum: number, line: any) => sum + Number(line.quantity ?? 0),
    0,
  ),
);
const orderEffectivePayable = computed(() =>
  Number(form.value.effectivePayable ?? orderTotal.value),
);
const orderNetPaidAmount = computed(() =>
  Number(
    form.value.netPaidAmount ??
      Number(form.value.paidAmount ?? 0) - Number(form.value.refundedAmount ?? 0),
  ),
);
const orderRemainingAfterPayment = computed(() =>
  Math.max(0, orderEffectivePayable.value - orderNetPaidAmount.value),
);
const orderPreviewProgressStatus = computed(() => {
  if (orderRemainingAfterPayment.value <= 0 && orderEffectivePayable.value > 0) return 2;
  if (orderNetPaidAmount.value > 0) return 1;
  return 0;
});

async function loadDicts() {
  const [arrivalType, deliveryType, settlementType, paymentProgress] = await Promise.all([
    api.get('/dictionaries/purchase_arrival_type').catch(() => []),
    api.get('/dictionaries/purchase_delivery_type').catch(() => []),
    api.get('/dictionaries/purchase_settlement_type').catch(() => []),
    api.get('/dictionaries/purchase_payment_progress_status').catch(() => []),
  ]);
  dicts.purchase_arrival_type = arrivalType as any[];
  dicts.purchase_delivery_type = deliveryType as any[];
  dicts.purchase_settlement_type = settlementType as any[];
  dicts.purchase_payment_progress_status = paymentProgress as any[];
}

async function loadOrgScopedOptions(orgId: unknown) {
  if (!orgId) {
    options.depts = [];
    options.warehouses = [];
    options.receivers = [];
    return;
  }
  const [depts, warehouses] = await Promise.all([
    api.get('/base-data/departments/options', { params: { orgId } }).catch(() => []),
    api.get('/base-data/warehouses/options', { params: { orgId } }).catch(() => []),
  ]);
  options.depts = depts as any[];
  options.warehouses = warehouses as any[];
}

async function loadReceiverOptions(orgId: unknown, deptId: unknown) {
  if (!orgId || !deptId) {
    options.receivers = [];
    return;
  }
  options.receivers = (await api
    .get('/purchase/receiver-options', { params: { orgId, deptId } })
    .catch(() => [])) as any[];
}

function organizationChanged() {
  form.value.deptId = '';
  form.value.warehouseId = '';
  form.value.receiverId = '';
  options.receivers = [];
  form.value.details = [blankLine()];
  options.contextGoods = [];
  loadOrgScopedOptions(form.value.orgId);
  loadContextGoods();
}

async function departmentChanged() {
  form.value.receiverId = '';
  await loadReceiverOptions(form.value.orgId, form.value.deptId);
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
const documentWarehouseType = computed<number>(() => {
  const types = new Set<number>(
    (form.value.details ?? [])
      .map((line: any) => Number(line.goodsWarehouseType ?? 0))
      .filter(Boolean),
  );
  return types.size === 1 ? ([...types][0] ?? 0) : 0;
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
  const list = filterMappedGoodsByKeyword(
    filterGoodsByWarehouseType(options.contextGoods, selectedWarehouseType.value),
    keyword,
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
  const otherTypes = new Set(
    (form.value.details ?? [])
      .filter((item: any) => item !== line)
      .map((item: any) => Number(item.goodsWarehouseType ?? 0))
      .filter(Boolean),
  );
  if (
    line.goodsWarehouseType > 0 &&
    otherTypes.size > 0 &&
    !otherTypes.has(line.goodsWarehouseType)
  ) {
    Object.assign(line, blankLine());
    ElMessage.warning('同一采购订单只能选择相同仓库类型的商品，请拆分订单');
    return;
  }
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
    const sku = (g.skus ?? []).find((x: any) => String(x.id) === String(line.skuId)) ?? g.skus?.[0];
    line.goodsCode = line.goodsCode || g.queryCode || '';
    line.goodsName = line.goodsName || g.goodsName || '';
    line.skuSpec = sku?.specModels ?? '';
    if (!line.skuId) line.skuId = sku?.id ?? '';
    if (!Number(line.unitType)) line.unitType = sku?.unitType ?? 0;
  } catch {
    // 商品不存在时保留原始值
  }
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
  await loadReceiverOptions(form.value.orgId, form.value.deptId);
  if (
    !options.receivers.some((item: any) => String(item.value) === String(form.value.receiverId))
  ) {
    form.value.receiverId = '';
  }
  form.value.details = (source.details ?? []).map((line: any) => ({
    ...blankLine(),
    goodsId: line.goodsId,
    skuId: line.skuId,
    unitType: line.unitType,
    quantity: Number(line.quantity ?? 0),
    totalAmount: Number((Number(line.referencePrice ?? 0) * Number(line.quantity ?? 0)).toFixed(2)),
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
  if (!form.value.receiverId) {
    ElMessage.warning('请选择收货人');
    return false;
  }
  const hasGoods = (form.value.details ?? []).some((line: any) => line.goodsId);
  if (!form.value.warehouseId) {
    ElMessage.warning(hasGoods ? '请选择与商品匹配的目标仓库' : '请选择所属组织、目标仓库和部门');
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
      receiverId: form.value.receiverId ?? '',
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
    else {
      await loadOrgScopedOptions(form.value.orgId);
      await loadReceiverOptions(form.value.orgId, form.value.deptId);
      if (
        options.receivers.some((item: any) => String(item.value) === String(auth.user?.id ?? ''))
      ) {
        form.value.receiverId = auth.user?.id ?? '';
      }
    }
  } else if (form.value.id) {
    // 编辑/查看的完整详情由 BusinessDocumentPage 统一加载，表单只做显示归一化。
    Object.assign(form.value, normalizeOrder(form.value));
    form.value.details = (form.value.details ?? []).map((line: any) => ({
      ...line,
      totalAmount: Number(
        line.totalAmount ?? Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0),
      ),
    }));
    if (Array.isArray(form.value.details)) {
      await Promise.all(form.value.details.map((line: any) => enrichLine(line)));
    }
    await loadOrgScopedOptions(form.value.orgId);
    await loadReceiverOptions(form.value.orgId, form.value.deptId);
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
  <el-form label-position="top" :disabled="isView" class="purchase-order-form">
    <PurchaseOrderBasicInfo
      :form="form"
      :mode="mode"
      :options="options"
      :dicts="dicts"
      :organization-tree="organizationTree"
      :warehouse-options="warehouseOptions"
      :document-warehouse-type="documentWarehouseType"
      @organization-change="organizationChanged"
      @warehouse-change="warehouseChanged"
      @department-change="departmentChanged"
    />

    <PurchaseOrderPaymentSummary
      :form="form"
      :mode="mode"
      :dicts="dicts"
      :can-view-amount="canViewAmount"
      :order-total="orderTotal"
      :effective-payable="orderEffectivePayable"
      :net-paid-amount="orderNetPaidAmount"
      :remaining-after-payment="orderRemainingAfterPayment"
      :preview-progress-status="orderPreviewProgressStatus"
    />

    <PurchaseOrderDetailsSection
      :form="form"
      :mode="mode"
      :can-view-amount="canViewAmount"
      :can-edit-amount="canEditAmount"
      :order-quantity="orderQuantity"
      :order-total="orderTotal"
      :units="options.units"
      :search-goods-options="searchGoodsOptions"
      :line-unit-price="lineUnitPrice"
      @add="addLine"
      @remove="removeLine"
      @goods-change="lineGoodsChanged"
      @quick-catalog="openQuickCatalog"
    />

    <div v-if="!isView" class="form-actions">
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canEditAmount" @click="save">
        保存
      </el-button>
    </div>
    <PurchaseQuickCatalogDialog
      ref="quickCatalogRef"
      :can-edit-amount="canEditAmount"
      @selected-existing="selectExistingGoods"
      @staged="quickCatalogStaged"
    />
  </el-form>
</template>

<style scoped>
.purchase-order-form {
  min-width: 0;
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--hs-space-2);
  margin-top: var(--hs-space-5);
}
:global(.purchase-order-form-dialog) {
  max-width: calc(100vw - 32px);
}
:global(.purchase-order-form-dialog .el-dialog__header) {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--hs-color-border);
}
:global(.purchase-order-form-dialog .el-dialog__title) {
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-dialog-title);
  line-height: var(--hs-line-dialog-title);
  font-weight: 600;
}
:global(.purchase-order-form-dialog .el-dialog__body) {
  max-height: calc(94vh - 80px);
  padding: 16px 20px 20px;
  overflow-x: hidden;
  overflow-y: auto;
}
@media (max-width: 760px) {
  :global(.purchase-order-form-dialog) {
    width: calc(100vw - 24px) !important;
    margin-right: auto;
    margin-left: auto;
  }
}
</style>
