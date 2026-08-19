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
    { prop: 'orderNo', label: '采购订单', minWidth: 155 },
    { prop: 'vendorName', label: '供应商', minWidth: 160 },
    { prop: 'paymentAmount', label: '付款金额', minWidth: 110, kind: 'money' },
    { prop: 'paymentDate', label: '付款日期', minWidth: 110, kind: 'date' },
    { prop: 'orderPayable', label: '订单应付', minWidth: 110, kind: 'money' },
    { prop: 'orderPaid', label: '已付金额', minWidth: 110, kind: 'money' },
    { prop: 'orderRemaining', label: '剩余应付', minWidth: 110, kind: 'money' },
    { prop: 'paymentChannel', label: '付款渠道', minWidth: 105 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['payment_channel'],
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
      show: (row) => Number(row.netPaid ?? 0) <= Number(row.effectivePayable ?? 0),
      confirm: '撤销后将从累计已付中回退，是否继续？',
      handler: async (row) => {
        const result: any = await api.delete(`/purchase/payments/${row.id}`);
        ElMessage.success(result?.message ?? '付款已撤销');
      },
    },
  ],
};
