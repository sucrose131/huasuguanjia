<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Download, Refresh, Warning } from '@element-plus/icons-vue';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';

type Kind = 'text' | 'money' | 'number';
type Column = { key: string; label: string; kind?: Kind; min?: number };
type Report = {
  title: string;
  columns: Column[];
  source: string;
  period?: boolean;
  aggregate?: boolean;
  amountKey?: string;
  load: () => Promise<any[]>;
};
type Row = Record<string, any>;

const route = useRoute();
const auth = useAuthStore();
const key = computed(() => String(route.params.report));
const loading = ref(false);
const error = ref('');
const rows = ref<Row[]>([]);
const query = reactive({ startDate: '', endDate: '' });
const cache = new Map<string, Row[]>();
const dictionaryCache = new Map<string, Array<{ value: string | number; label: string }>>();

async function dictionary(code: string) {
  if (!dictionaryCache.has(code))
    dictionaryCache.set(
      code,
      (await api.get(`/dictionaries/${code}`)) as Array<{ value: string | number; label: string }>,
    );
  return dictionaryCache.get(code)!;
}
const dictionaryLabel = (items: Array<{ value: string | number; label: string }>, value: unknown) =>
  items.find((item) => String(item.value) === String(value))?.label ?? '';

const first = (row: Row, ...keys: string[]) => {
  for (const item of keys)
    if (row[item] !== null && row[item] !== undefined && row[item] !== '') return row[item];
  return '';
};
const date = (row: Row) =>
  String(
    first(
      row,
      'date',
      'docDate',
      'orderDate',
      'planDate',
      'inputDate',
      'outDate',
      'returnDate',
      'paymentDate',
      'checkDate',
      'createdAt',
      'created_at',
    ),
  ).slice(0, 10);
const actor = (row: Row) =>
  first(row, 'createdByName', 'updatedByName', 'creator', 'createdBy', 'created_by');
const status = (row: Row) =>
  first(
    row,
    'statusName',
    'orderStatusName',
    'approveStatusName',
    'confirmStatusName',
    'status',
    'orderStatus',
    'approveStatus',
    'confirmStatus',
  );
const num = (value: any) =>
  value === '' || value === null || value === undefined ? null : Number(value);
const money = (value: any) => {
  // 金额无查看权：统一掩码（保留旧版纯 **** 展示）
  if (!auth.amountAccess.canViewAmount) return '****';
  // 后端对 own 范围脱敏后金额为 null：显示掩码，避免被兜成 ¥0 误导为真实金额为 0
  if (value === '' || value === null || value === undefined)
    return (auth.amountAccess.amountScope ?? 'all') === 'own' ? '¥ ****' : '';
  return `¥${Math.round(Number(value) || 0).toLocaleString('zh-CN')}`;
};
const c = (key: string, label: string, min = 110, kind: Kind = 'text'): Column => ({
  key,
  label,
  min,
  kind,
});
const inPeriod = (row: Row) => {
  const value = date(row);
  return !!value && value >= query.startDate && value <= query.endDate;
};

async function fetchAll(url: string, params: Row = {}) {
  if (cache.has(`${url}:${JSON.stringify(params)}`))
    return cache.get(`${url}:${JSON.stringify(params)}`)!;
  let page = 1;
  let result: Row[] = [];
  while (page <= 100) {
    const response = (await api.get(url, { params: { ...params, page, pageSize: 100 } })) as any;
    if (Array.isArray(response)) {
      result = response;
      break;
    }
    const items = response?.items ?? response?.list ?? response?.rows ?? response?.data ?? [];
    result.push(...items);
    const total = Number(response?.total ?? result.length);
    if (!items.length || result.length >= total) break;
    page += 1;
  }
  cache.set(`${url}:${JSON.stringify(params)}`, result);
  return result;
}

