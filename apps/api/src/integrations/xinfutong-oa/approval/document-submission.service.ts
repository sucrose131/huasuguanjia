import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Attachment, AttachmentsService } from '../../../attachments/attachments.service';
import { PrismaService } from '../../../database/prisma.service';
import { XinfutongOaCredentialService } from '../core/credential.service';
import type { OaFormMapping } from '../form/form-mapping.constants';
import { XinfutongOaApprovalService } from './approval.service';

export type OaDocumentSubmission = {
  businessType: string;
  businessId: bigint;
  userId: string;
  accountSetId: bigint;
  form: OaFormMapping;
  attachmentField: string;
  busKey: string;
  starterId: string;
  starterOrgId: string;
  formData: Record<string, unknown>;
};

export type OaDocumentSubmissionResult = {
  instanceId: bigint;
  procInstId: string;
  procStatus: string;
  busKey: string;
  errorMessage?: string;
};

@Injectable()
export class OaDocumentSubmissionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(XinfutongOaCredentialService)
    private readonly credentials: XinfutongOaCredentialService,
    @Inject(XinfutongOaApprovalService)
    private readonly approval: XinfutongOaApprovalService,
    @Inject(AttachmentsService) private readonly attachments: AttachmentsService,
  ) {}

  async submit(input: OaDocumentSubmission): Promise<OaDocumentSubmissionResult> {
    const credential = await this.credentials.getById(input.accountSetId);
    if (!credential) throw new Error('单据所属OA账套未启用');
    const instance = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.hspsi_oa_approval_instance.findFirst({
        where: {
          business_type: input.businessType,
          business_id: input.businessId,
          deleted_at: null,
        },
        orderBy: { id: 'desc' },
      });
      if (existing && ['RUNNING', 'BACKTOSTART', 'PASSED'].includes(existing.proc_status)) {
        return existing;
      }
      const data = {
        form_key: input.form.formKey,
        bus_key: input.busKey,
        proc_status: 'PENDING_PUSH',
        submitted_by: BigInt(input.userId),
        submitted_at: new Date(),
        account_set_id: input.accountSetId,
        updated_by: BigInt(input.userId),
        updated_at: new Date(),
      };
      return existing
        ? tx.hspsi_oa_approval_instance.update({ where: { id: existing.id }, data })
        : tx.hspsi_oa_approval_instance.create({
            data: {
              business_type: input.businessType,
              business_id: input.businessId,
              proc_inst_id: '',
              proc_key: '',
              callback_count: 0,
              created_by: BigInt(input.userId),
              ...data,
            },
          });
    });
    if (['RUNNING', 'BACKTOSTART', 'PASSED'].includes(instance.proc_status)) {
      return {
        instanceId: instance.id,
        procInstId: instance.proc_inst_id,
        procStatus: instance.proc_status,
        busKey: instance.bus_key,
      };
    }
    try {
      const files = await this.prepareAttachments(input, credential);
      const response = await this.approval.startFormProcess(credential, {
        formKey: input.form.formKey,
        busKey: input.busKey,
        procStartType: 'trialStart',
        starterId: input.starterId,
        starterOrgId: input.starterOrgId,
        formData: JSON.stringify({
          ...input.formData,
          ...(files.length ? { [input.attachmentField]: files } : {}),
        }),
      });
      const body = response.body;
      if (!body?.procInstId || !body.procStatus) {
        throw new Error('OA发起审批成功响应缺少procInstId或procStatus');
      }
      const updated = await this.prisma.hspsi_oa_approval_instance.update({
        where: { id: instance.id },
        data: {
          form_key: body.formKey || input.form.formKey,
          bus_key: body.busKey || input.busKey,
          proc_inst_id: body.procInstId,
          proc_status: body.procStatus,
          updated_by: BigInt(input.userId),
          updated_at: new Date(),
        },
      });
      return {
        instanceId: updated.id,
        procInstId: updated.proc_inst_id,
        procStatus: updated.proc_status,
        busKey: updated.bus_key,
      };
    } catch (error) {
      await this.prisma.hspsi_oa_approval_instance.update({
        where: { id: instance.id },
        data: {
          proc_status: 'PUSH_FAILED',
          updated_by: BigInt(input.userId),
          updated_at: new Date(),
        },
      });
      return {
        instanceId: instance.id,
        procInstId: '',
        procStatus: 'PUSH_FAILED',
        busKey: input.busKey,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async prepareAttachments(
    input: OaDocumentSubmission,
    credential: Parameters<XinfutongOaApprovalService['uploadFile']>[0],
  ) {
    const attachments = await this.attachments.listForIntegration(
      input.businessType,
      String(input.businessId),
    );
    if (!attachments.length) return [];
    const files: Array<{ id: string; objectKey: string; name: string }> = [];
    const directory = await mkdtemp(join(tmpdir(), 'hspsi-oa-upload-'));
    try {
      for (const attachment of attachments) {
        const cached = attachment.oaUploads?.find(
          (item) =>
            item.accountSetId === String(input.accountSetId) &&
            item.size === attachment.size &&
            item.fileId &&
            item.objectKey,
        );
        files.push(
          cached
            ? { id: cached.fileId, objectKey: cached.objectKey, name: attachment.fileName }
            : await this.upload(input, attachment, credential, directory),
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    return files;
  }

  private async upload(
    input: OaDocumentSubmission,
    attachment: Attachment,
    credential: Parameters<XinfutongOaApprovalService['uploadFile']>[0],
    directory: string,
  ) {
    const localPath = join(directory, `${randomUUID()}${extname(attachment.fileName)}`);
    await this.attachments.downloadToFileForIntegration(attachment.objectKey, localPath);
    if ((await stat(localPath)).size !== attachment.size) {
      throw new Error(`附件 ${attachment.fileName} 下载后大小不一致`);
    }
    const response = await this.approval.uploadFile(credential, {
      fileName: attachment.fileName,
      fileBuffer: await readFile(localPath),
      mimeType: attachment.contentType,
    });
    const fileId = response.body?.fileId;
    const objectKey = response.body?.objectKey;
    if (!fileId || !objectKey) throw new Error(`附件 ${attachment.fileName} 上传OA后缺少文件标识`);
    await this.attachments.cacheOaUpload(
      input.businessType,
      String(input.businessId),
      attachment.id,
      {
        accountSetId: String(input.accountSetId),
        fileId,
        objectKey,
        uploadedAt: new Date().toISOString(),
        size: attachment.size,
      },
    );
    return { id: fileId, objectKey, name: attachment.fileName };
  }
}
