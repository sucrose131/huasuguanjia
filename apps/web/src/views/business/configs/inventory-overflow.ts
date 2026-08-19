import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import InventoryOverflowForm from '../forms/InventoryOverflowForm.vue';

export const inventoryOverflowConfig: BusinessDocumentConfig = {
  key: 'inventory/overflows',
  title: '盘盈单',
  subtitle: '仅由库存盘点的数量盘盈生成，审批后直接增加来源批次库存',
  endpoint: '/inventory/overflows',
  no: 'businessNo',
  columns: [
    { prop: 'businessNo', label: '单号', minWidth: 165 },
    { prop: 'orgName', label: '组织', minWidth: 110 },
    { prop: 'warehouseName', label: '仓库', minWidth: 120 },
    { prop: 'documentTypeName', label: '单据类型', minWidth: 110, kind: 'status' },
    { prop: 'reason', label: '原因', minWidth: 150 },
    { prop: 'date', label: '日期', minWidth: 110, kind: 'date' },
    { prop: 'quantity', label: '数量', minWidth: 100, kind: 'number', align: 'right' },
    { prop: 'amount', label: '金额', minWidth: 110, kind: 'money', align: 'right' },
    { prop: 'approveStatus', label: '审批状态', minWidth: 110, kind: 'status' },
    { prop: 'inputStatus', label: '入库状态', minWidth: 110, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 100 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['inventory_overflow_type', 'approval_status'],
  creatable: true,
  createText: '新增盘盈单',
  createPreset: () => ({}),
  formComponent: InventoryOverflowForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/inventory/overflows/${query.documentId}`);
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
        await api.post(`/inventory/overflows/${row.id}/submit`);
        ElMessage.success('已提交审批');
      },
    },
    {
      key: 'approve',
      label: '通过',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      confirm: '通过后待入库过账，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/overflows/${row.id}/approve`, { approved: true, comment: '' });
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
        await api.post(`/inventory/overflows/${row.id}/approve`, {
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
      confirm: '确认删除该盘盈单？',
      handler: async (row) => {
        await api.delete(`/inventory/overflows/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
