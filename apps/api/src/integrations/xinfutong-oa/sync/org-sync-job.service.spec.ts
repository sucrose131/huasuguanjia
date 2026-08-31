import { beforeEach, describe, expect, it, vi } from 'vitest';
import { XinfutongOaOrgSyncJob } from './org-sync-job.service';

describe('XinfutongOaOrgSyncJob', () => {
  const credentials = { getAllEnabled: vi.fn() };
  const organization = {
    getAllOrganizations: vi.fn(),
    getAllPositions: vi.fn(),
    getAllMembers: vi.fn(),
  };
  const sync = {
    syncOrganizations: vi.fn(),
    syncPositions: vi.fn(),
    syncMembers: vi.fn(),
  };
  let job: XinfutongOaOrgSyncJob;

  beforeEach(() => {
    vi.clearAllMocks();
    job = new XinfutongOaOrgSyncJob(credentials as never, organization as never, sync as never);
  });

  it('没有启用账套时失败', async () => {
    credentials.getAllEnabled.mockResolvedValue([]);
    await expect(job.syncAll()).rejects.toThrow('没有启用的薪福通账套');
  });

  it('按组织、职位、人员顺序同步每个账套', async () => {
    const credential = { id: 1n, name: '测试账套', appId: 'a', appSecret: 's' };
    credentials.getAllEnabled.mockResolvedValue([credential]);
    const order: string[] = [];
    organization.getAllOrganizations.mockImplementation(async () => {
      order.push('orgs');
      return [{ id: 'o1' }];
    });
    organization.getAllPositions.mockImplementation(async () => {
      order.push('positions');
      return [{ id: 'p1' }];
    });
    organization.getAllMembers.mockImplementation(async () => {
      order.push('members');
      return [{ memberId: 'm1' }];
    });
    sync.syncOrganizations.mockImplementation(async () => {
      order.push('syncOrgs');
      return { org_inserted: 1, org_updated: 0, dept_inserted: 0, dept_updated: 0 };
    });
    sync.syncPositions.mockImplementation(async () => {
      order.push('syncPositions');
      return { position_inserted: 1, position_updated: 0, belongs_inserted: 0, belongs_updated: 0 };
    });
    sync.syncMembers.mockImplementation(async () => {
      order.push('syncMembers');
      return { staff_inserted: 1, staff_updated: 0, org_inserted: 0, user_inserted: 1, user_updated: 0, user_skipped: 0 };
    });
    const summary = await job.syncAll();
    expect(order).toEqual(['orgs', 'syncOrgs', 'positions', 'syncPositions', 'members', 'syncMembers']);
    expect(summary).toContain('测试账套');
    expect(summary).toContain('账号+1/0/0');
  });
});
