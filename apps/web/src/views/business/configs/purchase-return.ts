import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import PurchaseReturnForm from '../forms/PurchaseReturnForm.vue';

export const purchaseReturnConfig: BusinessDocumentConfig = {
  key: 'purchase/returns',
  title: '采购退货记录',
  subtitle: '统一查看采购订单未到货退回及采购入库实物退货记录',
  endpoint: '/purchase/returns',
  no: 'returnNo',
  columns: [
    { prop: 'returnNo', label: '退货单号', minWidth: 160 },
    {
      prop: 'sourceTypeLabel',
      label: '退货来源',
      width: 120,
      render: (row) => row.sourceTypeLabel || (row.sourceType === 'receipt' ? '已入库退货' : '未入库退货'),
    },
    {
      prop: 'orderNo',
      label: '采购订单',
      minWidth: 160,
      render: (row) => row.orderNo || String(row.orderId ?? '—'),
    },
    {
      prop: 'receiptId',
      label: '来源入库单',
      minWidth: 160,
      render: (row) =>
        row.sourceType === 'receipt' ? (row.receiptNo ?? `GA${row.receiptId}`) : '—',
    },
    { prop: 'returnQty', label: '退货数量', width: 104, kind: 'number' },
    {
      prop: 'affectsInventory',
      label: '库存影响',
      width: 96,
      render: (row) => (row.affectsInventory ? '扣减库存' : '不影响库存'),
    },
    {
      prop: 'returnDate',
      label: '退货日期',
      width: 112,
      kind: 'date',
      render: (row) => String(row.returnDate ?? '').slice(0, 10),
    },
    {
      prop: 'approveStatus',
      label: '处理状态',
      width: 96,
      render: (row, ctx) => ctx.dictLabel('purchase_return_status', row.approveStatus),
    },
    {
      prop: 'createdBy',
      label: '创建人',
      width: 96,
      render: (row, ctx) => ctx.creator(row),
    },
  ],
  dictionaries: ['approval_status', 'purchase_return_status'],
  summaryLabels: [
    { label: '退货记录总数', key: 'total', kind: 'number' },
    { label: '待处理数', key: 'pending', kind: 'number' },
    { label: '已完成数', key: 'complete', kind: 'number' },
  ],
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
      primary: false,
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
      primary: false,
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
      primary: false,
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
      primary: false,
      show: (row) => Number(row.approveStatus) === 0,
      confirm: '确认删除该采购退货记录？',
      handler: async (row) => {
        await api.delete(`/purchase/returns/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
