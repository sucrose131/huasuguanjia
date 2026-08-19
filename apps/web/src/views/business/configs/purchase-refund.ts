import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import PurchaseRefundForm from '../forms/PurchaseRefundForm.vue';

export const purchaseRefundConfig: BusinessDocumentConfig = {
  key: 'purchase/refunds',
  title: '采购退款',
  endpoint: '/purchase/refunds',
  no: 'refundNo',
  columns: [
    { prop: 'refundNo', label: '退款单号', minWidth: 160 },
    { prop: 'orderNo', label: '采购订单', minWidth: 155 },
    { prop: 'returnNo', label: '来源退货单', minWidth: 155 },
    { prop: 'vendorName', label: '供应商', minWidth: 160 },
    { prop: 'returnAmount', label: '应退金额', minWidth: 110, kind: 'money' },
    { prop: 'refundableAmount', label: '可退金额', minWidth: 110, kind: 'money' },
    { prop: 'refundedAmount', label: '已退金额', minWidth: 110, kind: 'money' },
    { prop: 'remainingAmount', label: '待退金额', minWidth: 110, kind: 'money' },
    { prop: 'refundStatus', label: '退款状态', minWidth: 105, kind: 'status' },
    { prop: 'returnDate', label: '退货日期', minWidth: 110, kind: 'date' },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['purchase_refund_status'],
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
      show: (row) => Number(row.remainingAmount ?? 0) > 0,
      handler: (row, ctx) => ctx.openView(row),
    },
    {
      key: 'close',
      label: '关闭退款任务',
      kind: 'warning',
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
