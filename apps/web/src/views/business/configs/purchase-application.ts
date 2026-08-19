import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import PurchaseApplicationForm from '../forms/PurchaseApplicationForm.vue';

/**
 * 采购申请单：共享引擎配置。
 *
 * 说明：列表接口返回的是原始 approveStatus（0 待审批 / 1 已通过 / 2 已驳回）与
 * generationStatus（not_generated / partially_generated / fully_generated）等数字/枚举值，
 * 没有 deptName / warehouseName / approveStatusName / createdByName 等富化字段，
 * 因此列按任务约定的「简单处理」直接展示后端原始字段。
 */
export const purchaseApplicationConfig: BusinessDocumentConfig = {
  key: 'purchase/applications',
  title: '采购申请单',
  subtitle: '采购需求草稿、提交与审批管理',
  endpoint: '/purchase/applications',
  no: 'applicationNo',
  columns: [
    { prop: 'applicationNo', label: '申请单号', minWidth: 165 },
    {
      prop: 'orgId',
      label: '组织',
      minWidth: 160,
      render: (row, ctx) => ctx.lookup('orgs', row.orgId),
    },
    {
      prop: 'deptId',
      label: '申请部门',
      minWidth: 128,
      render: (row, ctx) => ctx.lookup('depts', row.deptId),
    },
    {
      prop: 'warehouseId',
      label: '目标仓库',
      minWidth: 144,
      render: (row, ctx) => ctx.lookup('warehouses', row.warehouseId),
    },
    { prop: 'reason', label: '申请原因', minWidth: 200 },
    { prop: 'quantity', label: '申请数量', width: 104, kind: 'number' },
    {
      prop: 'generationStatus',
      label: '生成状态',
      minWidth: 120,
      render: (row) =>
        row.generationStatus === 'fully_generated'
          ? '已生成订单'
          : row.generationStatus === 'partially_generated'
            ? '部分生成'
            : row.generationStatus === 'not_generated'
              ? '未生成'
              : String(row.generationStatus ?? '—'),
    },
    {
      prop: 'createdBy',
      label: '创建人',
      width: 96,
      render: (row, ctx) => ctx.creator(row),
    },
    { prop: 'createdAt', label: '创建时间', width: 160, kind: 'datetime' },
    {
      prop: 'approveStatus',
      label: '审批状态',
      width: 96,
      render: (row, ctx) => ctx.dictLabel('approval_status', row.approveStatus),
    },
  ],
  dictionaries: ['approval_status'],
  optionBags: ['orgs', 'depts', 'warehouses'],
  autoStatusFilter: false,
  queryFields: [
    { key: 'orgId', label: '所属组织', type: 'tree-select', optionBag: 'orgs', width: 200 },
    { key: 'warehouseId', label: '目标仓库', type: 'select', optionBag: 'warehouses', width: 180 },
    {
      key: 'approveStatus',
      label: '审批状态',
      type: 'select',
      dictionary: 'approval_status',
      width: 140,
    },
    { key: 'createdDate', label: '申请日期', type: 'date-range', param: 'created', width: 250 },
  ],
  summaryLabels: [
    { label: '申请单总数', key: 'total', kind: 'number' },
    { label: '待审批数', key: 'pending', kind: 'number' },
    { label: '已审批数', key: 'complete', kind: 'number' },
  ],
  creatable: true,
  createText: '新增采购申请单',
  formComponent: PurchaseApplicationForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/purchase/applications/${String(query.documentId)}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 0,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'submit',
      label: '提交',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 0,
      confirm: '提交后将进入审批流程，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/purchase/applications/${row.id}/submit`, {});
        ElMessage.success(result?.message ?? '已提交审批');
      },
    },
    {
      key: 'approve',
      label: '通过',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      confirm: '通过后进入采购流程，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/purchase/applications/${row.id}/approve`, {
          approved: true,
          comment: '审批通过',
        });
        ElMessage.success(result?.message ?? '审批已通过');
      },
    },
    {
      key: 'reject',
      label: '驳回',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 1,
      confirm: '驳回后申请将退回，是否继续？',
      handler: async (row) => {
        const result: any = await api.post(`/purchase/applications/${row.id}/approve`, {
          approved: false,
          comment: '驳回',
        });
        ElMessage.success(result?.message ?? '已驳回');
      },
    },
    {
      key: 'generate-order',
      label: '生成订单',
      kind: 'success',
      primary: false,
      show: (row) => Number(row.approveStatus) === 1 && Number(row.remainingDetailCount) > 0,
      confirm: '按申请整单生成采购订单，是否继续？',
      // 后端 generate-order 需要供应商与每行金额（原页面用专用弹窗收集），
      // 引擎行操作无法承载该弹窗，故保留入口：跳转到采购订单页按申请预填。
      handler: (row, ctx) => ctx.navigate('/purchase/orders', { applicationId: String(row.id) }),
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => Number(row.approveStatus) === 0 && Number(row.status) === 0,
      confirm: '确认删除该采购申请单？',
      handler: async (row) => {
        await api.delete(`/purchase/applications/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