const loadProducts = () => fetchAll('/goods');
const loadVendors = () => fetchAll('/base-data/vendors');
const loadCustomers = () => fetchAll('/base-data/customers');
const loadPurchaseOrders = () => fetchAll('/purchase/orders');
const loadPlans = () => fetchAll('/production/plans');
const loadSales = () => fetchAll('/sales/orders', { propertyType: 1 });
const loadDiscounts = () => fetchAll('/sales/discount-orders');
const loadApplications = () => fetchAll('/requisitions/applications');
const loadReqOutputs = () => fetchAll('/requisitions/outputs');
const loadReqReturns = () => fetchAll('/requisitions/returns');
const loadReceipts = () => fetchAll('/purchase/receipts');
const loadProductionInputs = () => fetchAll('/production/inputs');
const loadSalesOutputs = () => fetchAll('/sales/outputs');
const loadProductionOutputs = () => fetchAll('/production/outputs');
const loadLosses = () => fetchAll('/inventory/losses');
const loadOverflows = () => fetchAll('/inventory/overflows');
const loadStocks = () => fetchAll('/inventory/stocks');
const loadChecks = () => fetchAll('/inventory/checks');
const loadPurchasePayments = () => fetchAll('/purchase/payments');

function group(values: Row[], keyOf: (row: Row) => string, amountOf?: (row: Row) => number | null) {
  const groups = new Map<string, Row>();
  values.forEach((item) => {
    const name = keyOf(item).trim();
    if (!name) return;
    const current = groups.get(name) ?? { group: name, count: 0, amount: amountOf ? 0 : '' };
    current.count += 1;
    const amount = amountOf?.(item);
    if (amount !== null && amount !== undefined && Number.isFinite(amount))
      current.amount = Number(current.amount || 0) + amount;
    groups.set(name, current);
  });
  return [...groups.values()];
}

