import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import InventoryOverflowForm from '../forms/InventoryOverflowForm.vue';

export const inventoryOverflowConfig: BusinessDocumentConfig = {
  key: 'inventory/overflows',
  title: '报盈入库单',
  subtitle: '仅由库存盘点的数量盘盈生成，审批后直接增加来源批次库存',
  endpoint: '/inventory/overflows',
  documentType: 'inventory_overflow',
  keywordPlaceholder: '商品编码 / 名称 / SKU',
  no: 'businessNo',
  columns: [
    { prop: 'businessNo', label: '报盈入库单号', minWidth: 155, link: true },
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
      prop: 'approveStatus',
      label: '审批/入库状态',
      minWidth: 110,
      kind: 'status',
      statusDict: 'inventory_overflow_status',
      render: (row) =>
        String(Number(row.inputStatus) === 1 ? 1 : Number(row.approveStatus) === 2 ? 2 : 0),
    },
    { prop: 'createdByName', label: '创建人', minWidth: 90 },
  ],
  dictionaries: ['inventory_overflow_type', 'approval_status', 'inventory_overflow_status'],
  optionBags: ['orgs'],
  queryFields: [
    { key: 'orgId', label: '组织', type: 'tree-select', optionBag: 'orgs', width: 200 },
    {
      key: 'warehouseId',
      label: '仓库',
      type: 'select',
      dependsOn: 'orgId',
      loadOnEmptyDep: true,
      width: 180,
      loadOptions: async (deps) => {
        return (await api.get('/base-data/warehouses/options', {
          params: deps.orgId ? { orgId: deps.orgId } : {},
        })) as any[];
      },
    },
  ],
  creatable: false,
  dialog: { width: '1280px', top: '4vh' },
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
      key: 'approve',
      label: '通过',
      kind: 'success',
      primary: false,
      show: (row) =>
        Number(row.approveStatus) === 0 &&
        Number(row.status) === 1 &&
        Number(row.sourceCheckId ?? 0) > 0,
      confirm: '审批通过将直接完成报盈入库并增加对应批次库存，是否继续？',
      confirmTitle: '确认审批',
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
      show: (row) =>
        Number(row.approveStatus) === 0 &&
        Number(row.status) === 1 &&
        Number(row.sourceCheckId ?? 0) > 0,
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
  ],
};
