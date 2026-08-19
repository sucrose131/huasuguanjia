import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import RequisitionReturnForm from '../forms/RequisitionReturnForm.vue';

export const requisitionReturnConfig: BusinessDocumentConfig = {
  key: 'requisitions/returns',
  title: '领用退回单',
  endpoint: '/requisitions/returns',
  no: 'returnNo',
  columns: [
    { prop: 'returnNo', label: '退回单号', minWidth: 160, tooltip: true },
    { prop: 'outputNo', label: '来源出库单', minWidth: 155, tooltip: true },
    { prop: 'applicationNo', label: '领用申请', minWidth: 155, tooltip: true },
    { prop: 'deptName', label: '领用部门', minWidth: 130 },
    { prop: 'receiverIdName', label: '经办人', minWidth: 110 },
    { prop: 'warehouseName', label: '仓库', minWidth: 125 },
    { prop: 'returnDate', label: '退回日期', minWidth: 110, kind: 'date' },
    { prop: 'quantity', label: '退回数量', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'confirmStatusName', label: '确认状态', minWidth: 105, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['requisition_status', 'requisition_confirm_status'],
  creatable: true,
  createText: '新增领用退回单',
  formComponent: RequisitionReturnForm,
  openFromRoute: async (query, ctx) => {
    if (query.outputId) ctx.openCreate({ outputId: String(query.outputId) });
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    { key: 'edit', label: '编辑', handler: (row, ctx) => ctx.openEdit(row) },
    {
      key: 'confirm',
      label: '确认',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.confirmStatus) === 0,
      confirm: '确认后会立即改变真实库存，是否继续？',
      handler: async (row) => {
        await api.post(`/requisitions/returns/${row.id}/confirm`, { comment: '确认' });
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
        await api.post(`/requisitions/returns/${row.id}/undo-confirm`, { comment: '撤销' });
        ElMessage.success('已撤销确认');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.confirmStatus) === 0,
      confirm: '确认删除该领用退回单？',
      handler: async (row) => {
        await api.delete(`/requisitions/returns/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
