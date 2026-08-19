import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import SalesDiscountOrderForm from '../forms/SalesDiscountOrderForm.vue';

type Row = Record<string, any>;

const hasSource = (row: Row) => Number(row.businessSourceId ?? row.business_source_id ?? 0) > 0;
const approveStatus = (row: Row) => Number(row.approveStatus ?? row.approve_status ?? 0);
const deliveryStatus = (row: Row) => Number(row.deliveryStatus ?? row.delivery_status ?? 0);
const orderStatus = (row: Row) => Number(row.orderStatus ?? row.order_status ?? 0);

/** 通过/驳回的展示条件：来源单按确认售出/未售出流转，普通单按审批流转 */
const canDispose = (row: Row) =>
  hasSource(row)
    ? approveStatus(row) !== 2 && deliveryStatus(row) !== 3
    : approveStatus(row) === 0 && orderStatus(row) === 1;

export const salesDiscountOrderConfig: BusinessDocumentConfig = {
  key: 'sales/discount-orders',
  title: '折价销售单',
  endpoint: '/sales/discount-orders',
  no: 'orderNo',
  columns: [
    { prop: 'orderNo', label: '折价销售单号', minWidth: 165 },
    { prop: 'businessSourceType', label: '来源类型', minWidth: 120, kind: 'status' },
    { prop: 'businessSourceNo', label: '来源单号', minWidth: 145 },
    { prop: 'customerName', label: '客户', minWidth: 130 },
    { prop: 'goodsNames', label: '商品名称', minWidth: 180 },
    { prop: 'warehouseName', label: '仓库', minWidth: 120 },
    { prop: 'orderDate', label: '订单日期', minWidth: 110, kind: 'date' },
    { prop: 'amount', label: '最终成交金额', minWidth: 120, kind: 'money' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'discountDisposalStatus', label: '处置状态', minWidth: 105, kind: 'status' },
  ],
  dictionaries: [
    'sales_order_source',
    'sales_order_status',
    'sales_discount_disposal_status',
    'sales_business_source_type',
  ],
  creatable: true,
  createText: '新增折价销售单',
  formComponent: SalesDiscountOrderForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      // controller 无 GET /sales/discount-orders/:id，详情复用 /sales/orders/:id
      const detail: any = await api.get(`/sales/orders/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => approveStatus(row) === 0,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'approve',
      label: (row) => (hasSource(row) ? '确认销售并出库' : '通过'),
      kind: 'success',
      show: canDispose,
      confirm: (row) =>
        hasSource(row)
          ? '确认销售并出库后，将按来源处置单的全部商品批次一次性扣减库存，不支持分批出库，是否继续？'
          : '审核通过后需要在销售出库单中选择批号并完成折价出库，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/sales/discount-orders/${row.id}/approve`, {
          approved: true,
          comment: hasSource(row) ? '确认销售并出库' : '通过',
        });
        ElMessage.success(result?.message ?? '操作成功');
      },
    },
    {
      key: 'reject',
      label: (row) => (hasSource(row) ? '确认未售出' : '驳回'),
      kind: 'danger',
      show: canDispose,
      confirm: (row) =>
        hasSource(row)
          ? '确认未售出后本单将关闭且不改变库存，是否继续？'
          : '驳回后本单将关闭，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/sales/discount-orders/${row.id}/approve`, {
          approved: false,
          comment: hasSource(row) ? '确认未售出' : '驳回',
        });
        ElMessage.success(result?.message ?? '操作成功');
      },
    },
    {
      key: 'create-output',
      label: '生成折价出库',
      kind: 'success',
      show: (row) => approveStatus(row) === 1 && !hasSource(row) && deliveryStatus(row) !== 3,
      handler: (row, ctx) =>
        ctx.navigate('/sales/outputs', { orderId: String(row.id) }),
    },
    {
      key: 'receive',
      label: '登记收款',
      kind: 'success',
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
      kind: 'warning',
      show: (row) => Number(row.netAmount ?? 0) > 0.000001,
      handler: (row, ctx) =>
        ctx.navigate('/sales/refunds', { create: '1', orderId: String(row.id) }),
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      show: (row) => !hasSource(row),
      confirm: '确认删除该折价销售单？',
      handler: async (row) => {
        const result: any = await api.delete(`/sales/discount-orders/${row.id}`);
        ElMessage.success(result?.message ?? '删除成功');
      },
    },
  ],
};
