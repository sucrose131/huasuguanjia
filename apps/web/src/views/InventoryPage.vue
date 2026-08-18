<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { FormInstance, FormRules, TableColumnCtx, TableInstance } from 'element-plus';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import DocumentTraceDialog from '@/components/DocumentTraceDialog.vue';
import DocumentAttachments from '@/components/DocumentAttachments.vue';
import BusinessStatusTag from '@/components/business/BusinessStatusTag.vue';
import TableRowActions from '@/components/business/TableRowActions.vue';
import InventoryCheckTable from '@/components/inventory/InventoryCheckTable.vue';
import { dateText, display, moneyText } from '@/utils/format';
import { inventoryDocumentType } from '@/utils/document-type';
import { canPageAction } from '@/utils/permission';

type Row = Record<string, any>;
type Option = {
  value: string | number;
  label: string;
  raw?: Row;
  count?: number;
  orgId?: string | number;
  warehouseType?: string | number;
};
type OrganizationTreeNode = Option & { children?: OrganizationTreeNode[] };
type Mode = 'create' | 'edit' | 'view';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const canEditAmount = computed(() => auth.amountAccess.canEditAmount);
const resource = computed(() => String(route.params.resource));
const canAction = (action: string) => canPageAction(auth.user, route.path, action);
const meta: Record<
  string,
  { title: string; subtitle: string; endpoint: string; createText?: string }
> = {
  stocks: {
    title: '库存查询',
    subtitle: '按仓库查看即时库存、库存金额及可追溯流水',
    endpoint: 'stocks',
  },
  transfers: {
    title: '库存调拨单',
    subtitle: '同类型仓库之间的双边库存调拨与审批',
    endpoint: 'transfers',
    createText: '新增库存调拨单',
  },
  adjustments: {
    title: '库存调整记录',
    subtitle: '通过审批流程修正账面库存并保留调整依据',
    endpoint: 'adjustments',
    createText: '新增库存调整',
  },
  losses: {
    title: '报损出库单',
    subtitle: '支持盘点损坏生成和日常独立报损，按处置方式完成库存闭环',
    endpoint: 'losses',
    createText: '新增报损出库单',
  },
  'loss-outputs': {
    title: '报亏出库单',
    subtitle: '仅由库存盘点的数量盘亏生成，整单审核通过后一次性扣减来源批次库存',
    endpoint: 'loss-outputs',
  },
  overflows: {
    title: '报盈入库单',
    subtitle: '仅由库存盘点的数量盘盈生成，审批后直接增加来源批次库存',
    endpoint: 'overflows',
  },
  'overflow-inputs': {
    title: '报盈入库单',
    subtitle: '查看由报盈单审批生成并完成过账的独立入库记录',
    endpoint: 'overflow-inputs',
  },
  checks: {
    title: '库存盘点',
    subtitle: '数量差异与损坏独立核算，同一批次可同时进入两条处理链',
    endpoint: 'checks',
    createText: '新增盘点单',
  },
  'quantity-alerts': {
    title: '库存预警',
    subtitle: '按仓库监控安全库存、缺口及建议补货数量',
    endpoint: 'quantity-alerts',
  },
  'expiry-alerts': {
    title: '效期预警',
    subtitle: '依据效期预警配置识别临期和过期批次',
    endpoint: 'expiry-alerts',
  },
};
const current = computed(() => meta[resource.value] ?? meta.stocks!);
const isReadOnly = computed(() =>
  ['stocks', 'overflow-inputs', 'quantity-alerts', 'expiry-alerts'].includes(resource.value),
);
const isDocument = computed(() =>
  ['losses', 'loss-outputs', 'overflows', 'overflow-inputs'].includes(resource.value),
);
const usesWarehouseTabs = computed(() =>
  ['stocks', 'checks', 'quantity-alerts', 'expiry-alerts'].includes(resource.value),
);
const stockScopeReady = computed(() => resource.value !== 'stocks' || Boolean(query.orgId));
const stockView = ref<'inventory' | 'requisition'>('inventory');

