import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { ElMessage, ElMessageBox } from 'element-plus';
import PurchaseApplicationForm from '../forms/PurchaseApplicationForm.vue';
import {
  approvalStatusText,
  approvalStatusType,
} from '@/utils/approval-status';

const isCurrentApplicant = (row: Record<string, any>) =>
  String(row.createdBy ?? '') === String(useAuthStore().user?.id ?? '');

/** OA 审批在途（推送中/审批中/退回发起人）：该单据不能在系统内审批，通过/驳回按钮不展示 */
const hasActiveOaApproval = (row: Record<string, any>) =>
  ['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'].includes(String(row.oaStatus ?? ''));
const canApproveApplication = (row: Record<string, any>) =>
  !hasActiveOaApproval(row) &&
  Number(row.approveStatus) === 0 &&
  Number(row.status) === 1;

/**
 * 采购申请单：共享引擎配置。
 *
 * 说明：列表接口返回的是原始 approveStatus（0 待审批 / 1 已通过 / 2 已驳回 / 3 已取消）与
 * generationStatus（not_generated / partially_generated / fully_generated）等数字/枚举值，
 * 列表接口提供 createdByName；组织、部门和仓库继续复用共享选项袋显示。
 */
export const purchaseApplicationConfig: BusinessDocumentConfig = {
  key: 'purchase/applications',
  title: '采购申请单',
  subtitle: '采购需求草稿、提交与审批管理',
  endpoint: '/purchase/applications',
  documentType: 'purchase_application',
  no: 'applicationNo',
  columns: [
    { prop: 'applicationNo', label: '申请单号', minWidth: 165, tooltip: true },
    {
      prop: 'orgId',
      label: '成本承担组织',
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
    { prop: 'reason', label: '申请原因', minWidth: 200, tooltip: true },
    { prop: 'quantity', label: '申请数量', width: 104, kind: 'number', align: 'right' },
    {
      prop: 'approveStatus',
      label: '审批状态',
      width: 130,
      kind: 'status',
      statusType: approvalStatusType,
      render: approvalStatusText,
    },
    {
      prop: 'generationStatus',
      label: '生成状态',
      minWidth: 120,
      kind: 'status',
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
      render: (row, ctx) => row.createdByName || ctx.creator(row),
    },
    { prop: 'createdAt', label: '创建时间', width: 160, kind: 'datetime' },
  ],
  dictionaries: ['approval_status'],
  optionBags: ['orgs', 'depts', 'warehouses'],
  autoStatusFilter: false,
  queryFields: [
    { key: 'orgId', label: '成本承担组织', type: 'tree-select', optionBag: 'orgs', width: 200 },
    {
      key: 'warehouseId',
      label: '目标仓库',
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
  dialog: { width: '1080px', className: 'purchase-application-form-dialog' },
  loadDetail: async (id) => (await api.get(`/purchase/applications/${id}`)) as Record<string, any>,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const row = { id: String(query.documentId) };
      if (String(query.view ?? '') === '1') ctx.openView(row);
      else ctx.openEdit(row);
    }
  },
  rowActions: [
    { key: 'view', label: '查看', handler: (row, ctx) => ctx.openView(row) },
    {
      key: 'edit',
      label: '编辑',
      show: (row) =>
        isCurrentApplicant(row) && Number(row.approveStatus) === 0 && Number(row.status) === 0,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'submit',
      label: '提交',
      kind: 'success',
      primary: false,
      show: (row) =>
        isCurrentApplicant(row) && Number(row.approveStatus) === 0 && Number(row.status) === 0,
      confirm: '提交后将进入审批流程，是否继续？',
      confirmTitle: '提交审批',
      handler: async (row) => {
        const result: any = await api.post(`/purchase/applications/${row.id}/submit`, {});
        ElMessage.success(result?.message ?? '已提交审批');
      },
    },
    {
      key: 'withdraw',
      label: '撤回',
      kind: 'warning',
      primary: false,
      show: (row) =>
        isCurrentApplicant(row) &&
        Number(row.status) === 1 &&
        Number(row.approveStatus) === 0 &&
        row.sourceType !== 'production_plan',
      confirm: '撤回后单据将回到草稿，可修改后重新提交，是否继续？',
      confirmTitle: '撤回审批',
      handler: async (row) => {
        const result: any = await api.post(`/purchase/applications/${row.id}/withdraw`, {});
        ElMessage.success(result?.message ?? '采购申请已撤回');
      },
    },
    {
      key: 'terminate',
      label: '终止',
      kind: 'danger',
      primary: false,
      show: (row) =>
        isCurrentApplicant(row) && Number(row.status) === 1 && Number(row.approveStatus) === 0,
      confirm: '终止后审批将结束，且不能再编辑提交，是否继续？',
      confirmTitle: '终止审批',
      handler: async (row) => {
        const result: any = await api.post(`/purchase/applications/${row.id}/terminate`, {});
        ElMessage.success(result?.message ?? '采购申请已终止');
      },
    },
    {
      key: 'approve',
      label: '通过',
      kind: 'success',
      primary: false,
      show: canApproveApplication,
      confirm: '通过后进入采购流程，是否继续？',
      confirmTitle: '确认审批通过',
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
      show: canApproveApplication,
      handler: async (row) => {
        const prompt = await ElMessageBox.prompt('请输入驳回原因', '驳回采购申请', {
          inputValidator: (value) => Boolean(String(value).trim()) || '驳回原因不能为空',
        });
        const result: any = await api.post(`/purchase/applications/${row.id}/approve`, {
          approved: false,
          comment: String(prompt.value).trim(),
        });
        ElMessage.success(result?.message ?? '已驳回');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) =>
        isCurrentApplicant(row) && Number(row.approveStatus) === 0 && Number(row.status) === 0,
      confirm: '确认删除该采购申请单？',
      confirmTitle: '确认删除',
      handler: async (row) => {
        await api.delete(`/purchase/applications/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
