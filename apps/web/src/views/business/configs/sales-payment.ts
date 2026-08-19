import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import SalesPaymentForm from '../forms/SalesPaymentForm.vue';

export const salesPaymentConfig: BusinessDocumentConfig = {
  key: 'sales/payments',
  title: '销售收款',
  endpoint: '/sales/payments',
  no: 'paymentNo',
  columns: [
    { prop: 'paymentNo', label: '收款单号', minWidth: 160 },
    { prop: 'orderNo', label: '销售订单', minWidth: 155 },
    { prop: 'customerName', label: '客户', minWidth: 130 },
    { prop: 'orderActualAmount', label: '订单实际金额', minWidth: 120, kind: 'money' },
    { prop: 'receivedAmount', label: '累计收款', minWidth: 120, kind: 'money' },
    { prop: 'refundedAmount', label: '累计退款', minWidth: 120, kind: 'money' },
    { prop: 'availableAmount', label: '未收金额', minWidth: 120, kind: 'money' },
    { prop: 'amount', label: '本次收款', minWidth: 120, kind: 'money' },
    { prop: 'paymentModeName', label: '付款方式', minWidth: 105, kind: 'status' },
    { prop: 'paymentDate', label: '收款日期', minWidth: 110, kind: 'date' },
    { prop: 'orgName', label: '组织', minWidth: 125 },
    { prop: 'deptName', label: '部门', minWidth: 125 },
    { prop: 'createdByName', label: '操作人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['payment_channel', 'sales_payment_type'],
  summary: true,
  summaryLabels: [
    { label: '本期金额', key: 'periodAmount', kind: 'money' },
    { label: '累计收款', key: 'receivedAmount', kind: 'money' },
    { label: '累计退款', key: 'refundedAmount', kind: 'money' },
  ],
  creatable: true,
  createText: '登记收款',
  formComponent: SalesPaymentForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/sales/payments/${query.documentId}`);
      ctx.openView(detail);
    } else if (String(query.create ?? '') === '1' && query.orderId) {
      ctx.openCreate({ orderId: String(query.orderId) });
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'void',
      label: '作废',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.amount) > 0,
      confirm: '确认作废该收款记录？',
      handler: async (row) => {
        const result: any = await api.delete(`/sales/payments/${row.id}`);
        ElMessage.success(result?.message ?? '已作废');
      },
    },
  ],
};