const rows = ref<Row[]>([]);
const total = ref(0);
const loading = ref(false);
const saving = ref(false);
const dialog = ref(false);
const ledgerDialog = ref(false);
const quantityAlertDialog = ref(false);
const historyDialog = ref(false);
const traceVisible = ref(false);
const traceRow = ref<Row>({});
const viewingOverflowInput = ref(false);
const mode = ref<Mode>('create');
const stockAdjustment = ref(false);
const formRef = ref<FormInstance>();
const form = reactive<Row>({});
const attachmentType = computed(() => inventoryDocumentType(resource.value, form));
const generatedDamageLocked = computed(
  () =>
    resource.value === 'losses' &&
    Number(form.businessKind) === 2 &&
    Number(form.sourceCheckId ?? 0) > 0,
);
const ledger = ref<Row[]>([]);
const recentLedger = ref<Row[]>([]);
const ledgerContext = reactive({ title: '', subtitle: '' });
const quantityAlertForm = reactive<Row>({});
const warehouseCounts = ref<Record<string, number>>({});
const query = reactive({
  page: 1,
  pageSize: 20,
  keyword: '',
  orgId: '',
  warehouseId: '',
  batchNo: '',
  inStockOnly: true,
  departmentId: '',
  receiverId: '',
  holdingStatus: 'all',
  dateRange: [] as string[],
});
const summary = reactive({
  itemCount: 0,
  totalAmount: 0,
  warningCount: 0,
  issuedQty: 0,
  returnedQty: 0,
  holdingQty: 0,
  holdingLines: 0,
});
const options = reactive<Record<string, Option[] | Row[]>>({
  organizations: [],
  warehouses: [],
  departments: [],
  users: [],
  stocks: [],
  lossSources: [],
  warehouseTabs: [],
});
const organizationTree = computed<OrganizationTreeNode[]>(() => {
  const nodes = new Map<string, OrganizationTreeNode>();
  for (const option of options.organizations as Option[])
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
const dicts = reactive<Record<string, Option[]>>({});
const dictCodes = [
  'inventory_adjust_type',
  'inventory_check_type',
  'inventory_check_result',
  'inventory_damage_status',
  'inventory_check_status',
  'inventory_loss_type',
  'inventory_loss_disposal',
  'inventory_loss_output_type',
  'inventory_overflow_type',
  'approval_status',
  'record_status',
  'inventory_overflow_status',
  'inventory_stock_health_status',
  'expiry_alert_type',
];
const rules: FormRules = {
  orgId: [{ required: true, message: '请选择组织', trigger: 'change' }],
  warehouseId: [{ required: true, message: '请选择仓库', trigger: 'change' }],
  toOrgId: [{ required: true, message: '请选择调入组织', trigger: 'change' }],
  toWarehouseId: [{ required: true, message: '请选择调入仓库', trigger: 'change' }],
  sendBy: [{ required: true, message: '请选择发出人', trigger: 'change' }],
  receiveBy: [{ required: true, message: '请选择接收人', trigger: 'change' }],
  reason: [{ required: true, message: '请输入原因', trigger: 'blur' }],
  sourceLossId: [{ required: true, message: '请选择已审批来源报亏单', trigger: 'change' }],
};

const quantity = (value: unknown) =>
  Number(value ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 });
const isExplicitDisposal = (value: unknown) => ['0', '1', '2'].includes(String(value ?? '').trim());
const lookup = (name: string, value: unknown) =>
  (options[name] as Option[])?.find((item) => String(item.value) === String(value))?.label ?? '—';
const dictLabel = (code: string, value: unknown) =>
  dicts[code]?.find((item) => String(item.value) === String(value))?.label ?? display(value);
const statusText = (row: Row) =>
  Number(row.approveStatus) === 1
    ? dictLabel('approval_status', 1)
    : Number(row.approveStatus) === 2
      ? dictLabel('approval_status', 2)
      : Number(row.status) === 0
        ? dictLabel('inventory_check_status', 0)
        : dictLabel('approval_status', 0);
const statusType = (row: Row) =>
  Number(row.approveStatus) === 1
    ? 'success'
    : Number(row.approveStatus) === 2
      ? 'danger'
      : Number(row.status) === 0
        ? 'info'
        : 'warning';
const sourceStatus = (row: Row) =>
  ['overflows', 'overflow-inputs'].includes(resource.value)
    ? dictLabel(
        'inventory_overflow_status',
        Number(row.inputStatus) === 1 ? 1 : Number(row.approveStatus) === 2 ? 2 : 0,
      )
    : statusText(row);
const filteredWarehouses = computed(() =>
  !form.orgId
    ? (options.warehouses as Option[])
    : (options.warehouses as Option[]).filter(
        (item) => String(item.raw?.orgId ?? item.orgId) === String(form.orgId),
      ),
);
const stockDepartments = computed(() =>
  (options.departments as Option[]).filter(
    (item) => !query.orgId || String(item.raw?.orgId ?? '') === String(query.orgId),
  ),
);
const stockReceivers = computed(() => options.users as Option[]);
const filteredToWarehouses = computed(() => {
  const requiredTypes = new Set(
    (form.details ?? [])
      .map((line: Row) => Number(line.categoryWarehouseType))
      .filter((value: number) => Number.isFinite(value) && value > 0),
  );
  const source = (options.warehouses as Option[]).find(
    (item) => String(item.value) === String(form.warehouseId),
  );
  const sourceType = Number(source?.raw?.warehouseType ?? source?.warehouseType ?? 0);
  if (resource.value === 'transfers' && sourceType > 0) requiredTypes.add(sourceType);
  return (options.warehouses as Option[]).filter((item) => {
    const isCurrentViewValue =
      mode.value === 'view' && String(item.value) === String(form.toWarehouseId);
    const belongsToOrg =
      !form.toOrgId || String(item.raw?.orgId ?? item.orgId) === String(form.toOrgId);
    const differentWarehouse = String(item.value) !== String(form.warehouseId);
    const matchesType =
      !requiredTypes.size ||
      requiredTypes.has(Number(item.raw?.warehouseType ?? item.warehouseType));
    return belongsToOrg && (isCurrentViewValue || (differentWarehouse && matchesType));
  });
});
const warehouseTabCount = (item: Option) =>
  ['quantity-alerts', 'expiry-alerts'].includes(resource.value)
    ? Number(warehouseCounts.value[String(item.value)] ?? 0)
    : Number(item.count ?? 0);
const dialogTitle = computed(() =>
  stockAdjustment.value
    ? '账面调整'
    : viewingOverflowInput.value
      ? '查看报盈入库单'
      : `${mode.value === 'view' ? '查看' : mode.value === 'edit' ? '编辑' : '新增'}${current.value.title}`,
);
const checkListSummary = computed(() => ({
  total: total.value,
  active: rows.value.filter((row) => Number(row.status) === 0 && Number(row.approveStatus) === 0)
    .length,
  pending: rows.value.filter((row) => Number(row.status) === 1 && Number(row.approveStatus) === 0)
    .length,
  abnormal: rows.value.filter(
    (row) => Number(row.lessQty) > 0 || Number(row.overflowQty) > 0 || Number(row.damagedQty) > 0,
  ).length,
}));
const checkDetailSummary = computed(() => {
  const details = Array.isArray(form.details) ? form.details : [];
  const goodsKeys = new Set(
    details.map((line: Row) => `${line.goodsId ?? ''}:${line.skuId ?? ''}`),
  );
  return {
    goods: goodsKeys.size,
    batches: details.length,
    inventoryQty: details.reduce(
      (sum: number, line: Row) => sum + Number(line.inventoryQty ?? 0),
      0,
    ),
    checkQty: details.reduce((sum: number, line: Row) => sum + Number(line.checkQty ?? 0), 0),
    shortageQty: details.reduce(
      (sum: number, line: Row) => sum + Math.abs(Math.min(Number(line.differentQty ?? 0), 0)),
      0,
    ),
    overflowQty: details.reduce(
      (sum: number, line: Row) => sum + Math.max(Number(line.differentQty ?? 0), 0),
      0,
    ),
    damagedQty: details.reduce((sum: number, line: Row) => sum + Number(line.damagedQty ?? 0), 0),
  };
});
const checkProductGroups = computed<Row[]>(() => {
  const groups = new Map<string, Row>();
  for (const line of Array.isArray(form.details) ? form.details : []) {
    const key = `${line.goodsId ?? ''}:${line.skuId ?? ''}`;
    if (!groups.has(key))
      groups.set(key, {
        key,
        goodsId: line.goodsId,
        skuId: line.skuId,
        goodsCode: line.goodsCode,
        goodsName: line.goodsName,
        skuSpec: line.skuSpec,
        unitName: line.unitName,
        batches: [],
      });
    groups.get(key)!.batches.push(line);
  }
  return [...groups.values()]
    .map((group: Row): Row => ({
      ...group,
      batches: [...group.batches].sort((left: Row, right: Row) =>
        String(left.batchNo ?? '').localeCompare(String(right.batchNo ?? ''), 'zh-CN', {
          numeric: true,
        }),
      ),
    }))
    .sort((left: Row, right: Row) =>
      `${left.goodsCode ?? ''}${left.goodsName ?? ''}${left.skuSpec ?? ''}`.localeCompare(
        `${right.goodsCode ?? ''}${right.goodsName ?? ''}${right.skuSpec ?? ''}`,
        'zh-CN',
        { numeric: true },
      ),
    );
});
const checkProductTableRef = ref<TableInstance>();
const selectedCheckProduct = ref<Row>();
const selectedCheckBatches = computed<Row[]>(() => selectedCheckProduct.value?.batches ?? []);
function selectCheckProduct(row?: Row) {
  selectedCheckProduct.value = row;
}
const checkQuantityStatus = (line: Row) =>
  Number(line.differentQty) < 0
    ? { text: dictLabel('inventory_check_result', 1), semantic: 'danger' as const }
    : Number(line.differentQty) > 0
      ? { text: dictLabel('inventory_check_result', 2), semantic: 'success' as const }
      : { text: dictLabel('inventory_check_result', 3), semantic: 'neutral' as const };
const checkDamageStatus = (line: Row) =>
  Number(line.damagedQty) > 0
    ? { text: dictLabel('inventory_damage_status', 1), semantic: 'warning' as const }
    : { text: dictLabel('inventory_damage_status', 0), semantic: 'neutral' as const };

const checkBatchRowKey = (line: Row) =>
  `${line.id ?? 'new'}:${line.goodsId ?? ''}:${line.skuId ?? ''}:${line.batchNo ?? ''}`;
const checkBatchRowClassName = ({ row }: { row: Row }) => {
  const classes: string[] = [];
  if (Number(row.damagedQty) > 0) classes.push('check-row-damaged');
  else if (Number(row.differentQty) < 0) classes.push('check-row-shortage');
  else if (Number(row.differentQty) > 0) classes.push('check-row-overflow');
  return classes.join(' ');
};
function getCheckSummaries({ columns, data }: { columns: TableColumnCtx<Row>[]; data: Row[] }) {
  const totals: Record<string, number> = {
    inventoryQty: data.reduce((sum, line) => sum + Number(line.inventoryQty ?? 0), 0),
    checkQty: data.reduce((sum, line) => sum + Number(line.checkQty ?? 0), 0),
    differentQty: data.reduce((sum, line) => sum + Number(line.differentQty ?? 0), 0),
    damagedQty: data.reduce((sum, line) => sum + Number(line.damagedQty ?? 0), 0),
    differentAmount: data.reduce((sum, line) => sum + Number(line.differentAmount ?? 0), 0),
  };
  return columns.map((column, index) => {
    if (index === 0) return '合计';
    if (!(column.property in totals)) return '';
    return column.property === 'differentAmount'
      ? `¥ ${moneyText(totals[column.property])}`
      : quantity(totals[column.property]);
  });
}

function params() {
  const result: Row = { page: query.page, pageSize: query.pageSize };
  for (const key of ['keyword', 'orgId', 'warehouseId', 'batchNo'])
    if ((query as Row)[key] !== '') result[key] = (query as Row)[key];
  if (resource.value === 'stocks' && stockView.value === 'inventory')
    result.inStockOnly = query.inStockOnly;
  if (resource.value === 'stocks' && stockView.value === 'requisition') {
    if (query.departmentId) result.departmentId = query.departmentId;
    if (query.receiverId) result.receiverId = query.receiverId;
    if (query.holdingStatus) result.holdingStatus = query.holdingStatus;
    if (query.dateRange?.[0]) result.startDate = query.dateRange[0];
    if (query.dateRange?.[1]) result.endDate = query.dateRange[1];
    delete result.warehouseId;
  }
  return result;
}

async function load() {
  if (!stockScopeReady.value) {
    rows.value = [];
    total.value = 0;
    recentLedger.value = [];
    Object.assign(summary, { itemCount: 0, totalAmount: 0, warningCount: 0 });
    return;
  }
  loading.value = true;
  try {
    const endpoint =
      resource.value === 'stocks' && stockView.value === 'requisition'
        ? 'requisition-history'
        : current.value.endpoint;
    const result = (await api.get(`/inventory/${endpoint}`, {
      params: params(),
    })) as Row;
    rows.value = result.items ?? [];
    total.value = Number(result.total ?? rows.value.length);
    Object.assign(summary, result.summary ?? {});
    if (['quantity-alerts', 'expiry-alerts'].includes(resource.value) && !query.warehouseId)
      warehouseCounts.value = result.warehouseCounts ?? {};
    if (resource.value === 'stocks' && stockView.value === 'inventory') {
      const recent = (await api.get('/inventory/ledger', {
        params: {
          page: 1,
          pageSize: 8,
          orgId: query.orgId,
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        },
      })) as Row;
      recentLedger.value = recent.items ?? [];
    }
  } finally {
    loading.value = false;
  }
}

async function loadOptions() {
  const [organizations, departments, warehouses, users, tabs, lossSources, ...dictionaries] =
    (await Promise.all([
      api.get('/base-data/organizations/options'),
      api.get('/base-data/departments/options'),
      api.get('/base-data/warehouses/options'),
      api.get('/base-data/employees/options'),
      resource.value === 'stocks' ? Promise.resolve([]) : api.get('/inventory/warehouses/tabs'),
      api.get('/inventory/losses/approved-options'),
      ...dictCodes.map((code) => api.get(`/dictionaries/${code}`).catch(() => [])),
    ])) as any[];
  options.organizations = organizations;
  options.departments = departments;
  options.warehouses = warehouses;
  options.users = users;
  options.warehouseTabs = tabs;
  options.lossSources = lossSources;
  dictCodes.forEach((code, index) => {
    dicts[code] = dictionaries[index] ?? [];
  });
  if (resource.value === 'stocks') options.warehouseTabs = [];
}

async function loadWarehouseTabs(orgId: unknown) {
  options.warehouseTabs = orgId
    ? ((await api.get('/inventory/warehouses/tabs', { params: { orgId } })) as Option[])
    : [];
}
async function organizationChanged(value: unknown) {
  query.orgId = String(value ?? '');
  query.warehouseId = '';
  query.page = 1;
  query.departmentId = '';
  query.receiverId = '';
  rows.value = [];
  total.value = 0;
  recentLedger.value = [];
  Object.assign(summary, { itemCount: 0, totalAmount: 0, warningCount: 0 });
  if (resource.value === 'stocks') await loadWarehouseTabs(query.orgId);
  if (resource.value === 'stocks')
    options.users = query.orgId
      ? ((await api.get('/base-data/employees/options', {
          params: { orgId: query.orgId },
        })) as Option[])
      : [];
  await load();
}
async function changeStockView(value: 'inventory' | 'requisition') {
  stockView.value = value;
  query.page = 1;
  query.warehouseId = '';
  rows.value = [];
  total.value = 0;
  await load();
}
function resetQuery() {
  Object.assign(query, {
    page: 1,
    keyword: '',
    orgId: '',
    warehouseId: '',
    batchNo: '',
    inStockOnly: true,
    departmentId: '',
    receiverId: '',
    holdingStatus: 'all',
    dateRange: [],
  });
  if (resource.value === 'stocks') options.warehouseTabs = [];
  load();
}
function selectWarehouse(value: unknown) {
  query.warehouseId = String(value ?? '');
  query.page = 1;
  load();
}
function blankLine() {
  return {
    stockKey: '',
    goodsId: '',
    goodsCode: '',
    goodsName: '',
    skuId: '',
    skuSpec: '',
    warehouseId: form.warehouseId || '',
    warehouseName: '',
    batchNo: '',
    unitType: 0,
    unitName: '',
    beforeQty: 0,
    inventoryQty: 0,
    adjustType: 1,
    quantity: 1,
    unitPrice: 0,
    amount: 0,
    remark: '',
    sourceReceiptDetailId: '',
    purchaseSourceOptions: [],
  };
}
function resetForm() {
  Object.keys(form).forEach((key) => delete form[key]);
  selectedCheckProduct.value = undefined;
  Object.assign(form, {
    orgId: auth.user?.orgId ?? '',
    warehouseId: '',
    toOrgId: auth.user?.orgId ?? '',
    toWarehouseId: '',
    sendBy: '',
    receiveBy: '',
    transferDate: dateText(new Date()),
    applicantDate: dateText(new Date()),
    date: dateText(new Date()),
    checkDate: dateText(new Date()),
    checkType: dicts.inventory_check_type?.[0]?.value ?? '',
    businessKind: 2,
    documentType: '',
    goWhere: '',
    sourceLossId: '',
    reason: '',
    remark: '',
    operatorName: auth.user?.username,
    details: [],
  });
}
async function loadStocks(warehouseId?: unknown, orgId?: unknown) {
  options.stocks = (await api.get('/inventory/stock-options', {
    params: { warehouseId, orgId },
  })) as Row[];
}
function stockKey(stock: Row) {
  return `${stock.goodsId}-${stock.skuId}-${stock.warehouseId}-${stock.batchNo}`;
}
function stockLabel(stock: Row) {
  return `${stock.goodsCode || ''} ${stock.goodsName} · ${stock.skuSpec || '默认规格'} · ${stock.batchNo || '无批号'}（库存 ${quantity(stock.inventoryQty)}）`;
}
function stockIdentity(line: Row) {
  return `${line.goodsCode || '—'} ${line.goodsName || '—'} · ${line.skuSpec || '默认规格'} · ${line.batchNo || '无批号'}`;
}
function selectStock(line: Row, key: string) {
  const stock = (options.stocks as Row[]).find((item) => stockKey(item) === key);
  if (!stock) return;
  Object.assign(line, {
    stockKey: key,
    goodsId: stock.goodsId,
    goodsCode: stock.goodsCode,
    goodsName: stock.goodsName,
    categoryWarehouseType: stock.categoryWarehouseType,
    skuId: stock.skuId,
    skuSpec: stock.skuSpec,
    warehouseId: stock.warehouseId,
    warehouseName: stock.warehouseName,
    batchNo: stock.batchNo,
    unitType: stock.unitType,
    unitName: stock.unitName,
    beforeQty: Number(stock.inventoryQty),
    inventoryQty: Number(stock.inventoryQty),
    unitPrice: Number(stock.unitPrice ?? 0),
  });
  recalcLine(line);
  if (resource.value === 'losses' && Number(form.goWhere) === 2) {
    void loadLossPurchaseSources(line);
  }
}

async function loadLossPurchaseSources(line: Row) {
  line.purchaseSourceOptions = [];
  if (
    resource.value !== 'losses' ||
    Number(form.goWhere) !== 2 ||
    !form.orgId ||
    !form.warehouseId ||
    !line.goodsId ||
    !line.skuId
  )
    return;
  const result = (await api.get('/inventory/losses/purchase-source-options', {
    params: {
      orgId: form.orgId,
      warehouseId: form.warehouseId,
      goodsId: line.goodsId,
      skuId: line.skuId,
      batchNo: line.batchNo ?? '',
    },
  })) as Option[];
  line.purchaseSourceOptions = result;
  if (!result.some((option) => String(option.value) === String(line.sourceReceiptDetailId))) {
    line.sourceReceiptDetailId = result.length === 1 ? result[0]?.value : '';
  }
}

async function lossDisposalChanged(value: unknown) {
  if (Number(value) !== 2) {
    for (const line of form.details ?? []) {
      line.sourceReceiptDetailId = '';
      line.purchaseSourceOptions = [];
    }
    return;
  }
  await Promise.all((form.details ?? []).map((line: Row) => loadLossPurchaseSources(line)));
}
function recalcLine(line: Row) {
  line.afterQty =
    Number(line.beforeQty ?? 0) +
    (Number(line.adjustType) === 1 ? Number(line.quantity ?? 0) : -Number(line.quantity ?? 0));
  line.amount = Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0);
  line.differentQty = Number(line.checkQty ?? 0) - Number(line.inventoryQty ?? 0);
  line.differentAmount = Number(line.differentQty ?? 0) * Number(line.unitPrice ?? 0);
  const resultNames = [
    Number(line.differentQty) < 0
      ? dictLabel('inventory_check_result', 1)
      : Number(line.differentQty) > 0
        ? dictLabel('inventory_check_result', 2)
        : '',
    Number(line.damagedQty) > 0 ? dictLabel('inventory_damage_status', 1) : '',
  ].filter(Boolean);
  line.resultName = resultNames.join(' + ') || dictLabel('inventory_check_result', 3);
}
function warehouseChanged() {
  form.details = [blankLine()];
  loadStocks(form.warehouseId, form.orgId);
}

