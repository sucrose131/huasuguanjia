import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import InventoryCheckForm from '../forms/InventoryCheckForm.vue';

export const inventoryCheckConfig: BusinessDocumentConfig = {
  key: 'inventory/checks',
  title: '库存盘点',
  subtitle: '数量差异与损坏独立核算，同一批次可同时进入两条处理链',
  endpoint: '/inventory/checks',
  no: 'checkNo',
  columns: [
    { prop: 'checkNo', label: '盘点单号', minWidth: 150 },
    { prop: 'checkTypeName', label: '盘点类型', minWidth: 100, kind: 'status' },
    { prop: 'orgName', label: '组织', minWidth: 110 },
    { prop: 'warehouseName', label: '仓库', minWidth: 120 },
    { prop: 'checkDate', label: '盘点日期', minWidth: 110, kind: 'date' },
    { prop: 'goodsCount', label: '商品数', minWidth: 80, kind: 'number', align: 'right' },
    { prop: 'allQty', label: '全部数量', minWidth: 95, kind: 'number', align: 'right' },
    { prop: 'lessQty', label: '盘亏', minWidth: 80, kind: 'number', align: 'right' },
    { prop: 'overflowQty', label: '盘盈', minWidth: 80, kind: 'number', align: 'right' },
    { prop: 'progressPct', label: '处理进度', minWidth: 130, kind: 'progress' },
    { prop: 'completedDocumentCount', label: '已生成单据', minWidth: 100, kind: 'number', align: 'right' },
    { prop: 'approveStatus', label: '状态', minWidth: 95, kind: 'status' },
    { prop: 'createdByName', label: '创建人', minWidth: 100 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['inventory_check_type', 'approval_status'],
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
  createText: '新增盘点单',
  formComponent: InventoryCheckForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/inventory/checks/${query.documentId}`);
      ctx.openView(detail);
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
      key: 'approve',
      label: '通过',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      confirm: '通过后将按盘盈盘亏生成对应单据，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/checks/${row.id}/approve`, { approved: true, comment: '' });
        ElMessage.success('审批已通过');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0,
      confirm: '确认删除该盘点单？',
      handler: async (row) => {
        await api.delete(`/inventory/checks/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
