import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';
import PurchaseOrderForm from '../forms/PurchaseOrderForm.vue';

const canEditAmount = () => useAuthStore().amountAccess.canEditAmount;

/**
 * 采购订单：共享引擎配置。
 *
 * 金额字段（totalAmount / payableAmount / paidAmount / remainingPayable）在无金额查看权限时
 * 由后端置为 null，引擎 money 列会自动展示「—」。
 */
export const purchaseOrderConfig: BusinessDocumentConfig = {
  key: 'purchase/orders',
  title: '采购订单',
  subtitle: '管理直接采购和采购申请转入订单',
  endpoint: '/purchase/orders',
  no: 'orderNo',
  columns: [
    { prop: 'orderNo', label: '订单编号', minWidth: 165 },
    {
      prop: 'applicationId',
      label: '数据来源',
      width: 112,
      render: (row) => (row.applicationId ? '采购申请转入' : '直接采购'),
    },
    {
      prop: 'vendorName',
      label: '供应商',
      minWidth: 176,
      render: (row, ctx) => row.vendorName || ctx.lookup('vendors', row.vendorId),
    },
    {
      prop: 'warehouseId',
      label: '仓库',
      minWidth: 160,
      render: (row, ctx) => ctx.lookup('warehouses', row.warehouseId),
    },
    {
      prop: 'planArrivalDate',
      label: '计划到货日',
      width: 112,
      render: (row) => (row.planArrivalDate ? String(row.planArrivalDate).slice(0, 10) : '—'),
    },
    {
      prop: 'pcsQty',
      label: '采购数量',
      width: 104,
      kind: 'number',
      render: (row) => String(row.pcsQty ?? row.quantity ?? 0),
    },
    {
      prop: 'totalAmount',
      label: '订单总金额',
      width: 120,
      kind: 'money',
      render: (row) => String(row.payableAmount ?? row.totalAmount ?? 0),
    },
    {
      prop: 'netPaidAmount',
      label: '净已付',
      width: 120,
      kind: 'money',
      render: (row) => String(row.netPaidAmount ?? 0),
    },
    {
      prop: 'remainingPayable',
      label: '待付款',
      width: 120,
      kind: 'money',
      render: (row) => String(row.remainingPayable ?? 0),
    },
    {
      prop: 'paymentProgressStatus',
      label: '付款进度',
      width: 104,
      render: (row, ctx) =>
        ctx.dictLabel('purchase_payment_progress_status', row.paymentProgressStatus),
    },
    {
      prop: 'arrivalProgress',
      label: '到货进度',
      width: 96,
      kind: 'progress',
    },
    {
      prop: 'orderStatus',
      label: '采购状态',
      width: 104,
      render: (row, ctx) => ctx.dictLabel('purchase_order_status', row.orderStatus),
    },
    {
      prop: 'createdBy',
      label: '创建人',
      width: 96,
      render: (row, ctx) => ctx.creator(row),
    },
  ],
  dictionaries: ['purchase_settlement_type', 'purchase_order_status', 'purchase_payment_progress_status'],
  optionBags: ['vendors', 'warehouses'],
  queryFields: [
    {
      key: 'vendorId',
      label: '供应商',
      type: 'select',
      optionBag: 'vendors',
      width: 200,
    },
    {
      key: 'orderStatus',
      label: '采购状态',
      type: 'select',
      dictionary: 'purchase_order_status',
      width: 140,
    },
  ],
  summaryLabels: [
    { label: '订单总数', key: 'total', kind: 'number' },
    { label: '待处理数', key: 'pending', kind: 'number' },
    { label: '已完成数', key: 'complete', kind: 'number' },
  ],
  creatable: true,
  createText: '新增直接采购订单',
  formComponent: PurchaseOrderForm,
  openFromRoute: async (query, ctx) => {
    if (query.applicationId) {
      ctx.openCreate({ applicationId: String(query.applicationId) });
      return;
    }
    const id = String(query.documentId ?? query.viewId ?? '');
    if (id) {
      const detail: any = await api.get(`/purchase/orders/${id}`);
      const viewOnly =
        String(query.view ?? '') === '1' || Boolean(query.viewId) || !canEditAmount();
      if (viewOnly) ctx.openView(detail);
      else ctx.openEdit(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => Number(row.orderStatus) === 1 && canEditAmount() && !row.applicationId,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'start',
      label: '开始采购',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.orderStatus) === 1,
      confirm: '开始采购后订单进入采购执行，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/purchase/orders/${row.id}/start`, {});
        ElMessage.success(result?.message ?? '采购订单已开始采购');
      },
    },
    {
      key: 'generate-receipt',
      label: '生成入库',
      kind: 'success',
      primary: false,
      show: (row) =>
        [2, 3].includes(Number(row.orderStatus)) && Number(row.isAllArrived) !== 1,
      confirm: '生成待入库单，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/purchase/orders/${row.id}/generate-receipt`, {});
        ElMessage.success(result?.message ?? '采购入库单已生成');
      },
    },
    {
      key: 'cancel-pending',
      label: '退回未到货',
      kind: 'warning',
      primary: false,
      show: (row) =>
        [2, 3].includes(Number(row.orderStatus)) &&
        Number(row.quantity) - Number(row.arrivedQuantity) - Number(row.cancelQty) > 0,
      confirm: '将未到货部分标记退回，是否继续？',
      handler: async (row) => {
        const detail: any = await api.get(`/purchase/orders/${row.id}`);
        const lines = (detail.details ?? [])
          .map((line: any) => ({
            goodsId: line.goodsId,
            skuId: line.skuId,
            cancelQuantity: Number(line.remainingQuantity ?? 0),
          }))
          .filter((line: any) => Number(line.cancelQuantity) > 0);
        if (!lines.length) {
          ElMessage.warning('该订单没有可退回的未到货数量');
          return;
        }
        const result: any = await api.post(`/purchase/orders/${row.id}/cancel-pending`, {
          reason: '采购订单未到货退回',
          details: lines,
        });
        ElMessage.success(result?.message ?? '未到货数量已退回');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.orderStatus) === 1,
      confirm: '确认删除该采购订单？',
      handler: async (row) => {
        await api.delete(`/purchase/orders/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