async function openCreate() {
  resetForm();
  mode.value = 'create';
  stockAdjustment.value = false;
  viewingOverflowInput.value = false;
  if (!['checks', 'loss-outputs'].includes(resource.value)) {
    form.details = [blankLine()];
  }
  dialog.value = true;
  await nextTick();
  formRef.value?.clearValidate();
}
async function openRow(row: Row, view = false) {
  mode.value = view ? 'view' : 'edit';
  stockAdjustment.value = false;
  viewingOverflowInput.value = resource.value === 'overflow-inputs';
  const data = (await api.get(`/inventory/${current.value.endpoint}/${row.id}`)) as Row;
  resetForm();
  Object.assign(form, data);
  if (resource.value === 'checks') {
    const checkTypeOption = dicts.inventory_check_type?.find(
      (item) => String(item.value) === String(form.checkType),
    );
    if (checkTypeOption) form.checkType = checkTypeOption.value;
  }
  form.goWhere = form.goWhere == null || form.goWhere === '' ? '' : String(form.goWhere);
  if (
    resource.value === 'loss-outputs' &&
    form.sourceLossId &&
    !(options.lossSources as Option[]).some(
      (item) => String(item.value) === String(form.sourceLossId),
    )
  )
    (options.lossSources as Option[]).push({
      value: form.sourceLossId,
      label: form.sourceLossNo || `报亏单 ${form.sourceLossId}`,
    });
  if (Array.isArray(form.details))
    form.details.forEach((line: Row) => {
      line.stockKey = `${line.goodsId}-${line.skuId}-${line.warehouseId ?? form.warehouseId}-${line.batchNo ?? ''}`;
      recalcLine(line);
    });
  await loadStocks(form.warehouseId, form.orgId);
  if (resource.value === 'losses' && Number(form.goWhere) === 2) {
    await Promise.all((form.details ?? []).map((line: Row) => loadLossPurchaseSources(line)));
  }
  dialog.value = true;
}
async function createCheck() {
  if (!form.orgId || !form.warehouseId || !form.checkType) {
    ElMessage.warning('请选择盘点类型、组织和仓库');
    return;
  }
  saving.value = true;
  try {
    const created = (await api.post('/inventory/checks', form)) as Row;
    const data = (await api.get(`/inventory/checks/${created.id}`)) as Row;
    Object.assign(form, data);
    form.details.forEach(recalcLine);
    mode.value = 'edit';
    ElMessage.success('库存已载入，请录入实盘数量');
  } finally {
    saving.value = false;
  }
}
function validateLines(submit = true) {
  if (resource.value === 'loss-outputs') return !!form.sourceLossId && !!form.details?.length;
  if (
    resource.value === 'losses' &&
    Number(form.businessKind) === 2 &&
    submit &&
    !isExplicitDisposal(form.goWhere)
  ) {
    ElMessage.warning('报损出库单提交前必须选择直接报废、折价出售或退货');
    return false;
  }
  if (!form.details?.length) {
    ElMessage.warning('至少需要一条明细');
    return false;
  }
  for (const line of form.details) {
    if (!line.goodsId || !line.skuId || !(line.warehouseId ?? form.warehouseId)) {
      ElMessage.warning('请选择有效库存商品');
      return false;
    }
    if (Number(line.quantity) <= 0) {
      ElMessage.warning('明细数量必须大于 0');
      return false;
    }
    if (resource.value === 'losses' && Number(form.goWhere) === 2 && !line.sourceReceiptDetailId) {
      ElMessage.warning(`${line.goodsName || '商品'}未选择原采购入库来源`);
      return false;
    }
    if (resource.value === 'adjustments' && Number(line.afterQty) < 0) {
      ElMessage.warning('调整后库存不能小于 0');
      return false;
    }
    if (
      !generatedDamageLocked.value &&
      ['transfers', 'losses'].includes(resource.value) &&
      Number(line.quantity) > Number(line.inventoryQty ?? line.beforeQty)
    ) {
      ElMessage.warning(`${line.goodsName || '商品'} 数量超过当前库存`);
      return false;
    }
  }
  return true;
}
async function save(submit = true) {
  if (!(await formRef.value?.validate().catch(() => false)) || !validateLines(submit)) return;
  saving.value = true;
  try {
    const endpoint = stockAdjustment.value ? 'adjustments' : current.value.endpoint;
    const payload = { ...form, submit: resource.value === 'loss-outputs' ? false : submit };
    const url = `/inventory/${endpoint}${mode.value === 'edit' && !stockAdjustment.value ? `/${form.id}` : ''}`;
    const result =
      mode.value === 'edit' && !stockAdjustment.value
        ? ((await api.patch(url, payload)) as Row)
        : ((await api.post(url, payload)) as Row);
    ElMessage.success(
      resource.value === 'loss-outputs'
        ? '报亏出库单已生成'
        : submit
          ? '已保存并提交审核'
          : '草稿已保存',
    );
    dialog.value = false;
    await Promise.all([load(), loadOptions()]);
    return result;
  } finally {
    saving.value = false;
  }
}
async function saveCheck(submit: boolean) {
  form.details.forEach(recalcLine);
  const invalid = form.details.find(
    (line: Row) =>
      Number(line.checkQty) < 0 ||
      Number(line.damagedQty) < 0 ||
      Number(line.damagedQty) > Number(line.checkQty),
  );
  if (invalid) {
    ElMessage.warning(`${invalid.goodsName || '商品'}损坏数量不能超过实盘总数`);
    return;
  }
  saving.value = true;
  try {
    await api.patch(`/inventory/checks/${form.id}`, { details: form.details, submit });
    ElMessage.success(submit ? '盘点已完成并提交审批' : '盘点数据已保存');
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}
async function submit(row: Row) {
  if (
    resource.value === 'losses' &&
    Number(row.businessKind) === 2 &&
    !isExplicitDisposal(row.goWhere)
  ) {
    ElMessage.warning('报损出库单提交前必须选择直接报废、折价出售或退货');
    return;
  }
  await ElMessageBox.confirm('提交后进入审批流程，是否继续？', '提交审批');
  await api.post(`/inventory/${current.value.endpoint}/${row.id}/submit`);
  ElMessage.success('已提交审批');
  load();
}
async function approve(row: Row, approved: boolean) {
  let comment = '';
  if (approved) {
    if (
      resource.value === 'losses' &&
      Number(row.businessKind) === 2 &&
      !isExplicitDisposal(row.goWhere)
    ) {
      ElMessage.warning('报损出库单必须先明确选择直接报废、折价出售或退货');
      return;
    }
    const message =
      resource.value === 'checks'
        ? '审批通过只会按差异类型生成后续单据：每个损坏批次生成一张独立报损出库单，盘亏生成报亏出库单，盘盈生成报盈入库单；本步骤不会直接改变库存，是否继续？'
        : resource.value === 'loss-outputs'
          ? '审核通过将按照本单全部商品批次及盘亏数量一次性扣减库存，不支持分批出库，是否继续？'
          : resource.value === 'overflows'
            ? '审批通过将直接完成报盈入库并增加对应批次库存，是否继续？'
            : resource.value === 'losses' && Number(row.businessKind) === 1
              ? '审批通过将自动生成报亏出库单并扣减库存，是否继续？'
              : resource.value === 'losses' && Number(row.goWhere) === 1
                ? '审批通过将生成折价销售单，本次不会扣减库存，是否继续？'
                : resource.value === 'losses' && Number(row.goWhere) === 2
                  ? '审批通过将按原采购入库来源生成采购退货草稿，本次不会扣减库存，是否继续？'
                  : '审批通过将按直接报废去向扣减库存，是否继续？';
    await ElMessageBox.confirm(message, '确认审批', { type: 'warning' });
  } else {
    const result = await ElMessageBox.prompt('请输入驳回原因', '驳回审批', {
      inputValidator: (value) => !!String(value).trim() || '驳回原因不能为空',
    });
    comment = result.value;
  }
  const result = (await api.post(`/inventory/${current.value.endpoint}/${row.id}/approve`, {
    approved,
    comment,
  })) as Row;
  ElMessage.success(result.message ?? (approved ? '审批已通过' : '单据已驳回'));
  await load();
}
async function removeRow(row: Row) {
  await ElMessageBox.confirm('确认删除该未过账单据？', '删除确认', { type: 'warning' });
  await api.delete(`/inventory/${current.value.endpoint}/${row.id}`);
  ElMessage.success('删除成功');
  await Promise.all([load(), loadOptions()]);
}
async function showLedger(row: Row) {
  const result = (await api.get('/inventory/ledger', {
    params: {
      goodsId: row.goodsId,
      skuId: row.skuId,
      warehouseId: row.warehouseId,
      ...(row.batchNo !== undefined ? { batchNo: row.batchNo } : {}),
      pageSize: 100,
    },
  })) as Row;
  ledger.value = result.items ?? [];
  Object.assign(ledgerContext, {
    title: row.goodsName || '库存流水',
    subtitle: `${row.goodsCode || ''} · ${row.warehouseName || ''}`,
  });
  ledgerDialog.value = true;
}
function editQuantityAlert(row: Row) {
  Object.keys(quantityAlertForm).forEach((key) => delete quantityAlertForm[key]);
  Object.assign(quantityAlertForm, {
    orgId: row.orgId,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouseName,
    goodsId: row.goodsId,
    goodsCode: row.goodsCode,
    goodsName: row.goodsName,
    skuId: row.skuId,
    skuSpec: row.skuSpec,
    factQty: Number(row.factQty ?? 0),
    safeQty: Number(row.safeQty ?? 0),
    purchaseQty: Number(row.purchaseQty ?? row.gapQty ?? 0),
  });
  quantityAlertDialog.value = true;
}
async function saveQuantityAlertConfig() {
  if (Number(quantityAlertForm.safeQty) < 0 || Number(quantityAlertForm.purchaseQty) < 0) {
    ElMessage.warning('安全库存和建议补货数量不能小于0');
    return;
  }
  saving.value = true;
  try {
    const result = (await api.post('/inventory/quantity-alerts', quantityAlertForm)) as Row;
    ElMessage.success(result.message ?? '库存预警配置已保存');
    quantityAlertDialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}
async function adjustStock(row: Row) {
  resetForm();
  stockAdjustment.value = true;
  mode.value = 'create';
  await loadStocks(row.warehouseId, row.orgId);
  form.reason = '';
  form.applicantDate = dateText(new Date());
  form.details = [
    {
      ...blankLine(),
      stockKey: stockKey(row),
      goodsId: row.goodsId,
      goodsCode: row.goodsCode,
      goodsName: row.goodsName,
      skuId: row.skuId,
      skuSpec: row.skuSpec,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      batchNo: row.batchNo,
      unitType: row.unitType,
      unitName: row.unitName,
      beforeQty: Number(row.inventoryQty),
      inventoryQty: Number(row.inventoryQty),
      adjustType: dicts.inventory_adjust_type?.[0]?.value ?? 1,
      quantity: 1,
    },
  ];
  recalcLine(form.details[0]);
  dialog.value = true;
}
function openTrace(row: Row) {
  traceRow.value = row;
  traceVisible.value = true;
}

const canEdit = (row: Row) =>
  Number(row.status) === 0 && [0, 2].includes(Number(row.approveStatus));
const canDelete = (row: Row) =>
  canEdit(row) &&
  (!isDocument.value ||
    (resource.value === 'losses' &&
      Number(row.businessKind) === 2 &&
      Number(row.sourceCheckId ?? 0) === 0));
const canApprove = (row: Row) =>
  Number(row.approveStatus) === 0 &&
  (resource.value === 'loss-outputs'
    ? [0, 1].includes(Number(row.status))
    : Number(row.status) === 1) &&
  !(resource.value === 'losses' && Number(row.businessKind) !== 2) &&
  !(resource.value === 'overflows' && Number(row.sourceCheckId ?? 0) <= 0);
const canEditDocument = (row: Row) =>
  resource.value === 'losses' && Number(row.businessKind) === 2 && canEdit(row);

watch(resource, async () => {
  resetQuery();
  await loadOptions();
});
watch(checkProductGroups, async (groups) => {
  const currentKey = selectedCheckProduct.value?.key;
  selectedCheckProduct.value = groups.find((group) => group.key === currentKey) ?? groups[0];
  await nextTick();
  checkProductTableRef.value?.setCurrentRow(selectedCheckProduct.value);
});
watch(dialog, async (opened) => {
  if (!opened || resource.value !== 'checks') return;
  await nextTick();
  checkProductTableRef.value?.setCurrentRow(selectedCheckProduct.value);
});
onMounted(async () => {
  await auth.load();
  await loadOptions();
  await load();
  if (String(route.query.create ?? '') === '1' && current.value.createText) await openCreate();
});
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>{{ current.title }}</h2>
        <p class="page-subtitle">{{ current.subtitle }}</p>
      </div>
      <div class="page-actions">
        <el-button @click="load">刷新</el-button>
        <el-button v-if="resource === 'checks'" @click="historyDialog = true"
          >查看盘点记录</el-button
        >
        <el-button v-if="current.createText && canAction('create')" type="primary" @click="openCreate">{{
          current.createText
        }}</el-button>
      </div>
    </header>

    <div class="panel">
      <div v-if="resource === 'stocks'" class="inventory-org-scope">
        <div class="inventory-org-scope__intro">
          <strong>库存组织</strong>
          <span>请先选择组织，再查看该组织下的仓库和库存</span>
        </div>
        <el-tree-select
          v-model="query.orgId"
          :data="organizationTree"
          class="inventory-org-scope__select"
          clearable
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          placeholder="请选择组织"
          @change="organizationChanged"
        />
        <el-radio-group
          v-if="stockScopeReady"
          :model-value="stockView"
          @update:model-value="changeStockView($event as 'inventory' | 'requisition')"
        >
          <el-radio-button value="inventory">仓库库存</el-radio-button>
          <el-radio-button value="requisition">领用记录</el-radio-button>
        </el-radio-group>
      </div>

      <div
        v-if="
          (resource === 'stocks' && stockScopeReady && stockView === 'inventory') ||
          resource === 'quantity-alerts'
        "
        class="summary-strip"
      >
        <div class="summary-item">
          <span class="summary-label">库存品项</span
          ><strong class="summary-value">{{ summary.itemCount || total }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">库存总值</span
          ><strong class="summary-value">¥ {{ moneyText(summary.totalAmount) }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">库存预警</span
          ><strong class="summary-value">{{ summary.warningCount }}</strong>
        </div>
      </div>
      <div
        v-if="resource === 'stocks' && stockScopeReady && stockView === 'requisition'"
        class="summary-strip"
      >
        <div class="summary-item">
          <span class="summary-label">领用明细</span
          ><strong class="summary-value">{{ total }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">累计领用</span
          ><strong class="summary-value">{{ quantity(summary.issuedQty) }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">累计退回</span
          ><strong class="summary-value">{{ quantity(summary.returnedQty) }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">当前持有</span
          ><strong class="summary-value">{{ quantity(summary.holdingQty) }}</strong>
        </div>
      </div>

      <div v-if="resource === 'checks'" class="check-summary-strip">
        <div class="check-summary-item">
          <span>盘点单总数</span>
          <strong>{{ checkListSummary.total }}</strong>
          <small>当前筛选范围</small>
        </div>
        <div class="check-summary-item check-summary-item--processing">
          <span>盘点进行中</span>
          <strong>{{ checkListSummary.active }}</strong>
          <small>可继续录入实盘数量</small>
        </div>
        <div class="check-summary-item check-summary-item--warning">
          <span>待审批</span>
          <strong>{{ checkListSummary.pending }}</strong>
          <small>等待确认盘点结果</small>
        </div>
        <div class="check-summary-item check-summary-item--danger">
          <span>存在差异</span>
          <strong>{{ checkListSummary.abnormal }}</strong>
          <small>含盘亏、盘盈或损坏</small>
        </div>
      </div>

      <div
        v-if="usesWarehouseTabs && stockScopeReady && stockView === 'inventory'"
        class="warehouse-tabs"
      >
        <button :class="{ active: !query.warehouseId }" @click="selectWarehouse('')">
          全部 <span>{{ resource === 'stocks' ? summary.itemCount : total }}</span>
        </button>
        <button
          v-for="item in options.warehouseTabs as Option[]"
          :key="item.value"
          :class="{ active: String(query.warehouseId) === String(item.value) }"
          @click="selectWarehouse(item.value)"
        >
          {{ item.label }} <span>{{ warehouseTabCount(item) }}</span>
        </button>
      </div>

      <div v-if="stockScopeReady" class="query-bar">
        <el-input
          v-model="query.keyword"
          class="query-field keyword"
          clearable
          placeholder="商品编码 / 名称 / SKU"
          @keyup.enter="
            query.page = 1;
            load();
          "
        />
        <el-select
          v-if="resource === 'stocks' && stockView === 'requisition'"
          v-model="query.departmentId"
          class="query-field"
          clearable
          filterable
          placeholder="全部部门"
        >
          <el-option
            v-for="item in stockDepartments"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select
          v-if="resource === 'stocks' && stockView === 'requisition'"
          v-model="query.receiverId"
          class="query-field"
          clearable
          filterable
          placeholder="全部领用人"
        >
          <el-option
            v-for="item in stockReceivers"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-tree-select
          v-if="resource !== 'stocks'"
          v-model="query.orgId"
          :data="organizationTree"
          class="query-field"
          clearable
          filterable
          check-strictly
          node-key="value"
          :props="{ label: 'label', children: 'children' }"
          placeholder="全部组织"
        />
        <el-select
          v-if="!usesWarehouseTabs"
          v-model="query.warehouseId"
          class="query-field"
          clearable
          placeholder="全部仓库"
          ><el-option
            v-for="item in options.warehouses as Option[]"
            :key="item.value"
            :label="item.label"
            :value="item.value"
        /></el-select>
        <el-input
          v-if="resource === 'stocks'"
          v-model="query.batchNo"
          class="query-field"
          clearable
          placeholder="批号"
        />
        <el-date-picker
          v-if="resource === 'stocks' && stockView === 'requisition'"
          v-model="query.dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="领用开始日期"
          end-placeholder="领用结束日期"
          class="query-date-range"
        />
        <el-select
          v-if="resource === 'stocks' && stockView === 'requisition'"
          v-model="query.holdingStatus"
          class="query-field"
        >
          <el-option label="全部领用历史" value="all" />
          <el-option label="仅看持有结存" value="holding" />
          <el-option label="仅看已退清" value="returned" />
        </el-select>
        <el-checkbox
          v-if="resource === 'stocks' && stockView === 'inventory'"
          v-model="query.inStockOnly"
          >仅显示有库存</el-checkbox
        >
        <div class="query-actions">
          <el-button
            type="primary"
            @click="
              query.page = 1;
              load();
            "
            >查询</el-button
          ><el-button @click="resetQuery">重置</el-button>
        </div>
      </div>

      <div v-if="resource === 'stocks' && !stockScopeReady" class="inventory-org-empty">
        <el-empty description="请先选择组织，再查看该组织下的仓库与库存数据" />
      </div>

      <div v-if="stockScopeReady" class="table-wrap">
        <InventoryCheckTable
          v-if="resource === 'checks'"
          :rows="rows"
          :loading="loading"
          :can-edit="canEdit"
          :can-approve="canApprove"
          :status-label="statusText"
          @view="openRow($event, true)"
          @trace="openTrace"
          @edit="openRow"
          @approve="approve($event, true)"
          @reject="approve($event, false)"
        />
        <el-table v-else :data="rows" v-loading="loading" border>
          <el-table-column type="index" label="序号" width="58" />
          <el-table-column prop="id" label="ID" width="100" />

          <template v-if="resource === 'stocks' && stockView === 'inventory'">
            <el-table-column prop="goodsCode" label="商品编码" width="125" /><el-table-column
              prop="goodsName"
              label="商品名称"
              min-width="150"
            /><el-table-column prop="skuSpec" label="规格" min-width="120" /><el-table-column
              prop="orgName"
              label="组织"
              min-width="110"
            /><el-table-column prop="warehouseName" label="所在仓库" min-width="120" />
            <el-table-column label="即时结存" width="100" align="right"
              ><template #default="s">{{ quantity(s.row.inventoryQty) }}</template></el-table-column
            ><el-table-column label="累计入库" width="100" align="right"
              ><template #default="s">{{ quantity(s.row.inputQty) }}</template></el-table-column
            ><el-table-column label="累计出库" width="100" align="right"
              ><template #default="s">{{ quantity(s.row.outputQty) }}</template></el-table-column
            ><el-table-column label="单位成本" width="100" align="right"
              ><template #default="s">¥ {{ moneyText(s.row.unitCost) }}</template></el-table-column
            ><el-table-column label="库存金额" width="110" align="right"
              ><template #default="s"
                >¥ {{ moneyText(s.row.inventoryAmount) }}</template
              ></el-table-column
            ><el-table-column label="库存状态" width="90"
              ><template #default="s"
                ><el-tag :type="Number(s.row.inventoryQty) > 0 ? 'success' : 'info'">{{
                  s.row.inventoryStatus
                }}</el-tag></template
              ></el-table-column
            ><el-table-column label="操作" width="132" fixed="right" align="center"
              ><template #default="s"
                ><TableRowActions
                  ><el-button link type="primary" @click="showLedger(s.row)">查看</el-button
                  ><el-button
                    v-if="canPageAction(auth.user, '/inventory/adjustments', 'create')"
                    link
                    type="primary"
                    @click="adjustStock(s.row)"
                    >调整</el-button
                  ></TableRowActions
                ></template
              ></el-table-column
            >
          </template>

          <template v-else-if="resource === 'stocks' && stockView === 'requisition'">
            <el-table-column prop="outputNo" label="领用出库单" width="165" />
            <el-table-column prop="applicationNo" label="领用申请单" width="165" />
            <el-table-column label="领用日期" width="112">
              <template #default="s">{{ dateText(s.row.outputDate) }}</template>
            </el-table-column>
            <el-table-column prop="departmentName" label="部门" min-width="110" />
            <el-table-column prop="receiverName" label="领用人" width="100" />
            <el-table-column prop="goodsCode" label="商品编码" width="125" />
            <el-table-column prop="goodsName" label="商品名称" min-width="145" />
            <el-table-column prop="skuSpec" label="SKU规格" min-width="130" />
            <el-table-column prop="batchNo" label="批号" width="135" />
            <el-table-column prop="warehouseName" label="领出仓库" min-width="120" />
            <el-table-column label="领用数量" width="92" align="right">
              <template #default="s">{{ quantity(s.row.issuedQty) }}</template>
            </el-table-column>
            <el-table-column label="已退数量" width="92" align="right">
              <template #default="s">{{ quantity(s.row.returnedQty) }}</template>
            </el-table-column>
            <el-table-column label="持有结存" width="92" align="right">
              <template #default="s">{{
                s.row.returnable ? quantity(s.row.remainingQty) : '—'
              }}</template>
            </el-table-column>
            <el-table-column label="归还状态" width="95" fixed="right">
              <template #default="s">
                <el-tag
                  :type="
                    !s.row.returnable
                      ? 'info'
                      : Number(s.row.remainingQty) > 0
                        ? 'warning'
                        : 'success'
                  "
                  effect="plain"
                  >{{ s.row.holdingStatusName }}</el-tag
                >
              </template>
            </el-table-column>
          </template>

          <template v-else-if="resource === 'transfers'">
            <el-table-column prop="transferNo" label="调拨单号" width="150" /><el-table-column
              prop="toWarehouseName"
              label="调入仓库"
              min-width="115"
            /><el-table-column
              prop="warehouseName"
              label="调出仓库"
              min-width="115"
            /><el-table-column prop="orgName" label="调出组织" min-width="105" /><el-table-column
              prop="toOrgName"
              label="调入组织"
              min-width="105"
            /><el-table-column prop="sendByName" label="发出人" width="90" /><el-table-column
              prop="receiveByName"
              label="接收人"
              width="90"
            /><el-table-column prop="reason" label="调拨理由" min-width="150" /><el-table-column
              label="调拨日期"
              width="105"
              ><template #default="s">{{ dateText(s.row.transferDate) }}</template></el-table-column
            ><el-table-column label="调拨数量" width="90" align="right"
              ><template #default="s">{{ quantity(s.row.quantity) }}</template></el-table-column
            ><el-table-column prop="createdByName" label="创建人" width="90" /><el-table-column
              label="创建时间"
              width="145"
              ><template #default="s">{{
                dateText(s.row.createdAt, true)
              }}</template></el-table-column
            ><el-table-column label="状态" width="90"
              ><template #default="s"
                ><el-tag :type="statusType(s.row)">{{ statusText(s.row) }}</el-tag></template
              ></el-table-column
            ><el-table-column label="操作" width="176" fixed="right" align="center"
              ><template #default="s"
                ><TableRowActions :show-more="canEdit(s.row) || canApprove(s.row)"
                  ><el-button link type="primary" @click="openRow(s.row, true)">查看</el-button
                  ><el-button v-if="canEdit(s.row) && canAction('update')" link type="primary" @click="openRow(s.row)"
                    >编辑</el-button
                  ><template #more
                    ><el-dropdown-item v-if="canEdit(s.row) && canAction('submit')" @click="submit(s.row)"
                      >提交</el-dropdown-item
                    ><el-dropdown-item
                      v-if="canApprove(s.row) && canAction('approve')"
                      class="table-action-success"
                      @click="approve(s.row, true)"
                      >通过</el-dropdown-item
                    ><el-dropdown-item
                      v-if="canApprove(s.row) && canAction('approve')"
                      class="table-action-danger"
                      @click="approve(s.row, false)"
                      >驳回</el-dropdown-item
                    ><el-dropdown-item
                      v-if="canEdit(s.row) && canAction('delete')"
                      class="table-action-danger"
                      divided
                      @click="removeRow(s.row)"
                      >删除</el-dropdown-item
                    ></template
                  ></TableRowActions
                ></template
              ></el-table-column
            >
          </template>

          <template v-else-if="resource === 'adjustments'">
            <el-table-column prop="adjustNo" label="调整单号" width="150" /><el-table-column
              label="申请日期"
              width="105"
              ><template #default="s">{{
                dateText(s.row.applicantDate)
              }}</template></el-table-column
            ><el-table-column prop="reason" label="调整原因" min-width="180" /><el-table-column
              prop="detailCount"
              label="明细数"
              width="80"
            /><el-table-column label="调整总量" width="100"
              ><template #default="s">{{ quantity(s.row.quantity) }}</template></el-table-column
            ><el-table-column label="审批状态" width="90"
              ><template #default="s"
                ><el-tag :type="statusType(s.row)">{{ statusText(s.row) }}</el-tag></template
              ></el-table-column
            ><el-table-column prop="createdByName" label="创建人" width="90" /><el-table-column
              label="创建时间"
              width="145"
              ><template #default="s">{{
                dateText(s.row.createdAt, true)
              }}</template></el-table-column
            ><el-table-column label="操作" width="176" fixed="right" align="center"
              ><template #default="s"
                ><TableRowActions :show-more="canEdit(s.row) || canApprove(s.row)"
                  ><el-button link type="primary" @click="openRow(s.row, true)">查看</el-button
                  ><el-button v-if="canEdit(s.row) && canAction('update')" link type="primary" @click="openRow(s.row)"
                    >编辑</el-button
                  ><template #more
                    ><el-dropdown-item v-if="canEdit(s.row) && canAction('submit')" @click="submit(s.row)"
                      >提交</el-dropdown-item
                    ><el-dropdown-item
                      v-if="canApprove(s.row) && canAction('approve')"
                      class="table-action-success"
                      @click="approve(s.row, true)"
                      >通过</el-dropdown-item
                    ><el-dropdown-item
                      v-if="canApprove(s.row) && canAction('approve')"
                      class="table-action-danger"
                      @click="approve(s.row, false)"
                      >驳回</el-dropdown-item
                    ><el-dropdown-item
                      v-if="canEdit(s.row) && canAction('delete')"
                      class="table-action-danger"
                      divided
                      @click="removeRow(s.row)"
                      >删除</el-dropdown-item
                    ></template
                  ></TableRowActions
                ></template
              ></el-table-column
            >
          </template>

          <template v-else-if="isDocument">
            <el-table-column
              prop="businessNo"
              :label="
                resource === 'losses'
                  ? '报损出库单号'
                  : resource === 'loss-outputs'
                    ? '报亏出库单号'
                    : '报盈入库单号'
              "
              width="155"
            />
            <el-table-column
              v-if="resource === 'losses'"
              prop="businessKindName"
              label="业务类别"
              width="105"
            />
            <el-table-column
              v-if="resource === 'loss-outputs'"
              prop="sourceCheckNo"
              label="来源盘点"
              width="145"
              ><template #default="s">{{
                s.row.sourceCheckNo || (s.row.sourceLossNo ? `历史：${s.row.sourceLossNo}` : '—')
              }}</template></el-table-column
            >
            <el-table-column
              v-if="resource === 'overflow-inputs'"
              prop="sourceOverflowNo"
              label="来源报盈单"
              width="145"
            />
            <el-table-column
              v-if="['losses', 'overflows', 'overflow-inputs'].includes(resource)"
              prop="sourceCheckNo"
              label="来源盘点"
              width="140"
              ><template #default="s">{{
                s.row.sourceCheckNo || '历史非盘点记录'
              }}</template></el-table-column
            >
            <el-table-column prop="orgName" label="组织" min-width="105" />
            <el-table-column prop="warehouseName" label="仓库" min-width="110" />
            <el-table-column prop="deptName" label="部门" min-width="100" />
            <el-table-column
              prop="documentTypeName"
              :label="
                resource === 'losses'
                  ? '业务类型'
                  : resource === 'loss-outputs'
                    ? '报亏类型'
                    : '报盈类型'
              "
              width="105"
            />
            <el-table-column prop="reason" label="原因" min-width="150" />
            <el-table-column
              v-if="resource === 'losses'"
              prop="goWhereName"
              label="报损去向"
              width="105"
            />
            <el-table-column label="日期" width="105"
              ><template #default="s">{{ dateText(s.row.date) }}</template></el-table-column
            >
            <el-table-column label="数量" width="85"
              ><template #default="s">{{ quantity(s.row.quantity) }}</template></el-table-column
            >
            <el-table-column label="金额" width="100"
              ><template #default="s">¥ {{ moneyText(s.row.amount) }}</template></el-table-column
            >
            <el-table-column
              :label="resource === 'overflows' ? '审批/入库状态' : '审批状态'"
              width="110"
              ><template #default="s"
                ><el-tag :type="statusType(s.row)">{{ sourceStatus(s.row) }}</el-tag></template
              ></el-table-column
            >
            <el-table-column prop="createdByName" label="创建人" width="90" />
            <el-table-column label="操作" width="176" fixed="right" align="center">
              <template #default="s">
                <TableRowActions>
                  <el-button link type="primary" @click="openRow(s.row, true)">查看</el-button>
                  <el-button
                    v-if="canEditDocument(s.row) && canAction('update')"
                    link
                    type="primary"
                    @click="openRow(s.row)"
                    >编辑</el-button
                  >
                  <template #more>
                    <!-- 暂时隐藏“业务链路”入口，保留底层查询能力以便后续恢复。
                    <el-dropdown-item @click="openTrace(s.row)">业务链路</el-dropdown-item>
                    -->
                    <el-dropdown-item v-if="canEditDocument(s.row) && canAction('submit')" @click="submit(s.row)"
                      >提交</el-dropdown-item
                    >
                    <el-dropdown-item
                      v-if="canApprove(s.row) && canAction('approve')"
                      class="table-action-success"
                      @click="approve(s.row, true)"
                      >通过</el-dropdown-item
                    >
                    <el-dropdown-item
                      v-if="canApprove(s.row) && canAction('approve')"
                      class="table-action-danger"
                      @click="approve(s.row, false)"
                      >驳回</el-dropdown-item
                    >
                    <el-dropdown-item
                      v-for="purchaseReturn in s.row.purchaseReturns || []"
                      :key="purchaseReturn.id"
                      @click="
                        router.push({
                          path: '/purchase/returns',
                          query: { documentId: String(purchaseReturn.id), view: '1' },
                        })
                      "
                      >查看采购退货 {{ purchaseReturn.returnNo }}</el-dropdown-item
                    >
                    <el-dropdown-item
                      v-if="canDelete(s.row) && canAction('delete')"
                      class="table-action-danger"
                      divided
                      @click="removeRow(s.row)"
                      >删除</el-dropdown-item
                    >
                  </template>
                </TableRowActions>
              </template>
            </el-table-column>
          </template>

          <template v-else-if="resource === 'quantity-alerts'">
            <el-table-column prop="goodsCode" label="商品编码" width="125" /><el-table-column
              prop="goodsName"
              label="商品名称"
              min-width="150"
            /><el-table-column prop="skuSpec" label="规格" min-width="120" /><el-table-column
              prop="warehouseName"
              label="所在仓库"
              min-width="120"
            /><el-table-column label="实际库存" width="95"
              ><template #default="s">{{ quantity(s.row.factQty) }}</template></el-table-column
            ><el-table-column label="安全库存" width="95"
              ><template #default="s">{{ quantity(s.row.safeQty) }}</template></el-table-column
            ><el-table-column label="缺口" width="85"
              ><template #default="s">{{ quantity(s.row.gapQty) }}</template></el-table-column
            ><el-table-column label="建议补货" width="95"
              ><template #default="s">{{ quantity(s.row.purchaseQty) }}</template></el-table-column
            ><el-table-column label="库存状态" width="95"
              ><template #default="s"
                ><el-tag :type="s.row.warning ? 'danger' : 'success'">{{
                  dictLabel('inventory_stock_health_status', s.row.warning ? 1 : 0)
                }}</el-tag></template
              ></el-table-column
            ><el-table-column label="操作" width="125" fixed="right"
              ><template #default="s"
                ><el-button link type="primary" @click="showLedger(s.row)">查看</el-button
                ><el-button link type="primary" @click="editQuantityAlert(s.row)"
                  >配置</el-button
                ></template
              ></el-table-column
            >
          </template>

          <template v-else-if="resource === 'expiry-alerts'">
            <el-table-column prop="goodsCode" label="商品编码" width="125" /><el-table-column
              prop="goodsName"
              label="商品名称"
              min-width="150"
            /><el-table-column prop="skuSpec" label="规格" min-width="120" /><el-table-column
              prop="warehouseName"
              label="所在仓库"
              min-width="115"
            /><el-table-column label="预警数量" width="95"
              ><template #default="s">{{ quantity(s.row.alertQty) }}</template></el-table-column
            ><el-table-column prop="alertTypeName" label="预警类型" width="100" /><el-table-column
              label="到期日"
              width="105"
              ><template #default="s">{{ dateText(s.row.endDay) }}</template></el-table-column
            ><el-table-column prop="alertDays" label="预警天数" width="85" /><el-table-column
              label="预警货值"
              width="105"
              ><template #default="s"
                >¥ {{ moneyText(s.row.alertValue) }}</template
              ></el-table-column
            ><el-table-column label="效期状态" width="95"
              ><template #default="s"
                ><el-tag
                  :type="
                    s.row.expiryStatus === '已过期'
                      ? 'danger'
                      : s.row.expiryStatus === '临期'
                        ? 'warning'
                        : 'success'
                  "
                  >⚠ {{ s.row.expiryStatus }}</el-tag
                ></template
              ></el-table-column
            ><el-table-column label="操作" width="75"
              ><template #default="s"
                ><el-button link type="primary" @click="showLedger(s.row)"
                  >查看</el-button
                ></template
              ></el-table-column
            >
          </template>
        </el-table>
      </div>
      <div
        v-if="stockScopeReady && !['quantity-alerts', 'expiry-alerts'].includes(resource)"
        class="table-footer"
      >
        <span class="result-total">共 {{ total }} 条</span
        ><el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :teleported="false"
          layout="prev, pager, next, sizes"
          :total="total"
          @change="load"
        />
      </div>
    </div>

    <div
      v-if="resource === 'stocks' && stockScopeReady && stockView === 'inventory'"
      class="panel recent-panel"
    >
      <div class="panel-title">最近库存流水</div>
      <el-table :data="recentLedger" border
        ><el-table-column label="发生时间" width="150"
          ><template #default="s">{{ dateText(s.row.createdAt, true) }}</template></el-table-column
        ><el-table-column prop="goodsName" label="商品" min-width="140" /><el-table-column
          label="业务模式"
          width="130"
          ><template #default="s">{{
            s.row.businessModeName || s.row.sourceType
          }}</template></el-table-column
        ><el-table-column prop="sourceNo" label="来源单号" width="145" /><el-table-column
          label="入库"
          width="85"
          ><template #default="s">{{ quantity(s.row.inputQty) }}</template></el-table-column
        ><el-table-column label="出库" width="85"
          ><template #default="s">{{ quantity(s.row.outputQty) }}</template></el-table-column
        ><el-table-column label="变动后库存" width="105"
          ><template #default="s">{{ quantity(s.row.afterQty) }}</template></el-table-column
        ><el-table-column prop="operatorName" label="操作人" width="90"
      /></el-table>
    </div>

    <el-dialog
      v-model="dialog"
      :title="dialogTitle"
      :width="resource === 'checks' ? 'min(1440px, calc(100vw - 48px))' : '1280px'"
      :class="{ 'inventory-check-dialog': resource === 'checks' }"
      destroy-on-close
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        :disabled="mode === 'view'"
      >
        <template v-if="resource === 'transfers'">
          <div class="master-grid">
            <el-form-item label="调出组织" prop="orgId"
              ><el-tree-select
                v-model="form.orgId"
                :data="organizationTree"
                filterable
                check-strictly
                node-key="value"
                :props="{ label: 'label', children: 'children' }"
                @change="
                  form.warehouseId = '';
                  form.toWarehouseId = '';
                  warehouseChanged();
                " /></el-form-item
            ><el-form-item label="调出仓库" prop="warehouseId"
              ><el-select
                v-model="form.warehouseId"
                @change="
                  form.toWarehouseId = '';
                  warehouseChanged();
                "
                ><el-option
                  v-for="item in filteredWarehouses"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" /></el-select></el-form-item
            ><el-form-item label="调入组织" prop="toOrgId"
              ><el-tree-select
                v-model="form.toOrgId"
                :data="organizationTree"
                filterable
                check-strictly
                node-key="value"
                :props="{ label: 'label', children: 'children' }"
                @change="form.toWarehouseId = ''" /></el-form-item
            ><el-form-item label="调入仓库" prop="toWarehouseId"
              ><el-select v-model="form.toWarehouseId" :disabled="!form.warehouseId"
                ><el-option
                  v-for="item in filteredToWarehouses"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" /></el-select></el-form-item
            ><el-form-item label="发出人" prop="sendBy"
              ><el-select v-model="form.sendBy"
                ><el-option
                  v-for="item in options.users as Option[]"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" /></el-select></el-form-item
            ><el-form-item label="接收人" prop="receiveBy"
              ><el-select v-model="form.receiveBy"
                ><el-option
                  v-for="item in options.users as Option[]"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" /></el-select></el-form-item
            ><el-form-item label="调拨理由" prop="reason"
              ><el-input v-model="form.reason" /></el-form-item
            ><el-form-item label="调拨日期"
              ><el-date-picker
                v-model="form.transferDate"
                type="date"
                value-format="YYYY-MM-DD" /></el-form-item
            ><el-form-item label="经办人"
              ><el-input :model-value="form.operatorName" disabled /></el-form-item
            ><el-form-item label="备注" class="span-2"
              ><el-input v-model="form.remark"
            /></el-form-item>
          </div>
        </template>

        <template v-else-if="resource === 'adjustments' || stockAdjustment">
          <div class="master-grid">
            <el-form-item label="调整原因" prop="reason" class="span-2"
              ><el-input v-model="form.reason" /></el-form-item
            ><el-form-item label="申请日期"
              ><el-date-picker
                v-model="form.applicantDate"
                type="date"
                value-format="YYYY-MM-DD" /></el-form-item
            ><el-form-item label="经办人"
              ><el-input :model-value="form.operatorName" disabled /></el-form-item
            ><el-form-item label="备注" class="span-all"
              ><el-input v-model="form.remark"
            /></el-form-item>
          </div>
        </template>

        <template v-else-if="resource === 'checks'">
          <div class="check-dialog-section">
            <div class="check-dialog-section__heading">
              <div>
                <strong>基本信息</strong>
                <span>新增、继续盘点和查看统一使用本布局；库存明细按商品规格和批次载入</span>
              </div>
              <BusinessStatusTag
                v-if="mode !== 'create'"
                :semantic="mode === 'view' ? 'neutral' : 'processing'"
                :text="mode === 'view' ? '只读查看' : '盘点录入中'"
              />
            </div>
            <div class="check-master-grid">
              <el-form-item label="盘点单号">
                <el-input :model-value="form.checkNo || '保存后自动生成'" disabled />
              </el-form-item>
              <el-form-item label="盘点类型">
                <el-select v-model="form.checkType">
                  <el-option
                    v-for="item in dicts.inventory_check_type"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="组织" prop="orgId">
                <el-tree-select
                  v-model="form.orgId"
                  :data="organizationTree"
                  filterable
                  check-strictly
                  node-key="value"
                  :props="{ label: 'label', children: 'children' }"
                  :disabled="mode !== 'create'"
                />
              </el-form-item>
              <el-form-item label="仓库" prop="warehouseId">
                <el-select v-model="form.warehouseId" :disabled="mode !== 'create'">
                  <el-option
                    v-for="item in filteredWarehouses"
                    :key="item.value"
                    :label="item.label"
                    :value="item.value"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="盘点日期">
                <el-date-picker v-model="form.checkDate" type="date" value-format="YYYY-MM-DD" />
              </el-form-item>
              <el-form-item label="盘点人">
                <el-input :model-value="form.operatorName || auth.user?.username || '—'" disabled />
              </el-form-item>
              <el-form-item label="备注" class="span-2">
                <el-input v-model="form.remark" placeholder="填写本次盘点范围或特殊说明" />
              </el-form-item>
            </div>
          </div>
        </template>

        <template v-else-if="isDocument">
          <div class="master-grid">
            <el-form-item v-if="resource === 'loss-outputs'" label="来源盘点单" class="span-2"
              ><el-input
                :model-value="
                  form.sourceCheckNo || (form.sourceLossNo ? `历史来源：${form.sourceLossNo}` : '—')
                "
                disabled
            /></el-form-item>
            <el-form-item
              v-if="resource === 'overflow-inputs' || viewingOverflowInput"
              label="来源报盈单"
              ><el-input :model-value="form.sourceOverflowNo" disabled
            /></el-form-item>
            <el-form-item v-if="form.sourceCheckNo" label="来源盘点单"
              ><el-input :model-value="form.sourceCheckNo" disabled
            /></el-form-item>
            <el-form-item v-if="resource === 'losses'" label="业务类别">
              <el-input model-value="报损出库单" disabled />
            </el-form-item>
            <el-form-item label="组织" prop="orgId"
              ><el-tree-select
                v-model="form.orgId"
                :data="organizationTree"
                filterable
                check-strictly
                node-key="value"
                :props="{ label: 'label', children: 'children' }"
                :disabled="
                  mode === 'view' ||
                  ['loss-outputs', 'overflow-inputs'].includes(resource) ||
                  viewingOverflowInput ||
                  generatedDamageLocked
                "
                @change="
                  form.warehouseId = '';
                  warehouseChanged();
                "
              />
              ></el-form-item
            >
            <el-form-item label="仓库" prop="warehouseId"
              ><el-select
                v-model="form.warehouseId"
                :disabled="
                  mode === 'view' ||
                  ['loss-outputs', 'overflow-inputs'].includes(resource) ||
                  viewingOverflowInput ||
                  generatedDamageLocked
                "
                @change="warehouseChanged"
                ><el-option
                  v-for="item in filteredWarehouses"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" /></el-select
            ></el-form-item>
            <el-form-item label="部门"
              ><el-select
                v-model="form.deptId"
                :disabled="
                  mode === 'view' ||
                  ['loss-outputs', 'overflow-inputs'].includes(resource) ||
                  viewingOverflowInput
                "
                ><el-option
                  v-for="item in options.departments as Option[]"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" /></el-select
            ></el-form-item>
            <el-form-item
              :label="
                resource === 'losses' && Number(form.businessKind) === 2
                  ? '报损类型'
                  : resource === 'losses'
                    ? '报亏类型'
                    : resource === 'loss-outputs'
                      ? '报亏类型'
                      : '报盈类型'
              "
            >
              <el-select
                v-model="form.documentType"
                :disabled="mode === 'view' || resource !== 'losses' || generatedDamageLocked"
              >
                <el-option
                  v-for="item in dicts[
                    resource === 'losses' && Number(form.businessKind) === 2
                      ? 'inventory_loss_type'
                      : resource === 'losses' || resource === 'loss-outputs'
                        ? 'inventory_loss_output_type'
                        : 'inventory_overflow_type'
                  ]"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="原因" prop="reason" class="span-2"
              ><el-input
                v-model="form.reason"
                :disabled="
                  mode === 'view' ||
                  ['loss-outputs', 'overflows', 'overflow-inputs'].includes(resource) ||
                  viewingOverflowInput ||
                  generatedDamageLocked
                "
            /></el-form-item>
            <el-form-item
              v-if="resource === 'losses' && Number(form.businessKind) === 2"
              label="报损去向"
              required
              ><el-select
                v-model="form.goWhere"
                :disabled="mode === 'view'"
                placeholder="提交前必须选择"
                @change="lossDisposalChanged"
                ><el-option
                  v-for="item in dicts.inventory_loss_disposal"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value" /></el-select
            ></el-form-item>
            <el-form-item
              v-if="resource === 'overflow-inputs' || viewingOverflowInput"
              label="入库单号"
              ><el-input :model-value="form.inputNo || form.businessNo" disabled
            /></el-form-item>
            <el-form-item
              v-if="resource === 'overflow-inputs' || viewingOverflowInput"
              label="确认入库时间"
              ><el-input :model-value="dateText(form.inputDate, true)" disabled
            /></el-form-item>
            <el-form-item label="日期"
              ><el-date-picker
                v-model="form.date"
                type="date"
                value-format="YYYY-MM-DD"
                :disabled="mode === 'view' || resource !== 'losses' || generatedDamageLocked"
            /></el-form-item>
            <el-form-item label="经办人"
              ><el-input :model-value="form.operatorName" disabled
            /></el-form-item>
            <el-form-item label="备注" class="span-all"
              ><el-input v-model="form.remark"
            /></el-form-item>
          </div>
        </template>

        <div v-if="resource === 'checks' && mode === 'create'" class="load-hint">
          选择组织和仓库后点击“载入库存开始盘点”，系统按商品规格及其全部库存批次生成盘点明细；不允许手工增加不存在的库存记录。
        </div>
        <div
          v-if="resource === 'checks' && form.generatedDocuments?.length"
          class="generated-documents"
        >
          <span>已生成后继单据：</span>
          <el-tag
            v-for="item in form.generatedDocuments"
            :key="`${item.type}-${item.id}`"
            :type="
              Number(item.approveStatus) === 1
                ? 'success'
                : Number(item.status) === 0
                  ? 'info'
                  : 'warning'
            "
          >
            {{ item.type }} {{ item.businessNo
            }}<template v-if="item.successorNo"> → {{ item.successorNo }}</template>
          </el-tag>
        </div>
        <div v-if="resource === 'checks'" class="check-result-summary">
          <div>
            <span>商品规格</span><strong>{{ checkDetailSummary.goods }}</strong
            ><small>去重后的商品 / SKU</small>
          </div>
          <div>
            <span>库存批次</span><strong>{{ checkDetailSummary.batches }}</strong
            ><small>本次逐批盘点行数</small>
          </div>
          <div>
            <span>账面总量</span><strong>{{ quantity(checkDetailSummary.inventoryQty) }}</strong
            ><small>载入时库存快照</small>
          </div>
          <div>
            <span>实盘总量</span><strong>{{ quantity(checkDetailSummary.checkQty) }}</strong
            ><small>包含损坏数量</small>
          </div>
          <div class="is-danger">
            <span>盘亏数量</span><strong>{{ quantity(checkDetailSummary.shortageQty) }}</strong
            ><small>按批次累计</small>
          </div>
          <div class="is-success">
            <span>盘盈数量</span><strong>{{ quantity(checkDetailSummary.overflowQty) }}</strong
            ><small>按批次累计</small>
          </div>
          <div class="is-warning">
            <span>损坏数量</span><strong>{{ quantity(checkDetailSummary.damagedQty) }}</strong
            ><small>独立损坏维度</small>
          </div>
        </div>
        <div class="form-section-title">
          {{ resource === 'checks' ? '批次盘点明细' : '商品明细' }}
        </div>
        <div class="table-wrap">
          <div v-if="resource === 'checks'" class="check-master-detail-layout">
            <div class="check-product-list-panel">
              <div class="check-panel-heading">
                <strong>盘点商品</strong
                ><span>共 {{ checkProductGroups.length }} 项，点击切换</span>
              </div>
              <el-table
                ref="checkProductTableRef"
                :data="checkProductGroups"
                border
                highlight-current-row
                row-key="key"
                height="360"
                empty-text="载入库存后显示商品"
                class="check-product-table"
                @current-change="selectCheckProduct"
              >
                <el-table-column
                  label="商品编码 / 名称 / 规格"
                  min-width="220"
                  show-overflow-tooltip
                >
                  <template #default="s"
                    ><div class="check-product-cell">
                      <strong>{{ s.row.goodsCode || '—' }} · {{ s.row.goodsName || '—' }}</strong
                      ><span>{{ s.row.skuSpec || '默认规格' }} · {{ s.row.unitName || '—' }}</span>
                    </div></template
                  >
                </el-table-column>
                <el-table-column label="批次" width="56" align="center"
                  ><template #default="s">{{ s.row.batches.length }}</template></el-table-column
                >
              </el-table>
            </div>
            <div class="check-batch-detail-panel">
              <div class="check-panel-heading">
                <strong>{{
                  selectedCheckProduct ? `${selectedCheckProduct.goodsName}的批次明细` : '批次明细'
                }}</strong>
                <span v-if="selectedCheckProduct"
                  >{{ selectedCheckProduct.goodsCode }} ·
                  {{ selectedCheckProduct.skuSpec || '默认规格' }} · 共
                  {{ selectedCheckBatches.length }} 个批次</span
                >
                <span v-else>请先从左侧选择商品</span>
              </div>
              <el-table
                :data="selectedCheckBatches"
                border
                table-layout="fixed"
                max-height="360"
                :row-key="checkBatchRowKey"
                :row-class-name="checkBatchRowClassName"
                :show-summary="selectedCheckBatches.length > 1"
                :summary-method="getCheckSummaries"
                empty-text="请选择左侧商品查看对应批次"
                class="check-batch-table"
              >
                <el-table-column prop="batchNo" label="批号" width="128" show-overflow-tooltip
                  ><template #default="b">{{
                    b.row.batchNo || '无批号'
                  }}</template></el-table-column
                >
                <el-table-column prop="inventoryQty" label="账面数量" width="96" align="right"
                  ><template #default="b">{{
                    quantity(b.row.inventoryQty)
                  }}</template></el-table-column
                >
                <el-table-column prop="checkQty" label="实盘总数" width="144" align="right"
                  ><template #default="b"
                    ><el-input-number
                      v-model="b.row.checkQty"
                      :min="0"
                      :precision="0"
                      :step="1"
                      controls-position="right"
                      :disabled="mode === 'view'"
                      @change="recalcLine(b.row)" /></template
                ></el-table-column>
                <el-table-column prop="differentQty" label="差异数量" width="96" align="right"
                  ><template #default="b"
                    ><span
                      :class="{
                        'difference-negative': Number(b.row.differentQty) < 0,
                        'difference-positive': Number(b.row.differentQty) > 0,
                      }"
                      >{{ quantity(b.row.differentQty) }}</span
                    ></template
                  ></el-table-column
                >
                <el-table-column prop="damagedQty" label="损坏数量" width="136" align="right"
                  ><template #default="b"
                    ><el-input-number
                      v-model="b.row.damagedQty"
                      :min="0"
                      :max="Number(b.row.checkQty)"
                      :precision="0"
                      :step="1"
                      controls-position="right"
                      :disabled="mode === 'view'"
                      @change="recalcLine(b.row)" /></template
                ></el-table-column>
                <el-table-column label="盘点结果" width="168" align="center"
                  ><template #default="b"
                    ><div class="check-result-tags">
                      <BusinessStatusTag
                        :semantic="checkQuantityStatus(b.row).semantic"
                        :text="checkQuantityStatus(b.row).text"
                        :dot="false"
                      /><BusinessStatusTag
                        v-if="Number(b.row.damagedQty) > 0"
                        :semantic="checkDamageStatus(b.row).semantic"
                        :text="checkDamageStatus(b.row).text"
                        :dot="false"
                      /></div></template
                ></el-table-column>
                <el-table-column prop="unitPrice" label="单价" width="88" align="right"
                  ><template #default="b"
                    >¥ {{ moneyText(b.row.unitPrice) }}</template
                  ></el-table-column
                >
                <el-table-column prop="differentAmount" label="差异金额" width="104" align="right"
                  ><template #default="b"
                    >¥ {{ moneyText(b.row.differentAmount) }}</template
                  ></el-table-column
                >
                <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip
                  ><template #default="b"
                    ><el-input v-model="b.row.remark" :disabled="mode === 'view'" /></template
                ></el-table-column>
              </el-table>
            </div>
          </div>
          <el-table
            v-else
            :data="form.details"
            border
            table-layout="fixed"
            empty-text="暂无明细"
            class="detail-entry-table"
          >
            <el-table-column
              v-if="resource !== 'loss-outputs'"
              label="商品 / SKU / 批次"
              min-width="300"
              ><template #default="s"
                ><span v-if="mode === 'view'" class="readonly-cell">{{ stockIdentity(s.row) }}</span
                ><el-select
                  v-else
                  v-model="s.row.stockKey"
                  filterable
                  :disabled="stockAdjustment || generatedDamageLocked"
                  @change="selectStock(s.row, $event)"
                  ><el-option
                    v-for="stock in options.stocks as Row[]"
                    :key="stockKey(stock)"
                    :label="stockLabel(stock)"
                    :value="stockKey(stock)" /></el-select></template
            ></el-table-column>
            <template v-if="resource === 'transfers'"
              ><el-table-column prop="unitName" label="单位" width="70" /><el-table-column
                label="调出库存"
                width="100"
                ><template #default="s">{{
                  quantity(s.row.inventoryQty)
                }}</template></el-table-column
              ><el-table-column label="调拨数量" width="140"
                ><template #default="s"
                  ><el-input-number
                    v-model="s.row.quantity"
                    :min="1"
                    :precision="0"
                    :step="1"
                    :disabled="mode === 'view'" /></template></el-table-column
              ><el-table-column prop="batchNo" label="批号" width="130"
            /></template>
            <template v-else-if="resource === 'adjustments' || stockAdjustment"
              ><el-table-column prop="warehouseName" label="仓库" width="110" /><el-table-column
                prop="unitName"
                label="单位"
                width="70" /><el-table-column label="调整前数量" width="105"
                ><template #default="s">{{ quantity(s.row.beforeQty) }}</template></el-table-column
              ><el-table-column label="调整类型" width="125"
                ><template #default="s"
                  ><span v-if="mode === 'view'" class="readonly-cell">{{
                    dictLabel('inventory_adjust_type', s.row.adjustType)
                  }}</span
                  ><el-select v-else v-model="s.row.adjustType" @change="recalcLine(s.row)"
                    ><el-option
                      v-for="item in dicts.inventory_adjust_type"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value" /></el-select></template></el-table-column
              ><el-table-column label="调整数量" width="140"
                ><template #default="s"
                  ><el-input-number
                    v-model="s.row.quantity"
                    :min="1"
                    :precision="0"
                    :step="1"
                    :disabled="mode === 'view'"
                    @change="recalcLine(s.row)" /></template></el-table-column
              ><el-table-column label="调整后数量" width="105"
                ><template #default="s">{{ quantity(s.row.afterQty) }}</template></el-table-column
              ><el-table-column label="备注" min-width="130"
                ><template #default="s"
                  ><el-input
                    v-model="s.row.remark"
                    :disabled="mode === 'view'" /></template></el-table-column
            ></template>
            <template v-else-if="isDocument"
              ><el-table-column
                v-if="
                  ['loss-outputs', 'overflow-inputs'].includes(resource) || viewingOverflowInput
                "
                prop="goodsCode"
                label="商品编码"
                width="115" /><el-table-column
                v-if="
                  ['loss-outputs', 'overflow-inputs'].includes(resource) || viewingOverflowInput
                "
                prop="goodsName"
                label="商品名称"
                min-width="130" /><el-table-column
                v-if="
                  ['loss-outputs', 'overflow-inputs'].includes(resource) || viewingOverflowInput
                "
                prop="skuSpec"
                label="SKU/规格"
                min-width="110" /><el-table-column
                prop="unitName"
                label="单位"
                width="70" /><el-table-column label="当前库存" width="95"
                ><template #default="s">{{
                  quantity(s.row.inventoryQty)
                }}</template></el-table-column
              ><el-table-column
                :label="
                  ['overflows', 'overflow-inputs'].includes(resource) || viewingOverflowInput
                    ? '报盈数量'
                    : Number(form.businessKind) === 1 || resource === 'loss-outputs'
                      ? '报亏数量'
                      : '报损数量'
                "
                width="145"
                ><template #default="s"
                  ><el-input-number
                    v-model="s.row.quantity"
                    :min="1"
                    :precision="0"
                    :step="1"
                    :disabled="
                      mode === 'view' ||
                      ['loss-outputs', 'overflow-inputs'].includes(resource) ||
                      viewingOverflowInput ||
                      generatedDamageLocked
                    "
                    @change="recalcLine(s.row)" /></template></el-table-column
              ><el-table-column label="单价" width="130"
                ><template #default="s"
                  ><el-input-number
                    v-model="s.row.unitPrice"
                    :min="0"
                    :precision="2"
                    :disabled="
                      mode === 'view' ||
                      !canEditAmount ||
                      ['loss-outputs', 'overflow-inputs'].includes(resource) ||
                      viewingOverflowInput ||
                      generatedDamageLocked
                    "
                    @change="recalcLine(s.row)" /></template></el-table-column
              ><el-table-column label="金额" width="100"
                ><template #default="s">¥ {{ moneyText(s.row.amount) }}</template></el-table-column
              ><el-table-column prop="batchNo" label="批号" width="125" /><el-table-column
                v-if="resource === 'losses' && Number(form.goWhere) === 2"
                label="原采购入库来源"
                min-width="220"
                ><template #default="s"
                  ><el-select
                    v-model="s.row.sourceReceiptDetailId"
                    filterable
                    :disabled="mode === 'view'"
                    placeholder="请选择来源入库单"
                    ><el-option
                      v-for="option in s.row.purchaseSourceOptions || []"
                      :key="option.value"
                      :label="option.label"
                      :value="option.value" /></el-select></template></el-table-column
            ></template>
            <el-table-column
              v-if="
                mode !== 'view' &&
                !['checks', 'loss-outputs'].includes(resource) &&
                !stockAdjustment &&
                !generatedDamageLocked
              "
              label="操作"
              width="70"
              fixed="right"
              ><template #default="s"
                ><el-button link type="danger" @click="form.details.splice(s.$index, 1)"
                  >删除</el-button
                ></template
              ></el-table-column
            >
          </el-table>
        </div>
        <el-button
          v-if="
            mode !== 'view' &&
            !['checks', 'loss-outputs'].includes(resource) &&
            !stockAdjustment &&
            !generatedDamageLocked
          "
          class="add-line"
          plain
          @click="form.details.push(blankLine())"
          >＋ 添加明细</el-button
        >
        <div v-if="isDocument" class="modal-totals">
          <span
            >合计数量
            <strong>{{
              quantity(
                form.details?.reduce(
                  (sum: number, line: Row) => sum + Number(line.quantity || 0),
                  0,
                ),
              )
            }}</strong></span
          ><span
            >合计金额
            <strong
              >¥
              {{
                moneyText(
                  form.details?.reduce(
                    (sum: number, line: Row) => sum + Number(line.amount || 0),
                    0,
                  ),
                )
              }}</strong
            ></span
          >
        </div>
      </el-form>
      <DocumentAttachments
        v-if="mode !== 'create' && attachmentType && form.id"
        :document-type="attachmentType"
        :document-id="form.id"
      />
      <template #footer>
        <el-button @click="dialog = false">{{ mode === 'view' ? '关闭' : '取消' }}</el-button>
        <template v-if="mode !== 'view'">
          <el-button
            v-if="resource === 'checks' && mode === 'create' && canAction('create')"
            type="primary"
            :loading="saving"
            @click="createCheck"
            >载入库存开始盘点</el-button
          >
          <template v-else-if="resource === 'checks' && canAction('update')"
            ><el-button :loading="saving" @click="saveCheck(false)">保存盘点</el-button
            ><el-button type="primary" :loading="saving" @click="saveCheck(true)"
              >完成盘点</el-button
            ></template
          >
          <el-button
            v-else-if="resource === 'loss-outputs' && canAction(mode === 'create' ? 'create' : 'update')"
            type="primary"
            :loading="saving"
            @click="save(false)"
            >保存报亏出库单</el-button
          >
          <template v-else-if="canAction(mode === 'create' ? 'create' : 'update')"
            ><el-button :loading="saving" @click="save(false)">保存草稿</el-button
            ><el-button v-if="canAction('submit')" type="primary" :loading="saving" @click="save(true)"
              >保存并提交审核</el-button
            ></template
          >
        </template>
      </template>
    </el-dialog>

    <el-dialog v-model="quantityAlertDialog" title="配置库存预警" width="520px">
      <div class="alert-config-summary">
        <strong>{{ quantityAlertForm.goodsCode }} · {{ quantityAlertForm.goodsName }}</strong>
        <span
          >{{ quantityAlertForm.skuSpec || '默认规格' }} ·
          {{ quantityAlertForm.warehouseName }}</span
        >
      </div>
      <el-form label-position="top">
        <div class="master-grid master-grid--two">
          <el-form-item label="当前实际库存"
            ><el-input :model-value="quantity(quantityAlertForm.factQty)" disabled
          /></el-form-item>
          <el-form-item label="安全库存"
            ><el-input-number
              v-model="quantityAlertForm.safeQty"
              :min="0"
              :precision="0"
              :step="1"
              controls-position="right"
          /></el-form-item>
          <el-form-item label="当前缺口"
            ><el-input
              :model-value="
                quantity(
                  Math.max(
                    0,
                    Number(quantityAlertForm.safeQty || 0) - Number(quantityAlertForm.factQty || 0),
                  ),
                )
              "
              disabled
          /></el-form-item>
          <el-form-item label="建议补货数量"
            ><el-input-number
              v-model="quantityAlertForm.purchaseQty"
              :min="0"
              :precision="0"
              :step="1"
              controls-position="right"
          /></el-form-item>
        </div>
      </el-form>
      <template #footer
        ><el-button @click="quantityAlertDialog = false">取消</el-button
        ><el-button type="primary" :loading="saving" @click="saveQuantityAlertConfig"
          >保存配置</el-button
        ></template
      >
    </el-dialog>

    <el-dialog v-model="ledgerDialog" :title="ledgerContext.title" width="1080px"
      ><p class="dialog-subtitle">{{ ledgerContext.subtitle }}</p>
      <el-table :data="ledger" border
        ><el-table-column label="发生时间" width="150"
          ><template #default="s">{{ dateText(s.row.createdAt, true) }}</template></el-table-column
        ><el-table-column label="业务模式/单据类型" width="150"
          ><template #default="s">{{
            s.row.businessModeName || s.row.sourceType
          }}</template></el-table-column
        ><el-table-column prop="sourceNo" label="来源单号" width="145" /><el-table-column
          label="入库数量"
          width="90"
          ><template #default="s">{{ quantity(s.row.inputQty) }}</template></el-table-column
        ><el-table-column label="出库数量" width="90"
          ><template #default="s">{{ quantity(s.row.outputQty) }}</template></el-table-column
        ><el-table-column label="变动后库存" width="105"
          ><template #default="s">{{ quantity(s.row.afterQty) }}</template></el-table-column
        ><el-table-column prop="batchNo" label="批号" width="120" /><el-table-column
          prop="operatorName"
          label="操作人"
          width="90" /><el-table-column prop="remark" label="备注" min-width="140" /></el-table
      ><template #footer
        ><el-button @click="ledgerDialog = false">关闭</el-button></template
      ></el-dialog
    >

    <el-dialog v-model="historyDialog" title="盘点记录" width="1280px"
      ><div class="history-toolbar"><el-button @click="load">重新加载</el-button></div>
      <el-table :data="rows" border
        ><el-table-column prop="checkNo" label="盘点单号" width="150" /><el-table-column
          prop="checkTypeName"
          label="盘点类型"
          width="100"
        /><el-table-column prop="orgName" label="组织" min-width="110" /><el-table-column
          prop="warehouseName"
          label="仓库"
          min-width="110"
        /><el-table-column label="盘点日期" width="110"
          ><template #default="s">{{ dateText(s.row.checkDate) }}</template></el-table-column
        ><el-table-column prop="goodsCount" label="商品数" width="80" /><el-table-column
          label="盘亏 / 盘盈"
          width="120"
          ><template #default="s"
            >{{ quantity(s.row.lessQty) }} / {{ quantity(s.row.overflowQty) }}</template
          ></el-table-column
        ><el-table-column label="操作" width="90"
          ><template #default="s"
            ><el-button
              link
              type="primary"
              @click="
                historyDialog = false;
                openRow(s.row, true);
              "
              >查看明细</el-button
            ></template
          ></el-table-column
        ></el-table
      ><template #footer
        ><el-button @click="historyDialog = false">关闭</el-button></template
      ></el-dialog
    >

    <DocumentTraceDialog
      v-model="traceVisible"
      :document-type="inventoryDocumentType(resource, traceRow)"
      :document-id="traceRow.id ?? ''"
      :document-no="traceRow.checkNo ?? traceRow.businessNo ?? ''"
    />
  </section>
