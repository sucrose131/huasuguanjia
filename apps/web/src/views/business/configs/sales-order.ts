import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import SalesOrderForm from '../forms/SalesOrderForm.vue';

export const salesOrderConfig: BusinessDocumentConfig = {
  key: 'sales/orders',
  title: '销售订单',
  endpoint: '/sales/orders',
  documentType: 'sales_order',
  no: 'orderNo',
  columns: [
    { prop: 'orderNo', label: '订单号', minWidth: 155, tooltip: true },
    { prop: 'customerName', label: '客户', minWidth: 130 },
    { prop: 'goodsNames', label: '商品名称', minWidth: 180, tooltip: true },
    { prop: 'sourceTypeName', label: '订单来源', minWidth: 105, kind: 'status' },
    { prop: 'propertyTypeName', label: '订单属性', minWidth: 105, kind: 'status' },
    { prop: 'orderDate', label: '订单日期', minWidth: 110, kind: 'date' },
    { prop: 'quantity', label: '订单数量', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'orderAmount', label: '订单金额', minWidth: 110, kind: 'money', align: 'right' },
    { prop: 'amount', label: '实际金额', minWidth: 110, kind: 'money', align: 'right' },
    { prop: 'receivedAmount', label: '累计收款', minWidth: 110, kind: 'money', align: 'right' },
    { prop: 'refundedAmount', label: '累计退款', minWidth: 110, kind: 'money', align: 'right' },
    { prop: 'netAmount', label: '净收款', minWidth: 110, kind: 'money', align: 'right' },
    { prop: 'paymentStatus', label: '收款状态', minWidth: 100 },
    { prop: 'deliveryProgress', label: '发货进度', minWidth: 110, kind: 'progress' },
    { prop: 'serviceStatusName', label: '售后状态', minWidth: 105, kind: 'status' },
    { prop: 'orderStatusName', label: '订单状态', minWidth: 105, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: [
    'sales_order_type',
    'sales_order_source',
    'sales_order_property',
    'sales_order_status',
    'sales_delivery_status',
    'sales_service_status',
  ],
  creatable: true,
  createText: '新增销售订单',
  formComponent: SalesOrderForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/sales/orders/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    } else if (String(query.create ?? '') === '1' && query.orderId) {
      ctx.openCreate({ orderId: String(query.orderId) });
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      primary: false,
      show: (row) =>
        !['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'].includes(String(row.oaStatus ?? '')) &&
        Number(row.confirmStatus ?? row.comfirm_status) !== 1 &&
        Number(row.approveStatus ?? row.approve_status) !== 1,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'analyze',
      label: '缺口分析',
      primary: false,
      show: (row) => Number(row.propertyType) === 1 && Number(row.orderStatus) === 1,
      confirm: '按未分配/未计划数量生成生产计划缺口，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/sales/orders/${row.id}/analyze`, {});
        ElMessage.success(result?.message ?? '缺口分析完成');
      },
    },
    {
      key: 'direct-output',
      label: '直接出库',
      permission: 'sales:outputs:create',
      show: (row) =>
        Number(row.orderType) !== 4 &&
        Number(row.deliveryQty ?? 0) + 0.000001 < Number(row.quantity ?? 0) &&
        Number(row.orderStatus ?? 0) !== 3,
      handler: (row, ctx) =>
        ctx.navigate('/sales/outputs', { orderId: String(row.id) }),
    },
    {
      key: 'receive',
      label: '登记收款',
      permission: 'sales:payments:create',
      kind: 'success',
      primary: false,
      show: (row) =>
        Math.max(
          0,
          Number(row.amount ?? 0) -
            (Number(row.receivedAmount ?? 0) - Number(row.refundedAmount ?? 0)),
        ) > 0.000001,
      handler: (row, ctx) =>
        ctx.navigate('/sales/payments', { create: '1', orderId: String(row.id) }),
    },
    {
      key: 'refund',
      label: '登记退款',
      permission: 'sales:refunds:create',
      kind: 'warning',
      primary: false,
      show: (row) =>
        Number(row.receivedAmount ?? 0) - Number(row.refundedAmount ?? 0) > 0.000001,
      handler: (row, ctx) =>
        ctx.navigate('/sales/refunds', { create: '1', orderId: String(row.id) }),
    },
    {
      key: 'return',
      label: '发起退货',
      permission: 'sales:returns:create',
      primary: false,
      show: (row) => Number(row.deliveryQty ?? 0) > 0.000001,
      handler: (row, ctx) =>
        ctx.navigate('/sales/returns', { create: '1', orderId: String(row.id) }),
    },
    {
      key: 'service',
      label: '登记售后',
      permission: 'sales:services:create',
      primary: false,
      show: (row) => Number(row.deliveryQty ?? 0) > 0.000001,
      handler: (row, ctx) =>
        ctx.navigate('/sales/services', { create: '1', orderId: String(row.id) }),
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      confirm: '确认删除该销售订单？',
      handler: async (row) => {
        const result: any = await api.delete(`/sales/orders/${row.id}`);
        ElMessage.success(result?.message ?? '删除成功');
      },
    },
  ],
};
