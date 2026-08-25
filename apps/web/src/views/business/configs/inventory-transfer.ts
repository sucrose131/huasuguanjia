import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import InventoryTransferForm from '../forms/InventoryTransferForm.vue';

export const inventoryTransferConfig: BusinessDocumentConfig = {
  key: 'inventory/transfers',
  title: '库存调拨',
  subtitle: '同类型仓库之间的双边库存调拨与审批',
  endpoint: '/inventory/transfers',
  documentType: 'inventory_transfer',
  keywordPlaceholder: '商品编码 / 名称 / SKU',
  no: 'transferNo',
  columns: [
    { prop: 'transferNo', label: '调拨单号', minWidth: 150 },
    { prop: 'orgName', label: '调出组织', minWidth: 110 },
    { prop: 'warehouseName', label: '调出仓库', minWidth: 120 },
    { prop: 'toOrgName', label: '调入组织', minWidth: 110 },
    { prop: 'toWarehouseName', label: '调入仓库', minWidth: 120 },
    { prop: 'sendByName', label: '发出人', minWidth: 90 },
    { prop: 'receiveByName', label: '接收人', minWidth: 90 },
    { prop: 'reason', label: '调拨理由', minWidth: 150, tooltip: true },
    { prop: 'transferDate', label: '调拨日期', minWidth: 110, kind: 'date' },
    { prop: 'quantity', label: '调拨数量', minWidth: 100, kind: 'number', align: 'right' },
    { prop: 'approveStatus', label: '审批状态', minWidth: 100, kind: 'status', statusDict: 'approval_status' },
    { prop: 'createdByName', label: '创建人', minWidth: 100 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['approval_status'],
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
  createText: '新增调拨单',
  dialog: { width: '1280px', top: '4vh' },
  formComponent: InventoryTransferForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/inventory/transfers/${query.documentId}`);
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
      confirm: '提交后进入审批流程，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/transfers/${row.id}/submit`);
        ElMessage.success('已提交审批');
      },
    },
    {
      key: 'approve',
      label: '通过',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      confirm: '通过后将立即调拨过账并调整两边库存，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/transfers/${row.id}/approve`, { approved: true, comment: '' });
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
        const prompt = await ElMessageBox.prompt('请输入驳回原因', '驳回审批', {
          inputValidator: (value) => Boolean(String(value).trim()) || '驳回原因不能为空',
        });
        await api.post(`/inventory/transfers/${row.id}/approve`, {
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
      confirm: '确认删除该未过账单据？',
      handler: async (row) => {
        await api.delete(`/inventory/transfers/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