</template>

<style scoped>
.master-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.alert-config-summary {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid var(--hs-border);
  border-radius: 6px;
  background: var(--hs-surface-soft, #f7f9fc);
}
.alert-config-summary span {
  color: var(--hs-muted);
  font-size: 12px;
}
.inventory-org-scope {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--hs-border);
  background: linear-gradient(90deg, #f6f9ff 0%, #fbfcff 100%);
}
.inventory-org-scope__intro {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.inventory-org-scope__intro strong {
  color: #26334d;
  font-size: 13px;
}
.inventory-org-scope__intro span {
  color: var(--hs-muted);
  font-size: 11px;
}
.inventory-org-scope__select {
  width: 280px;
}
.inventory-org-empty {
  min-height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
}
.warehouse-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 14px 0;
  overflow-x: auto;
  border-bottom: 1px solid var(--hs-border);
  background: #fff;
}
.warehouse-tabs button {
  flex: none;
  padding: 10px 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #667085;
  cursor: pointer;
}
.warehouse-tabs button.active {
  border-bottom-color: var(--hs-primary);
  color: var(--hs-primary);
  font-weight: 600;
}
.warehouse-tabs span {
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 10px;
  background: #f0f2f6;
  font-size: 9px;
}
.recent-panel {
  margin-top: 14px;
}
.panel-title {
  padding: 13px 15px;
  border-bottom: 1px solid var(--hs-border);
  font-weight: 650;
}
.add-line {
  margin-top: 12px;
}
.load-hint {
  padding: 24px;
  border: 1px dashed #c9d2e3;
  background: #f8faff;
  color: #667085;
  text-align: center;
}
.generated-documents {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid #dbe5f4;
  border-radius: 6px;
  background: #f7faff;
  color: #526079;
}
.dialog-subtitle {
  margin: -7px 0 12px;
  color: var(--hs-muted);
}
.history-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.check-summary-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(160px, 1fr));
  border-bottom: 1px solid var(--hs-color-border);
  background: var(--hs-color-surface);
}

