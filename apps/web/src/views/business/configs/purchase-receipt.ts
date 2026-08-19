import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import PurchaseReceiptForm from '../forms/PurchaseReceiptForm.vue';

export const purchaseReceiptConfig: BusinessDocumentConfig = {
  key: 'purchase/receipts',
  title: '采购入库单',
  subtitle: '按采购订单生成待入库单，补充库位与批次后执行库存过账',
  endpoint: '/purchase/receipts',
  no: 'receiptNo',
  columns: [
    { prop: 'receiptNo', label: '入库单号', minWidth: 160 },
    { prop: 'orderNo', label: '来源订单', minWidth: 155 },
    { prop: 'applicationNo', label: '来源申请', minWidth: 155 },
    { prop: 'warehouseId', label: '仓库', minWidth: 100 },
    { prop: 'inputType', label: '入库类型', minWidth: 100 },
    { prop: 'orderQuantity', label: '订单数量', minWidth: 100, kind: 'number' },
    { prop: 'inputQuantity', label: '入库数量', minWidth: 100, kind: 'number' },
    { prop: 'confirmStatus', label: '状态', minWidth: 100, kind: 'status' },
    { prop: 'remark', label: '备注', minWidth: 140 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['confirm_status'],
  creatable: true,
  createText: '新增采购入库单',
  formComponent: PurchaseReceiptForm,
  openFromRoute: async (query, ctx) => {
    if (query.orderId) {
      ctx.openCreate({ orderId: String(query.orderId) });
    } else if (query.receiptId) {
      const detail: any = await api.get(`/purchase/receipts/${String(query.receiptId)}`);
      ctx.openEdit(detail);
    } else if (query.documentId) {
      const detail: any = await api.get(`/purchase/receipts/${String(query.documentId)}`);
      ctx.openView(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: (row) => (Number(row.confirmStatus) === 0 ? '办理入库' : '查看'),
      show: (row) => Number(row.confirmStatus) === 0,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'confirm',
      label: '确认入库',
      kind: 'success',
      show: (row) => Number(row.confirmStatus) === 0,
      confirm: '确认后将按批次过账入库，是否继续？',
      handler: async (row) => {
        await api.post(`/purchase/receipts/${row.id}/confirm`, {
          confirmed: true,
          comment: '确认入库',
        });
        ElMessage.success('确认入库成功');
      },
    },
    {
      key: 'cancel',
      label: '撤销待入库',
      kind: 'warning',
      show: (row) => Number(row.confirmStatus) === 0,
      confirm: '撤销后草稿将失效，是否继续？',
      handler: async (row) => {
        await api.post(`/purchase/receipts/${row.id}/cancel`, { comment: '撤销待入库' });
        ElMessage.success('待入库单已撤销');
      },
    },
    {
      key: 'return',
      label: '退货',
      kind: 'warning',
      show: (row) => Number(row.confirmStatus) === 1,
      confirm: '从该入库单发起退货，是否继续？',
      handler: (row, ctx) =>
        ctx.navigate('/purchase/returns', { returnReceiptId: String(row.id) }),
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      show: (row) => Number(row.confirmStatus) === 0,
      confirm: '确认删除该采购入库单？',
      handler: async (row) => {
        await api.delete(`/purchase/receipts/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
