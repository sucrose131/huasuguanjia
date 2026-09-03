import { describe, expect, it } from 'vitest';
import { approvalStatusText, approvalStatusType } from './approval-status';

describe('approvalStatusText（审批/OA 合并口径，领用与采购共用）', () => {
  it('终态：OA 通过/驳回带渠道，系统通过/驳回不带', () => {
    expect(approvalStatusText({ approveStatus: 1, oaStatus: 'PASSED' })).toBe('OA已通过');
    expect(approvalStatusText({ approveStatus: 1, oaStatus: '' })).toBe('已通过');
    expect(approvalStatusText({ approve_status: 1 })).toBe('已通过');
    expect(approvalStatusText({ approveStatus: 2, oaStatus: 'REJECTED' })).toBe('OA已驳回');
    expect(approvalStatusText({ approveStatus: 2, oaStatus: '' })).toBe('已驳回');
  });

  it('未决态：展示 OA 过程，否则待审批', () => {
    expect(approvalStatusText({ approveStatus: 0, oaStatus: 'RUNNING' })).toBe('OA审批中');
    expect(approvalStatusText({ approveStatus: 0, oaStatus: 'BACKTOSTART' })).toBe('OA退回发起人');
    expect(approvalStatusText({ approveStatus: 0, oaStatus: 'PENDING_PUSH' })).toBe('待提交OA');
    expect(approvalStatusText({ approveStatus: 0, oaStatus: 'PUSH_FAILED' })).toBe('OA提交失败');
    expect(approvalStatusText({ approveStatus: 0, oaStatus: '' })).toBe('待审批');
    expect(approvalStatusText({})).toBe('待审批');
  });

  it('标签颜色：通过绿、驳回/提交失败红、其余警告', () => {
    expect(approvalStatusType({ approveStatus: 1, oaStatus: 'PASSED' })).toBe('success');
    expect(approvalStatusType({ approveStatus: 1 })).toBe('success');
    expect(approvalStatusType({ approveStatus: 2, oaStatus: 'REJECTED' })).toBe('danger');
    expect(approvalStatusType({ approveStatus: 2 })).toBe('danger');
    expect(approvalStatusType({ approveStatus: 0, oaStatus: 'PUSH_FAILED' })).toBe('danger');
    expect(approvalStatusType({ approveStatus: 0, oaStatus: 'RUNNING' })).toBe('warning');
    expect(approvalStatusType({ approveStatus: 0 })).toBe('warning');
  });
});