.check-summary-item {
  position: relative;
  min-height: 96px;
  padding: 16px 20px;
  border-right: 1px solid var(--hs-color-border);
}

.check-summary-item:last-child {
  border-right: 0;
}

.check-summary-item::before {
  content: '';
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 0;
  width: 3px;
  background: var(--hs-color-info);
}

.check-summary-item--processing::before {
  background: var(--hs-color-primary);
}
.check-summary-item--warning::before {
  background: var(--hs-color-warning);
}
.check-summary-item--danger::before {
  background: var(--hs-color-danger);
}

.check-summary-item span,
.check-summary-item small {
  display: block;
  color: var(--hs-color-text-secondary);
}

.check-summary-item span {
  font-size: 11px;
}

.check-summary-item strong {
  display: block;
  margin: 4px 0 2px;
  color: var(--hs-color-text-primary);
  font-size: 24px;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
}

.check-summary-item small {
  font-size: 10px;
}

.check-dialog-section {
  margin-bottom: var(--hs-space-5);
  padding: var(--hs-space-5);
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface-muted);
}

.check-dialog-section__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--hs-space-4);
  margin-bottom: var(--hs-space-4);
}

.check-dialog-section__heading strong,
.check-dialog-section__heading span {
  display: block;
}

.check-dialog-section__heading strong {
  margin-bottom: var(--hs-space-1);
  color: var(--hs-color-text-primary);
  font-size: 14px;
}

