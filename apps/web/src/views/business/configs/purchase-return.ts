import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import PurchaseReturnForm from '../forms/PurchaseReturnForm.vue';

export const purchaseReturnConfig: BusinessDocumentConfig = {
  key: 'purchase/returns',
  title: '采购退货记录',
  endpoint: '/purchase/returns',
  no: 'returnNo',
  columns: [
    { prop: 'returnNo', label: '退货单号', minWidth: 160 },
    { prop: 'orderNo', label: '采购订单', minWidth: 155 },
    { prop: 'sourceTypeLabel', label: '退货来源', minWidth: 110, kind: 'status' },
    { prop: 'reason', label: '原因', minWidth: 160 },
    { prop: 'returnDate', label: '退货日期', minWidth: 110, kind: 'date' },
    { prop: 'returnQty', label: '退货数量', minWidth: 100, kind: 'number' },
    { prop: 'approveStatus', label: '审批状态', minWidth: 105, kind: 'status' },
    { prop: 'createdBy', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['approval_status'],
  creatable: false,
  formComponent: PurchaseReturnForm,
  openFromRoute: async (query, ctx) => {
    if (query.returnReceiptId) {
      ctx.openCreate({ receiptId: String(query.returnReceiptId) });
    } else if (query.documentId) {
      const detail: any = await api.get(`/purchase/returns/${String(query.documentId)}`);
      ctx.openView(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => Number(row.approveStatus) === 0 && !row.autoCreated,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'submit',
      label: '提交',
      kind: 'success',
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 0,
      confirm: '提交后将进入审批流程，是否继续？',
      handler: async (row) => {
        await api.post(`/purchase/returns/${row.id}/submit`);
        ElMessage.success('已提交审批');
      },
    },
    {
      key: 'approve',
      label: '通过',
      kind: 'success',
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      confirm: '审批通过将立即扣减库存，是否继续？',
      handler: async (row) => {
        await api.post(`/purchase/returns/${row.id}/approve`, {
          approved: true,
          comment: '通过',
        });
        ElMessage.success('审批已通过');
      },
    },
    {
      key: 'reject',
      label: '驳回',
      kind: 'danger',
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      handler: async (row) => {
        const result = await ElMessageBox.prompt('请输入驳回原因', '驳回审批', {
          inputValidator: (value) => Boolean(String(value).trim()) || '驳回原因不能为空',
        });
        await api.post(`/purchase/returns/${row.id}/approve`, {
          approved: false,
          comment: result.value,
        });
        ElMessage.success('单据已驳回');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      show: (row) => Number(row.approveStatus) === 0,
      confirm: '确认删除该采购退货记录？',
      handler: async (row) => {
        await api.delete(`/purchase/returns/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
