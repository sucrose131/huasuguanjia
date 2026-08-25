import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import PurchaseReceiptForm from '../forms/PurchaseReceiptForm.vue';

export const purchaseReceiptConfig: BusinessDocumentConfig = {
  key: 'purchase/receipts',
  title: '采购入库单',
  subtitle: '按采购订单或临时采购生成待入库单，补充库位与批次后执行库存过账',
  endpoint: '/purchase/receipts',
  documentType: 'purchase_receipt',
  no: 'receiptNo',
  columns: [
    { prop: 'receiptNo', label: '入库单号', minWidth: 160 },
    {
      prop: 'orderNo',
      label: '数据来源',
      minWidth: 160,
      render: (row) => row.orderNo || row.orderId || '—',
    },
    {
      prop: 'warehouseId',
      label: '仓库',
      minWidth: 160,
      render: (row, ctx) => ctx.lookup('warehouses', row.warehouseId),
    },
    {
      prop: 'createdAt',
      label: '生成日期',
      width: 112,
      kind: 'date',
      render: (row) => String(row.createdAt ?? '').slice(0, 10),
    },
    { prop: 'orderQuantity', label: '订单数量', width: 104, kind: 'number', align: 'right' },
    { prop: 'inputQuantity', label: '本次入库', width: 104, kind: 'number', align: 'right' },
    {
      prop: 'confirmStatus',
      label: '入库状态',
      width: 96,
      kind: 'status',
      statusDict: 'purchase_input_status',
    },
    {
      prop: 'createdBy',
      label: '创建人',
      width: 96,
      render: (row, ctx) => ctx.creator(row),
    },
  ],
  dictionaries: ['confirm_status', 'purchase_input_status'],
  optionBags: ['warehouses'],
  queryFields: [
    {
      key: 'confirmStatus',
      label: '入库状态',
      type: 'select',
      dictionary: 'purchase_input_status',
      width: 140,
    },
  ],
  summaryLabels: [
    { label: '入库单总数', key: 'total', kind: 'number' },
    { label: '待入库数', key: 'pending', kind: 'number' },
    { label: '已入库数', key: 'complete', kind: 'number' },
  ],
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
      primary: false,
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
      primary: false,
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
      primary: false,
      show: (row) => Number(row.confirmStatus) === 1,
      confirm: '从该入库单发起退货，是否继续？',
      handler: (row, ctx) =>
        ctx.navigate('/purchase/returns', { returnReceiptId: String(row.id) }),
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.confirmStatus) === 0,
      confirm: '确认删除该采购入库单？',
      handler: async (row) => {
        await api.delete(`/purchase/receipts/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
