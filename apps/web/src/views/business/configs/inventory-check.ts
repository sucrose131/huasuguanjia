import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import InventoryCheckForm from '../forms/InventoryCheckForm.vue';

export const inventoryCheckConfig: BusinessDocumentConfig = {
  key: 'inventory/checks',
  title: '库存盘点',
  subtitle: '数量差异与损坏独立核算，同一批次可同时进入两条处理链',
  endpoint: '/inventory/checks',
  documentType: 'inventory_check',
  no: 'checkNo',
  keywordPlaceholder: '商品编码 / 名称 / SKU',
  columns: [
    { prop: 'checkNo', label: '盘点单号', minWidth: 150, link: true },
    { prop: 'checkTypeName', label: '盘点类型', minWidth: 100 },
    { prop: 'orgName', label: '组织', minWidth: 110 },
    { prop: 'warehouseName', label: '仓库', minWidth: 120 },
    { prop: 'checkDate', label: '盘点日期', minWidth: 110, kind: 'date' },
    { prop: 'goodsCount', label: '商品数', minWidth: 82, kind: 'number', align: 'right' },
    { prop: 'allQty', label: '账面总量', minWidth: 102, kind: 'number', align: 'right' },
    { prop: 'lessQty', label: '盘亏', minWidth: 90, kind: 'number', align: 'right' },
    { prop: 'overflowQty', label: '盘盈', minWidth: 90, kind: 'number', align: 'right' },
    { prop: 'damagedQty', label: '损坏', minWidth: 90, kind: 'number', align: 'right' },
    { prop: 'progressPct', label: '处理进度', minWidth: 132, kind: 'progress' },
    {
      prop: 'status',
      label: '业务状态',
      minWidth: 104,
      kind: 'status',
      render: (row, ctx) => {
        const approveStatus = Number(row.approveStatus);
        const status = Number(row.status);
        if (approveStatus === 1) return ctx.dictLabel('approval_status', 1);
        if (approveStatus === 2) return ctx.dictLabel('approval_status', 2);
        if (status === 0) return ctx.dictLabel('inventory_check_status', 0);
        return ctx.dictLabel('approval_status', 0);
      },
    },
    { prop: 'createdByName', label: '创建人', minWidth: 92 },
  ],
  dictionaries: ['inventory_check_type', 'approval_status', 'inventory_check_status'],
  optionBags: ['orgs'],
  queryFields: [
    { key: 'orgId', label: '组织', type: 'tree-select', optionBag: 'orgs', width: 200 },
  ],
  creatable: true,
  createText: '新增盘点单',
  formComponent: InventoryCheckForm,
  dialog: { width: 'min(1440px, calc(100vw - 48px))', top: '4vh', className: 'inventory-check-dialog' },
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
      label: '继续盘点',
      kind: 'primary',
      primary: false,
      show: (row) => Number(row.status) === 0 && [0, 2].includes(Number(row.approveStatus)),
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'approve',
      label: '审核通过',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      confirm: '审批通过只会按差异类型生成后续单据：每个损坏批次生成一张独立报损出库单，盘亏生成报亏出库单，盘盈生成报盈入库单；本步骤不会直接改变库存，是否继续？',
      handler: async (row) => {
        await api.post(`/inventory/checks/${row.id}/approve`, { approved: true, comment: '' });
        ElMessage.success('审批已通过');
      },
    },
    {
      key: 'reject',
      label: '驳回盘点',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      handler: async (row) => {
        const result = await ElMessageBox.prompt('请输入驳回原因', '驳回审批', {
          inputValidator: (value) => !!String(value).trim() || '驳回原因不能为空',
        });
        await api.post(`/inventory/checks/${row.id}/approve`, {
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
      show: (row) => Number(row.status) === 0 && [0, 2].includes(Number(row.approveStatus)),
      confirm: '确认删除该盘点单？',
      handler: async (row) => {
        await api.delete(`/inventory/checks/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
