import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import InventoryLossForm from '../forms/InventoryLossForm.vue';

export const inventoryLossConfig: BusinessDocumentConfig = {
  key: 'inventory/losses',
  title: '报损/报亏单',
  subtitle: '支持盘点损坏生成和日常独立报损，按处置方式完成库存闭环',
  endpoint: '/inventory/losses',
  no: 'businessNo',
  columns: [
    { prop: 'businessNo', label: '单号', minWidth: 165 },
    { prop: 'businessKindName', label: '类型', minWidth: 105, kind: 'status' },
    { prop: 'orgName', label: '组织', minWidth: 110 },
    { prop: 'warehouseName', label: '仓库', minWidth: 120 },
    { prop: 'documentTypeName', label: '单据类型', minWidth: 110, kind: 'status' },
    { prop: 'reason', label: '原因', minWidth: 150 },
    { prop: 'date', label: '日期', minWidth: 110, kind: 'date' },
    { prop: 'quantity', label: '数量', minWidth: 100, kind: 'number', align: 'right' },
    { prop: 'amount', label: '金额', minWidth: 110, kind: 'money', align: 'right' },
    { prop: 'goWhereName', label: '去向', minWidth: 105 },
    { prop: 'approveStatus', label: '审批状态', minWidth: 110, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 100 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['inventory_loss_type', 'inventory_loss_disposal', 'approval_status'],
  creatable: true,
  createText: '新增报损单',
  createPreset: () => ({ businessKind: 2 }),
  formComponent: InventoryLossForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/inventory/losses/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => Number(row.approveStatus) === 0,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'submit',
      label: '提交',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0,
      confirm: '提交后进入审批流程，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/losses/${row.id}/submit`);
        ElMessage.success('已提交审批');
      },
    },
    {
      key: 'approve',
      label: '通过',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      confirm: '通过后将生成对应处置流程，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/losses/${row.id}/approve`, { approved: true, comment: '' });
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
          inputValidator: (value) => !!String(value).trim() || '驳回原因不能为空',
        });
        await api.post(`/inventory/losses/${row.id}/approve`, {
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
      confirm: '确认删除该报损单？',
      handler: async (row) => {
        await api.delete(`/inventory/losses/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
