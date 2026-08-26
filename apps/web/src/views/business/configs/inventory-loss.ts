import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage, ElMessageBox } from 'element-plus';
import InventoryLossForm from '../forms/InventoryLossForm.vue';

export const inventoryLossConfig: BusinessDocumentConfig = {
  key: 'inventory/losses',
  title: '报损出库单',
  subtitle: '支持盘点损坏生成和日常独立报损，按处置方式完成库存闭环',
  endpoint: '/inventory/losses',
  documentType: 'inventory_loss',
  keywordPlaceholder: '商品编码 / 名称 / SKU',
  no: 'businessNo',
  columns: [
    { prop: 'businessNo', label: '报损出库单号', minWidth: 155, link: true },
    { prop: 'businessKindName', label: '业务类别', minWidth: 105 },
    {
      prop: 'sourceCheckNo',
      label: '来源盘点',
      minWidth: 140,
      render: (row) => row.sourceCheckNo || '历史非盘点记录',
    },
    { prop: 'orgName', label: '组织', minWidth: 105 },
    { prop: 'warehouseName', label: '仓库', minWidth: 110 },
    { prop: 'deptName', label: '部门', minWidth: 100 },
    { prop: 'documentTypeName', label: '业务类型', minWidth: 105 },
    { prop: 'reason', label: '原因', minWidth: 150, tooltip: true },
    { prop: 'goWhereName', label: '报损去向', minWidth: 105 },
    { prop: 'date', label: '日期', minWidth: 110, kind: 'date' },
    { prop: 'quantity', label: '数量', minWidth: 85, kind: 'number', align: 'right' },
    { prop: 'amount', label: '金额', minWidth: 100, kind: 'money', align: 'right' },
    { prop: 'approveStatus', label: '审批状态', minWidth: 110, kind: 'status', statusDict: 'approval_status' },
    { prop: 'createdByName', label: '创建人', minWidth: 90 },
  ],
  dictionaries: ['inventory_loss_type', 'inventory_loss_disposal', 'approval_status'],
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
  createText: '新增报损出库单',
  createPreset: () => ({ businessKind: 2 }),
  dialog: { width: '1280px', top: '4vh' },
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
      show: (row) =>
        Number(row.businessKind) === 2 &&
        Number(row.status) === 0 &&
        [0, 2].includes(Number(row.approveStatus)),
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'submit',
      label: '提交',
      kind: 'success',
      primary: false,
      show: (row) =>
        Number(row.businessKind) === 2 &&
        Number(row.status) === 0 &&
        [0, 2].includes(Number(row.approveStatus)),
      confirm: '提交后进入审批流程，是否继续？',
      confirmTitle: '提交审批',
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
      confirm: (row) =>
        Number(row.businessKind) === 1
          ? '审批通过将自动生成报亏出库单并扣减库存，是否继续？'
          : Number(row.goWhere) === 1
            ? '审批通过将生成折价销售单，本次不会扣减库存，是否继续？'
            : Number(row.goWhere) === 2
              ? '审批通过将按原采购入库来源生成采购退货草稿，本次不会扣减库存，是否继续？'
              : '审批通过将按直接报废去向扣减库存，是否继续？',
      confirmTitle: '确认审批',
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
      key: 'purchase-return',
      label: (row) =>
        (row.purchaseReturns ?? []).length
          ? `查看采购退货 ${row.purchaseReturns[0]?.returnNo ?? ''}`
          : '查看采购退货',
      kind: 'primary',
      primary: false,
      show: (row) => (row.purchaseReturns ?? []).length > 0,
      handler: (row, ctx) =>
        ctx.navigate('/purchase/returns', {
          documentId: String(row.purchaseReturns[0]?.id ?? ''),
          view: '1',
        }),
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) =>
        Number(row.businessKind) === 2 &&
        Number(row.sourceCheckId ?? 0) === 0 &&
        Number(row.status) === 0 &&
        [0, 2].includes(Number(row.approveStatus)),
      confirm: '确认删除该报损单？',
      confirmTitle: '删除确认',
      handler: async (row) => {
        await api.delete(`/inventory/losses/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
