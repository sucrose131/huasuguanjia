import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import SalesOutputForm from '../forms/SalesOutputForm.vue';

export const salesOutputConfig: BusinessDocumentConfig = {
  key: 'sales/outputs',
  title: '销售出库单',
  endpoint: '/sales/outputs',
  no: 'businessNo',
  columns: [
    { prop: 'businessNo', label: '出库单号', minWidth: 160 },
    { prop: 'orderNo', label: '销售订单', minWidth: 155, tooltip: true },
    { prop: 'customerName', label: '客户', minWidth: 130 },
    { prop: 'warehouseName', label: '仓库', minWidth: 125 },
    { prop: 'date', label: '出库日期', minWidth: 110, kind: 'date' },
    { prop: 'quantity', label: '本次出库', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'confirmStatusName', label: '确认状态', minWidth: 105, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['sales_output_destination', 'confirm_status'],
  creatable: true,
  createText: '新增销售出库',
  formComponent: SalesOutputForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/sales/outputs/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    } else if (query.orderId) {
      ctx.openCreate({ orderId: String(query.orderId) });
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => Number(row.confirmStatus) === 0,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'confirm',
      label: '确认',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.confirmStatus) === 0,
      confirm: '确认后将立即扣减库存，是否继续？',
      handler: async (row) => {
        await api.post(`/sales/outputs/${row.id}/confirm`, { comment: '确认' });
        ElMessage.success('确认成功');
      },
    },
    {
      key: 'undo-confirm',
      label: '撤销确认',
      kind: 'warning',
      primary: false,
      show: (row) => Number(row.confirmStatus) === 1,
      confirm: '撤销后将回退库存，是否继续？',
      handler: async (row) => {
        await api.post(`/sales/outputs/${row.id}/undo-confirm`, { comment: '撤销' });
        ElMessage.success('已撤销确认');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.confirmStatus) === 0,
      confirm: '确认删除该销售出库单？',
      handler: async (row) => {
        await api.delete(`/sales/outputs/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
