import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import InventoryOverflowInputForm from '../forms/InventoryOverflowInputForm.vue';

export const inventoryOverflowInputConfig: BusinessDocumentConfig = {
  key: 'inventory/overflow-inputs',
  title: '盘盈入库单',
  subtitle: '查看由报盈单审批生成并完成过账的独立入库记录',
  endpoint: '/inventory/overflow-inputs',
  documentType: 'inventory_overflow_input',
  keywordPlaceholder: '商品编码 / 名称 / SKU',
  no: 'businessNo',
  columns: [
    { prop: 'businessNo', label: '报盈入库单号', minWidth: 155, link: true },
    { prop: 'sourceOverflowNo', label: '来源报盈单', minWidth: 145 },
    {
      prop: 'sourceCheckNo',
      label: '来源盘点',
      minWidth: 140,
      render: (row) => row.sourceCheckNo || '历史非盘点记录',
    },
    { prop: 'orgName', label: '组织', minWidth: 105 },
    { prop: 'warehouseName', label: '仓库', minWidth: 110 },
    { prop: 'deptName', label: '部门', minWidth: 100 },
    { prop: 'documentTypeName', label: '报盈类型', minWidth: 105 },
    { prop: 'reason', label: '原因', minWidth: 150, tooltip: true },
    { prop: 'date', label: '日期', minWidth: 105, kind: 'date' },
    { prop: 'quantity', label: '数量', minWidth: 85, kind: 'number', align: 'right' },
    { prop: 'amount', label: '金额', minWidth: 100, kind: 'money', align: 'right' },
    {
      prop: 'status',
      label: '审批状态',
      minWidth: 110,
      kind: 'status',
      statusDict: 'inventory_overflow_status',
      render: (row) =>
        String(Number(row.inputStatus) === 1 ? 1 : Number(row.approveStatus) === 2 ? 2 : 0),
    },
    { prop: 'createdByName', label: '创建人', minWidth: 90 },
  ],
  dictionaries: ['inventory_overflow_status'],
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
  formComponent: InventoryOverflowInputForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/inventory/overflow-inputs/${query.documentId}`);
      ctx.openView(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'confirm',
      label: '确认入库',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.status) === 0,
      confirm: '确认后将库存过账，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/overflow-inputs/${row.id}/confirm`, { comment: '确认入库' });
        ElMessage.success('已确认入库');
      },
    },
  ],
};
