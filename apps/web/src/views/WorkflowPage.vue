<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { dateText, moneyText } from '@/utils/format';
import { generateBatchNo } from '@/utils/batch-number';
import { workflowDocumentType } from '@/utils/document-type';
import { lineUnitName } from '@/utils/unit-name';
import { createRequestId } from '@/utils/random-id';
import { businessConfigs } from './business-config';
import DocumentTraceDialog from '@/components/DocumentTraceDialog.vue';
import DocumentAttachments from '@/components/DocumentAttachments.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import SignaturePad from '@/components/requisition/SignaturePad.vue';
import ExecuteOutDialog from '@/components/production/ExecuteOutDialog.vue';
import TempSupplementDialog from '@/components/production/TempSupplementDialog.vue';
import EditOutboundDialog from '@/components/production/EditOutboundDialog.vue';
import ViewOutboundDialog from '@/components/production/ViewOutboundDialog.vue';
import LabOutboundDialog from '@/components/production/LabOutboundDialog.vue';
import BatchMaterialTable from '@/components/production/BatchMaterialTable.vue';
import InputDialog from '@/components/production/InputDialog.vue';
import BomReturnDialog from '@/components/production/BomReturnDialog.vue';
import { buildOrganizationTree, type OrganizationTreeNode } from '@/utils/organization-tree';
type B = Record<string, any>;
const route = useRoute(),
  router = useRouter(),
  auth = useAuthStore(),
  group = computed(() => String(route.path.split('/')[1])),
  resource = computed(() => String(route.params.resource));
const canEditAmount = computed(() => auth.amountAccess.canEditAmount);
const key = computed(() => `${group.value}/${resource.value}`),
  current = computed<B>(() => businessConfigs[key.value] ?? businessConfigs['production/boms']!),
  rows = ref<B[]>([]),
  total = ref(0),
  summary = reactive<B>({}),
  loading = ref(false),
  dialog = ref(false),
  saving = ref(false),
  moneyOrderLocked = ref(false),
  mode = ref<'create' | 'edit' | 'view'>('create'),
  form = reactive<B>({}),
  query = reactive({ keyword: '', status: '', outType: '', page: 1, pageSize: 20 }),
  options = reactive<B>({
    orgs: [],
    warehouses: [],
    depts: [],
    employees: [],
    requisitionWarehouses: [],
    requisitionDepts: [],
    customers: [],
    users: [],
    goods: [],
    contextGoods: [],
    boms: [],
    plans: [],
    orders: [],
    planOrders: [],
    salesOutputs: [],
    serviceOutputs: [],
    applications: [],
    outputs: [],
    stocks: [],
    units: [],
    dictionaries: {},
  });
const temporaryCreateMode = ref(false);
const organizationTree = computed(() =>
  buildOrganizationTree(options.orgs as OrganizationTreeNode[]),
);
const attachmentType = computed(() => workflowDocumentType(group.value, resource.value, form));
const serviceProgresses = ref<B[]>([]);
const progressSaving = ref(false);
const progressForm = reactive<B>({ id: '', content: '', status: 1, occurredAt: new Date() });

function resetProgressForm() {
  Object.assign(progressForm, {
    id: '',
    content: '',
    status: form.eventStatus || 1,
    occurredAt: new Date(),
  });
}
function serviceProgressStatusType(item: B): 'success' | 'warning' | 'danger' | 'info' {
  const label = String(item.statusName ?? item.status ?? '');
  if (label.includes('完成')) return 'success';
  if (label.includes('取消') || label.includes('关闭')) return 'info';
  if (label.includes('失败') || label.includes('驳回')) return 'danger';
  return 'warning';
}
const isMoney = computed(() => ['payments', 'refunds'].includes(resource.value)),
  isService = computed(() => resource.value === 'services'),
  isBom = computed(() => key.value === 'production/boms'),
  isPlan = computed(() => key.value === 'production/plans'),
  isInput = computed(() => key.value === 'production/inputs'),
  isShortage = computed(() => key.value === 'production/shortages'),
  isOrder = computed(() => ['orders', 'discount-orders'].includes(resource.value)),
  isOutput = computed(() => resource.value === 'outputs'),
  isReturn = computed(() => resource.value === 'returns'),
  serviceNeedsBatch = computed(() => isService.value && [4, 5].includes(Number(form.eventType))),
  hasLines = computed(
    () =>
      isPlan.value ||
      isBom.value ||
      isOrder.value ||
      key.value === 'requisitions/applications' ||
      isOutput.value ||
      isReturn.value ||
      serviceNeedsBatch.value,
  );
const discountOrderSourceLocked = computed(
  () => key.value === 'sales/discount-orders' && Boolean(form.sourceLocked),
);
const discountOutputSourceLocked = computed(
  () => key.value === 'sales/outputs' && Boolean(form.sourceLocked),
);
function blank(): B {
  return {
    goodsId: '',
    skuId: '',
    unitType: 0,
    batchNo: isInput.value ? generateBatchNo() : '',
    quantity: 1,
    price: 0,
    factAmount: null,
    availableStock: null,
    orderQty: 0,
    applicationQty: 0,
    issuedQty: 0,
    applicationDetailId: '',
    outputDetailId: '',
    returnable: null,
    remark: '',
  };
}
function lineActual(line: B) {
  return line.factAmount == null
    ? Number(line.quantity || 0) * Number(line.price || 0)
    : Number(line.factAmount);
}
function reset() {
  Object.keys(form).forEach((k) => delete form[k]);
  Object.assign(form, {
    orgId: auth.user?.orgId ?? '',
    warehouseId: '',
    productWarehouseId: '',
    deptId: auth.user?.deptId ?? '',
    receiverId: auth.user?.id,
    handlerId: auth.user?.id,
    applicantId: auth.user?.id,
    customerId: '',
    customerMobile: '',
    customerAddress: '',
    bomId: '',
    planId: '',
    orderId: '',
    applicationId: '',
    directOutput: false,
    outputId: '',
    sourceId: '',
    sourceOutputId: '',
    sourceLocked: false,
    businessSourceType: '',
    businessSourceId: 0,
    businessSourceNo: '',
    bomName: '',
    planQty: 1,
    maxPlanQty: 0,
    quantity: 1,
    batchNo: isInput.value ? generateBatchNo() : '',
    drawType: 1,
    outType: 1,
    destinationType: 1,
    status: 1,
    orderType: 1,
    sourceType: 4,
    propertyType: 1,
    destination: 1,
    disposalType: 1,
    date: dateText(new Date()),
    orderDate: dateText(new Date()),
    planDate: dateText(new Date()),
    outDate: dateText(new Date()),
    returnDate: dateText(new Date()),
    inputDate: dateText(new Date()),
    productDate: dateText(new Date()),
    eventDate: dateText(new Date()),
    paymentDate: dateText(new Date()),
    paymentMode: 1,
    amount: 0,
    reason: '',
    remark: '',
    eventType: 1,
    eventStatus: 1,
    eventContent: '',
    signatureContent: '',
    signatureAttachment: '',
    signedBy: '',
    signedAt: null,
    details: hasLines.value ? [blank()] : [],
  });
  if (group.value === 'requisitions') {
    form.applicantId = '';
    form.receiverId = '';
    if (key.value === 'requisitions/applications' && form.details[0])
      form.details[0].returnable = false;
  }
  if (isMoney.value) form.requestKey = createRequestId();
  if (key.value === 'sales/discount-orders') form.propertyType = 2;
  serviceProgresses.value = [];
  resetProgressForm();
}
const moneyLimit = computed(() =>
  Math.max(
    0,
    Number(resource.value === 'payments' ? form.unreceivedAmount : form.refundableAmount) || 0,
  ),
);
const moneySaveDisabled = computed(
  () =>
    !canEditAmount.value ||
    !form.orderId ||
    !form.orgId ||
    !form.deptId ||
    !form.paymentMode ||
    !form.paymentDate ||
    Number(form.amount) <= 0 ||
    Number(form.amount) > moneyLimit.value ||
    (resource.value === 'refunds' && !String(form.remark ?? '').trim()),
);
async function load() {
  loading.value = true;
  try {
    const r: any = await api.get(`/${group.value}/${resource.value}`, { params: query });
    rows.value = r.items ?? [];
    total.value = r.total ?? rows.value.length;
    Object.assign(summary, r.summary ?? {});
    if (key.value === 'production/outputs') {
      const all: any = await api.get(`/production/outputs`, { params: { pageSize: 1 } });
      summary.pending = rows.value.filter(
        (x: B) => Number(x.confirmStatus ?? x.status) === 0,
      ).length;
      summary.completed = rows.value.filter(
        (x: B) => Number(x.confirmStatus ?? x.status) === 1,
      ).length;
    }
  } finally {
    loading.value = false;
  }
}
async function loadOptions() {
  const [o, w, d, c, u, g, bo, pl, so, ra, ro, st, units] = (await Promise.all([
    api.get('/base-data/organizations/options'),
    api.get('/base-data/warehouses/options'),
    api.get('/base-data/departments/options'),
    api.get('/base-data/customers/options'),
    api.get('/base-data/users/options'),
    api.get('/goods', { params: { pageSize: 100, status: 1 } }),
    api.get('/production/boms', { params: { pageSize: 100, status: 1 } }),
    api.get('/production/plans', { params: { pageSize: 100 } }),
    api.get('/sales/money-order-options', { params: { pageSize: 100 } }),
    api.get('/requisitions/application-options'),
    api.get('/requisitions/output-options'),
    api.get('/inventory/stock-options'),
    api.get('/base-data/units/options'),
  ])) as any[];
  Object.assign(options, {
    orgs: o,
    warehouses: w,
    depts: d,
    customers: c,
    users: u,
    goods: g.items,
    boms: bo.items,
    plans: pl.items,
    orders: so,
    applications: ra,
    outputs: ro,
    stocks: st,
    units,
  });
}
async function loadRequisitionFormOptions(orgId: unknown) {
  if (group.value !== 'requisitions' || !orgId) {
    options.requisitionWarehouses = [];
    options.requisitionDepts = [];
    options.employees = [];
    return;
  }
  const result: any = await api.get('/requisitions/application-form-options', {
    params: { orgId },
  });
  options.requisitionWarehouses = result.warehouses ?? [];
  options.requisitionDepts = result.departments ?? [];
  options.employees = result.employees ?? [];
}
const optionWarehouseType = (item: B) =>
  Number(item?.warehouseType ?? item?.raw?.warehouseType ?? 0);
const lineWarehouseType = (line: B) =>
  Number(line?.categoryWarehouseType ?? goodsOf(line)?.categoryWarehouseType ?? 0);