.check-dialog-section__heading span {
  color: var(--hs-color-text-secondary);
  font-size: 11px;
}

.check-master-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0 var(--hs-space-3);
}

.check-result-summary {
  display: grid;
  grid-template-columns: repeat(7, minmax(112px, 1fr));
  margin-bottom: var(--hs-space-5);
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface);
}

.check-result-summary > div {
  min-height: 78px;
  padding: 13px 16px;
  border-right: 1px solid var(--hs-color-border);
}

.check-result-summary > div:last-child {
  border-right: 0;
}

.check-result-summary span,
.check-result-summary small {
  display: block;
  color: var(--hs-color-text-secondary);
  font-size: 10px;
}

.check-result-summary strong {
  display: block;
  margin: 3px 0;
  color: var(--hs-color-text-primary);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}

.check-result-summary .is-danger strong {
  color: var(--hs-color-danger);
}
.check-result-summary .is-success strong {
  color: var(--hs-color-success);
}
.check-result-summary .is-warning strong {
  color: var(--hs-color-warning);
}
.difference-negative {
  color: var(--hs-color-danger);
  font-weight: 650;
}
.difference-positive {
  color: var(--hs-color-success);
  font-weight: 650;
}
.check-result-tags {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--hs-space-1);
}
.check-master-detail-layout {
  display: grid;
  grid-template-columns: minmax(288px, 28%) minmax(0, 1fr);
  gap: var(--hs-space-3);
  align-items: stretch;
}
.check-product-list-panel,
.check-batch-detail-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--hs-color-border);
  border-radius: var(--hs-radius-md);
  background: var(--hs-color-surface);
}
.check-panel-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--hs-space-3);
  min-height: 44px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--hs-color-border);
  background: var(--hs-color-surface-muted);
}
.check-panel-heading strong {
  min-width: 0;
  overflow: hidden;
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-section);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.check-panel-heading span {
  flex: none;
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-helper);
}
.check-product-cell {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.check-product-cell strong,
.check-product-cell span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.check-product-cell strong {
  color: var(--hs-color-text-primary);
  font-size: var(--hs-font-body);
}
.check-product-cell span {
  color: var(--hs-color-text-secondary);
  font-size: var(--hs-font-helper);
}

:deep(.inventory-check-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 48px);
  margin: 24px auto !important;
  overflow: hidden;
}

