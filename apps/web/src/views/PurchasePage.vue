<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FormInstance, FormRules } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import DocumentTraceDialog from '@/components/DocumentTraceDialog.vue';
import PurchaseOperationHistoryDialog from '@/components/PurchaseOperationHistoryDialog.vue';
import DocumentAttachments from '@/components/DocumentAttachments.vue';
import DataState from '@/components/DataState.vue';
import StatusTag from '@/components/StatusTag.vue';
import SummaryStrip from '@/components/SummaryStrip.vue';
import PurchaseReceiptDetails from '@/components/PurchaseReceiptDetails.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import PurchaseApplicationOrderPreviewDialog from '@/components/purchase/PurchaseApplicationOrderPreviewDialog.vue';
import { dateText, display, moneyText } from '@/utils/format';
import { generateBatchNo } from '@/utils/batch-number';
import { purchaseDocumentType } from '@/utils/document-type';
import { buildCategoryTree } from '@/utils/category-tree';

type Mode = 'create' | 'edit' | 'view' | 'cancel' | 'refund' | 'payment';
type Option = { label: string; value: string | number };
type OrganizationOption = Option & {
  raw?: { parentId?: string | number; sort?: number };
};
type OrganizationTreeNode = OrganizationOption & { children?: OrganizationTreeNode[] };
type DocConfig = { title: string; subtitle: string; createText: string; summaries: string[] };
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const resource = computed(() => String(route.params.resource));
const configs: Record<string, DocConfig> = {
  applications: {
    title: '采购申请单',
    subtitle: '采购需求草稿、提交与审批管理',
    createText: '新增采购申请单',
    summaries: ['申请单总数', '待审批数', '已审批数'],
  },
  orders: {
    title: '采购订单',
    subtitle: '管理直接采购和采购申请转入订单',
    createText: '新增直接采购订单',
    summaries: ['订单总数', '待处理数', '已完成数'],
  },
  receipts: {
    title: '采购入库单',
    subtitle: '按采购订单生成待入库单，补充库位与批次后执行库存过账',
    createText: '新增采购入库单',
    summaries: ['入库单总数', '待入库数', '已入库数'],
  },
  returns: {
    title: '采购退货记录',
    subtitle: '统一查看采购订单未到货退回及采购入库实物退货记录',
    createText: '',
    summaries: ['退货记录总数', '待处理数', '已完成数'],
  },
  payments: {
    title: '采购付款',
    subtitle: '归集采购订单发起的付款流水并自动重算累计已付',
    createText: '',
    summaries: ['付款记录总数', '本页付款金额', '关联订单数'],
  },
  refunds: {
    title: '采购退款',
    subtitle: '采购退货形成实际应退金额后自动生成，支持分次退款与流水追溯',
    createText: '',
    summaries: ['退款任务总数', '本页待退金额', '本页已退金额'],
  },
};
const config = computed<DocConfig>(() => configs[resource.value] ?? configs.applications!);
const dialogTitle = computed(() =>
  mode.value === 'payment'
    ? '采购订单付款'
    : mode.value === 'refund'
      ? '确认采购退款'
      : resource.value === 'receipts' && mode.value !== 'view'
        ? '办理采购入库'
        : resource.value === 'returns' && mode.value === 'create'
          ? '从采购入库单发起退货'
          : `${mode.value === 'view' ? '查看' : mode.value === 'edit' ? '编辑' : '新增'}${config.value.title}`,
);
const rows = ref<any[]>([]);
const total = ref(0);
const summary = reactive({ pending: 0, complete: 0 });
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const dialog = ref(false);
const mode = ref<Mode>('create');
const detail = ref<any>(null);
const formRef = ref<FormInstance>();
const form = reactive<any>({});
const traceVisible = ref(false);
const operationHistoryVisible = ref(false);
const orderGenerationVisible = ref(false);
const orderGenerationMode = ref<'all' | 'partial' | 'related'>('all');
const orderGenerationApplicationId = ref('');
const quickCatalogVisible = ref(false);
const quickCatalogChecking = ref(false);
const quickCatalogMode = ref<'goods' | 'sku'>('goods');
const quickCatalogLine = ref<any>(null);
const quickCatalogForm = reactive<any>({});
const traceRow = ref<any>({});
const traceType = computed(() => purchaseDocumentType(resource.value));
const traceNo = computed(
  () =>
    traceRow.value.applicationNo ??
    traceRow.value.orderNo ??
    traceRow.value.receiptNo ??
    traceRow.value.returnNo ??
    traceRow.value.paymentNo ??
    traceRow.value.refundNo ??
    '',
);
const query = reactive<any>({
  page: 1,
  pageSize: 20,
  keyword: '',
  orgId: '',
  warehouseId: '',
  vendorId: '',
  orderId: '',
  approveStatus: '',
  confirmStatus: '',
  orderStatus: '',
  refundStatus: '',
  sourceType: '',
  dateRange: [],
});
const options = reactive<Record<string, any[]>>({
  organizations: [],
  departments: [],
  warehouses: [],
  vendors: [],
  goods: [],
  orders: [],
  receipts: [],
  applications: [],
  categories: [],
  units: [],
});
const organizationTree = computed<OrganizationTreeNode[]>(() => {
  const nodes = new Map<string, OrganizationTreeNode>();
  for (const option of options.organizations as OrganizationOption[])
    nodes.set(String(option.value), { ...option, children: [] });

  const roots: OrganizationTreeNode[] = [];
  for (const node of nodes.values()) {
    const parentId = String(node.raw?.parentId ?? 0);
    const parent = parentId !== '0' ? nodes.get(parentId) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  }

  const sortNodes = (items: OrganizationTreeNode[]) => {
    items.sort(
      (left, right) =>
        Number(left.raw?.sort ?? 0) - Number(right.raw?.sort ?? 0) ||
        left.label.localeCompare(right.label, 'zh-CN'),
    );
    for (const item of items) {
      if (item.children?.length) sortNodes(item.children);
      else delete item.children;
    }
  };
  sortNodes(roots);
  return roots;
});
const quickCategoryTreeProps = {
  value: 'id',
  label: 'name',
  children: 'children',
  disabled: 'disabled',
};
const markQuickCategories = (nodes: any[]): any[] =>
  nodes.map((item) => ({
    ...item,
    disabled: Number(item.status) !== 1 || Number(item.warehouseType) <= 0,
    children: markQuickCategories(item.children ?? []),
  }));
const quickCategoryTree = computed(() =>
  markQuickCategories(buildCategoryTree(options.categories ?? [])),
);
const organizationOptions = reactive<{ orgId: string; departments: any[]; warehouses: any[] }>({
  orgId: '',
  departments: [],
  warehouses: [],
});
const dicts = reactive<Record<string, Option[]>>({});
const dictCodes = [
  'purchase_arrival_type',
  'purchase_delivery_type',
  'purchase_settlement_type',
  'purchase_input_type',
  'purchase_return_type',
  'payment_channel',
  'purchase_order_status',
  'purchase_refund_status',
  'purchase_refund_source',
  'purchase_payment_progress_status',
  'approval_status',
  'purchase_input_status',
  'purchase_return_status',
  'warehouse_type',
];
const optionOrgId = (item: any) => item.orgId ?? item.raw?.orgId ?? item.raw?.organization?.id;
const filteredDepartments = computed(() => {
  if (!form.orgId) return [];
  if (organizationOptions.orgId === String(form.orgId)) return organizationOptions.departments;
  return (options.departments ?? []).filter(
    (item) => String(optionOrgId(item)) === String(form.orgId),
  );
});
const filteredWarehouses = computed(() => {
  if (!form.orgId) return [];
  if (organizationOptions.orgId === String(form.orgId)) return organizationOptions.warehouses;
  return (options.warehouses ?? []).filter(
    (item) => String(optionOrgId(item)) === String(form.orgId),
  );
});
const optionWarehouseType = (item: any) =>
  Number(item?.warehouseType ?? item?.raw?.warehouseType ?? 0);
const lineWarehouseType = (line: any) =>
  Number(line?.categoryWarehouseType ?? byId('goods', line?.goodsId)?.categoryWarehouseType ?? 0);
const documentWarehouseTypes = computed(() => [
  ...new Set((form.details ?? []).map(lineWarehouseType).filter(Boolean)),
]);
const documentWarehouseType = computed(() =>
  documentWarehouseTypes.value.length === 1 ? documentWarehouseTypes.value[0] : 0,
);
const compatibleWarehouses = computed(() =>
  filteredWarehouses.value.filter(
    (item) =>
      !documentWarehouseType.value || optionWarehouseType(item) === documentWarehouseType.value,
  ),
);
function requiredGoodsWarehouseType(line: any) {
  const otherType = [
    ...new Set(
      (form.details ?? [])
        .filter((item: any) => item !== line)
        .map(lineWarehouseType)
        .filter(Boolean),
    ),
  ][0];
  const selectedWarehouse = filteredWarehouses.value.find(
    (item) => String(item.value) === String(form.warehouseId),
  );
  return Number(otherType || optionWarehouseType(selectedWarehouse));
}
function compatibleGoods(line: any, items: any[]) {
  const requiredType = requiredGoodsWarehouseType(line);
  return items.filter(
    (item) => !requiredType || Number(item.categoryWarehouseType) === requiredType,
  );
}
function availableGoods(line: any) {
  return compatibleGoods(line, options.goods ?? []);
}
function mergeGoodsOptions(items: any[]) {
  const merged = new Map((options.goods ?? []).map((item) => [String(item.id), item]));
  items.forEach((item) => merged.set(String(item.id), item));
  options.goods = [...merged.values()];
}
const goodsSearchTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
const goodsSearchVersions = new WeakMap<object, number>();
function remoteSearchGoods(line: any, keyword: string) {
  line.goodsSearchKeyword = keyword;
  line.goodsSearchFailed = false;
  line.remoteGoods = [];
  const previousTimer = goodsSearchTimers.get(line);
  if (previousTimer) clearTimeout(previousTimer);
  const normalized = String(keyword ?? '').trim();
  const version = (goodsSearchVersions.get(line) ?? 0) + 1;
  goodsSearchVersions.set(line, version);
  if (!normalized) {
    line.goodsLoading = false;
    return;
  }
  line.goodsLoading = true;
  const timer = setTimeout(async () => {
    try {
      const result = (await api.get('/goods', {
        params: { keyword: normalized, pageSize: 50, status: 1 },
      })) as any;
      if (goodsSearchVersions.get(line) !== version) return;
      const items = compatibleGoods(line, result.items ?? []);
      line.remoteGoods = items;
      mergeGoodsOptions(items);
    } catch {
      if (goodsSearchVersions.get(line) !== version) return;
      line.goodsSearchFailed = true;
      line.remoteGoods = [];
    } finally {
      if (goodsSearchVersions.get(line) === version) line.goodsLoading = false;
    }
  }, 250);
  goodsSearchTimers.set(line, timer);
}
function searchedGoods(line: any) {
  const keyword = String(line.goodsSearchKeyword ?? '').trim();
  return keyword ? compatibleGoods(line, line.remoteGoods ?? []) : availableGoods(line);
}
const quickGoodsName = (line: any) => String(line.goodsSearchKeyword ?? '').trim();
const rules: FormRules = {
  orgId: [{ required: true, message: '请选择所属组织', trigger: 'change' }],
  deptId: [{ required: true, message: '请选择部门', trigger: 'change' }],
  warehouseId: [{ required: true, message: '请选择目标仓库', trigger: 'change' }],
  reason: [{ required: true, message: '请输入原因', trigger: 'blur' }],
  planArrivalDate: [{ required: true, message: '请选择计划到货日', trigger: 'change' }],
  orderId: [{ required: true, message: '请选择采购订单', trigger: 'change' }],
  receiptId: [{ required: true, message: '请选择来源入库单', trigger: 'change' }],
  paymentAmount: [{ required: true, message: '请输入付款金额', trigger: 'blur' }],
  paymentDate: [{ required: true, message: '请选择付款日期', trigger: 'change' }],
};

const lookup = (name: string, value: unknown) =>
  options[name]?.find((item) => String(item.value ?? item.id) === String(value))?.label ?? '—';
const byId = (name: string, value: unknown) =>
  options[name]?.find((item) => String(item.id ?? item.value) === String(value));
const dictLabel = (code: string, value: unknown) =>
  dicts[code]?.find((item) => String(item.value) === String(value))?.label ?? '—';
const goodsName = (id: unknown) => byId('goods', id)?.goodsName ?? '—';
const goodsCode = (line: any) => line.goodsCode ?? byId('goods', line.goodsId)?.queryCode ?? '—';
const goodsCategory = (line: any) =>
  line.categoryName ?? byId('goods', line.goodsId)?.categoryName ?? '—';
const unitName = (value: unknown) => lookup('units', value);
const skuText = (line: any) =>
  line.skuLabel ?? line.skuName ?? (line.skuId ? `规格 ${line.skuId}` : '—');
const creator = (row: any) =>
  String(row.createdBy) === String(auth.user?.id) ? auth.user?.username : '—';
const approval = (row: any) => Number(row.approveStatus ?? row.approve_status);
const summaryItems = computed(() => {
  if (resource.value === 'refunds')
    return [
      { label: config.value.summaries[0] ?? '', value: total.value },
      {
        label: config.value.summaries[1] ?? '',
        value: `¥ ${moneyText(rows.value.reduce((sum, item) => sum + Number(item.remainingAmount ?? 0), 0))}`,
      },
      {
        label: config.value.summaries[2] ?? '',
        value: `¥ ${moneyText(rows.value.reduce((sum, item) => sum + Number(item.refundedAmount ?? 0), 0))}`,
      },
    ];
  if (resource.value === 'payments')
    return [
      { label: config.value.summaries[0] ?? '', value: total.value },
      {
        label: config.value.summaries[1] ?? '',
        value: moneyText(
          rows.value.reduce((sum, item) => sum + Number(item.paymentAmount ?? 0), 0),
        ),
      },
      {
        label: config.value.summaries[2] ?? '',
        value: new Set(rows.value.map((item) => String(item.orderId))).size,
      },
    ];
  return config.value.summaries.map((label, index) => ({
    label,
    value: index === 0 ? total.value : index === 1 ? summary.pending : summary.complete,
  }));
});
const orderTotalAmount = computed(() =>
  Number(
    (form.details ?? []).reduce((sum: number, item: any) => sum + Number(item.totalAmount ?? 0), 0),
  ),
);
const orderEffectivePayable = computed(() =>
  mode.value === 'create'
    ? orderTotalAmount.value
    : Number(form.effectivePayable ?? form.payableAmount ?? orderTotalAmount.value),
);
const orderNetPaidAmount = computed(() => Number(form.netPaidAmount ?? 0));
const orderRemainingAfterPayment = computed(() =>
  Math.max(
    0,
    orderEffectivePayable.value - orderNetPaidAmount.value - Number(form.currentPaymentAmount ?? 0),
  ),
);
const orderPreviewProgressStatus = computed(() => {
  const originalPayable =
    mode.value === 'create'
      ? orderTotalAmount.value
      : Number(form.payableAmount ?? orderTotalAmount.value);
  if (originalPayable <= 0) return 0;
  if (orderEffectivePayable.value <= 0 || orderRemainingAfterPayment.value <= 0) return 2;
  return orderNetPaidAmount.value + Number(form.currentPaymentAmount ?? 0) > 0 ? 1 : 0;
});

