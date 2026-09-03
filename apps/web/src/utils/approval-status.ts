/**
 * 单据"审批状态"合并口径：终态区分 OA/系统渠道，未决态展示 OA 过程。
 * 适用于列表单列展示（审批状态 + OA 状态合并）；不改变"OA 审批单据不能系统内通过"的既有约束。
 */
export type ApprovalStatusTagType = 'success' | 'danger' | 'warning' | 'primary' | 'info';

export function approvalStatusText(row: Record<string, any>): string {
  const approveStatus = Number(row.approveStatus ?? row.approve_status ?? 0);
  const oaStatus = String(row.oaStatus ?? '');
  if (approveStatus === 1) return oaStatus === 'PASSED' ? 'OA已通过' : '已通过';
  if (approveStatus === 2) return oaStatus === 'REJECTED' ? 'OA已驳回' : '已驳回';
  if (approveStatus === 3) {
    // 取消/终止（approve_status=3）：OA 侧撤销（回调以 0 号操作人写入）带渠道，本系统终止（创建人）不带
    const bySystem = Number(row.approveBy ?? row.approve_by ?? 0) === 0;
    return oaStatus === 'CANCELED' && bySystem ? 'OA已取消' : '已取消';
  }
  if (oaStatus === 'RUNNING') return 'OA审批中';
  if (oaStatus === 'BACKTOSTART') return 'OA退回发起人';
  if (oaStatus === 'PENDING_PUSH') return '待提交OA';
  if (oaStatus === 'PUSH_FAILED') return 'OA提交失败';
  // 单据未进入审批流程（草稿/撤回待重提/未推送）：显示"待提交"，与 OA 各过程态区分
  return '待提交';
}

export function approvalStatusType(row: Record<string, any>): ApprovalStatusTagType {
  const text = approvalStatusText(row);
  if (text.includes('通过')) return 'success';
  if (text.includes('取消')) return 'info';
  if (text === 'OA提交失败') return 'danger';
  if (text.includes('驳回')) return 'danger';
  return 'warning'; // 待提交 / OA审批中 / 待提交OA / OA退回发起人
}