:deep(.inventory-check-dialog .el-dialog__header),
:deep(.inventory-check-dialog .el-dialog__footer) {
  flex: none;
}

:deep(.inventory-check-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--hs-color-background);
}

:deep(.inventory-check-dialog .el-dialog__footer) {
  border-top: 1px solid var(--hs-color-border);
  background: var(--hs-color-surface);
}

:deep(.detail-entry-table .el-input-number) {
  width: 100%;
}

:deep(.check-product-table .el-table__header-wrapper th) {
  background: var(--hs-color-surface-muted);
  color: var(--hs-color-text-primary);
  font-weight: 650;
}

:deep(.check-product-table .el-table__body td) {
  height: var(--hs-list-row-height);
}

:deep(.check-batch-table .el-table__header-wrapper th) {
  background: var(--hs-color-surface);
}

:deep(.check-batch-table .el-table__cell) {
  height: var(--hs-detail-row-height);
}

:deep(.check-batch-table .check-row-shortage) {
  --el-table-tr-bg-color: var(--el-color-danger-light-9);
}

:deep(.check-batch-table .check-row-overflow) {
  --el-table-tr-bg-color: var(--el-color-success-light-9);
}

:deep(.check-batch-table .check-row-damaged) {
  --el-table-tr-bg-color: var(--el-color-warning-light-9);
}

:deep(.check-batch-table .el-table__footer-wrapper td) {
  background: var(--hs-color-surface-muted);
  color: var(--hs-color-text-primary);
  font-weight: 650;
}

@media (max-width: 980px) {
  .check-summary-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .check-result-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .check-summary-item:nth-child(2),
  .check-result-summary > div:nth-child(even) {
    border-right: 0;
  }

  .check-result-summary > div {
    border-bottom: 1px solid var(--hs-color-border);
  }

  .check-result-summary > div:last-child {
    border-bottom: 0;
  }

  .check-master-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 680px) {
  .inventory-org-scope {
    align-items: stretch;
    flex-direction: column;
  }

  .inventory-org-scope__select {
    width: 100%;
  }

  .check-summary-strip,
  .check-result-summary,
  .check-master-grid,
  .master-grid--two {
    grid-template-columns: 1fr;
  }

  .check-summary-item,
  .check-result-summary > div {
    border-right: 0;
    border-bottom: 1px solid var(--hs-color-border);
  }

  .check-summary-item:last-child,
  .check-result-summary > div:last-child {
    border-bottom: 0;
  }
}
</style>
