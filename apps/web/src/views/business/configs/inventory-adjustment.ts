import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import InventoryAdjustmentForm from '../forms/InventoryAdjustmentForm.vue';

export const inventoryAdjustmentConfig: BusinessDocumentConfig = {
  key: 'inventory/adjustments',
  title: '库存调整',
  subtitle: '通过审批流程修正账面库存并保留调整依据',
  endpoint: '/inventory/adjustments',
  documentType: 'inventory_adjust',
  no: 'adjustNo',
  columns: [
    { prop: 'adjustNo', label: '调整单号', minWidth: 150, link: true },
    { prop: 'reason', label: '调整原因', minWidth: 180, tooltip: true },
    { prop: 'applicantDate', label: '申请日期', minWidth: 105, kind: 'date' },
    { prop: 'detailCount', label: '明细数', minWidth: 80, kind: 'number', align: 'right' },
    { prop: 'quantity', label: '调整总量', minWidth: 100, kind: 'number', align: 'right' },
    { prop: 'approveStatus', label: '审批状态', minWidth: 90, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 90 },
    { prop: 'createdAt', label: '创建时间', minWidth: 145, kind: 'datetime' },
  ],
  dictionaries: ['approval_status', 'inventory_adjust_type'],
  optionBags: ['orgs'],
  queryFields: [
    { key: 'orgId', label: '组织', type: 'tree-select', optionBag: 'orgs', width: 200 },
    {
      key: 'warehouseId',
      label: '仓库',
      type: 'select',
      dependsOn: 'orgId',
      width: 180,
      loadOptions: async (deps) => {
        if (!deps.orgId) return [];
        return (await api.get('/base-data/warehouses/options', {
          params: { orgId: deps.orgId },
        })) as any[];
      },
    },
  ],
  creatable: true,
  createText: '新增调整单',
  formComponent: InventoryAdjustmentForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/inventory/adjustments/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => Number(row.status) === 0 && [0, 2].includes(Number(row.approveStatus)),
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'submit',
      label: '提交',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.status) === 0 && [0, 2].includes(Number(row.approveStatus)),
      confirm: '提交后进入审批，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/adjustments/${row.id}/submit`);
        ElMessage.success('已提交审批');
      },
    },
    {
      key: 'approve',
      label: '通过',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      confirm: '通过后立即调整库存，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/adjustments/${row.id}/approve`, { approved: true, comment: '' });
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
        const prompt = await ElMessageBox.prompt('请输入驳回原因', '驳回库存调整', {
          inputValidator: (value) => Boolean(String(value).trim()) || '驳回原因不能为空',
        });
        await api.post(`/inventory/adjustments/${row.id}/approve`, {
          approved: false,
          comment: String(prompt.value).trim(),
        });
        ElMessage.success('已驳回');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.status) === 0 && [0, 2].includes(Number(row.approveStatus)),
      confirm: '确认删除该调整单？',
      handler: async (row) => {
        await api.delete(`/inventory/adjustments/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