const reports: Record<string, Report> = {
  products: {
    title: '商品资料查询表',
    source: 'GET /goods',
    period: false,
    columns: [
      c('code', '商品编码'),
      c('name', '商品名称', 150),
      c('spec', '规格型号', 140),
      c('status', '状态'),
      c('remark', '备注', 180),
    ],
    load: async () => {
      const statuses = await dictionary('enabled_status');
      return (await loadProducts()).map((row) => ({
        code: first(row, 'queryCode', 'productCode', 'goodsId', 'id'),
        name: first(row, 'goodsName', 'name'),
        spec: first(row, 'specModels', 'specification'),
        status: first(row, 'statusName') || dictionaryLabel(statuses, row.status),
        remark: row.remark,
      }));
    },
  },
  vendors: {
    title: '供应商资料查询表',
    source: 'GET /base-data/vendors',
    period: false,
    columns: [
      c('code', '编码'),
      c('vendor', '供应商', 180),
      c('contact', '联系人'),
      c('phone', '电话', 130),
    ],
    load: async () =>
      (await loadVendors()).map((row) => ({
        code: first(row, 'queryCode', 'code', 'id'),
        vendor: first(row, 'companyName', 'conpanyName', 'name'),
        contact: first(row, 'saleContact', 'contactName', 'contact'),
        phone: first(row, 'saleTel', 'mobile', 'phone'),
      })),
  },
  customers: {
    title: '客户资料查询表',
    source: 'GET /base-data/customers',
    period: false,
    columns: [
      c('code', '编码'),
      c('customer', '客户', 170),
      c('phone', '电话', 130),
      c('source', '来源'),
      c('status', '状态'),
    ],
    load: async () => {
      const [sources, statuses] = await Promise.all([
        dictionary('customer_source'),
        dictionary('enabled_status'),
      ]);
      return (await loadCustomers()).map((row) => ({
        code: first(row, 'code', 'id'),
        customer: row.name,
        phone: first(row, 'mobile', 'phone'),
        source: first(row, 'sourceTypeName') || dictionaryLabel(sources, row.sourceType),
        status: first(row, 'statusName') || dictionaryLabel(statuses, row.status),
      }));
    },
  },
  'purchase-detail': {
    title: '采购明细查询表',
    source: 'GET /purchase/orders',
    period: true,
    amountKey: 'amount',
    columns: [
      c('no', '单据编号', 150),
      c('type', '单据类型'),
      c('vendor', '供应商', 160),
      c('warehouse', '仓库', 140),
      c('date', '日期'),
      c('status', '状态'),
      c('amount', '金额', 120, 'money'),
      c('creator', '创建人'),
    ],
    load: async () =>
      (await loadPurchaseOrders()).map((row) => ({
        no: first(row, 'orderNo', 'docNo', 'id'),
        type: '采购订单',
        vendor: first(row, 'vendorName', 'counterparty'),
        warehouse: first(row, 'warehouseName', 'warehouse'),
        date: date(row),
        status: status(row),
        amount: num(first(row, 'totalAmount', 'payableAmount', 'amount')),
        creator: actor(row),
      })),
  },
  'purchase-summary': {
    title: '采购统计分析表',
    source: '采购订单列表本地聚合',
    period: true,
    aggregate: true,
    amountKey: 'amount',
    columns: [
      c('group', '供应商', 180),
      c('count', '单据数', 100, 'number'),
      c('amount', '金额合计', 130, 'money'),
    ],
    load: async () =>
      group(
        (await loadPurchaseOrders()).filter(inPeriod),
        (row) => String(first(row, 'vendorName', 'counterparty')),
        (row) => num(first(row, 'totalAmount', 'payableAmount', 'amount')),
      ),
  },
  'production-detail': {
    title: '生产明细查询表',
    source: 'GET /production/plans',
    period: true,
    columns: [
      c('no', '单据编号', 150),
      c('type', '单据类型'),
      c('product', '成品', 160),
      c('quantity', '计划数量', 110, 'number'),
      c('warehouse', '仓库', 140),
      c('date', '日期'),
      c('status', '状态'),
      c('creator', '创建人'),
    ],
    load: async () =>
      (await loadPlans()).map((row) => ({
        no: first(row, 'planNo', 'docNo', 'id'),
        type: '生产计划单',
        product: first(row, 'goodsName', 'productName', 'productionProductName'),
        quantity: num(first(row, 'planQty', 'quantity')),
        warehouse: first(row, 'warehouseName', 'warehouse'),
        date: date(row),
        status: status(row),
        creator: actor(row),
      })),
  },
  'production-summary': {
    title: '生产统计分析表',
    source: '生产计划列表本地聚合',
    period: true,
    aggregate: true,
    columns: [c('group', '状态', 150), c('count', '单据数', 100, 'number')],
    load: async () => group((await loadPlans()).filter(inPeriod), (row) => String(status(row))),
  },
  'sales-detail': {
    title: '销售明细查询表',
    source: '销售订单 + 折价销售单',
    period: true,
    amountKey: 'amount',
    columns: [
      c('no', '单据编号', 155),
      c('type', '单据类型'),
      c('customer', '客户', 150),
      c('property', '订单属性'),
      c('source', '订单来源'),
      c('date', '日期'),
      c('status', '状态'),
      c('amount', '金额', 120, 'money'),
      c('creator', '创建人'),
    ],
    load: async () => {
      const normal = (await loadSales()).map((row) => ({ ...row, reportType: '销售订单' }));
      const discounts = (await loadDiscounts()).map((row) => ({
        ...row,
        reportType: '折价销售单',
      }));
      return [...normal, ...discounts].map((row) => ({
        no: first(row, 'orderNo', 'docNo', 'id'),
        type: row.reportType,
        customer: first(row, 'customerName', 'counterparty'),
        property: first(row, 'propertyTypeName', 'orderProperty'),
        source: first(row, 'sourceTypeName', 'orderSource'),
        date: date(row),
        status: status(row),
        amount: num(first(row, 'amount', 'actualAmount')),
        creator: actor(row),
      }));
    },
  },
  'discount-detail': {
    title: '折价处理明细表',
    source: 'GET /sales/discount-orders',
    period: true,
    amountKey: 'actualAmount',
    columns: [
      c('no', '单据编号', 155),
      c('customer', '客户', 150),
      c('date', '日期'),
      c('status', '状态'),
      c('discountAmount', '折价金额', 120, 'money'),
      c('actualAmount', '实收金额', 120, 'money'),
      c('creator', '创建人'),
    ],
    load: async () =>
      (await loadDiscounts()).map((row) => ({
        no: first(row, 'orderNo', 'id'),
        customer: row.customerName,
        date: date(row),
        status: status(row),
        discountAmount: num(row.discountAmount),
        actualAmount: num(first(row, 'amount', 'actualAmount')),
        creator: actor(row),
      })),
  },
  'sales-summary': {
    title: '销售统计分析表',
    source: '销售订单列表本地聚合',
    period: true,
    aggregate: true,
    amountKey: 'amount',
    columns: [
      c('group', '客户', 180),
      c('count', '单据数', 100, 'number'),
      c('amount', '金额合计', 130, 'money'),
    ],
    load: async () => {
      const values = [...(await loadSales()), ...(await loadDiscounts())].filter(inPeriod);
      return group(
        values,
        (row) => String(first(row, 'customerName', 'counterparty')),
        (row) => num(first(row, 'amount', 'actualAmount')),
      );
    },
  },
  'requisition-detail': {
    title: '领用明细查询表',
    source: '领用申请 + 出库 + 退回',
    period: true,
    columns: [
      c('no', '单据编号', 155),
      c('type', '单据类型'),
      c('department', '领用部门', 140),
      c('applicant', '领用人'),
      c('warehouse', '仓库', 140),
      c('date', '日期'),
      c('status', '状态'),
    ],
    load: async () => {
      const values = [
        ...(await loadApplications()).map((row) => ({ ...row, type: '领用申请单' })),
        ...(await loadReqOutputs()).map((row) => ({ ...row, type: '领用出库单' })),
        ...(await loadReqReturns()).map((row) => ({ ...row, type: '领用退回单' })),
      ];
      return values.map((row) => ({
        no: first(row, 'applicationNo', 'outputNo', 'returnNo', 'id'),
        type: row.type,
        department: first(row, 'deptName', 'department'),
        applicant: first(row, 'receiverIdName', 'applicant', 'createdByName'),
        warehouse: first(row, 'warehouseName', 'warehouse'),
        date: date(row),
        status: status(row),
      }));
    },
  },
  'requisition-summary': {
    title: '领用统计分析表',
    source: '领用单据列表本地聚合',
    period: true,
    aggregate: true,
    columns: [c('group', '领用部门', 180), c('count', '单据数', 100, 'number')],
    load: async () => {
      const values = [
        ...(await loadApplications()),
        ...(await loadReqOutputs()),
        ...(await loadReqReturns()),
      ].filter(inPeriod);
      return group(values, (row) => String(first(row, 'deptName', 'department')));
    },
  },
  'inbound-detail': {
    title: '入库明细查询表',
    source: '采购入库 + 成品入库',
    period: true,
    columns: [
      c('no', '单据编号', 155),
      c('type', '单据类型'),
      c('counterparty', '往来单位', 150),
      c('warehouse', '仓库', 140),
      c('date', '日期'),
      c('status', '状态'),
      c('creator', '创建人'),
    ],
    load: async () =>
      [
        ...(await loadReceipts()).map((row) => ({ ...row, type: '采购入库单' })),
        ...(await loadProductionInputs()).map((row) => ({ ...row, type: '生产成品入库单' })),
      ].map((row) => ({
        no: first(row, 'receiptNo', 'inputNo', 'businessNo', 'id'),
        type: row.type,
        counterparty: first(row, 'vendorName', 'counterparty'),
        warehouse: first(row, 'warehouseName', 'warehouse'),
        date: date(row),
        status: status(row),
        creator: actor(row),
      })),
  },
  'outbound-detail': {
    title: '出库明细查询表',
    source: '销售出库 + 领用出库 + 生产出库',
    period: true,
    columns: [
      c('no', '单据编号', 155),
      c('type', '单据类型'),
      c('counterparty', '往来单位', 150),
      c('warehouse', '仓库', 140),
      c('date', '日期'),
      c('status', '状态'),
      c('creator', '创建人'),
    ],
    load: async () =>
      [
        ...(await loadSalesOutputs()).map((row) => ({ ...row, type: '销售出库单' })),
        ...(await loadReqOutputs()).map((row) => ({ ...row, type: '领用出库单' })),
        ...(await loadProductionOutputs()).map((row) => ({ ...row, type: '生产出库单' })),
      ].map((row) => ({
        no: first(row, 'businessNo', 'outputNo', 'outNo', 'id'),
        type: row.type,
        counterparty: first(row, 'customerName', 'deptName', 'counterparty'),
        warehouse: first(row, 'warehouseName', 'warehouse'),
        date: date(row),
        status: status(row),
        creator: actor(row),
      })),
  },
  'loss-detail': {
    title: '报损明细查询表',
    source: 'GET /inventory/losses',
    period: true,
    amountKey: 'amount',
    columns: [
      c('no', '单据编号', 155),
      c('organization', '组织', 150),
      c('department', '部门', 130),
      c('warehouse', '仓库', 140),
      c('date', '日期'),
      c('status', '状态'),
      c('amount', '金额', 120, 'money'),
      c('creator', '创建人'),
    ],
    load: async () =>
      (await loadLosses()).map((row) => ({
        no: first(row, 'businessNo', 'lossNo', 'docNo', 'id'),
        organization: first(row, 'orgName', 'organizationName'),
        department: first(row, 'deptName', 'department'),
        warehouse: first(row, 'warehouseName', 'warehouse'),
        date: date(row),
        status: status(row),
        amount: num(first(row, 'totalAmount', 'amount')),
        creator: actor(row),
      })),
  },
  'overflow-detail': {
    title: '报溢明细查询表',
    source: 'GET /inventory/overflows',
    period: true,
    amountKey: 'amount',
    columns: [
      c('no', '单据编号', 155),
      c('organization', '组织', 150),
      c('department', '部门', 130),
      c('warehouse', '仓库', 140),
      c('date', '日期'),
      c('status', '状态'),
      c('amount', '金额', 120, 'money'),
      c('creator', '创建人'),
    ],
    load: async () =>
      (await loadOverflows()).map((row) => ({
        no: first(row, 'businessNo', 'overflowNo', 'docNo', 'id'),
        organization: first(row, 'orgName', 'organizationName'),
        department: first(row, 'deptName', 'department'),
        warehouse: first(row, 'warehouseName', 'warehouse'),
        date: date(row),
        status: status(row),
        amount: num(first(row, 'totalAmount', 'amount')),
        creator: actor(row),
      })),
  },
  'inventory-summary': {
    title: '库存汇总统计分析表',
    source: 'GET /inventory/stocks 按仓聚合',
    period: false,
    amountKey: 'inventoryAmount',
    columns: [
      c('group', '仓库', 180),
      c('skuCount', 'SKU数', 100, 'number'),
      c('quantity', '库存数量', 120, 'number'),
      c('inventoryAmount', '库存金额', 130, 'money'),
    ],
    load: async () => {
      const values = await loadStocks();
      const groups = new Map<string, Row>();
      values.forEach((row) => {
        const name = String(first(row, 'warehouseName', 'warehouse')).trim();
        if (!name) return;
        const item = groups.get(name) ?? {
          group: name,
          skuCount: 0,
          quantity: 0,
          inventoryAmount: 0,
        };
        item.skuCount += 1;
        item.quantity += Number(first(row, 'inventoryQty', 'stock', 'quantity') || 0);
        item.inventoryAmount += Number(first(row, 'inventoryAmount', 'inventoryValue') || 0);
        groups.set(name, item);
      });
      return [...groups.values()];
    },
  },
  'check-summary': {
    title: '盘点汇总统计分析表',
    source: 'GET /inventory/checks',
    period: true,
    columns: [
      c('no', '盘点单号', 155),
      c('type', '盘点类型'),
      c('date', '盘点日期'),
      c('warehouse', '仓库', 140),
      c('quantity', '盘点件数', 110, 'number'),
      c('lossQty', '盘亏件数', 110, 'number'),
      c('overflowQty', '盘盈件数', 110, 'number'),
      c('status', '状态'),
      c('creator', '创建人'),
    ],
    load: async () =>
      (await loadChecks()).map((row) => ({
        no: first(row, 'checkNo', 'countNo', 'id'),
        type: first(row, 'checkTypeName', 'checkTypeLabel'),
        date: date(row),
        warehouse: first(row, 'warehouseName', 'warehouse'),
        quantity: num(first(row, 'allQty', 'quantity')),
        lossQty: num(first(row, 'lessQty', 'lossQty')),
        overflowQty: num(row.overflowQty),
        status: status(row),
        creator: actor(row),
      })),
  },
  'batch-inbound': {
    title: '分批入库查询表',
    source: 'GET /purchase/receipts',
    period: true,
    columns: [
      c('no', '入库单号', 155),
      c('order', '关联订单', 155),
      c('vendor', '供应商', 150),
      c('warehouse', '仓库', 140),
      c('quantity', '入库数量', 110, 'number'),
      c('orderQuantity', '订单数量', 110, 'number'),
      c('status', '状态'),
      c('date', '日期'),
      c('source', '来源'),
    ],
    load: async () =>
      (await loadReceipts()).map((row) => ({
        no: first(row, 'receiptNo', 'inputNo', 'businessNo', 'id'),
        order: first(row, 'orderNo', 'sourceDocumentNo', 'orderId', 'sourceDocumentId'),
        vendor: first(row, 'vendorName', 'counterparty'),
        warehouse: first(row, 'warehouseName', 'warehouse'),
        quantity: num(first(row, 'inputQuantity', 'inputQty', 'quantity', 'fulfilledQty')),
        orderQuantity: num(first(row, 'orderQuantity', 'poQty')),
        status: status(row),
        date: date(row),
        source: first(row, 'sourceType', 'source'),
      })),
  },
  'purchase-payment': {
    title: '采购付款查询表',
    source: 'GET /purchase/payments',
    period: true,
    amountKey: 'amount',
    columns: [
      c('no', '单据编号', 155),
      c('type', '单据类型'),
      c('vendor', '供应商', 160),
      c('date', '日期'),
      c('amount', '金额', 120, 'money'),
      c('creator', '创建人'),
    ],
    load: async () =>
      (await loadPurchasePayments()).map((row) => ({
        no: first(row, 'paymentNo', 'docNo', 'id'),
        type: '采购付款',
        vendor: first(row, 'vendorName', 'counterparty'),
        date: date(row),
        amount: num(first(row, 'amount', 'paymentAmount')),
        creator: actor(row),
      })),
  },
  'purchase-payable': {
    title: '应付账款统计表',
    source: '采购订单金额字段',
    period: true,
    amountKey: 'balance',
    columns: [
      c('no', '订单编号', 155),
      c('vendor', '供应商', 160),
      c('orderAmount', '订单金额', 120, 'money'),
      c('paidAmount', '已付金额', 120, 'money'),
      c('balance', '应付余额', 120, 'money'),
      c('status', '状态'),
      c('date', '日期'),
    ],
    load: async () =>
      (await loadPurchaseOrders()).map((row) => {
        const orderAmount = num(first(row, 'totalAmount', 'payableAmount', 'amount'));
        const paidAmount = num(first(row, 'paidAmount', 'payAmountDone')) ?? 0;
        return {
          no: first(row, 'orderNo', 'id'),
          vendor: first(row, 'vendorName', 'counterparty'),
          orderAmount,
          paidAmount,
          balance: orderAmount == null ? null : Math.max(orderAmount - paidAmount, 0),
          status: status(row),
          date: date(row),
        };
      }),
  },
};

