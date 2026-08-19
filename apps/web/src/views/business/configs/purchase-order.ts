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
  endpoint: '/purchase/orders',
  no: 'orderNo',
  columns: [
    { prop: 'orderNo', label: '订单号', minWidth: 165 },
    { prop: 'vendorName', label: '供应商', minWidth: 150 },
    { prop: 'quantity', label: '采购数量', minWidth: 105, kind: 'number' },
    { prop: 'arrivedQuantity', label: '已到货', minWidth: 105, kind: 'number' },
    { prop: 'arrivalProgress', label: '到货进度', minWidth: 125, kind: 'progress' },
    { prop: 'totalAmount', label: '订单金额', minWidth: 120, kind: 'money' },
    { prop: 'payableAmount', label: '应付金额', minWidth: 120, kind: 'money' },
    { prop: 'paidAmount', label: '已付金额', minWidth: 120, kind: 'money' },
    { prop: 'remainingPayable', label: '剩余应付', minWidth: 120, kind: 'money' },
    { prop: 'orderStatus', label: '订单状态', minWidth: 105, kind: 'status' },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['purchase_settlement_type', 'purchase_order_status'],
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
      show: (row) => Number(row.orderStatus) === 1,
      confirm: '确认删除该采购订单？',
      handler: async (row) => {
        await api.delete(`/purchase/orders/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
