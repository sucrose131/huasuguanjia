import { Inject, Injectable, Logger } from '@nestjs/common';
import { XinfutongOaCredentialService } from '../core/credential.service';
import { XinfutongOaOrganizationService } from '../organization/organization.service';
import { XinfutongOaSyncService } from './sync.service';

/**
 * 薪福通 OA 组织域定时同步编排：每个启用账套按 组织 → 职位 → 人员 顺序拉取并落库。
 */
@Injectable()
export class XinfutongOaOrgSyncJob {
  private static readonly logger = new Logger(XinfutongOaOrgSyncJob.name);

  constructor(
    @Inject(XinfutongOaCredentialService)
    private readonly credentials: XinfutongOaCredentialService,
    @Inject(XinfutongOaOrganizationService)
    private readonly organization: XinfutongOaOrganizationService,
    @Inject(XinfutongOaSyncService)
    private readonly sync: XinfutongOaSyncService,
  ) {}

  async syncAll(): Promise<string> {
    const accounts = await this.credentials.getAllEnabled();
    if (!accounts.length) {
      throw new Error('没有启用的薪福通账套');
    }
    const summaries: string[] = [];
    for (const credential of accounts) {
      const orgs = await this.organization.getAllOrganizations(credential);
      const orgStats = await this.sync.syncOrganizations(credential, orgs);
      const positions = await this.organization.getAllPositions(credential);
      const positionStats = await this.sync.syncPositions(credential, positions);
      const members = await this.organization.getAllMembers(credential);
      const memberStats = await this.sync.syncMembers(credential, members);
      const summary =
        `${credential.name}: 组织+${orgStats.org_inserted}/${orgStats.org_updated}` +
        ` 部门+${orgStats.dept_inserted}/${orgStats.dept_updated}` +
        ` 职位+${positionStats.position_inserted}/${positionStats.position_updated}` +
        ` 人员+${memberStats.staff_inserted}/${memberStats.staff_updated}` +
        ` 账号+${memberStats.user_inserted}/${memberStats.user_updated}/${memberStats.user_skipped}`;
      XinfutongOaOrgSyncJob.logger.log(summary);
      summaries.push(summary);
    }
    return summaries.join('；');
  }
}
