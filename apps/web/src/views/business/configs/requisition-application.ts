import type { BusinessDocumentConfig } from '../business-document-config';
import { api } from '@/api';
import { ElMessage } from 'element-plus';
import RequisitionApplicationForm from '../forms/RequisitionApplicationForm.vue';

const hasActiveOaApproval = (row: Record<string, any>) =>
  ['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'].includes(String(row.oaStatus ?? ''));
const canApproveApplication = (row: Record<string, any>) =>
  !hasActiveOaApproval(row) &&
  Number(row.approveStatus ?? row.approve_status) === 0 &&
  Number(row.status) === 1;
const canRejectApplication = (row: Record<string, any>) =>
  canApproveApplication(row) ||
  (Boolean(row.reverseGenerated) && Number(row.approveStatus ?? row.approve_status) === 1);

/**
 * 合并后的审批状态：终态区分 OA/系统渠道，未决态展示 OA 过程。
 * 展示仅合并两列，不改变"OA 审批单据不能系统内通过"的既有约束（前端操作与后端均拦截）。
 */
export function requisitionApprovalStatusText(row: Record<string, any>): string {
  const approveStatus = Number(row.approveStatus ?? row.approve_status ?? 0);
  const oaStatus = String(row.oaStatus ?? '');
  if (approveStatus === 1) return oaStatus === 'PASSED' ? 'OA已通过' : '已通过';
  if (approveStatus === 2) return oaStatus === 'REJECTED' ? 'OA已驳回' : '已驳回';
  if (oaStatus === 'RUNNING') return 'OA审批中';
  if (oaStatus === 'BACKTOSTART') return 'OA退回发起人';
  if (oaStatus === 'PENDING_PUSH') return '待提交OA';
  if (oaStatus === 'PUSH_FAILED') return 'OA提交失败';
  return '待审批';
}

function requisitionApprovalStatusType(
  row: Record<string, any>,
): 'success' | 'danger' | 'warning' | 'primary' | 'info' {
  const text = requisitionApprovalStatusText(row);
  if (text.includes('通过')) return 'success';
  if (text === 'OA提交失败') return 'danger';
  if (text.includes('驳回')) return 'danger';
  return 'warning'; // 待审批 / OA审批中 / 待提交OA / OA退回发起人
}

export const requisitionApplicationConfig: BusinessDocumentConfig = {
  key: 'requisitions/applications',
  title: '领用申请单',
  endpoint: '/requisitions/applications',
  documentType: 'requisition_application',
  no: 'applicationNo',
  columns: [
    { prop: 'applicationNo', label: '申请单号', minWidth: 160, tooltip: true },
    { prop: 'deptName', label: '领用部门', minWidth: 130 },
    { prop: 'receiverIdName', label: '领用人', minWidth: 110 },
    { prop: 'warehouseName', label: '仓库', minWidth: 125 },
    { prop: 'drawTypeName', label: '领用类型', minWidth: 105, kind: 'status' },
    { prop: 'date', label: '申请日期', minWidth: 110, kind: 'date' },
    { prop: 'quantity', label: '申请总量', minWidth: 105, kind: 'number', align: 'right' },
    { prop: 'actualQty', label: '实际领用', minWidth: 105, kind: 'number', align: 'right' },
    {
      prop: 'approveStatus',
      label: '审批状态',
      minWidth: 130,
      kind: 'status',
      statusType: requisitionApprovalStatusType,
      render: requisitionApprovalStatusText,
    },
    { prop: 'createdByName', label: '创建人', minWidth: 110 },
    { prop: 'createdAt', label: '创建时间', minWidth: 150, kind: 'datetime' },
  ],
  dictionaries: ['draw_type', 'requisition_status', 'requisition_approval_status', 'yes_no'],
  creatable: true,
  createText: '新增领用申请',
  formComponent: RequisitionApplicationForm,
  openFromRoute: async (query, ctx) => {
    if (query.documentId) {
      const detail: any = await api.get(`/requisitions/applications/${query.documentId}`);
      if (String(query.view ?? '') === '1') ctx.openView(detail);
      else ctx.openEdit(detail);
    }
  },
  rowActions: [
    {
      key: 'view',
      label: '查看',
      handler: (row, ctx) => ctx.openView(row),
    },
    {
      key: 'edit',
      label: '编辑',
      show: (row) => Number(row.approveStatus) === 0,
      handler: (row, ctx) => ctx.openEdit(row),
    },
    {
      key: 'auto-output',
      label: (row) => (Number(row.autoOutputConfirmStatus) === 1 ? '查看出库' : '办理出库'),
      permission: 'requisitions:outputs',
      show: (row) =>
        Boolean(row.autoOutputId) &&
        (Number(row.approveStatus) === 1 || Boolean(row.reverseGenerated)),
      handler: (row, ctx) =>
        ctx.navigate('/requisitions/outputs', {
          documentId: String(row.autoOutputId),
          view: Number(row.autoOutputConfirmStatus) === 1 ? '1' : '0',
        }),
    },
    {
      key: 'retry-oa',
      label: '重新提交OA',
      permission: 'submit',
      kind: 'warning',
      primary: false,
      show: (row) => row.oaStatus === 'PUSH_FAILED',
      handler: async (row) => {
        const result: any = await api.post(`/requisitions/applications/${row.id}/submit-oa`, {});
        if (result?.procStatus === 'PUSH_FAILED') ElMessage.warning(result?.message ?? '提交OA失败');
        else ElMessage.success(result?.message ?? '已提交OA审批');
      },
    },
    {
      key: 'approve',
      label: '通过',
      kind: 'success',
      primary: false,
      show: canApproveApplication,
      handler: async (row) => {
        const result: any = await api.post(`/requisitions/applications/${row.id}/approve`, {
          approved: true,
          comment: '',
        });
        ElMessage.success(result?.message ?? '操作成功');
      },
    },
    {
      key: 'reject',
      label: '驳回',
      kind: 'danger',
      primary: false,
      show: canRejectApplication,
      handler: async (row) => {
        const result: any = await api.post(`/requisitions/applications/${row.id}/approve`, {
          approved: false,
          comment: '',
        });
        ElMessage.success(result?.message ?? '操作成功');
      },
    },
    {
      key: 'delete',
      label: '删除',
      kind: 'danger',
      primary: false,
      show: (row) => row.approveStatus === 0,
      confirm: '确认删除该领用申请？',
      handler: async (row) => {
        await api.delete(`/requisitions/applications/${row.id}`);
        ElMessage.success('删除成功');
      },
    },
  ],
};