const documentWarehouseTypes = computed(() => [
  ...new Set((form.details ?? []).map(lineWarehouseType).filter(Boolean)),
]);
const documentWarehouseType = computed(() =>
  documentWarehouseTypes.value.length === 1 ? documentWarehouseTypes.value[0] : 0,
);
const requisitionWarehouseOptions = computed<B[]>(() => {
  const result =
    group.value === 'requisitions'
      ? [...(options.requisitionWarehouses ?? [])]
      : (options.warehouses as B[]).filter(
          (item: B) =>
            !form.orgId ||
            String(item.raw?.orgId ?? item.orgId ?? '') === String(form.orgId),
        );
  const selected = options.warehouses.find(
    (item: B) => String(item.value) === String(form.warehouseId),
  );
  if (selected && !result.some((item: B) => String(item.value) === String(selected.value)))
    result.unshift(selected);
  return result.filter(
    (item: B) =>
      !documentWarehouseType.value || optionWarehouseType(item) === documentWarehouseType.value,
  );
});
const lineGoodsOptions = computed<B[]>(() =>
  isBom.value ? (options.contextGoods ?? []) : options.goods,
);
async function loadContextGoods() {
  if (!form.orgId || !form.warehouseId) {
    options.contextGoods = [];
    return;
  }
  const endpoint =
    group.value === 'sales'
      ? '/sales/product-options'
      : group.value === 'requisitions'
        ? '/requisitions/product-options'
        : '/production/product-options';
  options.contextGoods = await api.get(
    endpoint,
    {
    params: { orgId: form.orgId, warehouseId: form.warehouseId },
    },
  );
}
async function businessWarehouseChanged() {
  refreshAvailableStocks();
  if (!isBom.value) return;
  form.details = [blank()];
  await loadContextGoods();
}
function bomOrganizationChanged() {
  form.warehouseId = '';
  form.details = [blank()];
  options.contextGoods = [];
}
function salesOrderOrganizationChanged() {
  form.warehouseId = '';
  form.details = [blank()];
  options.contextGoods = [];
}
async function requisitionOrganizationChanged() {
  form.warehouseId = '';
  form.deptId = '';
  form.applicantId = '';
  form.receiverId = '';
  form.details = [{ ...blank(), returnable: form.drawType === 2 }];
  options.contextGoods = [];
  await loadRequisitionFormOptions(form.orgId);
}
const requisitionDepartmentOptions = computed<B[]>(() =>
  group.value === 'requisitions' ? (options.requisitionDepts ?? []) : options.depts,
);
async function loadDictionaries() {
  const codes = [...new Set<string>(current.value.dictionaries ?? [])];
  const values = await Promise.all(codes.map((code) => api.get(`/dictionaries/${code}`)));
  options.dictionaries = Object.fromEntries(codes.map((code, index) => [code, values[index]]));
}
const statusOptions = computed(() => {
  const code = (current.value.dictionaries ?? []).find((item: string) => item.includes('status'));
  return code ? (options.dictionaries[code] ?? []) : [];
});
const productionOutputTypes = computed<B[]>(
  () => options.dictionaries.production_material_out_type ?? [],
);
const productionDialogRows = computed<B[]>(() => {
  const grouped = new Map<string, B>();
  for (const line of form.details ?? []) {
    const rowKey = `${line.goodsId ?? ''}:${line.skuId ?? ''}`;
    const batchRow = {
      batchNo: line.batchNo ?? '',
      qty: Number(line.quantity ?? line.planOutQty ?? 0),
      avail: Number(line.inventoryQty ?? 0),
    };
    const existing = grouped.get(rowKey);
    if (existing) {
      existing.batchRows.push(batchRow);
      continue;
    }
    const goods = goodsOf(line);
    grouped.set(rowKey, {
      ...line,
      goodsCode: line.goodsCode ?? goods.queryCode ?? '—',
      goodsName: line.goodsName ?? goods.goodsName ?? '—',
      skuSpec: line.skuSpec ?? line.goodsSpec ?? line.specModels ?? line.skuId ?? '—',
      unitName: lineUnitName(options.units, line),
      bomUnitQty: line.bomUnitQty ?? '—',
      totalDemand: line.standardQty ?? line.planOutQty ?? line.quantity ?? 0,
      stockQty: line.currentStock ?? 0,
      planQty: line.planOutQty ?? line.quantity ?? 0,
      batchRows: [batchRow],
    });
  }
  return [...grouped.values()];
});
function defaultTemporaryOutputType() {
  const matched = productionOutputTypes.value.find((item: B) =>
    /实验|临时出库/.test(String(item.label ?? '')),
  );
  const fallback = productionOutputTypes.value.at(-1);
  return Number(matched?.value ?? fallback?.value ?? 0);
}
function dictionaryLabel(code: string, value: unknown, fallback = '—') {
  return (
    (options.dictionaries[code] ?? []).find((item: B) => String(item.value) === String(value))
      ?.label ?? fallback
  );
}
function display(row: B, column: B) {
  const value = row[column.prop];
  if (column.prop === 'status' && isPlan.value)
    return row.planStatusName || dictionaryLabel('production_plan_status', row.planStatus);
  if (column.prop === 'businessStatus') {
    const ps = row.planStatusName || dictionaryLabel('production_plan_status', row.planStatus);
    const ms =
      row.materialStatusName || dictionaryLabel('production_material_status', row.materialStatus);
    const os =
      row.outboundStatusName || dictionaryLabel('production_outbound_status', row.outboundStatus);
    return `${ps}/${ms}/${os}`;
  }
  if (column.prop === 'businessSourceType')
    return dictionaryLabel('sales_business_source_type', value, '—');
  if (value === null || value === undefined || value === '') return '—';
  if (column.prop === 'stockCheckStatus')
    return (
      row.stockCheckStatusName ||
      dictionaryLabel('production_stock_check_status', value, String(value))
    );
  if (column.kind === 'money') return `¥ ${moneyText(value)}`;
  if (column.kind === 'date') return dateText(value);
  if (column.kind === 'datetime') return dateText(value, true);
  if (column.kind === 'number')
    return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
  if (column.prop === 'paymentStatus')
    return dictionaryLabel('sales_payment_progress_status', value, String(value));
  return value;
}
function displayCell(row: B, column: B) {
  if (column.prop === 'discountDisposalStatus') {
    const approval = Number(row.approveStatus ?? row.approve_status),
      delivery = Number(row.deliveryStatus ?? row.delivery_status);
    const value = approval === 2 ? 2 : delivery === 3 ? 1 : 0;
    return dictionaryLabel('sales_discount_disposal_status', value, String(value));
  }
  if (column.prop === 'paymentStatus') {
    const received = Number(row.receivedAmount || 0),
      refunded = Number(row.refundedAmount || 0),
      net = received - refunded,
      actual = Number(row.amount || 0),
      value = received <= 0 ? 0 : refunded >= received ? 3 : net + 0.000001 >= actual ? 2 : 1;
    return dictionaryLabel('sales_payment_progress_status', value, String(value));
  }
  return display(row, column);
}
function goodsOf(row: B) {
  return options.goods.find((item: B) => String(item.id) === String(row.goodsId)) ?? {};
}
function refreshAvailableStock(line: B) {
  if (!isOrder.value || !form.warehouseId || !line.goodsId || !line.skuId) {
    line.availableStock = null;
    return;
  }
  const total = (options.stocks as B[])
    .filter(
      (stock: B) =>
        String(stock.warehouseId) === String(form.warehouseId) &&
        String(stock.goodsId) === String(line.goodsId) &&
        String(stock.skuId) === String(line.skuId),
    )
    .reduce((sum: number, stock: B) => sum + Number(stock.inventoryQty ?? 0), 0);
  line.availableStock = Math.round(total * 10000) / 10000;
}
function refreshAvailableStocks() {
  if (!isOrder.value) return;
  (form.details ?? []).forEach((line: B) => refreshAvailableStock(line));
}
async function goodsChanged(line: B) {
  line.availableStock = null;
  if (!line.goodsId) return;
  const g: any = await api.get(`/goods/${line.goodsId}`);
  options.goodsSkus = g.skus ?? [];
  const sku = (g.skus ?? []).find((x: B) => x.isDefault === 1) ?? g.skus?.[0];
  if (sku) {
    line.skuId = sku.id;
    line.unitType = sku.unitType;
    line.price = Number(sku.salePrice ?? 0);
  }
  refreshAvailableStock(line);
  if (isBom.value) form.goodsCode = g.queryCode ?? '';
  form.goodsName = g.goodsName ?? '';
}
async function customerChanged() {
  if (!form.customerId) return;
  const c: any = await api.get(`/base-data/customers/${form.customerId}`);
  Object.assign(form, {
    customerMobile: c.mobile ?? '',
    customerAddress: c.address ?? '',
    orgId: c.orgId ?? c.org_id ?? form.orgId,
  });
}
async function sourceOutputChanged() {
  if (!form.sourceOutputId) return;
  const out: any = await api.get(`/sales/outputs/${form.sourceOutputId}`);
  Object.assign(form, { warehouseId: out.warehouseId });
  form.details = (out.details ?? [])
    .map((x: B) => {
      const historicalQty = Number(x.returnedQuantity ?? 0),
        remainingQty = Number(
          x.remainingReturnQuantity ?? Math.max(0, Number(x.quantity) - historicalQty),
        );
      return {
        ...blank(),
        ...x,
        orderQty: x.orderQty,
        issuedQty: x.quantity,
        historicalQty,
        remainingQty,
        quantity: remainingQty,
        stockKey: `${x.goodsId}-${x.skuId}-${out.warehouseId}-${x.batchNo}`,
      };
    })
    .filter((line: B) => Number(line.remainingQty) > 0);
  if (!form.details.length) ElMessage.warning('该销售出库单已无可退数量');
}
async function loadServiceOutputOptions() {
  options.serviceOutputs = [];
  if (!serviceNeedsBatch.value || !form.orderId || !form.goodsId || !form.skuId) return;
  options.serviceOutputs = (await api.get('/sales/services/source-options', {
    params: {
      orderId: form.orderId,
      goodsId: form.goodsId,
      skuId: form.skuId,
      excludeServiceId: form.id || undefined,
    },
  })) as B[];
}
async function serviceGoodsChanged() {
  form.sourceOutputId = '';
  form.details = [];
  const orderLine = (form.orderSummary?.details ?? []).find(
    (line: B) => String(line.goodsId) === String(form.goodsId),
  );
  form.skuId = orderLine?.skuId ?? '';
  await loadServiceOutputOptions();
}
async function serviceEventTypeChanged() {
  form.sourceOutputId = '';
  form.details = [];
  if (serviceNeedsBatch.value) await loadServiceOutputOptions();
}
function serviceSourceOutputChanged() {
  const source = (options.serviceOutputs as B[]).find(
    (item: B) => String(item.id) === String(form.sourceOutputId),
  );
  if (!source) {
    form.details = [];
    return;
  }
  form.details = (source.details ?? []).map((line: B) => ({
    ...blank(),
    ...line,
    sourceOutputId: source.id,
    sourceOutputNo: source.outputNo,
    remainingQty: Number(line.remainingQuantity),
    sourceQuantity: Number(line.sourceQuantity),
    quantity: 0,
  }));
}
function stockChanged(line: B) {
  const s = options.stocks.find(
    (x: B) => `${x.goodsId}-${x.skuId}-${x.warehouseId}-${x.batchNo}` === line.stockKey,
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
function stockKeyOf(line: B, warehouseId: unknown) {
  return line.goodsId && line.skuId && warehouseId && line.batchNo
    ? `${line.goodsId}-${line.skuId}-${warehouseId}-${line.batchNo}`
    : '';
}
async function appGoodsChanged(line: B) {
  if (!line.goodsId || !form.warehouseId) return;
  const stocks: any = await api.get('/inventory/stocks', {
    params: { warehouseId: form.warehouseId, goodsId: line.goodsId, pageSize: 50 },
  });
  line.batchOptions = (stocks.items ?? stocks ?? []).map((x: B) => ({
    ...x,
    label: `${x.batchNo} (库存:${x.inventoryQty})`,
  }));
  if (!line.skuId && line.batchOptions.length) {
    const first = line.batchOptions[0];
    line.skuId = first.skuId;
    line.unitType = first.unitType;
  }
  line.batchOptions?.sort?.((a: B, b: B) => Number(b.inventoryQty) - Number(a.inventoryQty));
}
async function loadPlanOrderOptions() {
  if (!isPlan.value || !form.goodsId || !form.skuId) {
    options.planOrders = [];
    return;
  }
  options.planOrders = (await api.get('/production/plan-source-options', {
    params: {
      goodsId: form.goodsId,
      skuId: form.skuId,
      orgId: form.orgId,
      excludePlanId: form.id || undefined,
    },
  })) as B[];
  if (
    form.sourceId &&
    !options.planOrders.some((item: B) => String(item.id) === String(form.sourceId))
  ) {
    if (mode.value === 'create') form.sourceId = '';
    else
      options.planOrders.unshift({
        id: form.sourceId,
        orderNo: form.sourceOrderNo || form.sourceId,
        customerName: '',
        goodsId: form.goodsId,
        skuId: form.skuId,
        orgId: form.orgId,
        warehouseId: form.productWarehouseId,
        remainingQty: Number(form.planQty),
      });
  }
  planSourceChanged();
}
function planSourceChanged() {
  if (!isPlan.value) return;
  const selected = (options.planOrders as B[]).find(
    (item: B) => String(item.id) === String(form.sourceId),
  );
  if (!selected) {
    form.maxPlanQty = 0;
    return;
  }
  Object.assign(form, {
    orgId: selected.orgId,
    productWarehouseId: selected.warehouseId,
    sourceOrderNo: selected.orderNo,
    maxPlanQty: Number(selected.remainingQty),
  });
  if (mode.value === 'create' && Number(form.planQty) > Number(form.maxPlanQty))
    form.planQty = Number(form.maxPlanQty);
  planQuantityChanged();
}
function planQuantityChanged() {
  if (!isPlan.value) return;
  for (const line of form.details ?? []) {
    const unitQty = Number(line.bomUnitQty ?? 0),
      quantity = unitQty * Number(form.planQty ?? 0);
    Object.assign(line, { standardQty: quantity, quantity, planOutQty: quantity });
  }
}
async function sourceChanged() {
  if (isPlan.value && form.bomId) {
    const b: any = await api.get(`/production/boms/${form.bomId}`);
    Object.assign(form, {
      orgId: b.orgId,
      warehouseId: b.warehouseId,
      goodsId: b.goodsId,
      skuId: b.skuId,
    });
    form.details = (b.details ?? []).map((x: B) => ({
      ...blank(),
      ...x,
      bomUnitQty: x.quantity,
      standardQty: Number(x.quantity) * Number(form.planQty),
      quantity: Number(x.quantity) * Number(form.planQty),
      planOutQty: Number(x.quantity) * Number(form.planQty),
    }));
    await loadPlanOrderOptions();
  } else if (isInput.value && form.planId) {
    const p: any = await api.get(`/production/plans/${form.planId}`);
    Object.assign(form, {
      orgId: p.orgId,
      warehouseId: p.productWarehouseId,
      goodsId: p.goodsId,
      skuId: p.skuId,
      planQty: p.planQty,
      deliveredQty: p.deliveredQty,
    });
  } else if (isOutput.value && group.value === 'production') {
    const p: any = await api.get(`/production/plans/${form.planId}`);
    Object.assign(form, {
      orgId: p.orgId,
      warehouseId: p.warehouseId,
      bomId: p.bomId,
      bomNo: p.bomNo,
      goodsName: p.goodsName,
      stockCheckStatus: p.stockCheckStatus,
      planStatus: p.planStatus,
    });
    form.details = (p.details ?? []).map((x: B) => ({ ...blank(), ...x, quantity: x.planOutQty }));
  } else if ((isOutput.value || isReturn.value) && group.value === 'sales') {
    const o: any = await api.get(`/sales/orders/${form.orderId}`);
    Object.assign(form, {
      orgId: o.orgId,
      warehouseId: o.warehouseId,
      customerName: o.customerName,
      destination: Number(o.propertyType) === 2 ? 2 : 1,
      sourceLocked: Boolean(o.sourceLocked),
    });
    if (!options.orders.some((order: B) => String(order.id) === String(o.id)))
      options.orders.unshift(o);
    if (isReturn.value)
      options.salesOutputs = (await api.get('/sales/output-options', {
        params: { orderId: form.orderId },
      })) as any;
    const sourceLines =
      isOutput.value && o.sourceLocked
        ? (o.sourceDisposalLines ?? [])
            .filter((line: B) => Number(line.remainingQuantity) > 0)
            .map((line: B) => {
              const orderLine =
                (o.details ?? []).find(
                  (detail: B) =>
                    String(detail.goodsId) === String(line.goodsId) &&
                    String(detail.skuId) === String(line.skuId),
                ) ?? {};
              return {
                ...blank(),
                ...orderLine,
                ...line,
                orderQty: line.quantity,
                historicalQty: line.confirmedQuantity,
                remainingQty: line.remainingQuantity,
                quantity: line.remainingQuantity,
                stockKey: stockKeyOf(line, o.warehouseId),
                sourceLocked: true,
              };
            })
        : (o.details ?? []);
    form.details = sourceLines.map((x: B) => {
      const historical = Number(
          isOutput.value ? (x.allocatedOutputQty ?? x.confirmedOutputQty) : x.confirmedReturnQty,
        ),
        base = Number(isOutput.value ? x.quantity : x.confirmedOutputQty);
      return x.sourceLocked
        ? x
        : {
            ...blank(),
            ...x,
            orderQty: x.quantity,
            issuedQty: base,
            historicalQty: historical,
            remainingQty: Math.max(0, base - historical),
            quantity: Math.max(0, base - historical),
          };
    });
  } else if (isMoney.value && form.orderId) {
    const s: any = await api.get(`/sales/orders/${form.orderId}/payment-summary`);
    Object.assign(form, s, { orderId: s.orderId, amount: 0 });
    normalizeMoneyDepartment();
  } else if (isService.value && form.orderId) {
    const o: any = await api.get(`/sales/orders/${form.orderId}`);
    Object.assign(form, {
      customerName: o.customerName,
      orderDate: o.orderDate,
      orderAmount: o.amount,
      orderQty: o.quantity,
      orderGoodsNames: o.goodsNames,
      orderSummary: o,
      orderGoodsIds: o.details?.map((x: any) => x.goodsId) || [],
    });
    form.goodsId = o.details?.[0]?.goodsId;
    form.skuId = o.details?.[0]?.skuId;
    form.sourceOutputId = '';
    form.details = [];
    await loadServiceOutputOptions();
  } else if (isOutput.value && group.value === 'requisitions') {
    const a: any = await api.get(`/requisitions/applications/${form.applicationId}`);
    Object.assign(form, {
      orgId: a.orgId,
      warehouseId: a.warehouseId,
      deptId: a.deptId,
      applicantId: a.applicantId,
      receiverId: a.applicantId,
    });
    form.details = (a.details ?? [])
      .filter((x: B) => Number(x.remainingQty) > 0)
      .map((x: B) => ({
        ...blank(),
        ...x,
        applicationDetailId: x.id,
        applicationQty: x.quantity,
        historicalQty: x.historicalQty,
        remainingQty: x.remainingQty,
        quantity: x.remainingQty,
        returnable: Boolean(x.returnable),
        stockKey: stockKeyOf(x, a.warehouseId),
      }));
  } else if (isReturn.value && group.value === 'requisitions') {
    const o: any = await api.get(`/requisitions/outputs/${form.outputId}`);
    Object.assign(form, {
      applicationId: o.applicationId,
      applicantId: o.applicantId,
      orgId: o.orgId,
      warehouseId: o.warehouseId,
      deptId: o.deptId,
      receiverId: o.receiverId ?? o.applicantId,
    });
    form.details = (o.details ?? [])
      .filter((x: B) => Boolean(x.returnable) && Number(x.remainingQty) > 0)
      .map((x: B) => ({
        ...blank(),
        ...x,
        outputDetailId: x.id,
        issuedQty: x.quantity,
        historicalQty: x.historicalQty,
        remainingQty: x.remainingQty,
        quantity: x.remainingQty,
        returnable: true,
      }));
  }
}
async function open(row?: B, view = false) {
  if (!view && (isOrder.value || isMoney.value) && !canEditAmount.value) {
    ElMessage.warning('当前账号没有金额编辑权限，只能查看金额相关单据');
    return;
  }
  moneyOrderLocked.value = false;
  temporaryCreateMode.value = false;
  reset();
  mode.value = row ? (view ? 'view' : 'edit') : 'create';
  if (row) {
    if (isMoney.value || key.value === 'production/inputs') Object.assign(form, row);
    else if (isService.value) {
      const detail: any = await api.get(`/sales/services/${row.id}`);
      Object.assign(form, detail);
      serviceProgresses.value = detail.progresses ?? [];
      resetProgressForm();
      form.orderSummary = detail.order;
      await loadServiceOutputOptions();
      if (
        form.sourceOutputId &&
        !options.serviceOutputs.some((item: B) => String(item.id) === String(form.sourceOutputId))
      )
        options.serviceOutputs.unshift({
          id: form.sourceOutputId,
          outputNo: form.details?.[0]?.sourceOutputNo ?? String(form.sourceOutputId),
          details: [],
        });
    } else {
      const detailUrl =
          key.value === 'sales/discount-orders'
            ? `/sales/orders/${row.id}`
            : `/${group.value}/${resource.value}/${row.id}`,
        d: any = await api.get(detailUrl);
      Object.assign(form, d);
    }
    if (key.value === 'requisitions/outputs') {
      form.details = (form.details ?? []).map((line: B) => ({
        ...line,
        stockKey: stockKeyOf(line, form.warehouseId),
      }));
    }
    if (key.value === 'sales/outputs') {
      const order: any = await api.get(`/sales/orders/${form.orderId}`);
      form.sourceLocked = Boolean(order.sourceLocked);
      if (
        form.sourceLocked &&
        !options.orders.some((item: B) => String(item.id) === String(order.id))
      )
        options.orders.unshift(order);
      form.details = (form.details ?? []).map((line: B) => {
        const sourceLine = (order.sourceDisposalLines ?? []).find(
          (item: B) =>
            String(item.goodsId) === String(line.goodsId) &&
            String(item.skuId) === String(line.skuId) &&
            String(item.batchNo ?? '') === String(line.batchNo ?? ''),
        );
        return {
          ...line,
          stockKey: stockKeyOf(line, form.warehouseId),
          sourceLocked: Boolean(order.sourceLocked),
          ...(sourceLine
            ? {
                historicalQty: sourceLine.confirmedQuantity,
                remainingQty: sourceLine.remainingQuantity,
              }
            : {}),
        };
      });
    }
    if (isPlan.value && form.goodsId) await loadPlanOrderOptions();
    if (isBom.value) await loadContextGoods();
  }
  if (group.value === 'requisitions') await loadRequisitionFormOptions(form.orgId);
  refreshAvailableStocks();
  dialog.value = true;
}
function editServiceProgress(row: B) {
  Object.assign(progressForm, {
    id: row.id,
    content: row.content,
    status: Number(row.status),
    occurredAt: new Date(row.occurredAt),
  });
}
async function reloadServiceProgresses() {
  serviceProgresses.value = (await api.get(`/sales/services/${form.id}/progress`)) as B[];
}
async function saveServiceProgress() {
  if (!String(progressForm.content ?? '').trim()) {
    ElMessage.warning('请填写本次处理进展');
    return;
  }
  progressSaving.value = true;
  try {
    const payload = {
      content: String(progressForm.content).trim(),
      status: Number(progressForm.status),
      occurredAt: progressForm.occurredAt,
    };
    const result: any = progressForm.id
      ? await api.patch(`/sales/services/${form.id}/progress/${progressForm.id}`, payload)
      : await api.post(`/sales/services/${form.id}/progress`, payload);
    form.eventStatus = payload.status;
    ElMessage.success(result.message);
    await reloadServiceProgresses();
    resetProgressForm();
    await load();
  } finally {
    progressSaving.value = false;
  }
}
async function deleteServiceProgress(row: B) {
  await ElMessageBox.confirm('确认删除这条售后进展？删除后仍保留审计记录。', '删除进展', {
    type: 'warning',
  });
  const result: any = await api.delete(`/sales/services/${form.id}/progress/${row.id}`);
  ElMessage.success(result.message);
  await reloadServiceProgresses();
  if (String(progressForm.id) === String(row.id)) resetProgressForm();
}
function applicantChanged(value: unknown) {
  if (key.value !== 'requisitions/applications') return;
  form.applicantId = value;
  form.signatureContent = '';
  form.signatureAttachment = '';
  form.signedBy = '';
  form.signedAt = null;
}
function drawTypeChanged(value: unknown) {
  const returnable = Number(value) === 2;
  for (const line of form.details ?? []) line.returnable = returnable;
}
function addDetailLine() {
  const line = blank();
  if (key.value === 'requisitions/applications') line.returnable = Number(form.drawType) === 2;
  form.details.push(line);
}
function signatureChanged(value: string) {
  form.signatureContent = value;
  form.signatureAttachment = '';
  form.signedBy = value ? form.applicantId : '';
  form.signedAt = value ? new Date().toISOString() : null;
}
async function save(submit = true) {
  if (isMoney.value && moneySaveDisabled.value) {
    ElMessage.warning(
      resource.value === 'refunds'
        ? '请完整填写退款信息，且退款金额不得超过可退金额'
        : '请完整填写收款信息，且收款金额不得超过未收金额',
    );
    return;
  }
  if (isPlan.value) {
    if (!form.sourceId) {
      ElMessage.warning('生产计划必须关联销售订单');
      return;
    }
    if (Number(form.planQty) > Number(form.maxPlanQty) + 0.000001) {
      ElMessage.warning(`生产数量不能超过销售订单剩余可计划数量 ${form.maxPlanQty}`);
      return;
    }
  }
  if (key.value === 'production/outputs' && Number(form.outType) === 3) {
    if (!form.orgId || !form.warehouseId) {
      ElMessage.warning('请选择所属组织和仓库');
      return;
    }
    if (
      !(form.details ?? []).some(
        (line: B) => line.goodsId && line.skuId && line.batchNo && Number(line.quantity) > 0,
      )
    ) {
      ElMessage.warning('请至少填写一条完整的商品、批次和出库数量');
      return;
    }
  }
  if (key.value === 'requisitions/applications') {
    if (!form.orgId || !form.deptId || !form.warehouseId || !form.applicantId) {
      ElMessage.warning('请选择所属组织、领用部门、行政/健服类仓库和领用人');
      return;
    }
    if (submit && !String(form.reason ?? '').trim()) {
      ElMessage.warning('提交申请前必须填写申请原因');
      return;
    }
    if ((form.details ?? []).some((line: B) => typeof line.returnable !== 'boolean')) {
      ElMessage.warning('请为每条领用明细选择“可归还”或“无需归还”');
      return;
    }
    if (
      submit &&
      !String(form.signatureContent ?? '').trim() &&
      !String(form.signatureAttachment ?? '').trim()
    ) {
      ElMessage.warning('提交申请前必须由领用人完成签字确认');
      return;
    }
    if (form.signatureContent || form.signatureAttachment) {
      form.signedBy = form.applicantId;
      form.signedAt = form.signedAt || new Date().toISOString();
    }
  }
  if (key.value === 'requisitions/outputs' && form.directOutput) {
    if (!form.orgId || !form.warehouseId || !form.deptId || !form.receiverId) {
      ElMessage.warning('请选择所属组织、领用部门、领用仓库和接收人');
      return;
    }
    if (
      !(form.details ?? []).some(
        (line: B) => line.goodsId && line.skuId && line.batchNo && Number(line.quantity) > 0,
      )
    ) {
      ElMessage.warning('请至少选择一条完整的库存批次并填写出库数量');
      return;
    }
    form.requestKey = form.requestKey || createRequestId();
  }
  if (serviceNeedsBatch.value) {
    const selected = (form.details ?? []).filter((line: B) => Number(line.quantity) > 0);
    if (!form.sourceOutputId || !selected.length) {
      ElMessage.warning('退货或换货售后必须选择来源销售出库单，并填写至少一个批次的本次处理数量');
      return;
    }
    form.details = selected;
  }
  saving.value = true;
  try {
    if (isMoney.value) {
      const msg =
        resource.value === 'payments'
          ? '收款保存后立即生效且不可直接编辑，是否继续？'
          : '退款只处理资金，不执行商品返库，是否继续？';
      await ElMessageBox.confirm(msg, '确认', { type: 'warning' });
    }
    if (key.value === 'requisitions/outputs' && form.directOutput) {
      await ElMessageBox.confirm(
        '保存后将立即扣减库存，并自动生成一张已通过的领用申请单。是否继续？',
        '确认直接领用出库',
        { type: 'warning' },
      );
    }
    const url = `/${group.value}/${resource.value}`,
      payload: B = { ...form };
    if (isPlan.value || key.value === 'requisitions/applications')
      payload.submit = isPlan.value ? true : submit;
    if (isMoney.value) {
      form.requestKey = form.requestKey || createRequestId();
      payload.requestKey = form.requestKey;
      if (resource.value === 'refunds') payload.remark = String(form.remark ?? '').trim();
    }
    const result: any = await (mode.value === 'edit'
      ? api.patch(`${url}/${form.id}`, payload)
      : api.post(url, payload));
    if (
      mode.value === 'create' &&
      key.value === 'production/outputs' &&
      Number(form.outType) === 3
    ) {
      await api.post(`/production/outputs/${result.id}/confirm`, {
        comment: String(form.remark ?? '').trim() || '实验室领料',
        details: form.details,
      });
    }
    if (isMoney.value) form.requestKey = '';
    const resultMessage =
      result?.message ??
      (isMoney.value
        ? resource.value === 'payments'
          ? '收款成功'
          : '退款成功'
        : submit
          ? '保存成功'
          : '草稿已保存');
    if (result?.oaStatus === 'PUSH_FAILED') ElMessage.warning(resultMessage);
    else ElMessage.success(resultMessage);
    query.page = 1;
    dialog.value = false;
    await load();
  } catch {
    // 请求失败时 axios 拦截器已弹出错误提示，此处静默处理，避免产生未捕获的 Promise 拒绝
  } finally {
    saving.value = false;
  }
}
async function retryOa(row: B) {
  const result: any = await api.post(`/requisitions/applications/${row.id}/submit-oa`, {});
  if (result?.procStatus === 'PUSH_FAILED') ElMessage.warning(result?.message ?? '提交OA失败');
  else ElMessage.success(result?.message ?? '已提交OA审批');
  await load();
}
async function action(
  row: B,
  type:
    | 'approve'
    | 'confirm'
    | 'undo-confirm'
    | 'analyze'
    | 'process'
    | 'recheck'
    | 'terminate'
    | 'toggle-bom',
  approved = true,
) {
  if (type === 'toggle-bom') {
    const newStatus = Number(row.status) === 1 ? 2 : 1;
    await api.patch(`/production/boms/${row.id}/status`, { status: newStatus });
    ElMessage.success(`已${dictionaryLabel('enabled_status', newStatus)}`);
    load();
    return;
  }
  const url =
    type === 'terminate' && key.value === 'production/shortages'
      ? `/production/plans/${row.planId}/terminate`
      : type === 'undo-confirm'
        ? `/${group.value}/${resource.value}/${row.id}/undo-confirm`
        : `/${group.value}/${resource.value}/${row.id}/${type}`;
  let body: B = {};
  if (type === 'approve') {
    let approveComment = '';
    if (key.value === 'sales/discount-orders') {
      const trustedSource = Number(row.businessSourceId ?? row.business_source_id) > 0;
      await ElMessageBox.confirm(
        trustedSource
          ? approved
            ? '确认销售并出库后，将按来源处置单的全部商品批次一次性扣减库存，不支持分批出库，是否继续？'
            : '确认未售出后本单将关闭且不改变库存，是否继续？'
          : approved
            ? '审核通过后需要在销售出库单中选择批号并完成折价出库，是否继续？'
            : '驳回后本单将关闭，是否继续？',
        trustedSource
          ? approved
            ? '确认销售并出库'
            : '确认未售出'
          : approved
            ? '通过折价销售单'
            : '驳回折价销售单',
        { type: approved ? 'warning' : 'info' },
      );
      approveComment = approved
        ? trustedSource
          ? '确认销售并出库'
          : '折价销售单审核通过'
        : trustedSource
          ? '确认未售出'
          : '折价销售单审核驳回';
    }
    body = { approved, comment: approveComment };
  }
  if (type === 'confirm') {
    await ElMessageBox.confirm('确认后会立即改变真实库存，是否继续？', '库存影响确认', {
      type: 'warning',
    });
    body = { comment: '确认' };
  }
  if (type === 'undo-confirm') {
    await ElMessageBox.confirm('撤销后将回退库存，是否继续？', '撤销确认', { type: 'warning' });
    body = { comment: '撤销' };
  }
  if (type === 'terminate')
    await ElMessageBox.confirm('终止后将关闭未执行出库和未处理缺料，是否继续？', '终止生产计划', {
      type: 'warning',
    });
  if (type === 'process')
    await ElMessageBox.confirm(
      row.successorType === 'sales_return'
        ? '该退货已经完成返库，本次仅将关联售后事项标记为已完成，是否继续？'
        : Number(row.eventType) === 5
          ? '办理后将先确认退货返库，再生成一张待确认换货出库单，是否继续？'
          : Number(row.eventType) === 4
            ? '办理后将自动生成并确认销售退货返库，是否继续？'
            : '确认将该售后事项标记为已完成？',
      '售后处理',
      { type: 'warning' },
    );
  const result: any = await api.post(url, body);
  ElMessage.success(result?.message ?? '操作成功');
  await load();
}
async function remove(row: B) {
  await ElMessageBox.confirm('确定删除（或作废）这条业务记录吗？', '操作确认', { type: 'warning' });
  await api.delete(`/${group.value}/${resource.value}/${row.id}`);
  ElMessage.success('操作成功');
  load();
}
const canApprove = (r: B) =>
  key.value !== 'sales/orders' &&
  !['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'].includes(String(r.oaStatus ?? '')) &&
  Number(r.approveStatus ?? r.approve_status) === 0 &&
  (Number(r.status) === 1 || Number(r.planStatus) === 1 || group.value === 'sales');
const canRejectReverseGeneratedApplication = (r: B) =>
  key.value === 'requisitions/applications' &&
  Boolean(r.reverseGenerated) &&
  Number(r.approveStatus ?? r.approve_status) === 1;
const canConfirmSourcedDiscount = (r: B) =>
  key.value === 'sales/discount-orders' &&
  Number(r.businessSourceId ?? r.business_source_id) > 0 &&
  Number(r.approveStatus ?? r.approve_status) !== 2 &&
  Number(r.deliveryStatus ?? r.delivery_status) !== 3;
const canEdit = (r: B) =>
  !isMoney.value &&
  !['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'].includes(String(r.oaStatus ?? '')) &&
  !(isService.value && r.sourceSystem) &&
  key.value !== 'production/inputs' &&
  Number(r.confirmStatus ?? r.comfirm_status) !== 1 &&
  Number(r.approveStatus ?? r.approve_status) !== 1 &&
  (key.value !== 'production/plans' || [0, 1].includes(Number(r.planStatus)));
const canRemove = (r: B) =>
  isService.value && r.sourceSystem
    ? false
    : key.value === 'sales/discount-orders' &&
        Number(r.businessSourceId ?? r.business_source_id) > 0
      ? false
      : isMoney.value ||
        (isService.value && Number(r.eventStatus) !== 2) ||
        (key.value === 'production/inputs' && Number(r.confirmStatus ?? r.status) !== 1) ||
        key.value === 'production/outputs' ||
        ([
          'sales/outputs',
          'sales/returns',
          'requisitions/outputs',
          'requisitions/returns',
        ].includes(key.value) &&
          Number(r.confirmStatus) !== 1) ||
        [
          'sales/orders',
          'sales/discount-orders',
          'production/plans',
          'production/boms',
          'requisitions/applications',
        ].includes(key.value);
const approvedOrder = (r: B) =>
  key.value === 'sales/orders' || Number(r.approveStatus ?? r.approve_status) === 1;
const orderNetReceived = (r: B) =>
  Number(r.netAmount ?? Number(r.receivedAmount || 0) - Number(r.refundedAmount || 0));
const discountSaleOutputCompleted = (r: B) =>
  Number(r.propertyType ?? r.so_property_type) !== 2 ||
  Number(r.deliveryStatus ?? r.delivery_status) === 3;
const canReceive = (r: B) =>
  approvedOrder(r) &&
  discountSaleOutputCompleted(r) &&
  Math.max(0, Number(r.amount || r.actualAmount || 0) - orderNetReceived(r)) > 0.000001;
const canRefund = (r: B) => approvedOrder(r) && orderNetReceived(r) > 0.000001;
const canDirectOutput = (r: B) =>
  approvedOrder(r) &&
  Number(r.deliveryQty || 0) + 0.000001 < Number(r.quantity || 0) &&
  Number(r.orderStatus ?? r.order_status) !== 3;
const canStartReturn = (r: B) => approvedOrder(r) && Number(r.deliveryQty || 0) > 0.000001;
const canAnalyzeGap = (r: B) =>
  approvedOrder(r) &&
  Number(r.propertyType ?? r.so_property_type) === 1 &&
  Number(r.orderStatus ?? r.order_status) === 1;
const selectableSalesOrders = computed(() =>
  !isMoney.value || moneyOrderLocked.value
    ? options.orders
    : options.orders.filter((item: B) =>
        resource.value === 'payments' ? canReceive(item) : canRefund(item),
      ),
);
async function startMoney(row: B, target: 'payments' | 'refunds') {
  await router.push({ path: `/sales/${target}`, query: { create: '1', orderId: String(row.id) } });
}
async function startSalesRelated(row: B, target: 'returns' | 'services') {
  await router.push({ path: `/sales/${target}`, query: { create: '1', orderId: String(row.id) } });
}
const expandSupplements = reactive<Record<string, B[]>>({});
const loadingSupplements = reactive<Record<string, boolean>>({});
const businessTableRef = ref<any>();
const expandedOutputRows = ref<Set<string>>(new Set());
async function handleOutputExpand(row: B, expandedRows: B[]) {
  expandedOutputRows.value = new Set(expandedRows.map((item) => String(item.id)));
  if (Number(row.outType) !== 1 || !expandedOutputRows.value.has(String(row.id))) return;
  const key = String(row.id);
  if (Object.prototype.hasOwnProperty.call(expandSupplements, key) || loadingSupplements[key])
    return;
  loadingSupplements[key] = true;
  try {
    const detail: any = await api.get(`/production/outputs/${row.id}`);
    expandSupplements[key] = detail.supplements ?? [];
  } catch {
    expandSupplements[key] = [];
  } finally {
    loadingSupplements[key] = false;
  }
}
function toggleOutputDetails(row: B) {
  businessTableRef.value?.toggleRowExpansion(row, !expandedOutputRows.value.has(String(row.id)));
}
const outputRowClassName = ({ row }: { row: B }) =>
  key.value === 'production/outputs' && Number(row.outType) !== 1 ? 'output-row-no-expand' : '';
const executeOutVisible = ref(false),
  tempSupplVisible = ref(false),
  editOutVisible = ref(false),
  viewOutVisible = ref(false),
  bomReturnVisible = ref(false),
  labOutVisible = ref(false),
  selectedOutRow = ref<B>({});
const inputVisible = ref(false),
  selectedInputRow = ref<B | undefined>(undefined),
  inputReadonly = ref(false);
const traceVisible = ref(false),
  traceRow = ref<B>({});
const traceType = computed(() => workflowDocumentType(group.value, resource.value, traceRow.value));
function openTrace(row: B) {
  traceRow.value = row;
  traceVisible.value = true;
}
async function openAutomaticRequisitionOutput(row: B) {
  if (!row.autoOutputId) {
    ElMessage.warning('审批生成的领用出库草稿尚未找到，请刷新后重试');
    return;
  }
  await router.push({
    path: '/requisitions/outputs',
    query: {
      documentId: String(row.autoOutputId),
      view: Number(row.autoOutputConfirmStatus) === 1 ? '1' : '0',
    },
  });
}
function openExecuteOut(row: B) {
  selectedOutRow.value = row;
  executeOutVisible.value = true;
}
function openTempSuppl(row: B) {
  selectedOutRow.value = row;
  tempSupplVisible.value = true;
}
function openBomReturn(row: B) {
  selectedOutRow.value = row;
  bomReturnVisible.value = true;
}
function openTemporaryOutputCreate() {
  labOutVisible.value = true;
}
async function openDirectRequisitionOutput() {
  reset();
  mode.value = 'create';
  form.directOutput = true;
  form.requestKey = createRequestId();
  form.drawType = 2;
  form.details = [{ ...blank(), returnable: true }];
  await loadRequisitionFormOptions(form.orgId);
  dialog.value = true;
}
function openWorkflowView(row: B) {
  if (key.value === 'production/inputs') {
    selectedInputRow.value = row;
    inputReadonly.value = true;
    inputVisible.value = true;
    return;
  }
  if (key.value === 'production/outputs') {
    selectedOutRow.value = row;
    viewOutVisible.value = true;
    return;
  }
  open(row, true);
}
async function onDialogDone() {
  Object.keys(expandSupplements).forEach((cacheKey) => delete expandSupplements[cacheKey]);
  expandedOutputRows.value = new Set();
  await Promise.all([load(), loadOptions()]);
}
async function confirmPendingSupplement(row: B) {
  await ElMessageBox.confirm('确认后将按补料明细立即扣减库存，是否继续？', '确认补料出库', {
    type: 'warning',
  });
  await api.post(`/production/outputs/${row.id}/confirm`, {
    comment: String(row.remark ?? '临时补料'),
    details: row.details ?? [],
  });
  ElMessage.success('临时补料已确认出库');
  await onDialogDone();
}
const inputPlans = computed(() =>
  (options.plans as B[]).filter(
    (p: B) => Number(p.planStatus) === 3 && Number(p.deliveredQty) < Number(p.planQty),
  ),
);
function ensureMoneyOrderOption() {
  if (!form.orderId || options.orders.some((item: B) => String(item.id) === String(form.orderId)))
    return;
  options.orders.unshift({
    id: form.orderId,
    orderNo: form.orderNo,
    customerName: form.customerName,
    customerMobile: form.customerMobile,
    orgId: form.orgId,
  });
}
function normalizeMoneyDepartment() {
  if (!form.deptId) return;
  const selected = options.depts.find((item: B) => String(item.value) === String(form.deptId));
  const selectedOrg = selected?.raw?.orgId ?? selected?.orgId;
  if (!selected || String(selectedOrg) !== String(form.orgId)) form.deptId = '';
}
async function onMainDialogClosed() {
  moneyOrderLocked.value = false;
  temporaryCreateMode.value = false;
  if (group.value === 'sales' && isMoney.value && String(route.query.create ?? '') === '1')
    await router.replace({ path: route.path });
}
async function openFromRoute() {
  if (String(route.query.create ?? '') === '1' && !route.query.orderId) {
    reset();
    mode.value = 'create';
    dialog.value = true;
    router.replace({ path: route.path });
  }
  if (group.value === 'requisitions') {
    if (route.query.documentId) {
      await open({ id: String(route.query.documentId) }, String(route.query.view ?? '') === '1');
      await router.replace({ path: route.path });
    } else if (resource.value === 'outputs' && route.query.applicationId) {
      const application: any = await api.get(
        `/requisitions/applications/${String(route.query.applicationId)}`,
      );
      if (application.autoOutputId)
        await open(
          { id: application.autoOutputId },
          Number(application.autoOutputConfirmStatus) === 1,
        );
      else {
        reset();
        mode.value = 'create';
        form.applicationId = String(route.query.applicationId);
        await sourceChanged();
        dialog.value = true;
      }
      await router.replace({ path: route.path });
    } else if (resource.value === 'returns' && route.query.outputId) {
      reset();
      mode.value = 'create';
      form.outputId = String(route.query.outputId);
      await sourceChanged();
      dialog.value = true;
      await router.replace({ path: route.path });
    }
  }
  if (group.value === 'production' && resource.value === 'outputs' && route.query.planId) {
    reset();
    mode.value = 'create';
    form.planId = String(route.query.planId);
    if (route.query.outType) form.outType = Number(route.query.outType);
    await sourceChanged();
    dialog.value = true;
    router.replace({ path: route.path });
  }
  if (group.value === 'sales' && resource.value === 'outputs' && route.query.orderId) {
    reset();
    mode.value = 'create';
    form.orderId = String(route.query.orderId);
    await sourceChanged();
    dialog.value = true;
    router.replace({ path: route.path });
  }
  if (group.value === 'sales' && resource.value === 'outputs' && route.query.documentId) {
    await open({ id: String(route.query.documentId) }, String(route.query.view ?? '') === '1');
    await router.replace({ path: route.path });
  }
  if (
    group.value === 'sales' &&
    ['returns', 'services'].includes(resource.value) &&
    String(route.query.create ?? '') === '1' &&
    route.query.orderId
  ) {
    reset();
    mode.value = 'create';
    form.orderId = String(route.query.orderId);
    await sourceChanged();
    dialog.value = true;
    await router.replace({ path: route.path });
  }
  if (
    group.value === 'sales' &&
    isMoney.value &&
    String(route.query.create ?? '') === '1' &&
    route.query.orderId
  ) {
    reset();
    mode.value = 'create';
    moneyOrderLocked.value = true;
    form.orderId = String(route.query.orderId);
    try {
      await sourceChanged();
      ensureMoneyOrderOption();
      normalizeMoneyDepartment();
      dialog.value = true;
    } catch (error: any) {
      moneyOrderLocked.value = false;
      ElMessage.error(error?.response?.data?.message ?? '销售订单资金摘要加载失败');
      await router.replace({ path: route.path });
    }
  }
}
onMounted(async () => {
  await auth.load();
  await Promise.all([loadOptions(), loadDictionaries()]);
  await load();
  await openFromRoute();
});
watch(key, async () => {
  query.page = 1;
  query.status = '';
  await Promise.all([loadOptions(), loadDictionaries()]);
  await load();
  await openFromRoute();
});
</script>
<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>{{ current.title }}</h2>
        <p class="page-subtitle">真实业务数据、来源追溯与库存事务处理</p>
      </div>
      <el-button
        v-if="
          current.creatable !== false &&
          key !== 'production/outputs' &&
          key !== 'production/inputs' &&
          key !== 'requisitions/outputs'
        "
        type="primary"
        :disabled="(isOrder || isMoney) && !canEditAmount"
        @click="open()"
        >{{ current.createText || '新增' + current.title }}</el-button
      >
      <el-button
        v-if="key === 'production/outputs'"
        type="primary"
        @click="openTemporaryOutputCreate"
        >新增临时出库</el-button
      >
      <el-button
        v-if="key === 'requisitions/outputs'"
        type="primary"
        @click="openDirectRequisitionOutput"
        >直接领用出库</el-button
      >
      <el-button
        v-if="key === 'production/inputs'"
        type="primary"
        @click="
          selectedInputRow = undefined;
          inputReadonly = false;
          inputVisible = true;
        "
        >新增生产成品入库单</el-button
      >
    </header>
    <div v-if="current.summary" class="summary-strip">
      <template v-if="key === 'production/outputs'">
        <div>
          <span>出库单总数</span><strong>{{ total }}</strong>
        </div>
        <div>
          <span>待处理</span><strong>{{ summary.pending ?? 0 }}</strong>
        </div>
        <div>
          <span>已出库</span><strong>{{ summary.completed ?? 0 }}</strong>
        </div>
      </template>
      <template v-else>
        <div>
          <span>本期金额</span><strong>¥ {{ moneyText(summary.periodAmount || 0) }}</strong>
        </div>
        <div>
          <span>累计收款</span><strong>¥ {{ moneyText(summary.receivedAmount || 0) }}</strong>
        </div>
        <div>
          <span>累计退款</span><strong>¥ {{ moneyText(summary.refundedAmount || 0) }}</strong>
        </div>
        <div>
          <span>当前净收款</span
          ><strong
            >¥
            {{ moneyText((summary.receivedAmount || 0) - (summary.refundedAmount || 0)) }}</strong
          >
        </div>
      </template>
    </div>
    <div class="query-bar">
      <el-input
        v-model="query.keyword"
        clearable
        placeholder="单号 / 客户 / 商品"
        style="width: 260px"
      />
      <el-select
        v-if="key === 'production/outputs'"
        v-model="query.outType"
        clearable
        placeholder="出库类型"
        style="width: 140px"
        ><el-option
          v-for="item in options.dictionaries.production_material_out_type || []"
          :key="item.value"
          :label="item.label"
          :value="item.value"
      /></el-select>
      <el-select
        v-if="statusOptions.length"
        v-model="query.status"
        clearable
        placeholder="业务状态"
        style="width: 160px"
        ><el-option
          v-for="item in statusOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
      /></el-select>
      <el-button
        type="primary"
        @click="
          query.page = 1;
          load();
        "
        >查询</el-button
      >
      <el-button
        @click="
          query.keyword = '';
          query.status = '';
          query.outType = '';
          load();
        "
        >重置</el-button
      >
    </div>
    <div class="table-card">
      <el-table
        ref="businessTableRef"
        :data="rows"
        v-loading="loading"
        border
        stripe
        row-key="id"
        :row-class-name="outputRowClassName"
        @expand-change="handleOutputExpand"
      >
        <el-table-column type="index" label="序号" width="65" />
        <el-table-column prop="id" label="ID" width="100" />
        <el-table-column
          v-for="column in current.columns"
          :key="column.prop"
          :label="column.label"
          :width="column.width"
          :min-width="column.minWidth"
        >
          <template #default="s">
            <el-progress
              v-if="column.kind === 'progress'"
              :percentage="Math.round(Number(s.row[column.prop] || 0))"
              :stroke-width="7"
            />
            <el-tag v-else-if="column.kind === 'status'" effect="plain">{{
              displayCell(s.row, column)
            }}</el-tag>
            <span v-else>{{ displayCell(s.row, column) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          v-if="key === 'production/outputs'"
          type="expand"
          width="1"
          class-name="output-expand-mechanism"
          label-class-name="output-expand-mechanism"
        >
          <template #default="s">
            <div class="output-supplement-panel">
              <div class="output-supplement-head">
                <div>
                  <strong>{{ s.row.outNo }}</strong
                  ><span>关联临时补料记录</span>
                </div>
                <el-tag effect="plain" type="info"
                  >{{ expandSupplements[String(s.row.id)]?.length ?? 0 }} 张补料单</el-tag
                >
              </div>
              <div v-loading="loadingSupplements[String(s.row.id)]" class="output-supplement-body">
                <el-empty
                  v-if="
                    !loadingSupplements[String(s.row.id)] &&
                    !expandSupplements[String(s.row.id)]?.length
                  "
                  :image-size="48"
                  description="暂无临时补料记录"
                />
                <el-table
                  v-else
                  :data="expandSupplements[String(s.row.id)] ?? []"
                  border
                  size="small"
                  table-layout="fixed"
                >
                  <el-table-column
                    prop="outNo"
                    label="补料单号"
                    width="168"
                    show-overflow-tooltip
                  />
                  <el-table-column label="补料说明" min-width="150" show-overflow-tooltip
                    ><template #default="d">{{
                      d.row.remark ?? '临时补料'
                    }}</template></el-table-column
                  >
                  <el-table-column label="物料种数" width="88" align="right"
                    ><template #default="d">{{
                      (d.row.details ?? []).length
                    }}</template></el-table-column
                  >
                  <el-table-column label="补料数量" width="96" align="right"
                    ><template #default="d">{{
                      (d.row.details ?? []).reduce(
                        (sum: number, item: B) => sum + Number(item.quantity ?? 0),
                        0,
                      )
                    }}</template></el-table-column
                  >
                  <el-table-column label="涉及批号" min-width="160" show-overflow-tooltip
                    ><template #default="d">{{
                      (d.row.details ?? [])
                        .map((item: B) => item.batchNo || '—')
                        .filter(
                          (value: string, index: number, array: string[]) =>
                            array.indexOf(value) === index,
                        )
                        .join('、')
                    }}</template></el-table-column
                  >
                  <el-table-column label="状态" width="88" align="center"
                    ><template #default="d"
                      ><el-tag
                        :type="Number(d.row.confirmStatus) === 1 ? 'success' : 'warning'"
                        effect="plain"
                        >{{ dictionaryLabel('confirm_status', d.row.confirmStatus) }}</el-tag
                      ></template
                    ></el-table-column
                  >
                  <el-table-column label="创建时间" width="160"
                    ><template #default="d">{{
                      dateText(d.row.outDate ?? d.row.createdAt)
                    }}</template></el-table-column
                  >
                  <el-table-column label="操作" width="120" align="center"
                    ><template #default="d"
                      ><el-button
                        v-if="Number(d.row.confirmStatus) === 0"
                        link
                        type="primary"
                        @click="confirmPendingSupplement(d.row)"
                        >确认出库</el-button
                      ><el-button v-else link type="success" @click="openBomReturn(d.row)"
                        >BOM退库</el-button
                      ></template
                    ></el-table-column
                  >
                </el-table>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="176" fixed="right" align="center">
          <template #default="s">
            <TableRowActions>
              <el-button link type="primary" @click="openWorkflowView(s.row)">查看</el-button>
              <el-button
                v-if="canEdit(s.row) && key !== 'production/outputs' && key !== 'production/inputs'"
                link
                type="primary"
                @click="open(s.row)"
                >编辑</el-button
              >
              <el-button
                v-if="canEdit(s.row) && key === 'production/outputs'"
                link
                type="primary"
                @click="
                  selectedOutRow = s.row;
                  editOutVisible = true;
                "
                >编辑</el-button
              >
              <template #more>
                <!-- 暂时隐藏“业务链路”入口，保留底层查询能力以便后续恢复。
                <el-dropdown-item
                  v-if="workflowDocumentType(group, resource, s.row)"
                  @click="openTrace(s.row)"
                  >业务链路</el-dropdown-item
                >
                -->
                <el-dropdown-item
                  v-if="key === 'requisitions/applications' && s.row.oaStatus === 'PUSH_FAILED'"
                  class="table-action-warning"
                  @click="retryOa(s.row)"
                  >重新提交OA</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="canApprove(s.row) || canConfirmSourcedDiscount(s.row)"
                  class="table-action-success"
                  @click="action(s.row, 'approve')"
                  >{{
                    key === 'sales/discount-orders' &&
                    Number(s.row.businessSourceId ?? s.row.business_source_id) > 0
                      ? '确认销售并出库'
                      : '通过'
                  }}</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    canApprove(s.row) ||
                    canConfirmSourcedDiscount(s.row) ||
                    canRejectReverseGeneratedApplication(s.row)
                  "
                  class="table-action-danger"
                  @click="action(s.row, 'approve', false)"
                  >{{
                    key === 'sales/discount-orders' &&
                    Number(s.row.businessSourceId ?? s.row.business_source_id) > 0
                      ? '确认未售出'
                      : '驳回'
                  }}</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="s.row.confirmStatus === 0 && key !== 'production/outputs'"
                  class="table-action-success"
                  @click="action(s.row, 'confirm')"
                  >确认</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'sales/orders' && canAnalyzeGap(s.row)"
                  @click="action(s.row, 'analyze')"
                  >缺口分析</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'sales/orders' && canDirectOutput(s.row)"
                  @click="
                    router.push({ path: '/sales/outputs', query: { orderId: String(s.row.id) } })
                  "
                  >直接出库</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'sales/discount-orders' &&
                    approvedOrder(s.row) &&
                    !Number(s.row.businessSourceId ?? s.row.business_source_id) &&
                    Number(s.row.deliveryStatus ?? s.row.delivery_status) !== 3
                  "
                  @click="
                    router.push({ path: '/sales/outputs', query: { orderId: String(s.row.id) } })
                  "
                  >生成折价出库</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    ['sales/orders', 'sales/discount-orders'].includes(key) && canReceive(s.row)
                  "
                  class="table-action-success"
                  @click="startMoney(s.row, 'payments')"
                  >登记收款</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="['sales/orders', 'sales/discount-orders'].includes(key) && canRefund(s.row)"
                  class="table-action-warning"
                  @click="startMoney(s.row, 'refunds')"
                  >登记退款</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'sales/orders' && canStartReturn(s.row)"
                  @click="startSalesRelated(s.row, 'returns')"
                  >发起退货</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'sales/orders' && canStartReturn(s.row)"
                  @click="startSalesRelated(s.row, 'services')"
                  >登记售后</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'sales/outputs' && Number(s.row.confirmStatus) === 1"
                  class="table-action-warning"
                  @click="action(s.row, 'undo-confirm')"
                  >撤销确认</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'sales/returns' &&
                    Number(s.row.confirmStatus) === 1 &&
                    Number(s.row.disposalType) === 1
                  "
                  class="table-action-warning"
                  @click="action(s.row, 'undo-confirm')"
                  >撤销确认</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'sales/services' &&
                    Number(s.row.eventStatus) === 1 &&
                    (!s.row.successorId || s.row.successorType === 'sales_return')
                  "
                  class="table-action-success"
                  @click="action(s.row, 'process')"
                  >{{
                    s.row.successorType === 'sales_return'
                      ? '处理完成'
                      : Number(s.row.eventType) === 5
                        ? '办理换货'
                        : Number(s.row.eventType) === 4
                          ? '办理退货'
                          : '处理完成'
                  }}</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'sales/services' &&
                    s.row.successorType === 'sales_exchange_output' &&
                    s.row.successorId
                  "
                  @click="
                    router.push({
                      path: '/sales/outputs',
                      query: { documentId: String(s.row.successorId) },
                    })
                  "
                  >办理换货出库</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'production/plans' &&
                    Number(s.row.approveStatus) === 0 &&
                    Number(s.row.planStatus) === 7 &&
                    Number(s.row.outboundStatus) === 0 &&
                    Number(s.row.materialStatus) === 4
                  "
                  class="table-action-warning"
                  @click="action(s.row, 'recheck')"
                  >重校库存</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'production/plans' &&
                    Number(s.row.approveStatus) === 1 &&
                    Number(s.row.planStatus) === 3 &&
                    Number(s.row.stockCheckStatus) === 1 &&
                    [1, 4].includes(Number(s.row.materialStatus)) &&
                    Number(s.row.outboundStatus) === 0
                  "
                  @click="
                    router.push({
                      path: '/production/outputs',
                      query: { planId: String(s.row.id), outType: '1' },
                    })
                  "
                  >生成BOM出库</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'production/plans' &&
                    ![5, 6].includes(Number(s.row.planStatus)) &&
                    Number(s.row.outboundStatus) !== 2
                  "
                  class="table-action-danger"
                  @click="action(s.row, 'terminate')"
                  >终止</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'production/boms'"
                  @click="action(s.row, 'toggle-bom')"
                  >{{
                    dictionaryLabel('enabled_status', Number(s.row.status) === 1 ? 2 : 1)
                  }}</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'production/outputs' &&
                    Number(s.row.outType) === 1 &&
                    Number(s.row.confirmStatus ?? s.row.status) === 0
                  "
                  class="table-action-success"
                  @click="openExecuteOut(s.row)"
                  >执行出库</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'production/outputs' &&
                    Number(s.row.outType) !== 1 &&
                    Number(s.row.confirmStatus ?? s.row.status) === 0
                  "
                  class="table-action-success"
                  @click="action(s.row, 'confirm')"
                  >确认出库</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'production/outputs' &&
                    Number(s.row.outType) === 1 &&
                    Number(s.row.confirmStatus) === 1
                  "
                  @click="openTempSuppl(s.row)"
                  >临时补料</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'production/outputs' &&
                    Number(s.row.outType) === 1 &&
                    Number(s.row.confirmStatus) === 1
                  "
                  class="table-action-success"
                  @click="openBomReturn(s.row)"
                  >BOM退库</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'production/outputs' && Number(s.row.outType) === 1"
                  @click="toggleOutputDetails(s.row)"
                  >{{
                    expandedOutputRows.has(String(s.row.id)) ? '收起补料明细' : '补料明细'
                  }}</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'production/shortages' && Number(s.row.status) === 0"
                  class="table-action-danger"
                  @click="action(s.row, 'terminate')"
                  >终止生产</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'requisitions/outputs' && Number(s.row.confirmStatus) === 1"
                  class="table-action-warning"
                  @click="action(s.row, 'undo-confirm')"
                  >撤销确认</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'requisitions/returns' && Number(s.row.confirmStatus) === 1"
                  class="table-action-warning"
                  @click="action(s.row, 'undo-confirm')"
                  >撤销确认</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'requisitions/applications' &&
                    (Number(s.row.approveStatus) === 1 || Boolean(s.row.reverseGenerated)) &&
                    s.row.autoOutputId
                  "
                  @click="openAutomaticRequisitionOutput(s.row)"
                  >{{
                    Number(s.row.autoOutputConfirmStatus) === 1 ? '查看出库' : '办理出库'
                  }}</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="key === 'requisitions/outputs' && s.row.applicationId"
                  @click="
                    router.push({
                      path: '/requisitions/applications',
                      query: { documentId: String(s.row.applicationId), view: '1' },
                    })
                  "
                  >查看领用申请</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="
                    key === 'requisitions/outputs' &&
                    Number(s.row.confirmStatus) === 1 &&
                    s.row.hasReturnableItems
                  "
                  @click="
                    router.push({
                      path: '/requisitions/returns',
                      query: { outputId: String(s.row.id) },
                    })
                  "
                  >生成退回</el-dropdown-item
                >
                <el-dropdown-item
                  v-if="canRemove(s.row)"
                  class="table-action-danger"
                  divided
                  @click="remove(s.row)"
                  >{{ isMoney ? '作废' : '删除' }}</el-dropdown-item
                >
              </template>
            </TableRowActions>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @change="load"
      />
    </div>
    <el-dialog
      v-model="dialog"
      :title="
        temporaryCreateMode
          ? '新增临时出库'
          : `${mode === 'view' ? '查看' : mode === 'edit' ? '编辑' : '新增'}${current.title}`
      "
      width="1080px"
      @closed="onMainDialogClosed"
    >
      <el-form label-position="top" :disabled="mode === 'view'">
        <div class="dialog-grid">
          <el-form-item v-if="isBom" label="BOM名称">
            <el-input v-model="form.bomName" />
          </el-form-item>
          <el-form-item v-if="isBom" label="成品">
            <el-select v-model="form.goodsId" filterable @change="goodsChanged(form)">
              <el-option
                v-for="g in options.goods"
                :key="g.id"
                :label="g.goodsName"
                :value="g.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isBom" label="成品SKU">
            <el-select v-model="form.skuId" :disabled="mode === 'view' || !form.goodsId" clearable>
              <el-option
                v-for="s in options.goodsSkus || []"
                :key="s.id"
                :label="s.spec_models || s.specModels || '默认'"
                :value="s.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isPlan" label="BOM">
            <el-select v-model="form.bomId" filterable @change="sourceChanged">
              <el-option v-for="x in options.boms" :key="x.id" :label="x.bomName" :value="x.id" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isPlan && form.bomId" label="成品"
            ><el-input
              :model-value="goodsOf(form).goodsName || form.goodsName || form.goodsId"
              readonly
          /></el-form-item>
          <el-form-item v-if="isPlan" label="生产数量">
            <el-input-number
              v-model="form.planQty"
              :min="1"
              :max="Number(form.maxPlanQty) || undefined"
              :precision="0"
              :step="1"
              @change="planQuantityChanged"
            />
          </el-form-item>
          <el-form-item v-if="isInput" label="生产计划">
            <el-select v-model="form.planId" @change="sourceChanged">
              <el-option
                v-for="x in inputPlans"
                :key="x.id"
                :label="`${x.planNo} · ${x.goodsName}`"
                :value="x.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isInput" label="入库成品"
            ><el-input :model-value="goodsOf(form).goodsName || form.goodsId" readonly
          /></el-form-item>
          <el-form-item v-if="isInput && form.planId" label="计划数量"
            ><el-input :model-value="form.planQty" readonly
          /></el-form-item>
          <el-form-item v-if="isInput && form.planId" label="已入库"
            ><el-input :model-value="form.deliveredQty ?? 0" readonly
          /></el-form-item>
          <el-form-item v-if="isInput && form.planId" label="剩余可入"
            ><el-input
              :model-value="
                Math.max(0, (Number(form.planQty) || 0) - (Number(form.deliveredQty) || 0))
              "
              readonly
          /></el-form-item>
          <el-form-item v-if="isOutput && group === 'production'" label="出库类型">
            <el-select
              v-model="form.outType"
              :disabled="mode === 'view'"
              @change="
                form.planId = '';
                form.details = [];
                form.bomNo = '';
                form.goodsName = '';
              "
            >
              <el-option
                v-for="item in productionOutputTypes"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)"
              />
            </el-select>
          </el-form-item>
          <el-form-item
            v-if="isOutput && group === 'production' && form.outType !== 3"
            label="生产计划"
          >
            <el-select v-model="form.planId" :disabled="mode !== 'create'" @change="sourceChanged">
              <el-option v-for="x in options.plans" :key="x.id" :label="x.planNo" :value="x.id" />
            </el-select>
          </el-form-item>
          <el-form-item
            v-if="isOutput && group === 'production' && form.outType === 3"
            label="所属组织"
          >
            <el-tree-select
              v-model="form.orgId"
              :data="organizationTree"
              filterable
              check-strictly
              node-key="value"
              :props="{ label: 'label', children: 'children' }"
            />
            ></el-form-item
          >
          <el-form-item
            v-if="isOutput && group === 'production' && form.outType === 3"
            label="仓库"
          >
            <el-select v-model="form.warehouseId" filterable
              ><el-option
                v-for="x in options.warehouses"
                :key="x.value"
                :label="x.label"
                :value="x.value" /></el-select
          ></el-form-item>
          <el-form-item v-if="isOutput && group === 'production' && form.planId" label="BOM编号"
            ><el-input :model-value="form.bomNo" readonly
          /></el-form-item>
          <el-form-item v-if="isOutput && group === 'production' && form.planId" label="生产成品"
            ><el-input :model-value="form.goodsName" readonly
          /></el-form-item>
          <el-form-item v-if="isOutput && group === 'production' && form.planId" label="库存校验"
            ><el-input
              :model-value="dictionaryLabel('production_stock_check_status', form.stockCheckStatus)"
              readonly
          /></el-form-item>
          <el-form-item
            v-if="(isOutput || isReturn || isMoney || isService) && group === 'sales'"
            label="销售订单"
          >
            <el-select
              v-model="form.orderId"
              filterable
              :disabled="
                mode === 'view' || (isMoney && moneyOrderLocked) || (isOutput && mode !== 'create')
              "
              @change="sourceChanged"
            >
              <el-option
                v-for="x in selectableSalesOrders"
                :key="x.id"
                :label="`${x.orderNo} · ${x.customerName}`"
                :value="x.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isReturn && group === 'sales'" label="来源已确认销售出库单">
            <el-select v-model="form.sourceOutputId" filterable @change="sourceOutputChanged">
              <el-option
                v-for="x in options.salesOutputs"
                :key="x.id"
                :label="x.outputNo"
                :value="x.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isOrder && key === 'sales/discount-orders'" label="来源类型">
            <el-select v-model="form.businessSourceType" disabled
              ><el-option
                v-for="x in options.dictionaries.sales_business_source_type || []"
                :key="x.value"
                :label="x.label"
                :value="String(x.value)"
            /></el-select>
          </el-form-item>
          <el-form-item v-if="isOrder && key === 'sales/discount-orders'" label="来源单号"
            ><el-input v-model="form.businessSourceNo" disabled
          /></el-form-item>
          <el-form-item v-if="isOrder" label="客户">
            <el-select
              v-model="form.customerId"
              :disabled="
                mode === 'view' || (key === 'sales/discount-orders' && !!form.businessSourceNo)
              "
              filterable
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
          <el-form-item v-if="(isOutput || isReturn) && group === 'sales'" label="客户"
            ><el-input v-model="form.customerName" readonly
          /></el-form-item>
          <el-form-item
            v-if="
              isPlan ||
              isInput ||
              ((isOutput || isReturn) && group !== 'production') ||
              key === 'requisitions/applications'
            "
            label="所属组织"
            ><el-select
              v-model="form.orgId"
              :disabled="
                mode === 'view' ||
                group !== 'requisitions' ||
                (isOutput && !form.directOutput) ||
                isReturn
              "
              @change="group === 'requisitions' && requisitionOrganizationChanged()"
              ><el-option
                v-for="x in options.orgs"
                :key="x.value"
                :label="x.label"
                :value="x.value" /></el-select
          ></el-form-item>
          <el-form-item v-if="key === 'requisitions/applications'" label="领用部门">
            <el-select v-model="form.deptId" filterable :disabled="mode === 'view'">
              <el-option
                v-for="x in requisitionDepartmentOptions"
                :key="x.value"
                :label="x.label"
                :value="x.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="key === 'requisitions/applications'" label="领用类型">
            <el-select v-model="form.drawType" :disabled="mode === 'view'" @change="drawTypeChanged"
              ><el-option
                v-for="item in options.dictionaries.draw_type || []"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)"
            /></el-select>
          </el-form-item>
          <el-form-item
            v-if="isOutput && group === 'requisitions' && !form.directOutput"
            label="领用申请"
          >
            <el-select
              v-model="form.applicationId"
              :disabled="mode !== 'create' || Boolean(form.autoCreated)"
              @change="sourceChanged"
            >
              <el-option
                v-for="x in options.applications"
                :key="x.id"
                :label="x.applicationNo"
                :value="x.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isReturn && group === 'requisitions'" label="来源出库">
            <el-select
              v-model="form.outputId"
              :disabled="mode !== 'create'"
              @change="sourceChanged"
            >
              <el-option
                v-for="x in options.outputs"
                :key="x.id"
                :label="x.outputNo"
                :value="x.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="!isMoney && !isService" label="仓库">
            <el-select
              v-model="form.warehouseId"
              :disabled="
                mode === 'view' ||
                !form.orgId ||
                (group === 'requisitions' && isOutput && !form.directOutput) ||
                discountOrderSourceLocked ||
                discountOutputSourceLocked
              "
              @change="businessWarehouseChanged"
            >
              <el-option
                v-for="x in requisitionWarehouseOptions"
                :key="x.value"
                :label="x.label"
                :value="x.value"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isInput" label="本次入库数量">
            <el-input-number v-model="form.quantity" :min="1" :precision="0" :step="1" />
          </el-form-item>
          <el-form-item v-if="isInput" label="批号">
            <el-input v-model="form.batchNo" />
          </el-form-item>
          <el-form-item v-if="isInput" label="生产日期"
            ><el-date-picker v-model="form.productDate" type="date" value-format="YYYY-MM-DD"
          /></el-form-item>
          <el-form-item v-if="isInput" label="有效期"
            ><el-date-picker v-model="form.validityPeriod" type="date" value-format="YYYY-MM-DD"
          /></el-form-item>
          <el-form-item v-if="isOutput && group === 'production'" label="出库类型"
            ><el-select v-model="form.outType" :disabled="mode === 'view'"
              ><el-option
                v-for="item in productionOutputTypes"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)" /></el-select
          ></el-form-item>
          <el-form-item
            v-if="isOutput && group === 'production' && Number(form.outType) === 3"
            label="出库去向"
            required
          >
            <el-select v-model="form.destinationType" :disabled="mode === 'view'">
              <el-option
                v-for="item in options.dictionaries.temporary_outbound_destination || []"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="isService" label="事件类型">
            <el-select v-model="form.eventType" @change="serviceEventTypeChanged"
              ><el-option
                v-for="item in options.dictionaries.after_sale_event_type || []"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)"
            /></el-select>
          </el-form-item>
          <template v-if="isService && form.sourceSystem">
            <el-form-item label="售后来源">
              <el-input :model-value="form.sourceSystemName || form.sourceSystem" readonly />
            </el-form-item>
            <el-form-item label="外部申请号">
              <el-input :model-value="form.externalRequestNo || form.externalRequestId" readonly />
            </el-form-item>
            <el-form-item label="接收时间">
              <el-input :model-value="dateText(form.receivedAt, true)" readonly />
            </el-form-item>
            <el-form-item label="外部原始申请（只读）" class="full-field">
              <el-input
                :model-value="JSON.stringify(form.externalPayload || {}, null, 2)"
                type="textarea"
                :rows="8"
                readonly
              />
            </el-form-item>
          </template>
          <el-form-item v-if="isService && form.orderId" label="订单号"
            ><el-input
              :model-value="form.orderNo || form.orderSummary?.orderNo || form.orderId"
              readonly
          /></el-form-item>
          <el-form-item v-if="isService && form.orderId" label="客户"
            ><el-input :model-value="form.customerName" readonly
          /></el-form-item>
          <el-form-item v-if="isService && form.orderId" label="订单日期"
            ><el-input :model-value="form.orderDate" readonly
          /></el-form-item>
          <el-form-item v-if="isService && form.orderId" label="订单金额"
            ><el-input :model-value="moneyText(form.orderAmount || 0)" readonly
          /></el-form-item>
          <el-form-item v-if="isService" label="售后商品">
            <el-select v-model="form.goodsId" filterable @change="serviceGoodsChanged">
              <el-option
                v-for="g in options.goods.filter(
                  (x: any) =>
                    !form.orderGoodsIds ||
                    !form.orderGoodsIds.length ||
                    form.orderGoodsIds.includes(x.id),
                )"
                :key="g.id"
                :label="g.goodsName"
                :value="g.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="serviceNeedsBatch" label="来源已确认销售出库单" required>
            <el-select
              v-model="form.sourceOutputId"
              filterable
              :disabled="mode === 'view'"
              @change="serviceSourceOutputChanged"
              ><el-option
                v-for="x in options.serviceOutputs"
                :key="x.id"
                :label="x.outputNo"
                :value="x.id"
            /></el-select>
          </el-form-item>
          <el-form-item v-if="isService" label="事件内容">
            <el-input v-model="form.eventContent" />
          </el-form-item>
          <el-form-item v-if="isReturn" label="原因">
            <el-input v-model="form.reason" />
          </el-form-item>
          <el-form-item v-if="isBom" label="所属组织"
            ><el-tree-select
              v-model="form.orgId"
              :data="organizationTree"
              filterable
              check-strictly
              node-key="value"
              :props="{ label: 'label', children: 'children' }"
              @change="bomOrganizationChanged"
            /></el-form-item>
          <el-form-item v-if="isBom" label="状态"
            ><el-select v-model="form.status"
              ><el-option
                v-for="x in options.dictionaries.enabled_status || []"
                :key="x.value"
                :label="x.label"
                :value="Number(x.value)" /></el-select
          ></el-form-item>
          <el-form-item v-if="isBom" label="排序"
            ><el-input-number v-model="form.sort" :min="0"
          /></el-form-item>
          <el-form-item v-if="isPlan" label="关联销售订单" required
            ><el-select
              v-model="form.sourceId"
              filterable
              :disabled="mode !== 'create'"
              @change="planSourceChanged"
              ><el-option
                v-for="x in options.planOrders"
                :key="`${x.id}-${x.goodsId}-${x.skuId}`"
                :label="`${x.orderNo} · ${x.customerName} · 剩余可计划 ${x.remainingQty}`"
                :value="x.id" /></el-select
          ></el-form-item>
          <el-form-item v-if="isPlan" label="销售订单剩余可计划"
            ><el-input
              :model-value="form.sourceId ? form.maxPlanQty : '请先选择BOM和销售订单'"
              readonly
          /></el-form-item>
          <el-form-item v-if="isPlan" label="计划日期"
            ><el-date-picker v-model="form.planDate" type="date" value-format="YYYY-MM-DD"
          /></el-form-item>
          <el-form-item v-if="isPlan" label="成品仓库"
            ><el-select v-model="form.productWarehouseId" disabled
              ><el-option
                v-for="x in options.warehouses"
                :key="x.value"
                :label="x.label"
                :value="x.value" /></el-select
          ></el-form-item>
          <el-form-item v-if="isOrder" label="订单日期"
            ><el-date-picker v-model="form.orderDate" type="date" value-format="YYYY-MM-DD"
          /></el-form-item>
          <el-form-item v-if="isOrder" label="订单来源"
            ><el-select v-model="form.sourceType"
              ><el-option
                v-for="x in options.dictionaries.sales_order_source || []"
                :key="x.value"
                :label="x.label"
                :value="Number(x.value)" /></el-select
          ></el-form-item>
          <el-form-item v-if="isOrder" label="订单属性"
            ><el-select v-model="form.propertyType" disabled
              ><el-option
                v-for="x in options.dictionaries.sales_order_property || []"
                :key="x.value"
                :label="x.label"
                :value="Number(x.value)" /></el-select
          ></el-form-item>
          <el-form-item v-if="isOrder" label="所属组织"
            ><el-tree-select
              v-model="form.orgId"
              :data="organizationTree"
              filterable
              check-strictly
              node-key="value"
              :props="{ label: 'label', children: 'children' }"
              :disabled="mode === 'view' || discountOrderSourceLocked"
              @change="salesOrderOrganizationChanged"
            /></el-form-item>
          <el-form-item v-if="isOrder && key !== 'sales/discount-orders'" label="客户手机"
            ><el-input v-model="form.customerMobile"
          /></el-form-item>
          <el-form-item v-if="isOrder" label="经办人"
            ><el-input v-model="form.salesName"
          /></el-form-item>
          <el-form-item v-if="isOutput && group === 'sales'" label="出库类型"
            ><el-select
              v-model="form.destination"
              :disabled="mode === 'view' || Number(form.destination) === 3"
              ><el-option
                v-for="x in options.dictionaries.sales_output_destination || []"
                :key="x.value"
                :label="x.label"
                :value="Number(x.value)" /></el-select
          ></el-form-item>
          <el-form-item v-if="isOutput" label="出库日期"
            ><el-date-picker v-model="form.outDate" type="date" value-format="YYYY-MM-DD"
          /></el-form-item>
          <el-form-item v-if="(isOutput || isReturn) && group !== 'production'" label="部门"
            ><el-select
              v-model="form.deptId"
              :disabled="mode === 'view' || (group === 'requisitions' && !form.directOutput)"
              ><el-option
                v-for="x in requisitionDepartmentOptions"
                :key="x.value"
                :label="x.label"
                :value="x.value" /></el-select
          ></el-form-item>
          <el-form-item
            v-if="(isOutput || isReturn) && group !== 'production'"
            :label="
              group === 'requisitions' && isOutput
                ? '领用接收人'
                : group === 'requisitions'
                  ? '退回人'
                  : '经办/接收人'
            "
            ><el-select
              v-model="form.receiverId"
              filterable
              :disabled="mode === 'view' || (group === 'requisitions' && !form.directOutput)"
              ><el-option
                v-for="item in group === 'requisitions' ? options.employees : options.users"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
          ></el-form-item>
          <el-form-item v-if="isReturn && group === 'sales'" label="退货后处理"
            ><el-select v-model="form.disposalType"
              ><el-option
                v-for="x in options.dictionaries.sales_return_disposal || []"
                :key="x.value"
                :label="x.label"
                :value="Number(x.value)" /></el-select
          ></el-form-item>
          <el-form-item v-if="isReturn" label="退回日期"
            ><el-date-picker v-model="form.returnDate" type="date" value-format="YYYY-MM-DD"
          /></el-form-item>
          <template v-if="isMoney">
            <div class="funds-section">
              <div class="funds-title">订单摘要</div>
              <el-form-item label="订单号"
                ><el-input :model-value="form.orderNo" readonly
              /></el-form-item>
              <el-form-item label="客户"
                ><el-input :model-value="form.customerName" readonly
              /></el-form-item>
              <el-form-item label="订单日期"
                ><el-input :model-value="form.orderDate" readonly
              /></el-form-item>
              <el-form-item label="订单实际金额"
                ><el-input
                  :model-value="moneyText(form.actualAmount || form.orderActualAmount || 0)"
                  readonly
              /></el-form-item>
            </div>
            <div class="funds-section">
              <div class="funds-title">资金摘要</div>
              <div class="funds-row">
                <el-form-item label="累计收款"
                  ><el-input :model-value="moneyText(form.receivedAmount || 0)" readonly
                /></el-form-item>
                <el-form-item label="累计退款"
                  ><el-input :model-value="moneyText(form.refundedAmount || 0)" readonly
                /></el-form-item>
                <el-form-item label="净收款"
                  ><el-input :model-value="moneyText(form.netAmount || 0)" readonly
                /></el-form-item>
                <el-form-item :label="resource === 'payments' ? '未收金额' : '可退金额'"
                  ><el-input
                    :model-value="
                      moneyText(
                        resource === 'payments' ? form.unreceivedAmount : form.refundableAmount,
                      )
                    "
                    readonly
                /></el-form-item>
              </div>
            </div>
            <el-form-item :label="resource === 'payments' ? '本次收款金额' : '本次退款金额'"
              ><el-input-number
                v-model="form.amount"
                :min="moneyLimit > 0 ? 0.01 : 0"
                :max="moneyLimit"
                :step="0.01"
                :precision="2"
                :disabled="!canEditAmount"
                style="width: 100%"
            /></el-form-item>
            <el-form-item :label="resource === 'payments' ? '付款方式' : '退款方式'"
              ><el-select v-model="form.paymentMode"
                ><el-option
                  v-for="x in options.dictionaries.payment_channel || []"
                  :key="x.value"
                  :label="x.label"
                  :value="Number(x.value)" /></el-select
            ></el-form-item>
            <el-form-item :label="resource === 'payments' ? '收款日期' : '退款日期'"
              ><el-date-picker v-model="form.paymentDate" type="date" value-format="YYYY-MM-DD"
            /></el-form-item>
            <el-form-item label="组织"
              ><el-select v-model="form.orgId" disabled
                ><el-option
                  v-for="x in options.orgs"
                  :key="x.value"
                  :label="x.label"
                  :value="x.value" /></el-select
            ></el-form-item>
            <el-form-item label="部门"
              ><el-select v-model="form.deptId"
                ><el-option
                  v-for="x in (options.depts as any[]).filter(
                    (d: any) =>
                      !form.orgId || String(d.raw?.orgId ?? d.orgId) === String(form.orgId),
                  )"
                  :key="x.value"
                  :label="x.label"
                  :value="x.value" /></el-select
            ></el-form-item>
          </template>
          <el-form-item v-if="key === 'requisitions/applications'" label="领用人"
            ><el-select
              v-model="form.applicantId"
              filterable
              :disabled="mode === 'view'"
              @change="applicantChanged"
              ><el-option
                v-for="item in options.employees"
                :key="item.value"
                :label="item.label"
                :value="item.value" /></el-select
          ></el-form-item>
          <el-form-item v-if="key === 'requisitions/applications'" label="申请日期"
            ><el-date-picker
              v-model="form.date"
              type="date"
              value-format="YYYY-MM-DD"
              :disabled="mode === 'view'"
          /></el-form-item>
          <el-form-item v-if="key === 'requisitions/applications'" label="申请原因" required
            ><el-input v-model="form.reason" :disabled="mode === 'view'"
          /></el-form-item>
          <el-form-item
            v-if="mode === 'view' && key === 'requisitions/applications'"
            label="单据状态"
            ><el-input
              :model-value="form.statusName || dictionaryLabel('requisition_status', form.status)"
              readonly
          /></el-form-item>
          <el-form-item
            v-if="mode === 'view' && key === 'requisitions/applications'"
            label="审批状态"
            ><el-input
              :model-value="
                form.approveStatusName ||
                dictionaryLabel('requisition_approval_status', form.approveStatus)
              "
              readonly
          /></el-form-item>
          <el-form-item v-if="mode === 'view' && key === 'requisitions/applications'" label="审批人"
            ><el-input :model-value="form.approveByName || '—'" readonly
          /></el-form-item>
          <el-form-item
            v-if="mode === 'view' && key === 'requisitions/applications'"
            label="审批时间"
            ><el-input
              :model-value="form.approveDate ? dateText(form.approveDate, true) : '—'"
              readonly
          /></el-form-item>
          <el-form-item
            v-if="mode === 'view' && key === 'requisitions/applications'"
            class="full-field"
            label="审批意见"
            ><el-input :model-value="form.approveComment || '—'" readonly
          /></el-form-item>
          <el-form-item
            v-if="mode === 'view' && group === 'requisitions' && (isOutput || isReturn)"
            label="确认状态"
            ><el-input
              :model-value="
                form.confirmStatusName ||
                dictionaryLabel('requisition_confirm_status', form.confirmStatus)
              "
              readonly
          /></el-form-item>
          <el-form-item
            v-if="mode === 'view' && group === 'requisitions' && (isOutput || isReturn)"
            label="确认人"
            ><el-input :model-value="form.confirmByName || '—'" readonly
          /></el-form-item>
          <el-form-item
            v-if="mode === 'view' && group === 'requisitions' && (isOutput || isReturn)"
            label="确认时间"
            ><el-input
              :model-value="form.confirmDate ? dateText(form.confirmDate, true) : '—'"
              readonly
          /></el-form-item>
          <el-form-item
            v-if="mode === 'view' && group === 'requisitions' && (isOutput || isReturn)"
            class="full-field"
            label="确认意见"
            ><el-input :model-value="form.confirmComment || '—'" readonly
          /></el-form-item>
          <el-form-item
            v-if="key === 'requisitions/applications'"
            class="full-field"
            label="领用人签字"
            required
          >
            <SignaturePad
              :model-value="form.signatureContent"
              :has-stored-signature="Boolean(form.signatureAttachment)"
              :disabled="mode === 'view'"
              @update:model-value="signatureChanged"
            />
          </el-form-item>
          <el-form-item v-if="isInput" label="入库日期"
            ><el-date-picker v-model="form.inputDate" type="date" value-format="YYYY-MM-DD"
          /></el-form-item>
          <el-form-item v-if="isInput" label="库位"
            ><el-input v-model="form.position"
          /></el-form-item>
          <el-form-item v-if="isService" label="事件状态"
            ><el-select v-model="form.eventStatus" disabled
              ><el-option
                v-for="x in options.dictionaries.after_sale_event_status || []"
                :key="x.value"
                :label="x.label"
                :value="Number(x.value)" /></el-select
          ></el-form-item>
          <el-form-item v-if="isService" label="处理人"
            ><el-input v-model="form.handlerId"
          /></el-form-item>
          <el-form-item v-if="isService" label="事件日期"
            ><el-date-picker v-model="form.eventDate" type="date" value-format="YYYY-MM-DD"
          /></el-form-item>
          <el-form-item v-if="isShortage" label="关联计划"
            ><el-input :model-value="form.planNo" readonly
          /></el-form-item>
          <el-form-item v-if="isShortage" label="生产成品"
            ><el-input :model-value="form.productGoodsName" readonly
          /></el-form-item>
          <el-form-item v-if="isShortage" label="原料名称"
            ><el-input :model-value="form.goodsName" readonly
          /></el-form-item>
          <el-form-item v-if="isShortage" label="总需求"
            ><el-input :model-value="form.requireQty" readonly
          /></el-form-item>
          <el-form-item v-if="isShortage" label="当前库存"
            ><el-input :model-value="form.factQty" readonly
          /></el-form-item>
          <el-form-item v-if="isShortage" label="缺口数量"
            ><el-input :model-value="form.gapQty" readonly
          /></el-form-item>
          <el-form-item v-if="isShortage" label="状态"
            ><el-select v-model="form.status" :disabled="mode === 'view'"
              ><el-option
                v-for="item in options.dictionaries.production_shortage_status || []"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)" /></el-select
          ></el-form-item>
          <el-form-item
            v-if="
              isPlan ||
              isBom ||
              isInput ||
              isShortage ||
              key === 'requisitions/applications' ||
              isOrder
            "
            label="操作人"
            ><el-input :model-value="auth.user?.username" readonly
          /></el-form-item>
          <el-form-item
            class="full-field"
            :label="isMoney && resource === 'refunds' ? '退款原因' : '备注'"
            :required="isMoney && resource === 'refunds'"
            ><el-input
              v-model="form.remark"
              type="textarea"
              :rows="2"
              :placeholder="
                isMoney ? (resource === 'refunds' ? '请填写退款原因' : '可填写收款说明') : ''
              "
          /></el-form-item>
        </div>
        <div v-if="key === 'production/outputs'" class="production-detail-section">
          <div class="production-detail-title">明细信息</div>
          <BatchMaterialTable
            :rows="productionDialogRows"
            :stocks="options.stocks"
            :editable="false"
            :mode="Number(form.outType) === 1 ? 'execute' : 'lab'"
          />
        </div>
        <el-table v-else-if="hasLines" :data="form.details" border>
          <el-table-column label="商品" min-width="220">
            <template #default="s">
              <el-select
                v-if="
                  (!isOutput && !isReturn && !isPlan && !isService) ||
                  (isOutput && group === 'production' && form.outType === 3) ||
                  (isOutput && group === 'requisitions' && form.directOutput)
                "
                v-model="s.row.goodsId"
                filterable
                :disabled="mode === 'view' || discountOrderSourceLocked"
                @change="
                  goodsChanged(s.row);
                  key === 'requisitions/applications' && appGoodsChanged(s.row);
                "
              >
                <el-option
                  v-for="g in lineGoodsOptions"
                  :key="g.id"
                  :label="`${g.queryCode || ''} ${g.goodsName}`"
                  :value="g.id"
                />
              </el-select>
              <span v-else>{{ goodsOf(s.row).goodsName || s.row.goodsName || s.row.goodsId }}</span>
            </template>
          </el-table-column>
          <el-table-column label="商品编码" width="125"
            ><template #default="s">{{
              goodsOf(s.row).queryCode || s.row.goodsCode || '—'
            }}</template></el-table-column
          >
          <el-table-column label="SKU/规格" min-width="125"
            ><template #default="s">{{
              s.row.skuSpec || s.row.goodsSpec || s.row.skuId || '—'
            }}</template></el-table-column
          >
          <el-table-column label="单位" width="90"
            ><template #default="s">{{
              lineUnitName(options.units, s.row)
            }}</template></el-table-column
          >
          <el-table-column
            v-if="
              key === 'requisitions/applications' ||
              ((isOutput || isReturn) && group === 'requisitions')
            "
            label="是否可归还"
            width="130"
          >
            <template #default="s">
              <el-select
                v-if="key === 'requisitions/applications'"
                v-model="s.row.returnable"
                placeholder="请选择"
                :disabled="mode === 'view'"
              >
                <el-option
                  v-for="item in options.dictionaries.yes_no || []"
                  :key="item.value"
                  :label="item.label"
                  :value="Number(item.value) === 1"
                />
              </el-select>
              <el-tag v-else :type="s.row.returnable ? 'success' : 'info'" effect="plain">{{
                dictionaryLabel('yes_no', s.row.returnable ? 1 : 0)
              }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="isPlan" prop="bomUnitQty" label="BOM单件用量" width="125" />
          <el-table-column v-if="isPlan" prop="standardQty" label="BOM标准需求" width="125" />
          <el-table-column v-if="isPlan" label="当前库存" width="100"
            ><template #default="s">{{ s.row.currentStock ?? 0 }}</template></el-table-column
          >
          <el-table-column v-if="isPlan" label="计划出库量" width="130"
            ><template #default="s"
              ><el-input-number
                v-model="s.row.planOutQty"
                :min="0"
                :precision="0"
                :step="1" /></template
          ></el-table-column>
          <el-table-column v-if="key === 'requisitions/applications'" label="意向批号" width="250"
            ><template #default="s"
              ><el-select
                v-model="s.row.batchNo"
                filterable
                allow-create
                clearable
                placeholder="选择或输入批号"
                :disabled="mode === 'view'"
                ><el-option
                  v-for="b in s.row.batchOptions ?? []"
                  :key="b.batchNo"
                  :label="b.label"
                  :value="b.batchNo" /></el-select></template
          ></el-table-column>
          <el-table-column
            v-if="isOutput && group === 'production'"
            prop="bomUnitQty"
            label="BOM单件用量"
            width="125"
          />
          <el-table-column
            v-if="isOutput && group === 'production'"
            prop="standardQty"
            label="总需求"
            width="100"
          />
          <el-table-column v-if="isOutput && group === 'production'" label="当前库存" width="100"
            ><template #default="s">{{ s.row.currentStock ?? 0 }}</template></el-table-column
          >
          <el-table-column
            v-if="isOutput && group === 'production'"
            prop="planOutQty"
            label="计划出库量"
            width="125"
          />
          <el-table-column
            v-if="(isOutput || isReturn) && group !== 'requisitions' && group !== 'production'"
            :prop="isReturn ? 'issuedQty' : 'orderQty'"
            :label="isReturn ? '已领/订单量' : '计划/订单量'"
            width="125"
          />
          <el-table-column
            v-if="(isOutput || isReturn) && group === 'requisitions'"
            :prop="isReturn ? 'issuedQty' : 'applicationQty'"
            :label="isReturn ? '已领用数量' : '申请数量'"
            width="125"
          />
          <el-table-column
            v-if="(isOutput || isReturn) && group === 'sales'"
            prop="historicalQty"
            :label="isReturn ? '历史已退' : '历史已出'"
            width="110"
          />
          <el-table-column
            v-if="(isOutput || isReturn) && group === 'sales'"
            prop="remainingQty"
            :label="isReturn ? '可退数量' : '剩余可出'"
            width="110"
          />
          <el-table-column
            v-if="serviceNeedsBatch"
            prop="sourceOutputNo"
            label="来源出库单"
            width="160"
          />
          <el-table-column
            v-if="serviceNeedsBatch"
            prop="sourceQuantity"
            label="来源出库数量"
            width="120"
          />
          <el-table-column
            v-if="serviceNeedsBatch"
            prop="remainingQty"
            label="剩余可退换"
            width="115"
          />
          <el-table-column v-if="isOutput && group === 'sales'" label="单价" width="100"
            ><template #default="s">{{ moneyText(s.row.price || 0) }}</template></el-table-column
          >
          <el-table-column v-if="isOutput && group === 'sales'" label="金额" width="100"
            ><template #default="s">{{
              moneyText(Number(s.row.quantity || 0) * Number(s.row.price || 0))
            }}</template></el-table-column
          >
          <el-table-column v-if="isReturn && group === 'sales'" label="处理方式" width="100"
            ><template #default="s">{{
              (options.dictionaries.sales_return_disposal || []).find(
                (x: any) => String(x.value) === String(form.disposalType ?? s.row.disposalType),
              )?.label || '—'
            }}</template></el-table-column
          >
          <el-table-column
            v-if="(isOutput || isReturn) && group === 'requisitions'"
            prop="historicalQty"
            :label="isReturn ? '历史已退' : '历史已出'"
            width="110"
          />
          <el-table-column
            v-if="(isOutput || isReturn) && group === 'requisitions'"
            prop="remainingQty"
            :label="isReturn ? '可退数量' : '剩余可出'"
            width="110"
          />
          <el-table-column
            v-if="isOutput || isReturn || serviceNeedsBatch"
            label="库存批次"
            min-width="200"
          >
            <template #default="s">
              <span
                v-if="
                  isReturn || serviceNeedsBatch || discountOutputSourceLocked || s.row.sourceLocked
                "
                >{{ s.row.batchNo || '无批号' }}</span
              >
              <el-select
                v-else
                v-model="s.row.stockKey"
                filterable
                :disabled="mode === 'view' || discountOutputSourceLocked || s.row.sourceLocked"
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
            </template>
          </el-table-column>
          <el-table-column
            v-if="isReturn && group === 'requisitions'"
            label="退回库位"
            min-width="160"
          >
            <template #default="s">
              <el-input
                v-model="s.row.storageLocation"
                maxlength="100"
                :disabled="mode === 'view'"
                placeholder="自定义库位文字"
              />
            </template>
          </el-table-column>
          <el-table-column label="数量" width="155">
            <template #default="s">
              <el-input-number
                v-model="s.row.quantity"
                :min="serviceNeedsBatch ? 0 : 1"
                :max="s.row.remainingQty == null ? undefined : Number(s.row.remainingQty)"
                :precision="0"
                :step="1"
                :disabled="mode === 'view' || discountOrderSourceLocked"
              />
            </template>
          </el-table-column>
          <el-table-column
            v-if="isOrder"
            :label="key === 'sales/discount-orders' ? '最终销售单价' : '销售单价'"
            width="140"
          >
            <template #default="s">
              <el-input-number
                v-model="s.row.price"
                :min="0"
                :precision="2"
                :disabled="mode === 'view' || !canEditAmount"
              />
            </template>
          </el-table-column>
          <el-table-column v-if="isOrder" label="金额" width="120"
            ><template #default="s">{{
              moneyText(Number(s.row.quantity || 0) * Number(s.row.price || 0))
            }}</template></el-table-column
          >
          <el-table-column v-if="isOrder" label="可用库存" width="100"
            ><template #default="s">{{
              s.row.availableStock == null
                ? '—'
                : Number(s.row.availableStock).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
            }}</template></el-table-column
          >
          <el-table-column v-if="isOrder" label="供应方式" width="110"
            ><template #default="s">{{
              goodsOf(s.row).supplyTypeName ||
              goodsOf(s.row).supply_type_name ||
              goodsOf(s.row).supplyType ||
              '—'
            }}</template></el-table-column
          >
          <el-table-column v-if="isOrder" label="商品形态" width="110"
            ><template #default="s">{{
              goodsOf(s.row).goodsFormName ||
              goodsOf(s.row).goods_form_name ||
              goodsOf(s.row).goodsForm ||
              '—'
            }}</template></el-table-column
          >
          <el-table-column label="备注" min-width="150"
            ><template #default="s"><el-input v-model="s.row.remark" /></template
          ></el-table-column>
          <el-table-column
            v-if="
              mode !== 'view' &&
              !isPlan &&
              !discountOrderSourceLocked &&
              !discountOutputSourceLocked
            "
            width="70"
          >
            <template #default="s">
              <el-button link type="danger" @click="form.details.splice(s.$index, 1)"
                >删除</el-button
              >
            </template>
          </el-table-column>
        </el-table>
        <div v-if="isOrder" class="order-totals">
          <span
            >合计数量：<strong>{{
              form.details
                .reduce((s: number, x: any) => s + Number(x.quantity || 0), 0)
                .toLocaleString('zh-CN')
            }}</strong></span
          >
          <span
            >订单金额：<strong
              >¥
              {{
                moneyText(
                  form.details.reduce(
                    (s: number, x: any) => s + Number(x.quantity || 0) * Number(x.price || 0),
                    0,
                  ),
                )
              }}</strong
            ></span
          >
          <span v-if="key !== 'sales/discount-orders'"
            >旧物折价金额：<strong
              >¥
              {{
                moneyText(
                  form.details.reduce(
                    (s: number, x: any) =>
                      s +
                      Math.max(0, Number(x.quantity || 0) * Number(x.price || 0) - lineActual(x)),
                    0,
                  ),
                )
              }}</strong
            ></span
          >
          <span
            >{{ key === 'sales/discount-orders' ? '最终成交金额' : '实付金额' }}：<strong
              >¥
              {{
                moneyText(
                  key === 'sales/discount-orders'
                    ? form.details.reduce(
                        (s: number, x: any) => s + Number(x.quantity || 0) * Number(x.price || 0),
                        0,
                      )
                    : form.details.reduce((s: number, x: any) => s + lineActual(x), 0),
                )
              }}</strong
            ></span
          >
        </div>
        <el-button
          v-if="
            hasLines &&
            mode !== 'view' &&
            !discountOrderSourceLocked &&
            ((!isOutput && !isReturn && !isPlan && !isService) ||
              (isOutput && group === 'production' && form.outType === 3) ||
              (isOutput && group === 'requisitions' && form.directOutput))
          "
          class="add-line"
          @click="addDetailLine"
          >添加明细</el-button
        >
      </el-form>
      <section v-if="isService && mode !== 'create' && form.id" class="service-progress-panel">
        <div class="service-progress-title">
          <div><strong>售后处理进展</strong><span>多次记录，原始售后申请不会被覆盖</span></div>
          <el-button
            v-if="mode !== 'view' && progressForm.id"
            link
            type="primary"
            @click="resetProgressForm"
          >
            取消编辑
          </el-button>
        </div>
        <div v-if="mode !== 'view'" class="service-progress-editor">
          <el-input
            v-model="progressForm.content"
            type="textarea"
            :rows="3"
            maxlength="10000"
            show-word-limit
            placeholder="记录本次沟通、处理动作和下一步安排"
          />
          <div class="service-progress-editor-row">
            <el-select v-model="progressForm.status" placeholder="处理后状态">
              <el-option
                v-for="item in options.dictionaries.after_sale_event_status || []"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)"
              />
            </el-select>
            <el-date-picker
              v-model="progressForm.occurredAt"
              type="datetime"
              placeholder="实际处理时间"
              style="width: 100%"
            />
            <el-button type="primary" :loading="progressSaving" @click="saveServiceProgress">
              {{ progressForm.id ? '保存进展修改' : '添加进展' }}
            </el-button>
          </div>
        </div>
        <el-table
          class="service-progress-table"
          :data="serviceProgresses"
          row-key="id"
          border
          stripe
          table-layout="fixed"
          max-height="320"
          empty-text="暂无处理进展"
        >
          <el-table-column label="处理时间" width="168">
            <template #default="{ row }">{{ dateText(row.occurredAt, true) }}</template>
          </el-table-column>
          <el-table-column prop="content" label="处理内容" min-width="300" show-overflow-tooltip />
          <el-table-column label="处理状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain" :type="serviceProgressStatusType(row)">
                {{ row.statusName || row.status || '—' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="记录来源" width="100" align="center">
            <template #default="{ row }">
              <el-tag size="small" effect="plain" type="info">
                {{ row.sourceTypeName || '人工记录' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="处理人" width="120" show-overflow-tooltip>
            <template #default="{ row }">
              {{ row.handlerIdName || row.createdByName || '未知操作人' }}
            </template>
          </el-table-column>
          <el-table-column
            v-if="mode !== 'view'"
            fixed="right"
            label="操作"
            width="110"
            align="center"
          >
            <template #default="{ row }">
              <template v-if="Number(row.sourceType) === 1">
                <el-button link type="primary" @click="editServiceProgress(row)">编辑</el-button>
                <el-button link type="danger" @click="deleteServiceProgress(row)">删除</el-button>
              </template>
              <span v-else class="service-progress-readonly">—</span>
            </template>
          </el-table-column>
        </el-table>
      </section>
      <DocumentAttachments
        v-if="mode !== 'create' && attachmentType && form.id"
        :document-type="attachmentType"
        :document-id="form.id"
      />
      <template #footer>
        <el-button @click="dialog = false">{{ mode === 'view' ? '关闭' : '取消' }}</el-button>
        <el-button
          v-if="mode !== 'view' && key === 'requisitions/applications'"
          :loading="saving"
          @click="save(false)"
          >保存草稿</el-button
        >
        <el-button
          v-if="mode !== 'view'"
          :type="isMoney && resource === 'refunds' ? 'danger' : 'primary'"
          :loading="saving"
          :disabled="saving || (isMoney && moneySaveDisabled)"
          @click="save(true)"
          >{{
            isMoney
              ? resource === 'payments'
                ? '确认收款'
                : '确认退款'
              : key === 'production/outputs' && Number(form.outType) === 3
                ? '确认出库'
                : key === 'sales/discount-orders'
                  ? '保存成交信息'
                  : isPlan
                    ? '保存生产计划'
                    : key === 'requisitions/applications'
                      ? '保存并提交审核'
                      : key === 'sales/orders'
                        ? '保存销售订单'
                        : '保存'
          }}</el-button
        >
      </template>
    </el-dialog>
    <ExecuteOutDialog v-model="executeOutVisible" :outDoc="selectedOutRow" @done="onDialogDone" />
    <TempSupplementDialog
      v-model="tempSupplVisible"
      :outDoc="selectedOutRow"
      @done="onDialogDone"
    />
    <EditOutboundDialog
      v-model="editOutVisible"
      :outRow="selectedOutRow"
      :units="options.units"
      @done="onDialogDone"
    />
    <ViewOutboundDialog v-model="viewOutVisible" :outRow="selectedOutRow" :units="options.units" />
    <BomReturnDialog v-model="bomReturnVisible" :outRow="selectedOutRow" @done="onDialogDone" />
    <LabOutboundDialog v-model="labOutVisible" @done="onDialogDone" />
    <InputDialog
      v-model="inputVisible"
      :editRow="inputReadonly ? undefined : selectedInputRow"
      :viewRow="inputReadonly ? selectedInputRow : undefined"
      @done="onDialogDone"
    />
    <DocumentTraceDialog
      v-model="traceVisible"
      :document-type="traceType"
      :document-id="traceRow.id || ''"
      :document-no="String(traceRow[current.no] ?? '')"
    />
  </section>
</template>
<style scoped>
.page {
  padding: 20px;
}
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.page-head h2 {
  margin: 0;
}
.page-subtitle {
  color: #8a94a6;
  margin: 6px 0 0;
}
.summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-bottom: 14px;
  border: 1px solid #e5e9f0;
  background: #e5e9f0;
}
.summary-strip > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  background: #fff;
}
.summary-strip span {
  color: #7b8798;
  font-size: 12px;
}
.summary-strip strong {
  color: #27334a;
  font-size: 17px;
}
.query-bar {
  display: flex;
  gap: 10px;
  background: #fff;
  padding: 14px;
  margin-bottom: 14px;
}
.table-card {
  background: #fff;
  padding: 14px;
}
.el-pagination {
  margin-top: 14px;
  justify-content: flex-end;
}
.dialog-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0 16px;
}
.full-field {
  grid-column: 1/-1;
}
.production-detail-section {
  grid-column: 1/-1;
  margin-top: 4px;
}
.production-detail-title {
  margin: 14px 0 8px;
  color: #27334a;
  font-size: 13px;
  font-weight: 700;
}
.order-totals {
  display: flex;
  justify-content: flex-end;
  gap: 24px;
  padding: 14px 4px;
  color: #667085;
}
.order-totals strong {
  color: #1f2a44;
}
.add-line {
  margin-top: 12px;
}
.service-progress-panel {
  margin-top: 18px;
  padding: 14px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
}
.service-progress-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.service-progress-title span {
  margin-left: 10px;
  color: #909399;
  font-size: 12px;
}
.service-progress-editor {
  margin-bottom: 14px;
  padding: 12px;
  background: #f8faff;
  border: 1px solid #e5e9f0;
  border-radius: 4px;
}
.service-progress-editor-row {
  display: grid;
  grid-template-columns: 180px 220px max-content;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.service-progress-table {
  width: 100%;
}
.service-progress-readonly {
  color: #a8abb2;
}
.funds-section {
  margin-bottom: 8px;
  padding: 8px 12px;
  background: #f8faff;
  border: 1px solid #e5e9f0;
  border-radius: 4px;
}
.funds-title {
  font-weight: 650;
  color: #27334a;
  margin-bottom: 6px;
  font-size: 13px;
}
.funds-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0 16px;
}
.output-supplement-panel {
  box-sizing: border-box;
  width: 100%;
  padding: 12px 18px 16px;
  background: #f8fafc;
}
.output-supplement-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.output-supplement-head > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.output-supplement-head strong {
  color: #27334a;
  font-size: 13px;
}
.output-supplement-head span {
  color: #8490a3;
  font-size: 11px;
}
.output-supplement-body {
  min-height: 72px;
}
:deep(.output-supplement-body .el-empty) {
  padding: 10px 0;
}
:deep(.output-expand-mechanism) {
  width: 0 !important;
  min-width: 0 !important;
  padding: 0 !important;
  border-right: 0 !important;
}
:deep(.output-expand-mechanism .cell) {
  width: 0 !important;
  padding: 0 !important;
}
:deep(.output-expand-mechanism .el-table__expand-icon) {
  display: none;
}
:deep(.el-table__expanded-cell) {
  padding: 0 !important;
}
@media (max-width: 900px) {
  .dialog-grid {
    grid-template-columns: 1fr;
  }
  .summary-strip {
    grid-template-columns: repeat(2, 1fr);
  }
  .order-totals {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .service-progress-editor-row {
    grid-template-columns: 1fr;
  }
}
</style>
