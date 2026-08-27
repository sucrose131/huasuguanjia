import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import InventoryLossOutputForm from '../forms/InventoryLossOutputForm.vue';

export const inventoryLossOutputConfig: BusinessDocumentConfig = {
  key: 'inventory/loss-outputs',
  title: '报亏出库单',
  subtitle: '仅由库存盘点的数量盘亏生成，整单审核通过后一次性扣减来源批次库存',
  endpoint: '/inventory/loss-outputs',
  documentType: 'inventory_loss_output',
  keywordPlaceholder: '商品编码 / 名称 / SKU',
  no: 'businessNo',
  columns: [
    { prop: 'businessNo', label: '报亏出库单号', minWidth: 155, link: true },
    {
      prop: 'sourceCheckNo',
      label: '来源盘点',
      minWidth: 145,
      render: (row) => row.sourceCheckNo || (row.sourceLossNo ? `历史：${row.sourceLossNo}` : '—'),
    },
    { prop: 'orgName', label: '组织', minWidth: 105 },
    { prop: 'warehouseName', label: '仓库', minWidth: 110 },
    { prop: 'deptName', label: '部门', minWidth: 100 },
    { prop: 'documentTypeName', label: '报亏类型', minWidth: 105 },
    { prop: 'reason', label: '原因', minWidth: 150, tooltip: true },
    { prop: 'date', label: '日期', minWidth: 105, kind: 'date' },
    { prop: 'quantity', label: '数量', minWidth: 85, kind: 'number', align: 'right' },
    { prop: 'amount', label: '金额', minWidth: 100, kind: 'money', align: 'right' },
    { prop: 'approveStatus', label: '审批状态', minWidth: 110, kind: 'status', statusDict: 'approval_status' },
    { prop: 'createdByName', label: '创建人', minWidth: 90 },
  ],
  dictionaries: ['inventory_loss_output_type', 'approval_status'],
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
  creatable: false,
  dialog: { width: '1280px', top: '4vh' },
  formComponent: InventoryLossOutputForm,
  viewCloseInForm: true,
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
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && [0, 1].includes(Number(row.status)),
      confirm: '审核通过将按来源批次扣减库存，是否继续？',
      confirmTitle: '确认审批',
      handler: async (row) => {
        await api.post(`/inventory/loss-outputs/${row.id}/approve`, { approved: true, comment: '' });
        ElMessage.success('审批已通过，库存已扣减');
      },
    },
    {
      key: 'confirm',
      label: '确认出库',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 1,
      confirm: '确认后将扣减库存，是否继续？',
      confirmTitle: '库存影响确认',
      handler: async (row) => {
        await api.post(`/inventory/loss-outputs/${row.id}/confirm`, { comment: '确认出库' });
        ElMessage.success('已确认出库');
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
        await api.post(`/inventory/loss-outputs/${row.id}/approve`, {
          approved: false,
          comment: String(prompt.value).trim(),
        });
        ElMessage.success('单据已驳回');
      },
    },
  ],
};