const current = computed(() => reports[key.value] ?? reports.products!);
const visibleRows = computed(() =>
  current.value.period === false || current.value.aggregate
    ? rows.value
    : rows.value.filter((row) => {
        const value = String(row.date ?? '');
        return value && value >= query.startDate && value <= query.endDate;
      }),
);
const displayedRows = computed(() => visibleRows.value.slice(0, 200));
/** 合计是否包含服务端脱敏金额（null）：存在则合计不展示数字，避免「只算可见部分」误导 */
const amountMasked = computed(() => {
  if (!current.value.amountKey) return false;
  const restricted =
    !auth.amountAccess.canViewAmount || (auth.amountAccess.amountScope ?? 'all') === 'own';
  if (!restricted) return false;
  return visibleRows.value.some((row) => num(row[current.value.amountKey!]) == null);
});
const amountTotal = computed(() => {
  if (!current.value.amountKey || amountMasked.value) return null;
  return visibleRows.value.reduce((sum, row) => {
    const value = num(row[current.value.amountKey!]);
    return sum + (value == null || !Number.isFinite(value) ? 0 : value);
  }, 0);
});

function initializeDates() {
  const now = new Date();
  query.startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  query.endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    rows.value = await current.value.load();
  } catch (caught: any) {
    error.value = caught?.response?.data?.message ?? '报表加载失败';
    rows.value = [];
  } finally {
    loading.value = false;
  }
}
function cell(row: Row, column: Column) {
  const value = row[column.key];
  // money 列遇 null（服务端对 own 范围脱敏）交给 money 统一呈现掩码，避免空/0 误导
  if (value === null || value === undefined || value === '')
    return column.kind === 'money' ? money(null) : '';
  return column.kind === 'money' ? money(value) : String(value);
}
function exportReport() {
  const escape = (value: any) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const lines = [
    current.value.columns.map((column) => escape(column.label)).join(','),
    ...visibleRows.value.map((row) =>
      current.value.columns
        .map((column) =>
          escape(column.kind === 'money' ? (num(row[column.key]) ?? '') : row[column.key]),
        )
        .join(','),
    ),
  ];
  const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${current.value.title}_${query.startDate}_${query.endDate}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
watch(
  () => [query.startDate, query.endDate],
  () => {
    if (query.startDate && query.endDate && query.startDate > query.endDate)
      error.value = '开始日期不能晚于结束日期';
    else {
      if (error.value === '开始日期不能晚于结束日期') error.value = '';
      if (current.value.aggregate) load();
    }
  },
);
onMounted(() => {
  initializeDates();
  load();
});
</script>

<template>
  <section class="page report-page">
    <header class="page-head">
      <div>
        <h2>{{ current.title }}</h2>
        <p class="page-subtitle">按统一口径查看经营指标、趋势和业务明细。</p>
      </div>
      <div class="page-actions">
        <el-button
          type="primary"
          :icon="Download"
          :disabled="loading || !!error"
          @click="exportReport"
          >导出</el-button
        >
      </div>
    </header>
    <div class="report-filter">
      <div>
        <span>统计期间</span
        ><el-date-picker v-model="query.startDate" value-format="YYYY-MM-DD" /><b>至</b
        ><el-date-picker v-model="query.endDate" value-format="YYYY-MM-DD" />
      </div>
      <el-tag :type="visibleRows.length ? 'primary' : 'info'">{{
        visibleRows.length ? `${visibleRows.length} 条` : '无数据'
      }}</el-tag>
    </div>
    <div v-if="loading" class="report-state">
      <el-icon class="is-loading"><Refresh /></el-icon><strong>加载报表…</strong
      ><span>仅展示接口返回的真实数据</span>
    </div>
    <div v-else-if="error" class="report-state error">
      <el-icon><Warning /></el-icon><strong>报表加载失败</strong><span>{{ error }}</span>
    </div>
    <template v-else>
      <div v-if="visibleRows.length" class="report-metrics">
        <article>
          <span>记录数</span><strong>{{ visibleRows.length }}</strong
          ><small>{{ query.startDate }} ~ {{ query.endDate }}</small>
        </article>
        <article v-if="amountTotal !== null">
          <span>金额合计</span><strong>{{ money(amountTotal) }}</strong
          ><small>按当前报表业务金额口径</small>
        </article>
        <article v-else-if="amountMasked && current.amountKey">
          <span>金额合计</span><strong>¥ ****</strong
          ><small>报表含无权查看金额，合计不展示</small>
        </article>
        <article>
          <span>数据来源</span><strong>业务接口</strong><small>{{ current.source }}</small>
        </article>
      </div>
      <div class="panel">
        <div class="table-wrap">
          <el-table :data="displayedRows"
            ><el-table-column type="index" label="序号" width="65" /><el-table-column
              v-for="column in current.columns"
              :key="column.key"
              :label="column.label"
              :min-width="column.min"
              show-overflow-tooltip
              ><template #default="{ row }"
                ><span :class="{ money: column.kind === 'money' }">{{
                  cell(row, column)
                }}</span></template
              ></el-table-column
            ></el-table
          >
        </div>
        <footer class="table-footer">
          <span v-if="visibleRows.length"
            >共 {{ visibleRows.length }} 条真实数据 · 显示前 {{ displayedRows.length }} 条 ·
            {{ current.source }}</span
          ><span v-else>当前期间无数据，仅显示表头 · {{ current.source }}</span>
        </footer>
      </div>
    </template>
  </section>
</template>

<style scoped>
.report-filter {
  min-height: 70px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  margin-bottom: 14px;
  padding: 12px 17px;
  border: 1px solid var(--hs-border);
  border-radius: 6px;
  background: #fff;
}
.report-filter > div {
  display: flex;
  align-items: center;
  gap: 10px;
}
.report-filter span {
  color: #566173;
}
.report-filter b {
  color: #8a94a4;
  font-weight: 400;
}
.report-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 14px;
}
.report-metrics article {
  min-height: 92px;
  padding: 16px 18px;
  border: 1px solid var(--hs-border);
  border-radius: 6px;
  background: #fff;
}
.report-metrics span,
.report-metrics small {
  display: block;
  color: var(--hs-muted);
}
.report-metrics strong {
  display: block;
  margin: 7px 0 4px;
  font-size: 19px;
}
.report-state {
  min-height: 350px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  color: var(--hs-muted);
}
.report-state strong {
  color: #293244;
}
.table-wrap :deep(.el-table) {
  min-width: 900px;
}
@media (max-width: 1180px) {
  .report-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 820px) {
  .report-filter,
  .report-filter > div {
    align-items: stretch;
    flex-direction: column;
  }
  .report-filter :deep(.el-date-editor) {
    width: 100%;
  }
}
@media (max-width: 540px) {
  .report-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
