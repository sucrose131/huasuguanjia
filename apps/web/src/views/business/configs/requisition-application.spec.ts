import { describe, expect, it } from 'vitest';
import { requisitionApprovalStatusText } from './requisition-application';

describe('requisitionApprovalStatusText（审批状态/OA状态合并口径）', () => {
  it('终态：OA 通过/驳回带渠道，系统通过/驳回不带', () => {
    expect(requisitionApprovalStatusText({ approveStatus: 1, oaStatus: 'PASSED' })).toBe('OA已通过');
    expect(requisitionApprovalStatusText({ approveStatus: 1, oaStatus: '' })).toBe('已通过');
    expect(requisitionApprovalStatusText({ approveStatus: 1 })).toBe('已通过');
    expect(requisitionApprovalStatusText({ approveStatus: 2, oaStatus: 'REJECTED' })).toBe('OA已驳回');
    expect(requisitionApprovalStatusText({ approveStatus: 2, oaStatus: '' })).toBe('已驳回');
  });

  it('未决态：展示 OA 过程，未进入审批流程的显示待提交', () => {
    expect(requisitionApprovalStatusText({ approveStatus: 0, oaStatus: 'RUNNING' })).toBe('OA审批中');
    expect(requisitionApprovalStatusText({ approveStatus: 0, oaStatus: 'BACKTOSTART' })).toBe(
      'OA退回发起人',
    );
    expect(requisitionApprovalStatusText({ approveStatus: 0, oaStatus: 'PENDING_PUSH' })).toBe(
      '待提交OA',
    );
    expect(requisitionApprovalStatusText({ approveStatus: 0, oaStatus: 'PUSH_FAILED' })).toBe(
      'OA提交失败',
    );
    expect(requisitionApprovalStatusText({ approveStatus: 0, oaStatus: '' })).toBe('待提交');
    expect(requisitionApprovalStatusText({ approve_status: 0 })).toBe('待提交');
  });

  it('终态：取消/终止（3）按渠道区分，OA 侧撤销带渠道', () => {
    expect(requisitionApprovalStatusText({ approveStatus: 3, oaStatus: 'CANCELED', approveBy: 0 })).toBe(
      'OA已取消',
    );
    expect(requisitionApprovalStatusText({ approveStatus: 3, approveBy: 214 })).toBe('已取消');
    expect(requisitionApprovalStatusText({ approve_status: 3 })).toBe('已取消');
  });
});
