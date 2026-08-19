import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import InventoryLossOutputForm from '../forms/InventoryLossOutputForm.vue';

export const inventoryLossOutputConfig: BusinessDocumentConfig = {
  key: 'inventory/loss-outputs',
  title: '报损出库单',
  subtitle: '仅由库存盘点的数量盘亏生成，整单审核通过后一次性扣减来源批次库存',
  endpoint: '/inventory/loss-outputs',
  no: 'businessNo',
  columns: [
    { prop: 'businessNo', label: '单号', minWidth: 165 },
    { prop: 'sourceCheckNo', label: '来源盘点', minWidth: 140 },
    { prop: 'sourceLossNo', label: '来源报损', minWidth: 140 },
    { prop: 'orgName', label: '组织', minWidth: 110 },
    { prop: 'warehouseName', label: '仓库', minWidth: 120 },
    { prop: 'documentTypeName', label: '单据类型', minWidth: 110, kind: 'status' },
    { prop: 'date', label: '日期', minWidth: 110, kind: 'date' },
    { prop: 'quantity', label: '数量', minWidth: 100, kind: 'number' },
    { prop: 'approveStatus', label: '审批状态', minWidth: 110, kind: 'status' },
    { prop: 'inputStatus', label: '入库状态', minWidth: 110, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 100 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['inventory_loss_output_type', 'approval_status'],
  creatable: false,
  formComponent: InventoryLossOutputForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/inventory/loss-outputs/${query.documentId}`);
      ctx.openView(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'approve',
      label: '通过',
      kind: 'success',
      show: (row) => Number(row.approveStatus) === 0,
      confirm: '审核通过将按来源批次扣减库存，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/loss-outputs/${row.id}/approve`, { approved: true, comment: '' });
        ElMessage.success('审批已通过，库存已扣减');
      },
    },
    {
      key: 'confirm',
      label: '确认出库',
      kind: 'success',
      show: (row) => Number(row.approveStatus) === 1,
      confirm: '确认后将扣减库存，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/loss-outputs/${row.id}/confirm`, { comment: '确认出库' });
        ElMessage.success('已确认出库');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      show: (row) => Number(row.approveStatus) === 0,
      confirm: '确认删除该报损出库单？',
      handler: async (row) => {
        await api.delete(`/inventory/loss-outputs/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