function params() {
  const result: any = { page: query.page, pageSize: query.pageSize };
  for (const key of [
    'keyword',
    'orgId',
    'warehouseId',
    'vendorId',
    'orderId',
    'approveStatus',
    'confirmStatus',
    'orderStatus',
    'refundStatus',
    'sourceType',
  ])
    if (query[key] !== '' && query[key] !== null) result[key] = query[key];
  return result;
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    const data = (await api.get(`/purchase/${resource.value}`, { params: params() })) as any;
    rows.value = data.items;
    total.value = data.total;
    if (resource.value === 'applications' || resource.value === 'returns') {
      const [pending, complete] = (await Promise.all([
        api.get(`/purchase/${resource.value}`, { params: { pageSize: 1, approveStatus: 0 } }),
        api.get(`/purchase/${resource.value}`, { params: { pageSize: 1, approveStatus: 1 } }),
      ])) as any[];
      summary.pending = pending.total;
      summary.complete = complete.total;
    } else if (resource.value === 'receipts') {
      const [pending, complete] = (await Promise.all([
        api.get('/purchase/receipts', { params: { pageSize: 1, confirmStatus: 0 } }),
        api.get('/purchase/receipts', { params: { pageSize: 1, confirmStatus: 1 } }),
      ])) as any[];
      summary.pending = pending.total;
      summary.complete = complete.total;
    } else if (resource.value === 'orders') {
      const complete = (await api.get('/purchase/orders', {
        params: { pageSize: 1, orderStatus: 6 },
      })) as any;
      summary.complete = complete.total;
      summary.pending = Math.max(0, data.total - complete.total);
    }
  } catch (e: any) {
    error.value = e.response?.data?.message ?? '列表加载失败';
    rows.value = [];
  } finally {
    loading.value = false;
  }
}
async function loadOptions() {
  const [
    orgs,
    depts,
    warehouses,
    vendors,
    goods,
    orders,
    receipts,
    applications,
    categories,
    units,
    ...dictionaries
  ] = (await Promise.all([
    api.get('/base-data/organizations/options'),
    api.get('/base-data/departments/options'),
    api.get('/base-data/warehouses/options'),
    api.get('/base-data/vendors/options'),
    api.get('/goods', { params: { pageSize: 100, status: 1 } }),
    api.get('/purchase/orders', { params: { pageSize: 100 } }),
    api.get('/purchase/receipts', { params: { pageSize: 100, confirmStatus: 1 } }),
    api.get('/purchase/applications', { params: { pageSize: 100, approveStatus: 1 } }),
    api.get('/goods/categories'),
    api.get('/base-data/units/options'),
    ...dictCodes.map((code) => api.get(`/dictionaries/${code}`).catch(() => [])),
  ])) as any[];
  options.organizations = orgs;
  options.departments = depts;
  options.warehouses = warehouses;
  options.vendors = vendors;
  options.goods = goods.items;
  options.orders = orders.items.map((item: any) => ({
    ...item,
    label: item.orderNo,
    value: item.id,
  }));
  options.receipts = receipts.items.map((item: any) => ({
    ...item,
    label: item.receiptNo,
    value: item.id,
  }));
  options.applications = applications.items.map((item: any) => ({
    ...item,
    label: item.applicationNo,
    value: item.id,
  }));
  options.categories = categories.items ?? [];
  options.units = units ?? [];
  dictCodes.forEach((code, index) => {
    dicts[code] = dictionaries[index] ?? [];
  });
}
function resetQuery() {
  Object.assign(query, {
    page: 1,
    keyword: '',
    orgId: '',
    warehouseId: '',
    vendorId: '',
    orderId: '',
    approveStatus: '',
    confirmStatus: '',
    orderStatus: '',
    refundStatus: '',
    sourceType: '',
    dateRange: [],
  });
  load();
}
function search() {
  query.page = 1;
  load();
}
async function loadOrganizationOptions(orgId: unknown) {
  const requestedOrgId = String(orgId ?? '');
  organizationOptions.orgId = '';
  organizationOptions.departments = [];
  organizationOptions.warehouses = [];
  if (!requestedOrgId) return;
  const [departments, warehouses] = (await Promise.all([
    api.get('/base-data/departments/options', { params: { orgId: requestedOrgId } }),
    api.get('/base-data/warehouses/options', { params: { orgId: requestedOrgId } }),
  ])) as any[];
  if (String(form.orgId ?? '') !== requestedOrgId) return;
  organizationOptions.orgId = requestedOrgId;
  organizationOptions.departments = departments ?? [];
  organizationOptions.warehouses = warehouses ?? [];
}
async function organizationChanged(orgId: unknown) {
  form.deptId = '';
  form.warehouseId = '';
  await loadOrganizationOptions(orgId);
}
function blankLine() {
  return {
    goodsId: '',
    skuId: '',
    skuOptions: [],
    categoryWarehouseType: 0,
    goodsSearchKeyword: '',
    remoteGoods: [],
    goodsLoading: false,
    goodsSearchFailed: false,
    quantity: 1,
    unitType: 0,
    unitPrice: 0,
    totalAmount: 0,
    orderQuantity: 0,
    arrivedQuantity: 0,
    unarrivedQuantity: 0,
    inputtedQuantity: 0,
    uninputtedQuantity: 0,
    remainingQuantity: 0,
    latestArrivalDate: '',
    inputQuantity: 1,
    returnQuantity: 1,
    batchNo: resource.value === 'receipts' ? generateBatchNo() : '',
    position: '',
    productionDate: '',
    validityPeriod: '',
    arrivalDate: '',
    remark: '',
  };
}
function resetForm() {
  Object.keys(form).forEach((key) => delete form[key]);
  organizationOptions.orgId = '';
  organizationOptions.departments = [];
  organizationOptions.warehouses = [];
  if (resource.value === 'applications')
    Object.assign(form, {
      orgId: '',
      deptId: '',
      warehouseId: '',
      reason: '',
      remark: '',
      details: [blankLine()],
    });
  if (resource.value === 'orders')
    Object.assign(form, {
      applicationId: '',
      orgId: '',
      deptId: '',
      warehouseId: '',
      receiverId: auth.user?.id,
      vendorId: '',
      arrivalType: 1,
      planArrivalDate: '',
      deliveryType: 1,
      deliveryNo: '',
      paymentType: 1,
      planPayDate: '',
      currentPaymentAmount: 0,
      currentPaymentChannel: Number(dicts.payment_channel?.[0]?.value ?? 1),
      currentPaymentDate: new Date().toISOString().slice(0, 10),
      currentPaymentRemark: '',
      payableAmount: 0,
      effectivePayable: 0,
      paidAmount: 0,
      refundedAmount: 0,
      netPaidAmount: 0,
      remainingPayable: 0,
      paymentProgressStatus: 0,
      remark: '',
      details: [blankLine()],
    });
  if (resource.value === 'receipts')
    Object.assign(form, {
      directReceipt: false,
      orderId: '',
      orgId: '',
      warehouseId: '',
      vendorId: '',
      deptId: '',
      receiverId: auth.user?.id,
      inputType: 1,
      remark: '',
      details: [],
    });
  if (resource.value === 'returns')
    Object.assign(form, {
      receiptId: '',
      reason: '',
      returnDate: new Date().toISOString().slice(0, 10),
      returnType: 1,
      remark: '',
      details: [],
    });
  if (resource.value === 'payments')
    Object.assign(form, {
      orderId: '',
      orgId: auth.user?.orgId ?? '',
      deptId: auth.user?.deptId ?? '',
      paymentAmount: 0,
      paymentChannel: 1,
      paymentDate: new Date().toISOString().slice(0, 10),
      remark: '',
    });
  if (resource.value === 'refunds')
    Object.assign(form, {
      refundAmount: 0,
      refundChannel: 1,
      refundDate: new Date().toISOString().slice(0, 10),
      supplierSerialNo: '',
      receiveAccount: '',
      requestKey: '',
      flowRemark: '',
      flows: [],
    });
}
async function enrichLine(line: any) {
  if (!line.goodsId) return;
  const product = (await api.get(`/goods/${line.goodsId}`)) as any;
  mergeGoodsOptions([product]);
  line.categoryWarehouseType = Number(product.categoryWarehouseType ?? 0);
  line.categoryName = product.categoryName ?? line.categoryName;
  line.skuOptions = (product.skus ?? []).map((sku: any) => ({
    label: sku.specModels || sku.skuName || sku.skuNo || `规格 ${sku.id}`,
    value: sku.id,
    unitType: sku.unitType,
    costPrice: Number(sku.costPrice ?? product.costPrice ?? 0),
  }));
  if (!line.skuId && line.skuOptions.length) line.skuId = line.skuOptions[0].value;
  const selected = line.skuOptions.find((item: any) => String(item.value) === String(line.skuId));
  line.skuLabel = selected?.label;
  if (selected?.unitType) line.unitType = selected.unitType;
  else if (!Number(line.unitType) && product.unitType) line.unitType = product.unitType;
  if (resource.value === 'orders' && !Number(line.totalAmount)) {
    const referencePrice = Number(selected?.costPrice ?? product.costPrice ?? 0);
    line.totalAmount = Number(line.quantity ?? 0) * referencePrice;
  }
  if (resource.value === 'receipts' && form.directReceipt && !Number(line.unitPrice))
    line.unitPrice = Number(selected?.costPrice ?? product.costPrice ?? 0);
}
async function goodsChanged(line: any) {
  delete line.newGoods;
  delete line.newSku;
  line.skuId = '';
  await enrichLine(line);
  const warehouse = filteredWarehouses.value.find(
    (item) => String(item.value) === String(form.warehouseId),
  );
  if (
    warehouse &&
    lineWarehouseType(line) &&
    optionWarehouseType(warehouse) !== lineWarehouseType(line)
  ) {
    form.warehouseId = '';
    ElMessage.warning('所选商品要求的仓库类型已变化，请重新选择同类型仓库');
  }
}
function openQuickCatalog(line: any, kind: 'goods' | 'sku', goodsName = '') {
  quickCatalogMode.value = kind;
  quickCatalogLine.value = line;
  Object.keys(quickCatalogForm).forEach((key) => delete quickCatalogForm[key]);
  const goods = byId('goods', line.goodsId);
  Object.assign(quickCatalogForm, {
    goodsName,
    queryCode: '',
    categoryId: '',
    unitType: Number(line.unitType || goods?.unitType || 0) || '',
    specModels: '',
    costPrice: Number(line.unitPrice ?? 0),
    salePrice: 0,
    pcsQty: 1,
  });
  quickCatalogVisible.value = true;
}
async function globalGoodsAvailability(goodsName: string) {
  return (await api.get('/goods/name-availability', {
    params: { name: goodsName },
  })) as any;
}
function warehouseTypeText(value: unknown) {
  const label = dictLabel('warehouse_type', value);
  return label === '—' ? `仓库类型 ${value}` : label;
}
async function explainUnavailableGlobalGoods(result: any, goodsName: string) {
  const categoryText = result.categoryName ? `，所属分类为“${result.categoryName}”` : '';
  const messages: Record<string, string> = {
    warehouse_type_unavailable: `全局商品主档中已经存在“${goodsName}”${categoryText}，要求使用“${warehouseTypeText(result.warehouseType)}”。当前组织没有启用该类型仓库，因此不能使用，也不能重复新增。请先配置对应类型仓库，或联系管理员调整商品分类。`,
    goods_disabled: `全局商品主档中已经存在“${goodsName}”，但商品当前已停用，不能使用，也不能重复新增。请联系商品管理员恢复。`,
    goods_deleted: `全局商品主档中已经存在“${goodsName}”的历史档案，不能重复新增。请联系商品管理员恢复或处理原档案。`,
    category_disabled: `全局商品主档中已经存在“${goodsName}”${categoryText}，但该分类当前已停用，不能使用，也不能重复新增。`,
    category_deleted: `全局商品主档中已经存在“${goodsName}”，但其分类当前不可用，不能使用，也不能重复新增。`,
  };
  await ElMessageBox.alert(
    messages[result.reason] ??
      `全局商品主档中已经存在“${goodsName}”，当前不可使用，也不能重复新增。`,
    '商品已存在但当前不可用',
    { confirmButtonText: '我知道了', type: 'warning' },
  ).catch(() => undefined);
}
async function useExistingGlobalGoods(line: any, result: any) {
  const goods = result.goods;
  if (!goods?.id) return;
  mergeGoodsOptions([goods]);
  line.goodsId = goods.id;
  line.goodsSearchKeyword = '';
  await goodsChanged(line);
  quickCatalogVisible.value = false;
  ElMessage.success(`商品“${goods.goodsName}”已存在，已为你选择现有商品`);
}
async function requestQuickCatalog(line: any, goodsName: string) {
  const normalizedName = goodsName.trim();
  if (!normalizedName || quickCatalogChecking.value) return;
  quickCatalogChecking.value = true;
  try {
    const result = await globalGoodsAvailability(normalizedName);
    if (!result.exists) {
      openQuickCatalog(line, 'goods', normalizedName);
      return;
    }
    if (result.usable) await useExistingGlobalGoods(line, result);
    else await explainUnavailableGlobalGoods(result, normalizedName);
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message ?? '全局商品名称检查失败，请稍后重试');
  } finally {
    quickCatalogChecking.value = false;
  }
}
async function stageQuickCatalog() {
  const line = quickCatalogLine.value;
  if (!line) return;
  if (quickCatalogMode.value === 'goods') {
    const goodsName = String(quickCatalogForm.goodsName ?? '').trim();
    if (!goodsName || !quickCatalogForm.categoryId || !quickCatalogForm.unitType) {
      ElMessage.warning('请填写商品名称、分类和基础单位');
      return;
    }
    quickCatalogChecking.value = true;
    let availability: any;
    try {
      availability = await globalGoodsAvailability(goodsName);
    } catch (e: any) {
      ElMessage.error(e.response?.data?.message ?? '全局商品名称检查失败，请稍后重试');
      quickCatalogChecking.value = false;
      return;
    }
    quickCatalogChecking.value = false;
    if (availability.exists) {
      if (availability.usable) await useExistingGlobalGoods(line, availability);
      else await explainUnavailableGlobalGoods(availability, goodsName);
      return;
    }
    const category = (options.categories ?? []).find(
      (item) => String(item.id) === String(quickCatalogForm.categoryId),
    );
    const token = `quick-goods-${Date.now()}-${Math.random()}`;
    line.newGoods = {
      goodsName,
      categoryId: quickCatalogForm.categoryId,
      unitType: Number(quickCatalogForm.unitType),
    };
    line.newSku = {
      specModels: '默认规格',
      unitType: Number(quickCatalogForm.unitType),
      pcsQty: 1,
      costPrice: 0,
      salePrice: 0,
    };
    line.goodsId = token;
    line.skuId = `${token}-sku`;
    line.categoryName = category?.name ?? '';
    line.categoryWarehouseType = Number(category?.warehouseType ?? 0);
    line.unitType = Number(quickCatalogForm.unitType);
    line.goodsSearchKeyword = '';
    line.skuOptions = [{ label: line.newSku.specModels, value: line.skuId }];
  } else {
    const specModels = String(quickCatalogForm.specModels ?? '').trim();
    if (!specModels || !quickCatalogForm.unitType) {
      ElMessage.warning('请填写 SKU 规格和单位');
      return;
    }
    const duplicate = (line.skuOptions ?? []).some(
      (item: any) =>
        String(item.label ?? '')
          .trim()
          .toLocaleLowerCase() === specModels.toLocaleLowerCase(),
    );
    if (duplicate) {
      ElMessage.warning('该 SKU 规格已存在，请直接选择已有 SKU');
      return;
    }
    line.newSku = { ...quickCatalogForm, specModels };
    line.skuId = `quick-sku-${Date.now()}-${Math.random()}`;
    line.unitType = Number(quickCatalogForm.unitType);
    line.skuOptions = [
      ...(line.skuOptions ?? []).filter(
        (item: any) => !String(item.value).startsWith('quick-sku-'),
      ),
      { label: specModels, value: line.skuId },
    ];
  }
  quickCatalogVisible.value = false;
}
async function sourceApplicationChanged() {
  if (!form.applicationId) return;
  const source = (await api.get(`/purchase/applications/${form.applicationId}`)) as any;
  Object.assign(form, {
    orgId: source.org_id ?? source.orgId,
    deptId: source.dept_id ?? source.deptId,
    warehouseId: source.warehouse_id ?? source.warehouseId,
  });
  await loadOrganizationOptions(form.orgId);
  form.details = (source.details ?? []).map((line: any) => ({
    ...blankLine(),
    ...line,
    quantity: Number(line.quantity),
    totalAmount: 0,
  }));
  await Promise.all(form.details.map(enrichLine));
}
async function sourceOrderChanged() {
  if (!form.orderId) return;
  const source = (await api.get(`/purchase/orders/${form.orderId}`)) as any;
  const plannedWarehouseId = source.warehouseId ?? source.warehouse_id;
  Object.assign(form, {
    orgId: source.orgId ?? source.org_id,
    warehouseId: '',
    deptId: source.deptId ?? source.dept_id,
    vendorId: source.vendorId ?? source.vendor_id,
    receiverId: auth.user?.id,
  });
  await loadOrganizationOptions(form.orgId);
  form.details = (source.details ?? [])
    .filter((line: any) => Number(line.remainingQuantity ?? 0) > 0)
    .map((line: any) => ({
      ...blankLine(),
      ...line,
      orderQuantity: Number(line.quantity),
      arrivedQuantity: Number(line.arrivedQuantity ?? 0),
      unarrivedQuantity: Number(line.unarrivedQuantity ?? line.remainingQuantity ?? 0),
      inputtedQuantity: Number(line.inputtedQuantity ?? 0),
      uninputtedQuantity: Number(line.uninputtedQuantity ?? 0),
      baseArrivedQuantity: Number(line.arrivedQuantity ?? 0),
      baseUnarrivedQuantity: Number(line.unarrivedQuantity ?? line.remainingQuantity ?? 0),
      baseUninputtedQuantity: Number(line.uninputtedQuantity ?? 0),
      remainingQuantity: Number(line.remainingQuantity ?? 0),
      inputQuantity: Number(line.remainingQuantity ?? 0),
      batchNo: generateBatchNo(),
    }));
  if (!form.details.length) ElMessage.warning('该订单没有剩余可入库商品');
  await Promise.all(form.details.map(enrichLine));
  const plannedWarehouse = filteredWarehouses.value.find(
    (item) => String(item.value) === String(plannedWarehouseId),
  );
  if (
    plannedWarehouse &&
    (!documentWarehouseType.value ||
      optionWarehouseType(plannedWarehouse) === documentWarehouseType.value)
  )
    form.warehouseId = plannedWarehouseId;
  else
    ElMessage.warning(
      '原采购订单的计划仓库与商品分类不匹配，请选择同组织、同仓库类型的实际入库仓库',
    );
}
function receiptSourceChanged() {
  form.orderId = '';
  form.details = form.directReceipt ? [blankLine()] : [];
  form.orgId = '';
  form.deptId = '';
  form.warehouseId = '';
  form.vendorId = '';
}
async function sourceReceiptChanged() {
  if (!form.receiptId) return;
  const source = (await api.get(`/purchase/receipts/${form.receiptId}`)) as any;
  Object.assign(form, {
    orderId: source.po_id,
    orgId: source.org_id,
    warehouseId: source.warehouse_id,
    deptId: source.dept_id,
  });
  await loadOrganizationOptions(form.orgId);
  const order = (await api.get(`/purchase/orders/${source.po_id}`)) as any;
  form.vendorId = order.vendor_id;
  form.details = (source.details ?? []).map((line: any) => ({
    ...blankLine(),
    ...line,
    inputQuantity: Number(line.inputQuantity),
    returnQuantity: 1,
  }));
  await Promise.all(form.details.map(enrichLine));
}
async function openCreate() {
  if (resource.value === 'refunds') {
    ElMessage.warning('采购退款任务只能由采购退货自动生成');
    return;
  }
  if (resource.value === 'payments') {
    ElMessage.warning('请从采购订单操作列发起付款');
    return;
  }
  if (resource.value === 'returns' && !route.query.returnReceiptId && !route.query.receiptId) {
    ElMessage.warning('请从已入库的采购入库单发起退货');
    return;
  }
  mode.value = 'create';
  detail.value = null;
  resetForm();
  dialog.value = true;
  await nextTick();
  formRef.value?.clearValidate();
}
function normalizeDetail(data: any) {
  if (resource.value === 'applications')
    return {
      ...data,
      orgId: data.org_id ?? data.orgId,
      deptId: data.dept_id ?? data.deptId,
      warehouseId: data.warehouse_id ?? data.warehouseId,
      reason: data.pur_reson ?? data.reason,
      approveStatus: data.approve_status ?? data.approveStatus,
    };
  if (resource.value === 'orders') {
    const planPayDate = dateText(data.planPayDate ?? data.plan_pay_date);
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
      planArrivalDate: dateText(data.planArrivalDate ?? data.plan_arrival_date),
      deliveryType: data.deliveryType ?? data.delivery_type,
      deliveryNo: data.deliveryNo ?? data.delivery_no,
      paymentType: data.paymentType ?? data.pay_type,
      planPayDate: planPayDate === '—' ? '' : planPayDate,
      payableAmount: Number(data.payableAmount ?? data.totalAmount ?? data.pay_amout ?? 0),
      effectivePayable: Number(
        data.effectivePayable ?? data.payableAmount ?? data.totalAmount ?? 0,
      ),
      paidAmount: Number(data.paidAmount ?? data.pay_amount_done ?? 0),
      refundedAmount: Number(data.refundedAmount ?? 0),
      netPaidAmount: Number(data.netPaidAmount ?? data.paidAmount ?? data.pay_amount_done ?? 0),
      remainingPayable: Number(data.remainingPayable ?? 0),
      paymentProgressStatus: Number(data.paymentProgressStatus ?? 0),
      currentPaymentAmount: 0,
      currentPaymentChannel: Number(dicts.payment_channel?.[0]?.value ?? 1),
      currentPaymentDate: new Date().toISOString().slice(0, 10),
      currentPaymentRemark: '',
    };
  }
  if (resource.value === 'receipts')
    return {
      ...data,
      id: data.po_input_id ?? data.id,
      orderId: data.orderId ?? data.po_id,
      orgId: data.orgId ?? data.org_id,
      deptId: data.deptId ?? data.dept_id,
      warehouseId: data.warehouseId ?? data.warehouse_id,
      receiverId: data.receiverId ?? data.receiver_id,
      inputType: data.inputType ?? data.input_type,
      confirmStatus: data.confirmStatus ?? data.comfirm_status,
    };
  if (resource.value === 'returns')
    return {
      ...data,
      receiptId: data.receiptId ?? data.po_input_id,
      orderId: data.orderId ?? data.po_id,
      reason: data.reason ?? data.exit_reson,
      returnDate: dateText(data.returnDate ?? data.exit_date),
      returnType: data.returnType ?? data.exit_type,
      approveStatus: data.approveStatus ?? data.approve_status,
    };
  if (resource.value === 'refunds')
    return {
      ...data,
      refundDate: dateText(data.refundDate),
      refundAmount: Number(data.remainingAmount ?? 0),
      refundChannel: 1,
      supplierSerialNo: '',
      receiveAccount: '',
      requestKey: '',
      flowRemark: '',
      flows: data.flows ?? [],
    };
  return data;
}
async function open(modeValue: Mode, row: any) {
  mode.value = modeValue;
  error.value = '';
  try {
    const data = normalizeDetail(await api.get(`/purchase/${resource.value}/${row.id}`));
    detail.value = data;
    resetForm();
    Object.assign(form, data);
    if (resource.value === 'receipts' && modeValue === 'edit' && Array.isArray(form.details)) {
      form.details = form.details.map((line: any) => ({
        ...line,
        batchNo: String(line.batchNo ?? '').trim() || generateBatchNo(),
      }));
    }
    if (resource.value === 'returns') {
      if (form.receiptId) {
        const receipt: any = await api.get(`/purchase/receipts/${form.receiptId}`);
        Object.assign(form, {
          orderId: receipt.orderId ?? receipt.po_id,
          orgId: receipt.orgId ?? receipt.org_id,
          deptId: receipt.deptId ?? receipt.dept_id,
          warehouseId: receipt.warehouseId ?? receipt.warehouse_id,
        });
      }
      if (form.orderId) {
        const order: any = await api.get(`/purchase/orders/${form.orderId}`);
        Object.assign(form, {
          orgId: form.orgId || order.orgId || order.org_id,
          deptId: form.deptId || order.deptId || order.dept_id,
          warehouseId: form.warehouseId || order.warehouseId || order.warehouse_id,
          vendorId: order.vendorId ?? order.vendor_id,
        });
      }
    }
    if (form.orgId) await loadOrganizationOptions(form.orgId);
    if (Array.isArray(form.details)) await Promise.all(form.details.map(enrichLine));
    if (resource.value === 'receipts' && modeValue === 'edit' && form.warehouseId) {
      const selectedWarehouse = filteredWarehouses.value.find(
        (item) => String(item.value) === String(form.warehouseId),
      );
      if (
        !selectedWarehouse ||
        (documentWarehouseType.value &&
          optionWarehouseType(selectedWarehouse) !== documentWarehouseType.value)
      ) {
        form.warehouseId = '';
        ElMessage.warning('原入库仓库与商品分类不匹配，请重新选择同组织、同类型仓库');
      }
    }
    dialog.value = true;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message ?? '单据详情加载失败，请重试');
  }
}
function validateLines() {
  if (resource.value === 'payments' || resource.value === 'refunds') return true;
  if (!form.details?.length) {
    ElMessage.warning('至少需要一条采购明细');
    return false;
  }
  for (const line of form.details) {
    if (!line.goodsId || !line.skuId) {
      ElMessage.warning('请选择商品和规格');
      return false;
    }
    const amount =
      resource.value === 'receipts'
        ? line.inputQuantity
        : resource.value === 'returns'
          ? line.returnQuantity
          : line.quantity;
    if (Number(amount) <= 0) {
      ElMessage.warning('明细数量必须大于 0');
      return false;
    }
    if (resource.value === 'orders' && Number(line.totalAmount ?? 0) <= 0) {
      ElMessage.warning('采购订单明细总价必须大于 0');
      return false;
    }
    if (resource.value === 'receipts' && !String(line.batchNo ?? '').trim())
      line.batchNo = generateBatchNo();
    if (
      resource.value === 'receipts' &&
      !form.directReceipt &&
      Number(line.inputQuantity) > Number(line.remainingQuantity ?? 0)
    ) {
      ElMessage.warning('实收数不能超过订单剩余可收数量');
      return false;
    }
    if (resource.value === 'returns' && Number(line.returnQuantity) > Number(line.inputQuantity)) {
      ElMessage.warning('本次退货不能超过来源入库数量');
      return false;
    }
  }
  if (documentWarehouseTypes.value.length > 1) {
    ElMessage.warning('同一采购单据只能包含相同仓库类型的商品，请拆分单据');
    return false;
  }
  const warehouse = filteredWarehouses.value.find(
    (item) => String(item.value) === String(form.warehouseId),
  );
  if (
    form.warehouseId &&
    documentWarehouseType.value &&
    (!warehouse || optionWarehouseType(warehouse) !== documentWarehouseType.value)
  ) {
    ElMessage.warning('所选仓库类型与商品分类不一致，请重新选择');
    return false;
  }
  return true;
}
async function save(submit = false) {
  if (
    resource.value === 'receipts' &&
    form.directReceipt &&
    (!form.orgId || !form.warehouseId || !form.vendorId || !form.deptId)
  ) {
    ElMessage.warning('临时采购入库必须选择组织、仓库、供应商和部门');
    return;
  }
  if (
    resource.value === 'orders' &&
    mode.value === 'create' &&
    Number(form.currentPaymentAmount ?? 0) > orderTotalAmount.value
  ) {
    ElMessage.warning('本次付款金额不能超过订单总金额');
    return;
  }
  if (
    resource.value === 'orders' &&
    mode.value === 'create' &&
    Number(form.currentPaymentAmount ?? 0) > 0 &&
    !form.vendorId
  ) {
    ElMessage.warning('登记本次付款前必须选择供应商');
    return;
  }
  if (!(await formRef.value?.validate().catch(() => false)) || !validateLines()) return;
  saving.value = true;
  try {
    const url = `/purchase/${resource.value}${mode.value === 'edit' ? `/${detail.value.id ?? detail.value.po_id ?? detail.value.po_input_id ?? detail.value.po_exit_id}` : ''}`;
    const payload = {
      ...form,
      ...(resource.value === 'receipts' && form.directReceipt ? { orderId: '' } : {}),
    };
    const result =
      mode.value === 'edit'
        ? ((await api.patch(url, payload)) as any)
        : ((await api.post(url, payload)) as any);
    if (submit && (resource.value === 'applications' || resource.value === 'returns'))
      await api.post(`/purchase/${resource.value}/${result.id}/submit`);
    if (submit && resource.value === 'receipts')
      await api.post(`/purchase/receipts/${result.id}/confirm`, {
        confirmed: true,
        comment: '办理采购入库',
      });
    ElMessage.success(
      submit
        ? resource.value === 'receipts'
          ? '采购入库办理完成，库存已增加'
          : '已提交审批'
        : `${config.value.title}已保存`,
    );
    dialog.value = false;
    await Promise.all([load(), loadOptions()]);
  } finally {
    saving.value = false;
  }
}
async function remove(row: any) {
  const wording =
    resource.value === 'payments'
      ? '撤销后将反向重算订单累计已付金额和结清状态，是否继续？'
      : `删除后不可恢复，是否删除该${config.value.title}？`;
  await ElMessageBox.confirm(wording, resource.value === 'payments' ? '确认撤销付款' : '确认删除', {
    type: 'warning',
    confirmButtonText: '确认',
    cancelButtonText: '取消',
  });
  await api.delete(`/purchase/${resource.value}/${row.id}`);
  ElMessage.success(resource.value === 'payments' ? '付款已撤销' : '删除成功');
  load();
  loadOptions();
}
async function submit(row: any) {
  await ElMessageBox.confirm('提交后将进入审批流程，是否继续？', '提交审批');
  await api.post(`/purchase/${resource.value}/${row.id}/submit`);
  ElMessage.success('已提交审批');
  load();
}
async function approve(row: any, approved: boolean) {
  let comment = '';
  if (approved)
    await ElMessageBox.confirm(
      resource.value === 'returns'
        ? '审批通过将立即扣减库存，是否继续？'
        : '审批通过后将自动生成待采购订单，供应商在采购订单中补充。是否继续？',
      '确认审批通过',
      { type: 'warning' },
    );
  else {
    const result = await ElMessageBox.prompt('请输入驳回原因', '驳回审批', {
      inputValidator: (value) => !!String(value).trim() || '驳回原因不能为空',
    });
    comment = result.value;
  }
  await api.post(`/purchase/${resource.value}/${row.id}/approve`, { approved, comment });
  ElMessage.success(approved ? '审批已通过' : '单据已驳回');
  load();
  loadOptions();
}
async function startPurchase(row: any) {
  if (!Number(row.vendorId)) {
    ElMessage.warning('请先编辑订单并选择供应商');
    await open('edit', row);
    return;
  }
  await ElMessageBox.confirm(
    '开始采购后将锁定订单关键内容，并进入采购中状态。是否继续？',
    '开始采购',
    { type: 'warning', confirmButtonText: '确认开始' },
  );
  const result = (await api.post(`/purchase/orders/${row.id}/start`)) as any;
  ElMessage.success(result.message ?? '采购订单已开始采购');
  await Promise.all([load(), loadOptions()]);
}
async function openOrderPayment(row: any) {
  if (!Number(row.vendorId)) {
    ElMessage.warning('请先选择供应商并保存采购订单');
    return;
  }
  if (!(Number(row.remainingPayable ?? 0) > 0)) {
    ElMessage.warning('该采购订单已经没有待付款金额');
    return;
  }
  const data = normalizeDetail(await api.get(`/purchase/orders/${row.id}`));
  mode.value = 'payment';
  detail.value = data;
  resetForm();
  Object.assign(form, data, {
    currentPaymentAmount: Number(data.remainingPayable ?? 0),
    currentPaymentChannel: Number(dicts.payment_channel?.[0]?.value ?? 1),
    currentPaymentDate: new Date().toISOString().slice(0, 10),
    currentPaymentRemark: '',
  });
  dialog.value = true;
}
async function confirmOrderPayment() {
  const amount = Number(form.currentPaymentAmount ?? 0);
  if (!(amount > 0)) {
    ElMessage.warning('本次付款金额必须大于0');
    return;
  }
  if (amount > Number(form.remainingPayable ?? 0)) {
    ElMessage.warning('本次付款不能超过待付款金额');
    return;
  }
  if (!form.currentPaymentChannel || !form.currentPaymentDate) {
    ElMessage.warning('请选择付款渠道和付款日期');
    return;
  }
  await ElMessageBox.confirm(`确认登记本次付款 ¥ ${moneyText(amount)}？`, '确认采购付款', {
    type: 'warning',
    confirmButtonText: '确认付款',
    cancelButtonText: '取消',
  });
  saving.value = true;
  try {
    const result = (await api.post('/purchase/payments', {
      orderId: form.id,
      deptId: form.deptId,
      paymentAmount: amount,
      paymentChannel: Number(form.currentPaymentChannel),
      paymentDate: form.currentPaymentDate,
      remark: form.currentPaymentRemark,
    })) as any;
    ElMessage.success(result.message ?? '采购付款已生效');
    dialog.value = false;
    await Promise.all([load(), loadOptions()]);
  } finally {
    saving.value = false;
  }
}
async function generateReceipt(row: any) {
  const result = (await api.post(`/purchase/orders/${row.id}/generate-receipt`, {})) as any;
  ElMessage.success(result.message ?? '采购入库单已生成');
  await router.push({ path: '/purchase/receipts', query: { receiptId: String(result.id) } });
}
async function startReturn(row: any) {
  await router.push({ path: '/purchase/returns', query: { returnReceiptId: String(row.id) } });
}
async function cancelPendingReceipt(row: any) {
  await ElMessageBox.confirm(
    '撤销后将释放该单锁定的待入库数量，不影响库存。是否继续？',
    '撤销待入库单',
    { type: 'warning', confirmButtonText: '确认撤销' },
  );
  const result = (await api.post(`/purchase/receipts/${row.id}/cancel`, {
    comment: '业务撤销待入库单',
  })) as any;
  ElMessage.success(result.message ?? '待入库单已撤销');
  await Promise.all([load(), loadOptions()]);
}
async function openCancel(row: any) {
  mode.value = 'cancel';
  detail.value = null;
  const data = normalizeDetail(await api.get(`/purchase/orders/${row.id}`));
  detail.value = data;
  resetForm();
  Object.assign(form, data);
  form.returnReason = '';
  form.details = (data.details ?? [])
    .filter((line: any) => Number(line.remainingQuantity ?? 0) > 0)
    .map((line: any) => ({ ...line, cancelQuantity: 0 }));
  if (!form.details.length) {
    ElMessage.warning('该订单没有可退回的未到货数量');
    return;
  }
  dialog.value = true;
}
async function confirmCancel() {
  if (!form.details?.length) return;
  const selected = form.details.filter((line: any) => Number(line.cancelQuantity) > 0);
  if (!selected.length) {
    ElMessage.warning('请至少填写一条退回数量');
    return;
  }
  for (const line of selected) {
    if (Number(line.cancelQuantity) > Number(line.remainingQuantity)) {
      ElMessage.warning(`商品 ${line.goodsName} 退回数量超过可退数量`);
      return;
    }
  }
  try {
    const result = (await api.post(`/purchase/orders/${form.id}/cancel-pending`, {
      reason: form.returnReason || '采购订单未到货退回',
      details: selected.map((line: any) => ({
        goodsId: line.goodsId,
        skuId: line.skuId,
        cancelQuantity: Number(line.cancelQuantity),
      })),
    })) as any;
    ElMessage.success(result.message ?? '未到货数量已退回');
    dialog.value = false;
    await Promise.all([load(), loadOptions()]);
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message ?? '退回失败');
  }
}
function refundRequestKey() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `refund-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}
async function openRefund(row: any) {
  mode.value = 'refund';
  error.value = '';
  try {
    const data = normalizeDetail(await api.get(`/purchase/refunds/${row.id}`));
    detail.value = data;
    resetForm();
    Object.assign(form, data, {
      refundAmount: Number(data.remainingAmount ?? 0),
      refundChannel: 1,
      refundDate: new Date().toISOString().slice(0, 10),
      supplierSerialNo: '',
      receiveAccount: '',
      requestKey: refundRequestKey(),
      flowRemark: '',
    });
    dialog.value = true;
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message ?? '退款任务加载失败');
  }
}
async function confirmRefund() {
  if (!(Number(form.refundAmount) > 0)) {
    ElMessage.warning('本次退款金额必须大于0');
    return;
  }
  if (Number(form.refundAmount) > Number(form.remainingAmount ?? 0)) {
    ElMessage.warning('本次退款不能超过剩余应退金额');
    return;
  }
  if (!form.refundChannel || !form.refundDate) {
    ElMessage.warning('请选择退款渠道和退款日期');
    return;
  }
  await ElMessageBox.confirm(
    `确认记录本次退款 ¥ ${moneyText(form.refundAmount)} ？`,
    '确认采购退款',
    { type: 'warning', confirmButtonText: '确认退款', cancelButtonText: '取消' },
  );
  saving.value = true;
  try {
    const result = (await api.post(`/purchase/refunds/${form.id}/flows`, {
      refundAmount: Number(form.refundAmount),
      refundChannel: Number(form.refundChannel),
      refundDate: form.refundDate,
      supplierSerialNo: form.supplierSerialNo,
      receiveAccount: form.receiveAccount,
      requestKey: form.requestKey || refundRequestKey(),
      remark: form.flowRemark,
    })) as any;
    ElMessage.success(result.message ?? '采购退款已记录');
    const data = normalizeDetail(await api.get(`/purchase/refunds/${form.id}`));
    detail.value = data;
    resetForm();
    Object.assign(form, data, {
      refundAmount: Number(data.remainingAmount ?? 0),
      refundChannel: 1,
      refundDate: new Date().toISOString().slice(0, 10),
      requestKey: refundRequestKey(),
      flowRemark: '',
    });
    mode.value = Number(data.remainingAmount ?? 0) > 0 ? 'refund' : 'view';
    await load();
  } finally {
    saving.value = false;
  }
}
async function voidRefundFlow(flow: any) {
  await ElMessageBox.confirm('作废后会重算累计已退和退款状态，是否继续？', '作废退款流水', {
    type: 'warning',
    confirmButtonText: '确认作废',
    cancelButtonText: '取消',
  });
  const result = (await api.delete(`/purchase/refunds/flows/${flow.id}`)) as any;
  ElMessage.success(result.message ?? '退款流水已作废');
  const data = normalizeDetail(await api.get(`/purchase/refunds/${form.id}`));
  detail.value = data;
  resetForm();
  Object.assign(form, data);
  mode.value = 'view';
  await load();
}
async function closeRefund(row: any) {
  const result = await ElMessageBox.prompt('请输入关闭原因', '关闭采购退款任务', {
    inputValidator: (value) => !!String(value).trim() || '关闭原因不能为空',
    confirmButtonText: '确认关闭',
    cancelButtonText: '取消',
  });
  const response = (await api.post(`/purchase/refunds/${row.id}/close`, {
    reason: result.value,
  })) as any;
  ElMessage.success(response.message ?? '退款任务已关闭');
  await load();
}
function editable(row: any) {
  if (resource.value === 'applications')
    return (!Number(row.status) && [0, 2].includes(approval(row))) || approval(row) === 2;
  if (resource.value === 'returns')
    return (!Number(row.status) && [0, 2].includes(approval(row))) || approval(row) === 2;
  if (resource.value === 'refunds' || resource.value === 'payments') return false;
  if (resource.value === 'receipts') return Number(row.confirmStatus) === 0;
  if (resource.value === 'orders') return Number(row.orderStatus) === 1 && !row.applicationId;
  return false;
}
function removable(row: any) {
  return (
    resource.value === 'payments' ||
    (resource.value === 'orders' && Number(row.orderStatus) === 1) ||
    (['applications', 'returns'].includes(resource.value) && editable(row))
  );
}
function canSubmit(row: any) {
  return ['applications', 'returns'].includes(resource.value) && editable(row);
}
function canApprove(row: any) {
  return (
    ['applications', 'returns'].includes(resource.value) &&
    Number(row.status) === 1 &&
    approval(row) === 0
  );
}
function amount(row: any) {
  if (resource.value === 'orders') return Number(row.totalAmount ?? 0);
  return Number(row.quantity ?? 0) * Number(row.unitPrice ?? 0);
}
function calculatedOrderUnitPrice(row: any) {
  const quantity = Number(row.quantity ?? 0);
  return quantity > 0 ? Number(row.totalAmount ?? 0) / quantity : 0;
}
function orderOf(id: unknown) {
  return byId('orders', id);
}
const editLabel = computed(() => (resource.value === 'receipts' ? '办理入库' : '编辑'));
const removeLabel = computed(() => (resource.value === 'payments' ? '撤销' : '删除'));
const isApp = computed(() => resource.value === 'applications');
const isOrd = computed(() => resource.value === 'orders');
const isRct = computed(() => resource.value === 'receipts');
const isRefund = computed(() => resource.value === 'refunds');
function vendorOfOrder(id: unknown) {
  return lookup('vendors', orderOf(id)?.vendorId);
}
function openTrace(row: any) {
  traceRow.value = row;
  traceVisible.value = true;
}
function openOperationHistory(row: any) {
  traceRow.value = row;
  operationHistoryVisible.value = true;
}
function openOrderGeneration(row: any, previewMode: 'all' | 'partial' | 'related') {
  orderGenerationApplicationId.value = String(row.id);
  orderGenerationMode.value = previewMode;
  orderGenerationVisible.value = true;
}

watch(
  [
    resource,
    () => route.query.viewId,
    () => route.query.receiptId,
    () => route.query.returnReceiptId,
  ],
  async () => {
    query.page = 1;
    resetQuery();
    await loadOptions();
    await nextTick();
    await openFromRoute();
  },
);
async function openFromRoute() {
  if (String(route.query.create ?? '') === '1') await openCreate();
  if (resource.value === 'orders' && route.query.viewId)
    await open('view', { id: String(route.query.viewId) });
  if (resource.value === 'orders' && route.query.applicationId) {
    await openCreate();
    form.applicationId = String(route.query.applicationId);
    await sourceApplicationChanged();
  }
  if (resource.value === 'receipts' && route.query.orderId) {
    await openCreate();
    form.orderId = String(route.query.orderId);
    await sourceOrderChanged();
  }
  if (resource.value === 'receipts' && route.query.receiptId)
    await open('edit', { id: String(route.query.receiptId) });
  if (resource.value === 'returns' && route.query.returnReceiptId) {
    await openCreate();
    form.receiptId = String(route.query.returnReceiptId);
    await sourceReceiptChanged();
  }
}
onMounted(async () => {
  await Promise.all([load(), loadOptions()]);
  await openFromRoute();
});
</script>

<template>
  <section class="page purchase-page">
    <header class="page-head">
      <div>
        <h2>{{ config.title }}</h2>
        <p class="page-subtitle">{{ config.subtitle }}</p>
      </div>
      <el-button
        v-if="!['returns', 'refunds', 'payments'].includes(resource)"
        type="primary"
        @click="openCreate"
        >{{ config.createText }}</el-button
      >
    </header>
    <div class="panel">
      <SummaryStrip :items="summaryItems" />
      <div class="query-bar">
        <el-input
          v-if="resource === 'applications'"
          v-model="query.keyword"
          class="query-field keyword"
          clearable
          placeholder="申请单号或申请原因"
          @keyup.enter="search"
        />
        <el-tree-select
          v-if="resource === 'applications'"
          v-model="query.orgId"
          :data="organizationTree"
          class="query-field"
          clearable
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          placeholder="所属组织"
        />
        <el-select
          v-if="resource === 'applications'"
          v-model="query.warehouseId"
          class="query-field"
          clearable
          filterable
          placeholder="目标仓库"
          ><el-option
            v-for="item in options.warehouses"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <el-select
          v-if="resource === 'applications'"
          v-model="query.approveStatus"
          class="query-field"
          clearable
          placeholder="审批状态"
          ><el-option
            v-for="item in (dicts.approval_status ?? []).filter((item) => Number(item.value) !== 3)"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
        /></el-select>
        <el-select
          v-if="resource === 'returns'"
          v-model="query.approveStatus"
          class="query-field"
          clearable
          placeholder="处理状态"
          ><el-option
            v-for="item in dicts.purchase_return_status"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
        /></el-select>
        <el-date-picker
          v-if="resource === 'applications'"
          v-model="query.dateRange"
          class="query-field"
          type="daterange"
          range-separator="至"
          start-placeholder="申请日期起"
          end-placeholder="申请日期止"
          value-format="YYYY-MM-DD"
        />
        <el-select
          v-if="resource === 'orders'"
          v-model="query.vendorId"
          class="query-field"
          clearable
          filterable
          placeholder="供应商"
          ><el-option
            v-for="item in options.vendors"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <el-select
          v-if="resource === 'orders'"
          v-model="query.orderStatus"
          class="query-field"
          clearable
          placeholder="采购状态"
          ><el-option
            v-for="item in dicts.purchase_order_status"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <el-select
          v-if="resource === 'receipts'"
          v-model="query.confirmStatus"
          class="query-field"
          clearable
          placeholder="入库状态"
          ><el-option
            v-for="item in dicts.purchase_input_status"
            :key="item.value"
            :label="item.label"
            :value="Number(item.value)"
        /></el-select>
        <el-select
          v-if="resource === 'payments'"
          v-model="query.orderId"
          class="query-field keyword"
          clearable
          filterable
          placeholder="关联采购订单"
          ><el-option
            v-for="item in options.orders"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <el-select
          v-if="resource === 'refunds'"
          v-model="query.orderId"
          class="query-field keyword"
          clearable
          filterable
          placeholder="关联采购订单"
          ><el-option
            v-for="item in options.orders"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <el-select
          v-if="resource === 'refunds'"
          v-model="query.vendorId"
          class="query-field"
          clearable
          filterable
          placeholder="供应商"
          ><el-option
            v-for="item in options.vendors"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <el-select
          v-if="resource === 'refunds'"
          v-model="query.sourceType"
          class="query-field"
          clearable
          placeholder="退款来源"
          ><el-option
            v-for="item in dicts.purchase_refund_source"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <el-select
          v-if="resource === 'refunds'"
          v-model="query.refundStatus"
          class="query-field"
          clearable
          placeholder="退款状态"
          ><el-option
            v-for="item in dicts.purchase_refund_status"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <div class="query-actions">
          <el-button type="primary" @click="search">查询</el-button
          ><el-button @click="resetQuery">重置</el-button>
        </div>
      </div>
      <div class="table-wrap purchase-table-wrap">
        <el-table :data="rows" v-loading="loading" stripe class="purchase-list-table">
          <template #empty
            ><DataState
              :error="error"
              :empty="!rows.length"
              :loading="loading"
              :title="config.title"
              :can-create="!['returns', 'refunds', 'payments'].includes(resource)"
              :empty-description="
                resource === 'refunds'
                  ? '暂无需要处理的采购退款任务'
                  : resource === 'payments'
                    ? '暂无采购付款流水'
                    : undefined
              "
              :empty-hint="
                resource === 'refunds'
                  ? '采购退货形成实际应退金额后，系统将自动生成退款任务'
                  : resource === 'payments'
                    ? '请从采购订单操作列发起付款'
                    : undefined
              "
              @retry="load"
              @create="openCreate"
          /></template>
          <el-table-column type="index" label="序号" width="64" fixed="left" />
          <el-table-column prop="id" label="ID" width="100" fixed="left" />
          <template v-if="resource === 'applications'">
            <el-table-column
              prop="applicationNo"
              label="申请单号"
              min-width="160"
            /><el-table-column label="组织" min-width="160" show-overflow-tooltip
              ><template #default="s">{{
                lookup('organizations', s.row.orgId)
              }}</template></el-table-column
            ><el-table-column label="申请部门" min-width="128" show-overflow-tooltip
              ><template #default="s">{{
                lookup('departments', s.row.deptId)
              }}</template></el-table-column
            ><el-table-column label="目标仓库" min-width="144" show-overflow-tooltip
              ><template #default="s">{{
                lookup('warehouses', s.row.warehouseId)
              }}</template></el-table-column
            ><el-table-column
              prop="reason"
              label="申请原因"
              min-width="200"
              show-overflow-tooltip
            /><el-table-column label="申请数量" width="104" align="right"
              ><template #default="s">{{ s.row.quantity ?? 0 }}</template></el-table-column
            ><el-table-column label="创建人" width="96"
              ><template #default="s">{{ creator(s.row) }}</template></el-table-column
            ><el-table-column label="创建时间" width="160"
              ><template #default="s">{{
                dateText(s.row.createdAt, true)
              }}</template></el-table-column
            ><el-table-column label="审批状态" width="96"
              ><template #default="s"
                ><StatusTag
                  :value="s.row.approveStatus"
                  :label="dictLabel('approval_status', s.row.approveStatus)" /></template
            ></el-table-column>
          </template>
          <template v-else-if="resource === 'orders'">
            <el-table-column prop="orderNo" label="订单编号" min-width="160" />
            <el-table-column label="数据来源" width="112"
              ><template #default="s">{{
                s.row.applicationId ? '采购申请转入' : '直接采购'
              }}</template></el-table-column
            >
            <el-table-column label="供应商" min-width="176" show-overflow-tooltip
              ><template #default="s">{{
                s.row.vendorName || lookup('vendors', s.row.vendorId)
              }}</template></el-table-column
            >
            <el-table-column label="仓库" min-width="160" show-overflow-tooltip
              ><template #default="s">{{
                lookup('warehouses', s.row.warehouseId)
              }}</template></el-table-column
            >
            <el-table-column label="计划到货日" width="112"
              ><template #default="s">{{
                dateText(s.row.planArrivalDate)
              }}</template></el-table-column
            >
            <el-table-column label="采购数量" width="104" align="right"
              ><template #default="s">{{
                s.row.pcsQty ?? s.row.quantity
              }}</template></el-table-column
            >
            <el-table-column label="订单总金额" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.payableAmount ?? s.row.totalAmount) }}</template
              ></el-table-column
            >
            <el-table-column label="净已付" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.netPaidAmount ?? 0) }}</template
              ></el-table-column
            >
            <el-table-column label="待付款" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.remainingPayable ?? 0) }}</template
              ></el-table-column
            >
            <el-table-column label="付款进度" width="104"
              ><template #default="s"
                ><StatusTag
                  :value="s.row.paymentProgressStatus"
                  kind="record"
                  :label="
                    dictLabel('purchase_payment_progress_status', s.row.paymentProgressStatus)
                  " /></template
            ></el-table-column>
            <el-table-column label="到货进度" width="96" align="right"
              ><template #default="s"
                ><span>{{ s.row.arrivalProgress ?? 0 }}%</span></template
              ></el-table-column
            >
            <el-table-column label="采购状态" width="104"
              ><template #default="s"
                ><StatusTag
                  :value="s.row.orderStatus"
                  kind="order"
                  :label="dictLabel('purchase_order_status', s.row.orderStatus)" /></template
            ></el-table-column>
            <el-table-column label="创建人" width="96"
              ><template #default="s">{{ creator(s.row) }}</template></el-table-column
            >
          </template>
          <template v-else-if="resource === 'receipts'">
            <el-table-column prop="receiptNo" label="入库单号" min-width="160" /><el-table-column
              label="数据来源"
              min-width="160"
              ><template #default="s">{{
                s.row.orderNo ?? orderOf(s.row.orderId)?.orderNo ?? '—'
              }}</template></el-table-column
            ><el-table-column label="供应商" min-width="176" show-overflow-tooltip
              ><template #default="s">{{ vendorOfOrder(s.row.orderId) }}</template></el-table-column
            ><el-table-column label="仓库" min-width="160" show-overflow-tooltip
              ><template #default="s">{{
                lookup('warehouses', s.row.warehouseId)
              }}</template></el-table-column
            ><el-table-column label="生成日期" width="112"
              ><template #default="s">{{ dateText(s.row.createdAt) }}</template></el-table-column
            ><el-table-column label="订单数量" width="104" align="right"
              ><template #default="s">{{ s.row.orderQuantity }}</template></el-table-column
            ><el-table-column label="本次入库" width="104" align="right"
              ><template #default="s">{{ s.row.inputQuantity }}</template></el-table-column
            ><el-table-column label="入库状态" width="96"
              ><template #default="s"
                ><StatusTag
                  :value="s.row.confirmStatus"
                  :label="
                    dictLabel('purchase_input_status', s.row.confirmStatus)
                  " /></template></el-table-column
            ><el-table-column label="创建人" width="96"
              ><template #default="s">{{ creator(s.row) }}</template></el-table-column
            >
          </template>
          <template v-else-if="resource === 'returns'">
            <el-table-column prop="returnNo" label="退货单号" min-width="160" /><el-table-column
              label="退货来源"
              width="120"
              ><template #default="s">{{ s.row.sourceTypeLabel }}</template></el-table-column
            ><el-table-column label="采购订单" min-width="160"
              ><template #default="s">{{
                s.row.orderNo ?? orderOf(s.row.orderId)?.orderNo ?? '—'
              }}</template></el-table-column
            ><el-table-column label="来源入库单" min-width="160"
              ><template #default="s">{{
                s.row.sourceType === 'receipt'
                  ? (byId('receipts', s.row.receiptId)?.receiptNo ?? `GA${s.row.receiptId}`)
                  : '—'
              }}</template></el-table-column
            ><el-table-column label="退货数量" width="104" align="right"
              ><template #default="s">{{ s.row.returnQty ?? 0 }}</template></el-table-column
            ><el-table-column label="库存影响" width="96"
              ><template #default="s">{{
                s.row.affectsInventory ? '扣减库存' : '不影响库存'
              }}</template></el-table-column
            ><el-table-column label="供应商" min-width="176" show-overflow-tooltip
              ><template #default="s">{{ vendorOfOrder(s.row.orderId) }}</template></el-table-column
            ><el-table-column label="退货日期" width="112"
              ><template #default="s">{{ dateText(s.row.returnDate) }}</template></el-table-column
            ><el-table-column label="处理状态" width="96"
              ><template #default="s"
                ><StatusTag
                  :value="s.row.approveStatus"
                  :label="
                    dictLabel('purchase_return_status', s.row.approveStatus)
                  " /></template></el-table-column
            ><el-table-column label="创建人" width="96"
              ><template #default="s">{{ creator(s.row) }}</template></el-table-column
            >
          </template>
          <template v-else-if="resource === 'refunds'">
            <el-table-column prop="refundNo" label="退款单号" min-width="160" />
            <el-table-column prop="returnNo" label="来源退货单" min-width="160" />
            <el-table-column label="退款来源" width="136"
              ><template #default="s">{{
                dictLabel('purchase_refund_source', s.row.sourceType)
              }}</template></el-table-column
            >
            <el-table-column prop="orderNo" label="采购订单" min-width="160" />
            <el-table-column
              prop="vendorName"
              label="供应商"
              min-width="176"
              show-overflow-tooltip
            />
            <el-table-column label="退货金额" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.returnAmount) }}</template
              ></el-table-column
            >
            <el-table-column label="应退金额" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.refundableAmount) }}</template
              ></el-table-column
            >
            <el-table-column label="已退金额" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.refundedAmount) }}</template
              ></el-table-column
            >
            <el-table-column label="待退金额" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.remainingAmount) }}</template
              ></el-table-column
            >
            <el-table-column label="退款状态" width="112"
              ><template #default="s"
                ><StatusTag
                  :value="s.row.refundStatus"
                  kind="record"
                  :label="dictLabel('purchase_refund_status', s.row.refundStatus)" /></template
            ></el-table-column>
            <el-table-column label="创建时间" width="160"
              ><template #default="s">{{
                dateText(s.row.createdAt, true)
              }}</template></el-table-column
            >
          </template>
          <template v-else>
            <el-table-column prop="paymentNo" label="付款单号" min-width="160" /><el-table-column
              label="采购订单"
              min-width="160"
              ><template #default="s"
                ><div>{{ s.row.orderNo ?? orderOf(s.row.orderId)?.orderNo ?? '—' }}</div></template
              ></el-table-column
            ><el-table-column label="供应商" min-width="176" show-overflow-tooltip
              ><template #default="s">{{
                s.row.vendorName || vendorOfOrder(s.row.orderId)
              }}</template></el-table-column
            ><el-table-column label="订单应付" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.orderPayable ?? 0) }}</template
              ></el-table-column
            ><el-table-column label="退货后应付" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.effectivePayable ?? s.row.orderPayable ?? 0) }}</template
              ></el-table-column
            ><el-table-column label="累计已付" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.orderPaid ?? 0) }}</template
              ></el-table-column
            ><el-table-column label="累计已退" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.orderRefunded ?? 0) }}</template
              ></el-table-column
            ><el-table-column label="净已付" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.netPaid ?? 0) }}</template
              ></el-table-column
            ><el-table-column label="剩余应付" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.orderRemaining ?? 0) }}</template
              ></el-table-column
            ><el-table-column label="本次付款" width="120" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.paymentAmount) }}</template
              ></el-table-column
            ><el-table-column label="付款渠道" width="112"
              ><template #default="s">{{
                dictLabel('payment_channel', s.row.paymentChannel)
              }}</template></el-table-column
            ><el-table-column label="付款日期" width="112"
              ><template #default="s">{{ dateText(s.row.paymentDate) }}</template></el-table-column
            ><el-table-column label="付款人" width="96"
              ><template #default="s">{{ creator(s.row) }}</template></el-table-column
            >
          </template>
          <el-table-column label="操作" width="176" fixed="right" align="center"
            ><template #default="s">
              <TableRowActions>
                <el-button link type="primary" @click="open('view', s.row)">查看</el-button>
                <el-button
                  v-if="editable(s.row)"
                  link
                  type="primary"
                  @click="open('edit', s.row)"
                  >{{ editLabel }}</el-button
                >
                <el-button
                  v-if="isOrd && Number(s.row.vendorId) > 0 && Number(s.row.remainingPayable) > 0"
                  link
                  type="primary"
                  @click="openOrderPayment(s.row)"
                  >付款</el-button
                >
                <el-button
                  v-if="isRefund && [0, 1].includes(Number(s.row.refundStatus))"
                  link
                  type="primary"
                  @click="openRefund(s.row)"
                  >确认退款</el-button
                >
                <template #more>
                  <template v-if="isApp && approval(s.row) === 1">
                    <el-dropdown-item @click="openOrderGeneration(s.row, 'all')"
                      >整单生成</el-dropdown-item
                    >
                    <el-dropdown-item @click="openOrderGeneration(s.row, 'partial')"
                      >选品生成</el-dropdown-item
                    >
                    <el-dropdown-item @click="openOrderGeneration(s.row, 'related')"
                      >关联订单</el-dropdown-item
                    >
                  </template>
                  <el-dropdown-item
                    :divided="isApp && approval(s.row) === 1"
                    @click="openOperationHistory(s.row)"
                    >操作记录</el-dropdown-item
                  >
                  <el-dropdown-item v-if="canSubmit(s.row)" @click="submit(s.row)"
                    >提交</el-dropdown-item
                  >
                  <el-dropdown-item
                    v-if="
                      resource === 'returns' &&
                      s.row.sourceDocumentType === 'inventory_loss' &&
                      s.row.sourceDocumentId
                    "
                    @click="
                      router.push({
                        path: '/inventory/losses',
                        query: { documentId: String(s.row.sourceDocumentId), view: '1' },
                      })
                    "
                    >查看来源报损单</el-dropdown-item
                  >
                  <el-dropdown-item
                    v-if="canApprove(s.row)"
                    class="table-action-success"
                    @click="approve(s.row, true)"
                    >通过</el-dropdown-item
                  >
                  <el-dropdown-item
                    v-if="canApprove(s.row)"
                    class="table-action-danger"
                    @click="approve(s.row, false)"
                    >驳回</el-dropdown-item
                  >
                  <el-dropdown-item
                    v-if="isOrd && Number(s.row.orderStatus) === 1"
                    class="table-action-success"
                    @click="startPurchase(s.row)"
                    >开始采购</el-dropdown-item
                  >
                  <el-dropdown-item
                    v-if="isOrd && [2, 3].includes(Number(s.row.orderStatus))"
                    @click="generateReceipt(s.row)"
                    >生成入库</el-dropdown-item
                  >
                  <el-dropdown-item
                    v-if="isOrd && [2, 3].includes(Number(s.row.orderStatus))"
                    class="table-action-warning"
                    @click="openCancel(s.row)"
                    >退回未到货</el-dropdown-item
                  >
                  <el-dropdown-item
                    v-if="isRct && Number(s.row.confirmStatus) === 0"
                    class="table-action-warning"
                    @click="cancelPendingReceipt(s.row)"
                    >撤销待入库</el-dropdown-item
                  >
                  <el-dropdown-item
                    v-if="isRct && Number(s.row.confirmStatus) === 1"
                    @click="startReturn(s.row)"
                    >退货</el-dropdown-item
                  >
                  <el-dropdown-item
                    v-if="isRefund && [0, 1].includes(Number(s.row.refundStatus))"
                    class="table-action-warning"
                    @click="closeRefund(s.row)"
                    >关闭退款任务</el-dropdown-item
                  >
                  <el-dropdown-item
                    v-if="removable(s.row)"
                    class="table-action-danger"
                    divided
                    @click="remove(s.row)"
                    >{{ removeLabel }}</el-dropdown-item
                  >
                </template>
              </TableRowActions>
            </template></el-table-column
          >
        </el-table>
      </div>
      <footer v-if="!error && rows.length" class="table-footer">
        <span class="result-total">共 {{ total }} 条{{ config.title }}记录</span
        ><el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          layout="prev, pager, next, sizes"
          @change="load"
        />
      </footer>
    </div>

    <el-dialog
      v-model="dialog"
      class="purchase-document-dialog"
      :title="dialogTitle"
      :width="
        mode === 'payment'
          ? '760'
          : resource === 'payments'
            ? '520'
            : resource === 'refunds'
              ? '880'
              : resource === 'receipts'
                ? '1120'
                : '1040'
      "
      top="4vh"
      :close-on-click-modal="false"
    >
      <template v-if="resource === 'orders' && mode === 'cancel'">
        <div class="purchase-dialog-content">
          <div class="section-title section-title--master"><strong>基本信息</strong></div>
          <div class="master-grid purchase-master-grid">
            <el-form-item label="采购订单"
              ><el-input :model-value="detail.orderNo" disabled
            /></el-form-item>
            <el-form-item label="供应商"
              ><el-input :model-value="lookup('vendors', detail.vendorId)" disabled
            /></el-form-item>
            <el-form-item label="退回原因" class="span-2"
              ><el-input v-model="form.returnReason" placeholder="请输入未到货退回原因"
            /></el-form-item>
          </div>
          <div class="section-title">
            <strong>未到货退回明细</strong
            ><span class="muted">待入库数量已锁定，不在可退范围内</span>
          </div>
          <el-table :data="form.details" border class="detail-table">
            <el-table-column label="商品编码" width="128"
              ><template #default="s">{{ goodsCode(s.row) }}</template></el-table-column
            >
            <el-table-column label="商品名称" min-width="160"
              ><template #default="s">{{ goodsName(s.row.goodsId) }}</template></el-table-column
            >
            <el-table-column label="规格" min-width="136"
              ><template #default="s">{{ skuText(s.row) }}</template></el-table-column
            >
            <el-table-column label="采购数量" width="104" align="right"
              ><template #default="s">{{ s.row.quantity }}</template></el-table-column
            >
            <el-table-column label="已锁定/入库" width="104" align="right"
              ><template #default="s">{{ s.row.arrivedQuantity ?? 0 }}</template></el-table-column
            >
            <el-table-column label="已取消" width="104" align="right"
              ><template #default="s">{{ s.row.canceledQuantity ?? 0 }}</template></el-table-column
            >
            <el-table-column label="可退未到货" width="104" align="right"
              ><template #default="s">{{ s.row.remainingQuantity }}</template></el-table-column
            >
            <el-table-column label="本次退回" width="120"
              ><template #default="s"
                ><el-input-number
                  v-model="s.row.cancelQuantity"
                  :min="0"
                  :max="Number(s.row.remainingQuantity)"
                  :precision="0"
                  :step="1"
                  controls-position="right" /></template
            ></el-table-column>
          </el-table>
        </div>
      </template>
      <el-form
        v-else-if="resource === 'orders' && mode === 'payment'"
        :model="form"
        label-position="top"
      >
        <div class="purchase-dialog-content">
          <div class="section-title section-title--master">
            <strong>订单与付款</strong><span class="muted">付款提交后自动形成采购付款流水</span>
          </div>
          <div class="master-grid purchase-master-grid payment-grid">
            <el-form-item label="采购订单"
              ><el-input :model-value="form.orderNo" disabled
            /></el-form-item>
            <el-form-item label="供应商"
              ><el-input :model-value="lookup('vendors', form.vendorId)" disabled
            /></el-form-item>
            <el-form-item label="结算方式"
              ><el-input
                :model-value="dictLabel('purchase_settlement_type', form.paymentType)"
                disabled
            /></el-form-item>
            <el-form-item label="付款后进度"
              ><el-input
                :model-value="
                  dictLabel('purchase_payment_progress_status', orderPreviewProgressStatus)
                "
                disabled
            /></el-form-item>
            <el-form-item label="订单总金额"
              ><el-input :model-value="`¥ ${moneyText(form.payableAmount)}`" disabled
            /></el-form-item>
            <el-form-item label="退货后应付"
              ><el-input :model-value="`¥ ${moneyText(form.effectivePayable)}`" disabled
            /></el-form-item>
            <el-form-item label="累计付款"
              ><el-input :model-value="`¥ ${moneyText(form.paidAmount)}`" disabled
            /></el-form-item>
            <el-form-item label="累计退款"
              ><el-input :model-value="`¥ ${moneyText(form.refundedAmount)}`" disabled
            /></el-form-item>
            <el-form-item label="净已付款"
              ><el-input :model-value="`¥ ${moneyText(form.netPaidAmount)}`" disabled
            /></el-form-item>
            <el-form-item label="本次付款前待付"
              ><el-input :model-value="`¥ ${moneyText(form.remainingPayable)}`" disabled
            /></el-form-item>
            <el-form-item label="本次付款金额"
              ><el-input-number
                v-model="form.currentPaymentAmount"
                :min="0.01"
                :max="Number(form.remainingPayable ?? 0)"
                :precision="2"
                controls-position="right"
            /></el-form-item>
            <el-form-item label="付款后待付"
              ><el-input :model-value="`¥ ${moneyText(orderRemainingAfterPayment)}`" disabled
            /></el-form-item>
            <el-form-item label="付款日期"
              ><el-date-picker v-model="form.currentPaymentDate" value-format="YYYY-MM-DD"
            /></el-form-item>
            <el-form-item label="付款渠道"
              ><el-select v-model="form.currentPaymentChannel"
                ><el-option
                  v-for="item in dicts.payment_channel"
                  :key="item.value"
                  :label="item.label"
                  :value="Number(item.value)" /></el-select
            ></el-form-item>
            <el-form-item label="付款人"
              ><el-input :model-value="auth.user?.username" disabled
            /></el-form-item>
            <el-form-item label="付款备注"
              ><el-input v-model="form.currentPaymentRemark"
            /></el-form-item>
          </div>
        </div>
      </el-form>
      <el-form
        v-else
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        :disabled="mode === 'view'"
      >
        <div class="purchase-dialog-content">
          <div class="section-title section-title--master"><strong>基本信息</strong></div>
          <div
            class="master-grid purchase-master-grid"
            :class="{ 'payment-grid': resource === 'payments' || resource === 'refunds' }"
          >
            <template v-if="resource === 'applications'"
              ><el-form-item label="所属组织" prop="orgId"
                ><el-tree-select
                  v-model="form.orgId"
                  :data="organizationTree"
                  filterable
                  check-strictly
                  node-key="value"
                  :props="{ label: 'label', children: 'children' }"
                  @change="organizationChanged" /></el-form-item
              ><el-form-item label="申请部门" prop="deptId"
                ><el-select v-model="form.deptId" filterable :disabled="!form.orgId"
                  ><el-option
                    v-for="item in filteredDepartments"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value" /></el-select></el-form-item
              ><el-form-item label="目标仓库" prop="warehouseId"
                ><el-select v-model="form.warehouseId" filterable :disabled="!form.orgId"
                  ><el-option
                    v-for="item in compatibleWarehouses"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value" /></el-select></el-form-item
              ><el-form-item label="申请人"
                ><el-input :model-value="auth.user?.username" disabled /></el-form-item
              ><el-form-item label="申请原因" prop="reason" class="span-2"
                ><el-input v-model="form.reason" /></el-form-item
            ></template>
            <template v-else-if="resource === 'orders'"
              ><el-form-item label="来源采购申请"
                ><el-input
                  :model-value="
                    form.applicationId ? lookup('applications', form.applicationId) : '直接采购'
                  "
                  disabled /></el-form-item
              ><el-form-item label="供应商"
                ><el-select
                  v-model="form.vendorId"
                  clearable
                  filterable
                  placeholder="开始采购前必须选择"
                  ><el-option
                    v-for="item in options.vendors"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value" /></el-select></el-form-item
              ><el-form-item label="所属组织" prop="orgId"
                ><el-tree-select
                  v-model="form.orgId"
                  :data="organizationTree"
                  filterable
                  check-strictly
                  node-key="value"
                  :props="{ label: 'label', children: 'children' }"
                  :disabled="!!form.applicationId"
                  @change="organizationChanged" /></el-form-item
              ><el-form-item label="目标仓库" prop="warehouseId"
                ><el-select
                  v-model="form.warehouseId"
                  :disabled="!!form.applicationId || !form.orgId"
                  ><el-option
                    v-for="item in compatibleWarehouses"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value" /></el-select></el-form-item
              ><el-form-item label="接收部门" prop="deptId"
                ><el-select v-model="form.deptId" :disabled="!!form.applicationId || !form.orgId"
                  ><el-option
                    v-for="item in filteredDepartments"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value" /></el-select></el-form-item
              ><el-form-item label="接收人"
                ><el-input :model-value="auth.user?.username" disabled /></el-form-item
              ><el-form-item label="到货方式"
                ><el-select v-model="form.arrivalType"
                  ><el-option
                    v-for="item in dicts.purchase_arrival_type"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select></el-form-item
              ><el-form-item label="计划到货日" prop="planArrivalDate"
                ><el-date-picker
                  v-model="form.planArrivalDate"
                  value-format="YYYY-MM-DD" /></el-form-item
              ><el-form-item label="运输方式"
                ><el-select v-model="form.deliveryType"
                  ><el-option
                    v-for="item in dicts.purchase_delivery_type"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select></el-form-item
              ><el-form-item label="物流单号"><el-input v-model="form.deliveryNo" /></el-form-item
              ><el-form-item label="结算方式"
                ><el-select v-model="form.paymentType"
                  ><el-option
                    v-for="item in dicts.purchase_settlement_type"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select></el-form-item
              ><el-form-item label="计划付款日"
                ><el-date-picker
                  v-model="form.planPayDate"
                  value-format="YYYY-MM-DD" /></el-form-item
            ></template>
            <template v-else-if="resource === 'receipts'">
              <el-form-item v-if="mode === 'create' || mode === 'view'" label="来源方式">
                <el-radio-group v-model="form.directReceipt" @change="receiptSourceChanged"
                  ><el-radio-button :value="false">采购订单入库</el-radio-button
                  ><el-radio-button :value="true">临时采购入库</el-radio-button></el-radio-group
                >
              </el-form-item>
              <el-form-item v-if="!form.directReceipt" label="来源采购订单" prop="orderId"
                ><el-select
                  v-model="form.orderId"
                  filterable
                  :disabled="mode === 'edit' || mode === 'view'"
                  @change="sourceOrderChanged"
                  ><el-option
                    v-for="item in options.orders"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value" /></el-select
              ></el-form-item>
              <el-form-item label="所属组织" :prop="form.directReceipt ? 'orgId' : ''"
                ><el-tree-select
                  v-if="form.directReceipt"
                  v-model="form.orgId"
                  :data="organizationTree"
                  filterable
                  check-strictly
                  node-key="value"
                  :props="{ label: 'label', children: 'children' }"
                  @change="organizationChanged" />
                <el-input v-else :model-value="lookup('organizations', form.orgId)" disabled
              /></el-form-item>
              <el-form-item label="实际入库仓库" prop="warehouseId"
                ><el-select
                  v-model="form.warehouseId"
                  filterable
                  :disabled="!form.orgId || mode === 'view'"
                  placeholder="请选择同类型仓库"
                  ><el-option
                    v-for="item in compatibleWarehouses"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value" /></el-select
              ></el-form-item>
              <el-form-item label="供应商" :prop="form.directReceipt ? 'vendorId' : ''"
                ><el-select v-if="form.directReceipt" v-model="form.vendorId" filterable
                  ><el-option
                    v-for="item in options.vendors"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value" /></el-select
                ><el-input
                  v-else
                  :model-value="
                    form.vendorId ? lookup('vendors', form.vendorId) : vendorOfOrder(form.orderId)
                  "
                  disabled
              /></el-form-item>
              <el-form-item label="接收部门" prop="deptId"
                ><el-select v-model="form.deptId" :disabled="!form.orgId"
                  ><el-option
                    v-for="item in filteredDepartments"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value" /></el-select
              ></el-form-item>
              <el-form-item label="收货经办人"
                ><el-input :model-value="auth.user?.username" disabled /></el-form-item
              ><el-form-item label="入库类型"
                ><el-select v-model="form.inputType"
                  ><el-option
                    v-for="item in dicts.purchase_input_type"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select></el-form-item
              ><el-form-item label="入库日期"
                ><el-input
                  :model-value="
                    mode === 'view'
                      ? dateText(form.inputDate ?? form.createdAt)
                      : dateText(new Date())
                  "
                  disabled
              /></el-form-item>
              <el-alert
                v-if="form.directReceipt"
                class="span-2"
                type="warning"
                :closable="false"
                title="确认临时采购入库时，系统会反向生成已审批采购申请和采购订单。"
              />
            </template>
            <template v-else-if="resource === 'returns'"
              ><el-form-item label="退货来源"
                ><el-input
                  :model-value="form.sourceTypeLabel ?? '已入库退货'"
                  disabled /></el-form-item
              ><el-form-item label="来源单据"
                ><el-input
                  :model-value="
                    form.receiptId
                      ? (byId('receipts', form.receiptId)?.receiptNo ?? `GA${form.receiptId}`)
                      : (orderOf(form.orderId)?.orderNo ?? form.orderNo ?? '—')
                  "
                  disabled /></el-form-item
              ><el-form-item label="采购订单"
                ><el-input
                  :model-value="
                    orderOf(form.orderId)?.orderNo ?? form.orderNo ?? `PO${form.orderId}`
                  "
                  disabled /></el-form-item
              ><el-form-item label="仓库"
                ><el-input
                  :model-value="lookup('warehouses', form.warehouseId)"
                  disabled /></el-form-item
              ><el-form-item label="供应商"
                ><el-input :model-value="lookup('vendors', form.vendorId)" disabled /></el-form-item
              ><el-form-item label="退货类型"
                ><el-select v-model="form.returnType" :disabled="mode === 'view'"
                  ><el-option
                    v-for="item in dicts.purchase_return_type"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select></el-form-item
              ><el-form-item label="退货原因" prop="reason" class="span-2"
                ><el-input v-model="form.reason" :disabled="mode === 'view'" /></el-form-item
              ><el-form-item label="退货日期"
                ><el-date-picker
                  v-model="form.returnDate"
                  value-format="YYYY-MM-DD"
                  :disabled="mode === 'view'" /></el-form-item
              ><el-form-item label="退货人"
                ><el-input :model-value="auth.user?.username" disabled /></el-form-item
            ></template>
            <template v-else-if="resource === 'refunds'">
              <el-form-item label="采购退款单"
                ><el-input :model-value="form.refundNo" disabled
              /></el-form-item>
              <el-form-item label="来源退货单"
                ><el-input :model-value="form.returnNo" disabled
              /></el-form-item>
              <el-form-item label="采购订单"
                ><el-input :model-value="form.orderNo" disabled
              /></el-form-item>
              <el-form-item label="供应商"
                ><el-input :model-value="form.vendorName" disabled
              /></el-form-item>
              <el-form-item label="退款来源"
                ><el-input
                  :model-value="dictLabel('purchase_refund_source', form.sourceType)"
                  disabled
              /></el-form-item>
              <el-form-item label="退货类型"
                ><el-input
                  :model-value="dictLabel('purchase_return_type', form.returnType)"
                  disabled
              /></el-form-item>
              <el-form-item label="退货金额"
                ><el-input :model-value="`¥ ${moneyText(form.returnAmount)}`" disabled
              /></el-form-item>
              <el-form-item label="应退金额"
                ><el-input :model-value="`¥ ${moneyText(form.refundableAmount)}`" disabled
              /></el-form-item>
              <el-form-item label="累计已退"
                ><el-input :model-value="`¥ ${moneyText(form.refundedAmount)}`" disabled
              /></el-form-item>
              <el-form-item label="剩余应退"
                ><el-input :model-value="`¥ ${moneyText(form.remainingAmount)}`" disabled
              /></el-form-item>
              <el-form-item label="退款状态"
                ><el-input
                  :model-value="dictLabel('purchase_refund_status', form.refundStatus)"
                  disabled
              /></el-form-item>
              <el-form-item v-if="mode === 'refund'" label="本次退款金额"
                ><el-input-number
                  v-model="form.refundAmount"
                  :min="0.01"
                  :max="Number(form.remainingAmount ?? 0)"
                  :precision="2"
              /></el-form-item>
              <el-form-item v-if="mode === 'refund'" label="退款日期"
                ><el-date-picker v-model="form.refundDate" value-format="YYYY-MM-DD"
              /></el-form-item>
              <el-form-item v-if="mode === 'refund'" label="退款渠道"
                ><el-select v-model="form.refundChannel"
                  ><el-option
                    v-for="item in dicts.payment_channel"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select
              ></el-form-item>
              <el-form-item v-if="mode === 'refund'" label="供应商流水号"
                ><el-input v-model="form.supplierSerialNo"
              /></el-form-item>
              <el-form-item v-if="mode === 'refund'" label="收款账户" class="span-2"
                ><el-input v-model="form.receiveAccount"
              /></el-form-item>
              <el-form-item v-if="mode === 'refund'" label="本次退款备注" class="span-2"
                ><el-input v-model="form.flowRemark"
              /></el-form-item>
            </template>
            <template v-else
              ><el-form-item label="关联采购订单" prop="orderId"
                ><el-select
                  v-model="form.orderId"
                  filterable
                  :disabled="mode === 'edit' || mode === 'view'"
                  ><el-option
                    v-for="item in options.orders"
                    :key="item.value"
                    :label="`${item.label} · ${lookup('vendors', item.vendorId)}`"
                    :value="item.value" /></el-select></el-form-item
              ><el-form-item label="所属组织" prop="orgId"
                ><el-tree-select
                  v-model="form.orgId"
                  :data="organizationTree"
                  filterable
                  check-strictly
                  node-key="value"
                  :props="{ label: 'label', children: 'children' }" /></el-form-item
              ><el-form-item label="供应商"
                ><el-input :model-value="vendorOfOrder(form.orderId)" disabled /></el-form-item
              ><el-form-item label="本次付款金额" prop="paymentAmount"
                ><el-input-number
                  v-model="form.paymentAmount"
                  :min="0.01"
                  :precision="2"
                  style="width: 100%" /></el-form-item
              ><el-form-item label="付款日期" prop="paymentDate"
                ><el-date-picker
                  v-model="form.paymentDate"
                  value-format="YYYY-MM-DD" /></el-form-item
              ><el-form-item label="付款渠道"
                ><el-select v-model="form.paymentChannel"
                  ><el-option
                    v-for="item in dicts.payment_channel"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select></el-form-item
              ><el-form-item label="付款人"
                ><el-input :model-value="auth.user?.username" disabled /></el-form-item
            ></template>
            <el-form-item v-if="resource !== 'refunds'" label="备注" class="span-all"
              ><el-input v-model="form.remark" type="textarea" :rows="2"
            /></el-form-item>
          </div>
          <template v-if="resource === 'orders'">
            <div class="section-title">
              <strong>金额与付款</strong
              ><span class="muted"
                >订单金额自动汇总；本次付款可为 0，后续仍可从订单操作列分次付款</span
              >
            </div>
            <div class="master-grid purchase-master-grid order-payment-summary">
              <el-form-item label="订单总金额"
                ><el-input :model-value="`¥ ${moneyText(orderTotalAmount)}`" disabled
              /></el-form-item>
              <el-form-item label="退货后应付"
                ><el-input :model-value="`¥ ${moneyText(orderEffectivePayable)}`" disabled
              /></el-form-item>
              <el-form-item label="累计付款"
                ><el-input :model-value="`¥ ${moneyText(form.paidAmount ?? 0)}`" disabled
              /></el-form-item>
              <el-form-item label="累计退款"
                ><el-input :model-value="`¥ ${moneyText(form.refundedAmount ?? 0)}`" disabled
              /></el-form-item>
              <el-form-item label="净已付款"
                ><el-input :model-value="`¥ ${moneyText(orderNetPaidAmount)}`" disabled
              /></el-form-item>
              <el-form-item label="本次付款金额"
                ><el-input-number
                  v-if="mode === 'create'"
                  v-model="form.currentPaymentAmount"
                  :min="0"
                  :max="orderTotalAmount"
                  :precision="2"
                  controls-position="right" /><el-input v-else model-value="—" disabled
              /></el-form-item>
              <el-form-item label="付款后待付"
                ><el-input :model-value="`¥ ${moneyText(orderRemainingAfterPayment)}`" disabled
              /></el-form-item>
              <el-form-item label="付款进度"
                ><el-input
                  :model-value="
                    dictLabel('purchase_payment_progress_status', orderPreviewProgressStatus)
                  "
                  disabled
              /></el-form-item>
              <el-form-item label="本次付款日期"
                ><el-date-picker
                  v-if="mode === 'create'"
                  v-model="form.currentPaymentDate"
                  value-format="YYYY-MM-DD"
                  :disabled="!Number(form.currentPaymentAmount)" /><el-input
                  v-else
                  model-value="—"
                  disabled
              /></el-form-item>
              <el-form-item label="本次付款渠道"
                ><el-select
                  v-if="mode === 'create'"
                  v-model="form.currentPaymentChannel"
                  :disabled="!Number(form.currentPaymentAmount)"
                  ><el-option
                    v-for="item in dicts.payment_channel"
                    :key="item.value"
                    :label="item.label"
                    :value="Number(item.value)" /></el-select
                ><el-input v-else model-value="—" disabled
              /></el-form-item>
              <el-form-item label="付款备注" class="span-2"
                ><el-input
                  v-if="mode === 'create'"
                  v-model="form.currentPaymentRemark"
                  :disabled="!Number(form.currentPaymentAmount)" /><el-input
                  v-else
                  model-value="—"
                  disabled
              /></el-form-item>
            </div>
          </template>
          <PurchaseReceiptDetails
            v-if="resource === 'receipts' && !form.directReceipt"
            :details="form.details ?? []"
            :units="options.units"
            :readonly="mode === 'view'"
          />
          <template v-else-if="resource === 'receipts' && form.directReceipt">
            <div class="section-title">
              <div>
                <strong>临时采购入库明细</strong
                ><span class="muted">共 {{ form.details?.length ?? 0 }} 项</span>
              </div>
            </div>
            <el-table :data="form.details" border class="detail-table direct-receipt-table">
              <el-table-column label="商品名称" min-width="152">
                <template #default="s"
                  ><div v-if="mode !== 'view'" class="quick-catalog-cell">
                    <el-select
                      v-model="s.row.goodsId"
                      filterable
                      remote
                      :remote-method="(keyword: string) => remoteSearchGoods(s.row, keyword)"
                      :loading="s.row.goodsLoading"
                      @change="goodsChanged(s.row)"
                    >
                      <el-option
                        v-if="s.row.newGoods"
                        :label="s.row.newGoods.goodsName"
                        :value="s.row.goodsId"
                      />
                      <el-option
                        v-for="item in searchedGoods(s.row)"
                        :key="item.id"
                        :label="`${item.queryCode || ''} ${item.goodsName}`"
                        :value="item.id"
                      />
                      <template #empty>
                        <div class="goods-select-empty">
                          <span v-if="s.row.goodsSearchFailed">商品搜索失败，请重新输入</span>
                          <span v-else-if="!quickGoodsName(s.row)">请输入商品名称进行搜索</span>
                          <el-button
                            v-else
                            link
                            type="primary"
                            :loading="quickCatalogChecking"
                            @click.stop="requestQuickCatalog(s.row, quickGoodsName(s.row))"
                          >
                            新增“{{ quickGoodsName(s.row) }}”
                          </el-button>
                        </div>
                      </template>
                    </el-select>
                    <el-tag v-if="s.row.newGoods" type="warning" size="small">待创建</el-tag>
                  </div>
                  <span v-else class="readonly-cell">{{ goodsName(s.row.goodsId) }}</span></template
                >
              </el-table-column>
              <el-table-column label="规格" min-width="128">
                <template #default="s"
                  ><el-select
                    v-if="mode !== 'view'"
                    v-model="s.row.skuId"
                    @change="enrichLine(s.row)"
                    ><el-option
                      v-for="item in s.row.skuOptions"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value" /></el-select
                  ><span v-else class="readonly-cell">{{ skuText(s.row) }}</span></template
                >
              </el-table-column>
              <el-table-column label="实收数量" width="104" align="right"
                ><template #default="s"
                  ><el-input-number
                    v-if="mode !== 'view'"
                    v-model="s.row.inputQuantity"
                    :min="1"
                    :precision="0"
                    :step="1"
                    controls-position="right"
                  /><span v-else class="readonly-cell number-cell">{{
                    s.row.inputQuantity
                  }}</span></template
                ></el-table-column
              >
              <el-table-column label="采购单价" width="112" align="right"
                ><template #default="s"
                  ><el-input-number
                    v-if="mode !== 'view'"
                    v-model="s.row.unitPrice"
                    :min="0"
                    :precision="2"
                    controls-position="right"
                  /><span v-else class="readonly-cell number-cell"
                    >¥ {{ moneyText(s.row.unitPrice) }}</span
                  ></template
                ></el-table-column
              >
              <el-table-column label="批号" width="120"
                ><template #default="s"
                  ><el-input
                    v-if="mode !== 'view'"
                    v-model="s.row.batchNo"
                    placeholder="系统自动生成"
                  /><span v-else class="readonly-cell">{{ display(s.row.batchNo) }}</span></template
                ></el-table-column
              >
              <el-table-column label="库位" width="96"
                ><template #default="s"
                  ><el-input v-if="mode !== 'view'" v-model="s.row.position" /><span
                    v-else
                    class="readonly-cell"
                    >{{ display(s.row.position) }}</span
                  ></template
                ></el-table-column
              >
              <el-table-column label="生产日期" width="120"
                ><template #default="s"
                  ><el-date-picker
                    v-if="mode !== 'view'"
                    v-model="s.row.productionDate"
                    value-format="YYYY-MM-DD"
                  /><span v-else class="readonly-cell">{{
                    dateText(s.row.productionDate)
                  }}</span></template
                ></el-table-column
              >
              <el-table-column label="有效期" width="120"
                ><template #default="s"
                  ><el-date-picker
                    v-if="mode !== 'view'"
                    v-model="s.row.validityPeriod"
                    value-format="YYYY-MM-DD"
                  /><span v-else class="readonly-cell">{{
                    dateText(s.row.validityPeriod)
                  }}</span></template
                ></el-table-column
              >
              <el-table-column
                v-if="mode !== 'view'"
                label="操作"
                width="96"
                fixed="right"
                align="center"
                ><template #default="s"
                  ><el-button
                    link
                    type="danger"
                    :disabled="form.details.length === 1"
                    @click="form.details.splice(s.$index, 1)"
                    >删除</el-button
                  ></template
                ></el-table-column
              >
            </el-table>
            <el-button
              v-if="mode !== 'view'"
              class="add-line"
              @click="form.details.push(blankLine())"
              >添加明细行</el-button
            >
          </template>
          <template v-else-if="resource === 'refunds'">
            <div class="section-title">
              <div>
                <strong>退款流水</strong
                ><span class="muted">共 {{ form.flows?.length ?? 0 }} 条</span>
              </div>
            </div>
            <el-table :data="form.flows ?? []" border class="detail-table">
              <el-table-column prop="flowNo" label="流水号" min-width="152" />
              <el-table-column label="本次退款" width="120" align="right"
                ><template #default="s"
                  >¥ {{ moneyText(s.row.refundAmount) }}</template
                ></el-table-column
              >
              <el-table-column label="退款渠道" width="112"
                ><template #default="s">{{
                  dictLabel('payment_channel', s.row.refundChannel)
                }}</template></el-table-column
              >
              <el-table-column label="退款日期" width="112"
                ><template #default="s">{{ dateText(s.row.refundDate) }}</template></el-table-column
              >
              <el-table-column
                prop="supplierSerialNo"
                label="供应商流水号"
                min-width="144"
                show-overflow-tooltip
              />
              <el-table-column
                prop="receiveAccount"
                label="收款账户"
                min-width="144"
                show-overflow-tooltip
              />
              <el-table-column prop="remark" label="备注" min-width="144" show-overflow-tooltip />
              <el-table-column label="操作" width="88" fixed="right"
                ><template #default="s"
                  ><el-button link type="danger" @click="voidRefundFlow(s.row)"
                    >作废</el-button
                  ></template
                ></el-table-column
              >
            </el-table>
          </template>
          <template v-else-if="resource !== 'payments'">
            <div class="section-title">
              <div>
                <strong>{{
                  resource === 'applications'
                    ? '采购明细'
                    : resource === 'returns'
                      ? '退货明细'
                      : '订单明细'
                }}</strong
                ><span class="muted">共 {{ form.details?.length ?? 0 }} 项</span>
              </div>
            </div>
            <el-table :data="form.details" border class="detail-table">
              <el-table-column label="商品编码" width="128"
                ><template #default="s">{{ goodsCode(s.row) }}</template></el-table-column
              >
              <el-table-column label="商品名称" min-width="160"
                ><template #default="s"
                  ><div
                    v-if="
                      mode !== 'view' &&
                      (resource === 'applications' ||
                        (resource === 'orders' && !form.applicationId))
                    "
                    class="quick-catalog-cell"
                  >
                    <el-select
                      v-model="s.row.goodsId"
                      filterable
                      remote
                      :remote-method="(keyword: string) => remoteSearchGoods(s.row, keyword)"
                      :loading="s.row.goodsLoading"
                      @change="goodsChanged(s.row)"
                    >
                      <el-option
                        v-if="s.row.newGoods"
                        :label="s.row.newGoods.goodsName"
                        :value="s.row.goodsId"
                      />
                      <el-option
                        v-for="item in searchedGoods(s.row)"
                        :key="item.id"
                        :label="item.goodsName"
                        :value="item.id"
                      />
                      <template #empty>
                        <div class="goods-select-empty">
                          <span v-if="s.row.goodsSearchFailed">商品搜索失败，请重新输入</span>
                          <span v-else-if="!quickGoodsName(s.row)">请输入商品名称进行搜索</span>
                          <el-button
                            v-else
                            link
                            type="primary"
                            :loading="quickCatalogChecking"
                            @click.stop="requestQuickCatalog(s.row, quickGoodsName(s.row))"
                          >
                            新增“{{ quickGoodsName(s.row) }}”
                          </el-button>
                        </div>
                      </template>
                    </el-select>
                    <el-tag v-if="s.row.newGoods" type="warning" size="small">待创建</el-tag>
                  </div>
                  <span v-else class="readonly-cell">{{ goodsName(s.row.goodsId) }}</span></template
                ></el-table-column
              >
              <el-table-column v-if="resource === 'orders'" label="分类" min-width="112"
                ><template #default="s">{{ goodsCategory(s.row) }}</template></el-table-column
              >
              <el-table-column label="SKU/规格" min-width="136"
                ><template #default="s"
                  ><div
                    v-if="
                      mode !== 'view' &&
                      (resource === 'applications' ||
                        (resource === 'orders' && !form.applicationId))
                    "
                    class="quick-catalog-cell"
                  >
                    <el-select v-model="s.row.skuId">
                      <el-option
                        v-if="s.row.newSku"
                        :label="s.row.newSku.specModels"
                        :value="s.row.skuId"
                      />
                      <el-option
                        v-for="item in s.row.skuOptions"
                        :key="item.value"
                        :label="item.label"
                        :value="item.value"
                      />
                    </el-select>
                    <el-button
                      v-if="!s.row.newGoods && s.row.goodsId"
                      link
                      type="primary"
                      @click="openQuickCatalog(s.row, 'sku')"
                    >
                      补充 SKU
                    </el-button>
                  </div>
                  <span v-else class="readonly-cell">{{ skuText(s.row) }}</span></template
                ></el-table-column
              >
              <el-table-column label="单位" width="72"
                ><template #default="s">{{ unitName(s.row.unitType) }}</template></el-table-column
              >
              <el-table-column
                v-if="resource === 'applications' || resource === 'orders'"
                label="数量"
                width="104"
                align="right"
                ><template #default="s"
                  ><el-input-number
                    v-if="mode !== 'view' && !(resource === 'orders' && !!form.applicationId)"
                    v-model="s.row.quantity"
                    :min="1"
                    :precision="0"
                    :step="1"
                    controls-position="right"
                  /><span v-else class="readonly-cell number-cell">{{
                    s.row.quantity
                  }}</span></template
                ></el-table-column
              >
              <el-table-column
                v-if="resource === 'orders'"
                label="明细总价"
                width="128"
                align="right"
                ><template #default="s"
                  ><el-input-number
                    v-if="mode !== 'view'"
                    v-model="s.row.totalAmount"
                    :min="0.01"
                    :precision="2"
                    controls-position="right"
                  /><span v-else class="readonly-cell number-cell"
                    >¥ {{ moneyText(s.row.totalAmount) }}</span
                  ></template
                ></el-table-column
              >
              <el-table-column
                v-if="resource === 'orders'"
                label="反算单价"
                width="120"
                align="right"
                ><template #default="s"
                  >¥ {{ moneyText(calculatedOrderUnitPrice(s.row)) }}</template
                ></el-table-column
              >
              <el-table-column
                v-if="resource === 'returns'"
                label="来源入库"
                width="96"
                align="right"
                ><template #default="s">{{ s.row.inputQuantity }}</template></el-table-column
              >
              <el-table-column
                v-if="resource === 'returns'"
                label="历史已退"
                width="96"
                align="right"
                ><template #default="s">{{
                  s.row.historicalReturned ?? 0
                }}</template></el-table-column
              >
              <el-table-column
                v-if="resource === 'returns'"
                label="可退数量"
                width="96"
                align="right"
                ><template #default="s">{{
                  Math.max(0, Number(s.row.inputQuantity) - (s.row.historicalReturned ?? 0))
                }}</template></el-table-column
              >
              <el-table-column
                v-if="resource === 'returns'"
                label="本次退货"
                width="112"
                align="right"
                ><template #default="s"
                  ><el-input-number
                    v-if="mode !== 'view'"
                    v-model="s.row.returnQuantity"
                    :min="1"
                    :max="
                      Math.max(0, Number(s.row.inputQuantity) - (s.row.historicalReturned ?? 0))
                    "
                    :precision="0"
                    :step="1"
                    controls-position="right"
                  /><span v-else class="readonly-cell number-cell">{{
                    s.row.returnQuantity
                  }}</span></template
                ></el-table-column
              >
              <el-table-column v-if="resource === 'returns'" label="批号" width="120"
                ><template #default="s">{{ display(s.row.batchNo) }}</template></el-table-column
              >
              <el-table-column v-if="resource === 'returns'" label="单价" width="112" align="right"
                ><template #default="s"
                  >¥ {{ moneyText(s.row.unitPrice ?? 0) }}</template
                ></el-table-column
              >
              <el-table-column v-if="resource === 'returns'" label="金额" width="120" align="right"
                ><template #default="s"
                  >¥
                  {{
                    moneyText(Number(s.row.returnQuantity ?? 0) * Number(s.row.unitPrice ?? 0))
                  }}</template
                ></el-table-column
              >
              <el-table-column
                v-if="
                  mode !== 'view' &&
                  (resource === 'applications' || (resource === 'orders' && !form.applicationId))
                "
                label="操作"
                width="96"
                fixed="right"
                align="center"
                ><template #default="s"
                  ><el-button
                    link
                    type="danger"
                    :disabled="form.details.length === 1"
                    @click="form.details.splice(s.$index, 1)"
                    >删除</el-button
                  ></template
                ></el-table-column
              >
            </el-table>
            <el-button
              v-if="
                mode !== 'view' &&
                (resource === 'applications' || (resource === 'orders' && !form.applicationId))
              "
              class="add-line"
              @click="form.details.push(blankLine())"
              >添加明细行</el-button
            >
            <div v-if="resource === 'orders'" class="form-total">
              合计：{{
                form.details.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0)
              }}
              件　订单金额 ¥
              {{
                moneyText(form.details.reduce((sum: number, item: any) => sum + amount(item), 0))
              }}
            </div>
          </template>
        </div>
      </el-form>
      <DocumentAttachments
        v-if="mode !== 'create' && traceType && (detail?.id || form.id)"
        :document-type="traceType"
        :document-id="detail?.id || form.id"
      />
      <template #footer
        ><el-button @click="dialog = false">{{ mode === 'view' ? '关闭' : '取消' }}</el-button
        ><template v-if="mode !== 'view'"
          ><el-button
            v-if="resource === 'refunds' && mode === 'refund'"
            type="primary"
            :loading="saving"
            @click="confirmRefund"
            >确认本次退款</el-button
          ><el-button
            v-if="resource === 'orders' && mode === 'cancel'"
            type="primary"
            :loading="saving"
            @click="confirmCancel"
            >确认退回</el-button
          ><el-button
            v-if="resource === 'orders' && mode === 'payment'"
            type="primary"
            :loading="saving"
            @click="confirmOrderPayment"
            >确认本次付款</el-button
          ><el-button
            v-if="['applications', 'returns'].includes(resource)"
            :loading="saving"
            @click="save(false)"
            >保存草稿</el-button
          ><el-button
            v-if="resource === 'orders' && !['cancel', 'payment'].includes(mode)"
            type="primary"
            :loading="saving"
            @click="save(false)"
            >保存采购订单</el-button
          ><el-button
            v-if="['applications', 'returns'].includes(resource)"
            type="primary"
            :loading="saving"
            @click="save(true)"
            >提交审批</el-button
          ><el-button
            v-if="resource === 'receipts'"
            type="primary"
            :loading="saving"
            @click="save(true)"
            >执行入库</el-button
          ></template
        ></template
      >
    </el-dialog>
    <el-dialog
      v-model="quickCatalogVisible"
      :title="quickCatalogMode === 'goods' ? '快捷新增商品' : '单据内补充 SKU'"
      width="620"
      :close-on-click-modal="false"
    >
      <el-alert
        title="当前内容仅暂存在单据行中；保存或提交单据成功时才会创建正式商品/SKU档案。"
        type="info"
        :closable="false"
        style="margin-bottom: 14px"
      />
      <el-form label-position="top">
        <div class="master-grid">
          <el-form-item v-if="quickCatalogMode === 'goods'" label="商品名称" required>
            <el-input v-model="quickCatalogForm.goodsName" />
          </el-form-item>
          <el-form-item v-if="quickCatalogMode === 'goods'" label="商品分类" required>
            <el-tree-select
              v-model="quickCatalogForm.categoryId"
              :data="quickCategoryTree"
              :props="quickCategoryTreeProps"
              filterable
              check-strictly
              default-expand-all
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="基础单位" required>
            <el-select v-model="quickCatalogForm.unitType" filterable style="width: 100%">
              <el-option
                v-for="item in options.units"
                :key="item.value"
                :label="item.label"
                :value="Number(item.value)"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="quickCatalogMode === 'sku'" label="SKU规格">
            <el-input v-model="quickCatalogForm.specModels" placeholder="留空则使用“默认规格”" />
          </el-form-item>
          <el-form-item v-if="quickCatalogMode === 'sku'" label="每业务单位基础件数" required>
            <el-input-number
              v-model="quickCatalogForm.pcsQty"
              :min="1"
              :precision="0"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item v-if="quickCatalogMode === 'sku'" label="基础件成本">
            <el-input-number
              v-model="quickCatalogForm.costPrice"
              :min="0"
              :precision="2"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item v-if="quickCatalogMode === 'sku'" label="销售价">
            <el-input-number
              v-model="quickCatalogForm.salePrice"
              :min="0"
              :precision="2"
              style="width: 100%"
            />
          </el-form-item>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="quickCatalogVisible = false">取消</el-button>
        <el-button type="primary" :loading="quickCatalogChecking" @click="stageQuickCatalog"
          >暂存到单据行</el-button
        >
      </template>
    </el-dialog>
    <DocumentTraceDialog
      v-model="traceVisible"
      :document-type="traceType"
      :document-id="traceRow.id || ''"
      :document-no="String(traceNo)"
    />
    <PurchaseOperationHistoryDialog
      v-model="operationHistoryVisible"
      :resource="resource"
      :document-id="traceRow.id || ''"
      :document-no="String(traceNo)"
    />
    <PurchaseApplicationOrderPreviewDialog
      v-model="orderGenerationVisible"
      :application-id="orderGenerationApplicationId"
      :mode="orderGenerationMode"
      @generated="load"
    />
  </section>
</template>

<style scoped>
.purchase-page :deep(.page-head h2) {
  font-size: var(--hs-font-page-title);
  line-height: var(--hs-line-page-title);
}
.purchase-table-wrap {
  overflow-x: auto;
}
.purchase-page :deep(.purchase-list-table) {
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
.purchase-page :deep(.purchase-list-table th.el-table__cell) {
  height: var(--hs-list-header-height);
  padding: 0;
  font-size: var(--hs-font-label);
  font-weight: 600;
  color: #5f6b7c;
  background: #f6f8fb;
}
.purchase-page :deep(.purchase-list-table td.el-table__cell) {
  height: var(--hs-list-row-height);
  padding: 0;
  font-size: var(--hs-font-body);
  color: #344054;
}
.purchase-page :deep(.purchase-list-table .el-table__row--striped td.el-table__cell) {
  background: #fafbfd;
}
.purchase-page :deep(.purchase-list-table .cell) {
  line-height: var(--hs-line-body);
}
.purchase-dialog-content {
  container-name: purchase-dialog;
  container-type: inline-size;
  min-width: 0;
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 40px;
  margin: 16px 0 8px;
  padding: 0 12px;
  border: 1px solid #e4e8ef;
  border-radius: 4px;
  background: #f7f9fc;
  color: #344054;
  font-size: var(--hs-font-section);
  line-height: var(--hs-line-section);
}
.section-title--master {
  margin-top: 0;
}
.section-title > div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title strong {
  font-size: var(--hs-font-section);
  font-weight: 600;
}
.muted {
  color: #8791a5;
  font-size: var(--hs-font-helper);
  font-weight: 400;
}
.master-grid.purchase-master-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px 16px;
}
.master-grid.purchase-master-grid.payment-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.purchase-master-grid :deep(.el-form-item) {
  margin-bottom: 0;
}
.purchase-master-grid :deep(.el-form-item__label) {
  height: auto;
  margin-bottom: 5px;
  padding: 0;
  color: #667085;
  font-size: var(--hs-font-label);
  line-height: var(--hs-line-label);
}
.purchase-master-grid :deep(.el-select),
.purchase-master-grid :deep(.el-date-editor),
.purchase-master-grid :deep(.el-input-number) {
  width: 100%;
}
.purchase-master-grid :deep(.el-input__wrapper),
.purchase-master-grid :deep(.el-select__wrapper),
.purchase-master-grid :deep(.el-input-number .el-input__wrapper) {
  min-height: var(--hs-control-height);
  font-size: var(--hs-font-body);
}
.purchase-master-grid :deep(.el-textarea__inner) {
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
.purchase-master-grid :deep(.is-disabled) {
  opacity: 1;
}
.purchase-master-grid :deep(.is-disabled .el-input__inner),
.purchase-master-grid :deep(.is-disabled .el-select__selected-item) {
  color: #344054;
  -webkit-text-fill-color: #344054;
}
.detail-table {
  width: 100%;
  font-size: var(--hs-font-body);
  line-height: var(--hs-line-body);
}
.detail-table :deep(th.el-table__cell) {
  height: var(--hs-detail-header-height);
  padding: 0;
  background: #f7f9fc;
  color: #667085;
  font-size: var(--hs-font-label);
  font-weight: 600;
}
.detail-table :deep(td.el-table__cell) {
  height: var(--hs-detail-row-height);
  padding: 4px 0;
  color: #344054;
  font-size: var(--hs-font-body);
}
.detail-table :deep(.cell) {
  line-height: var(--hs-line-body);
}
.detail-table :deep(.el-select),
.detail-table :deep(.el-input-number),
.detail-table :deep(.el-date-editor) {
  width: 100%;
  margin: 0;
}
.detail-table :deep(.el-input__wrapper),
.detail-table :deep(.el-select__wrapper),
.detail-table :deep(.el-input-number .el-input__wrapper) {
  min-height: var(--hs-detail-control-height);
  padding-top: 0;
  padding-bottom: 0;
  font-size: var(--hs-font-body);
}
.readonly-cell {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quick-catalog-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
.quick-catalog-cell .el-select {
  width: 100%;
}
.goods-select-empty {
  padding: 8px 12px;
  color: #8791a5;
  font-size: var(--hs-font-helper);
  text-align: center;
}
.number-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.add-line {
  height: var(--hs-control-height);
  margin-top: 10px;
  font-size: var(--hs-font-body);
}
.form-total {
  text-align: right;
  padding: 12px 4px 0;
  color: #172033;
  font-size: var(--hs-font-body);
  font-weight: 600;
}
.actions {
  white-space: normal;
}
:global(.purchase-document-dialog .el-dialog__header) {
  padding: 16px 20px 12px;
  border-bottom: 1px solid #e4e8ef;
}
:global(.purchase-document-dialog) {
  max-width: calc(100vw - 32px);
}
:global(.purchase-document-dialog .el-dialog__title) {
  font-size: var(--hs-font-dialog-title);
  line-height: var(--hs-line-dialog-title);
  font-weight: 600;
  color: #172033;
}
:global(.purchase-document-dialog .el-dialog__body) {
  max-height: calc(92vh - 132px);
  padding: 16px 20px;
  overflow-x: hidden;
  overflow-y: auto;
}
:global(.purchase-document-dialog .el-form-item__label) {
  font-size: var(--hs-font-label) !important;
  line-height: var(--hs-line-label) !important;
}
:global(.purchase-document-dialog .el-input__inner),
:global(.purchase-document-dialog .el-select__selected-item),
:global(.purchase-document-dialog .el-textarea__inner) {
  font-size: var(--hs-font-body) !important;
}
:global(.purchase-document-dialog .el-dialog__footer) {
  padding: 12px 20px 16px;
  border-top: 1px solid #e4e8ef;
}
@container purchase-dialog (max-width:919px) {
  .master-grid.purchase-master-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container purchase-dialog (max-width:519px) {
  .master-grid.purchase-master-grid,
  .master-grid.purchase-master-grid.payment-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .purchase-master-grid :deep(.span-2),
  .purchase-master-grid :deep(.span-all) {
    grid-column: 1/-1;
  }
}
@media (max-width: 760px) {
  :global(.purchase-document-dialog) {
    width: calc(100vw - 24px) !important;
    margin-left: auto;
    margin-right: auto;
  }
}
</style>
