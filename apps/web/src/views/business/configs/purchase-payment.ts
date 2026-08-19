import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import PurchasePaymentForm from '../forms/PurchasePaymentForm.vue';

export const purchasePaymentConfig: BusinessDocumentConfig = {
  key: 'purchase/payments',
  title: '采购付款',
  subtitle: '归集采购订单发起的付款流水并自动重算累计已付',
  endpoint: '/purchase/payments',
  no: 'paymentNo',
  columns: [
    { prop: 'paymentNo', label: '付款单号', minWidth: 160 },
    {
      prop: 'orderNo',
      label: '采购订单',
      minWidth: 160,
      render: (row) => row.orderNo || String(row.orderId ?? '—'),
    },
    {
      prop: 'vendorName',
      label: '供应商',
      minWidth: 176,
      render: (row, ctx) => row.vendorName || ctx.lookup('vendors', row.vendorId),
    },
    {
      prop: 'orderPayable',
      label: '订单应付',
      width: 120,
      kind: 'money',
      render: (row) => String(row.orderPayable ?? 0),
    },
    {
      prop: 'effectivePayable',
      label: '退货后应付',
      width: 120,
      kind: 'money',
      render: (row) => String(row.effectivePayable ?? row.orderPayable ?? 0),
    },
    {
      prop: 'orderPaid',
      label: '累计已付',
      width: 120,
      kind: 'money',
      render: (row) => String(row.orderPaid ?? 0),
    },
    {
      prop: 'orderRefunded',
      label: '累计已退',
      width: 120,
      kind: 'money',
      render: (row) => String(row.orderRefunded ?? 0),
    },
    {
      prop: 'netPaid',
      label: '净已付',
      width: 120,
      kind: 'money',
      render: (row) => String(row.netPaid ?? 0),
    },
    {
      prop: 'orderRemaining',
      label: '剩余应付',
      width: 120,
      kind: 'money',
      render: (row) => String(row.orderRemaining ?? 0),
    },
    {
      prop: 'paymentAmount',
      label: '本次付款',
      width: 120,
      kind: 'money',
      render: (row) => String(row.paymentAmount ?? 0),
    },
    {
      prop: 'paymentChannel',
      label: '付款渠道',
      width: 112,
      render: (row, ctx) => ctx.dictLabel('payment_channel', row.paymentChannel),
    },
    {
      prop: 'paymentDate',
      label: '付款日期',
      width: 112,
      kind: 'date',
      render: (row) => String(row.paymentDate ?? '').slice(0, 10),
    },
    {
      prop: 'createdBy',
      label: '付款人',
      width: 96,
      render: (row, ctx) => ctx.creator(row),
    },
  ],
  dictionaries: ['payment_channel'],
  optionBags: ['vendors'],
  queryFields: [
    {
      key: 'orderId',
      label: '关联采购订单',
      type: 'remote-select',
      width: 220,
      fetch: async (keyword: string) => {
        const r: any = await api.get('/purchase/orders', {
          params: { keyword, pageSize: 50 },
        });
        return (r.items ?? []).map((x: any) => ({
          value: x.id,
          label: `${x.orderNo ?? ''} · ${x.vendorName ?? ''}`.trim(),
        }));
      },
      currentLabel: (value: unknown) =>
        value == null || value === '' ? '' : `#${String(value)}`,
    },
  ],
  summaryLabels: [
    { label: '付款记录总数', key: 'total', kind: 'number' },
    { label: '本页付款金额', key: 'paymentAmount', kind: 'money' },
    { label: '关联订单数', key: 'orderCount', kind: 'number' },
  ],
  creatable: true,
  createText: '登记付款',
  formComponent: PurchasePaymentForm,
  openFromRoute: async (query, ctx) => {
    if (String(query.create ?? '') === '1' && query.orderId) {
      ctx.openCreate({ orderId: String(query.orderId) });
    } else if (query.documentId) {
      ctx.openView({ id: String(query.documentId) });
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'remove',
      label: '撤销',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.netPaid ?? 0) <= Number(row.effectivePayable ?? 0),
      confirm: '撤销后将从累计已付中回退，是否继续？',
      handler: async (row) => {
        const result: any = await api.delete(`/purchase/payments/${row.id}`);
        ElMessage.success(result?.message ?? '付款已撤销');
      },
    },
  ],
};
