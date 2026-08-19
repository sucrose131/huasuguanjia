import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import SalesRefundForm from '../forms/SalesRefundForm.vue';

export const salesRefundConfig: BusinessDocumentConfig = {
  key: 'sales/refunds',
  title: '销售退款',
  endpoint: '/sales/refunds',
  no: 'paymentNo',
  columns: [
    { prop: 'paymentNo', label: '退款单号', minWidth: 160 },
    { prop: 'orderNo', label: '销售订单', minWidth: 155 },
    { prop: 'customerName', label: '客户', minWidth: 130 },
    { prop: 'receivedAmount', label: '累计收款', minWidth: 120, kind: 'money', align: 'right' },
    { prop: 'refundedAmount', label: '累计退款', minWidth: 120, kind: 'money', align: 'right' },
    { prop: 'netAmount', label: '净收款', minWidth: 120, kind: 'money', align: 'right' },
    { prop: 'availableAmount', label: '可退金额', minWidth: 120, kind: 'money', align: 'right' },
    { prop: 'amount', label: '本次退款', minWidth: 120, kind: 'money', align: 'right' },
    { prop: 'paymentModeName', label: '退款方式', minWidth: 105, kind: 'status' },
    { prop: 'paymentDate', label: '退款日期', minWidth: 110, kind: 'date' },
    { prop: 'remark', label: '退款原因', minWidth: 160 },
    { prop: 'orgName', label: '组织', minWidth: 125 },
    { prop: 'deptName', label: '部门', minWidth: 125 },
    { prop: 'createdByName', label: '操作人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['payment_channel', 'sales_payment_type'],
  summary: true,
  summaryLabels: [
    { label: '本期退款', key: 'periodAmount', kind: 'money' },
    { label: '累计收款', key: 'receivedAmount', kind: 'money' },
    { label: '累计退款', key: 'refundedAmount', kind: 'money' },
  ],
  creatable: true,
  createText: '登记退款',
  formComponent: SalesRefundForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/sales/refunds/${query.documentId}`);
      ctx.openView(detail);
    } else if (query.orderId) {
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
      confirm: '确认作废该退款记录？',
      handler: async (row) => {
        const result: any = await api.delete(`/sales/refunds/${row.id}`);
        ElMessage.success(result?.message ?? '已作废');
      },
    },
  ],
};
