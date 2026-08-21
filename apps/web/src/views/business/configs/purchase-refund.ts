import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import PurchaseRefundForm from '../forms/PurchaseRefundForm.vue';

export const purchaseRefundConfig: BusinessDocumentConfig = {
  key: 'purchase/refunds',
  title: '采购退款',
  subtitle: '采购退货形成实际应退金额后自动生成，支持分次退款与流水追溯',
  endpoint: '/purchase/refunds',
  documentType: 'purchase_refund',
  no: 'refundNo',
  columns: [
    { prop: 'refundNo', label: '退款单号', minWidth: 160 },
    { prop: 'returnNo', label: '来源退货单', minWidth: 160, tooltip: true },
    {
      prop: 'sourceType',
      label: '退款来源',
      width: 136,
      kind: 'status',
      statusDict: 'purchase_refund_source',
    },
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
      prop: 'returnAmount',
      label: '退货金额',
      width: 120,
      kind: 'money',
      align: 'right',
      render: (row) => String(row.returnAmount ?? 0),
    },
    {
      prop: 'refundableAmount',
      label: '应退金额',
      width: 120,
      kind: 'money',
      align: 'right',
      render: (row) => String(row.refundableAmount ?? 0),
    },
    {
      prop: 'refundedAmount',
      label: '已退金额',
      width: 120,
      kind: 'money',
      align: 'right',
      render: (row) => String(row.refundedAmount ?? 0),
    },
    {
      prop: 'remainingAmount',
      label: '待退金额',
      width: 120,
      kind: 'money',
      align: 'right',
      render: (row) => String(row.remainingAmount ?? 0),
    },
    {
      prop: 'refundStatus',
      label: '退款状态',
      width: 112,
      kind: 'status',
      statusDict: 'purchase_refund_status',
    },
    {
      prop: 'createdAt',
      label: '创建时间',
      width: 160,
      kind: 'datetime',
      render: (row) => String(row.createdAt ?? '').replace('T', ' ').slice(0, 16),
    },
  ],
  dictionaries: ['purchase_refund_status', 'purchase_refund_source'],
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
    { key: 'vendorId', label: '供应商', type: 'select', optionBag: 'vendors', width: 200 },
    {
      key: 'sourceType',
      label: '退款来源',
      type: 'select',
      dictionary: 'purchase_refund_source',
      width: 140,
    },
  ],
  summaryLabels: [
    { label: '退款任务总数', key: 'total', kind: 'number' },
    { label: '本页待退金额', key: 'pendingAmount', kind: 'money' },
    { label: '本页已退金额', key: 'refundedAmount', kind: 'money' },
  ],
  summary: true,
  creatable: false,
  formComponent: PurchaseRefundForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) ctx.openView({ id: String(query.documentId) });
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'record',
      label: '登记退款',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.remainingAmount ?? 0) > 0,
      handler: (row, ctx) => ctx.openView(row),
    },
    {
      key: 'close',
      label: '关闭退款任务',
      kind: 'warning',
      primary: false,
      show: (row) => Number(row.remainingAmount ?? 0) > 0,
      confirm: '关闭后该退款任务结束，是否继续？',
      handler: async (row) => {
        const result = await ElMessageBox.prompt('请输入关闭原因', '关闭采购退款任务', {
          inputValidator: (value) => !!String(value).trim() || '关闭原因不能为空',
          confirmButtonText: '确认关闭',
          cancelButtonText: '取消',
        });
        const response: any = await api.post(`/purchase/refunds/${row.id}/close`, {
          reason: result.value,
        });
        ElMessage.success(response?.message ?? '退款任务已关闭');
      },
    },
  ],
};
