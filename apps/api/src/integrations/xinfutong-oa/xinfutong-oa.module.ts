import { Module } from '@nestjs/common';
import { XinfutongOaClient } from './core/client';
import { XinfutongOaCredentialService } from './core/credential.service';
import { XinfutongOaOrganizationService } from './organization/organization.service';
import { XinfutongOaFormService } from './form/form.service';
import { OaFormMappingService } from './form/form-mapping.service';
import { XinfutongOaApprovalService } from './approval/approval.service';
import { XinfutongOaApprovalCallbackService } from './approval/approval-callback.service';
import { XinfutongOaSyncService } from './sync/sync.service';
import { AttachmentsModule } from '../../attachments/attachments.module';
import { OaDocumentSubmissionService } from './approval/document-submission.service';
import { OaStarterContextService } from './approval/starter-context.service';
import { XinfutongOaOrgSyncJob } from './sync/org-sync-job.service';

/**
 * 薪福通 OA 对接模块
 *
 * 结构：
 * - core/        协议层：基础请求客户端、国密算法、凭证服务
 * - organization/ 业务域：组织/职位/岗位/成员/员工查询
 * - form/        业务域：表单列表/表单数据/表单配置查询
 * - approval/    业务域：审批出站发起 + 入站回调
 * - sync/        同步层：组织/岗位/成员同步到本地表
 */
@Module({
  imports: [AttachmentsModule],
  providers: [
    XinfutongOaClient,
    XinfutongOaCredentialService,
    XinfutongOaOrganizationService,
    XinfutongOaFormService,
    OaFormMappingService,
    XinfutongOaApprovalService,
    XinfutongOaApprovalCallbackService,
    XinfutongOaSyncService,
    OaDocumentSubmissionService,
    OaStarterContextService,
    XinfutongOaOrgSyncJob,
  ],
  exports: [
    XinfutongOaCredentialService,
    XinfutongOaOrganizationService,
    XinfutongOaFormService,
    OaFormMappingService,
    XinfutongOaApprovalService,
    XinfutongOaApprovalCallbackService,
    XinfutongOaSyncService,
    OaDocumentSubmissionService,
    OaStarterContextService,
    XinfutongOaOrgSyncJob,
  ],
})
export class XinfutongOaModule {}
