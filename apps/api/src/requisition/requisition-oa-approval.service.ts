import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Attachment, AttachmentsService } from '../attachments/attachments.service';
import { PrismaService } from '../database/prisma.service';
import { XinfutongOaApprovalService } from '../integrations/xinfutong-oa/approval/approval.service';
import { XinfutongOaCredentialService } from '../integrations/xinfutong-oa/core/credential.service';
import { OaFormMappingService } from '../integrations/xinfutong-oa/form/form-mapping.service';
import type { OaFormMapping } from '../integrations/xinfutong-oa/form/form-mapping.constants';

const BUSINESS_TYPE = 'requisition_application';

type OaSubmissionResult = {
  instanceId: bigint;
  procInstId: string;
  procStatus: string;
  busKey: string;
  errorMessage?: string;
};

@Injectable()
export class RequisitionOaApprovalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(XinfutongOaCredentialService)
    private readonly credentialService: XinfutongOaCredentialService,
    @Inject(XinfutongOaApprovalService)
    private readonly approvalService: XinfutongOaApprovalService,
    @Inject(AttachmentsService)
    private readonly attachmentsService: AttachmentsService,
    @Inject(OaFormMappingService) private readonly mappingService: OaFormMappingService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /** OA 审批是否启用；关闭时拦截发起（单据保留系统内待审批，不写 OA 实例） */
  private get oaApprovalEnabled() {
    return this.config.get<string>('XINFUTONG_OA_APPROVAL_ENABLED', 'true') !== 'false';
  }

  async submit(drawId: bigint, userId: string): Promise<OaSubmissionResult> {
    if (!this.oaApprovalEnabled) {
      return {
        instanceId: 0n,
        procInstId: '',
        procStatus: 'PUSH_FAILED',
        busKey: `${BUSINESS_TYPE}:${drawId}`,
        errorMessage: 'OA审批已暂停，单据保留在系统内审批',
      };
    }
    // 后端兜底：账套以单据所属组织为准，提交人按 (登录用户, 单据组织账套) 解析，
    // 不信任前端自动填入的主身份 staff_id（多账套用户可能跨账套错配）。
    const appBrief = await this.prisma.hspsi_draw_approve.findFirst({
      where: { draw_id: drawId, deleted_at: null },
      select: { org_id: true, draw_type: true, applicant_id: true },
    });
    if (!appBrief) throw new BadRequestException('领用申请不存在');
    // 非「借用」类型的领用申请走系统内审批，不推送 OA。
    if (Number(appBrief.draw_type) !== 2) {
      throw new BadRequestException('非借用领用申请走系统内审批，无需提交OA');
    }
    const orgBrief = await this.prisma.hspsi_basic_organization.findFirst({
      where: { org_id: appBrief.org_id, deleted_at: null },
      select: { account_set_id: true },
    });
    if (!orgBrief?.account_set_id) throw new BadRequestException('领用申请所属组织未关联OA账套');
    const accountSetId = orgBrief.account_set_id;
    // 直接领用出库反向生成的借用申请：以领用人（接收人）的身份发起 OA，操作人仅作系统提交人；
    // 正常借用申请：申请人必须是提交人在单据账套下的 OA 员工身份（防跨账套错配）。
    const directOutput = await this.prisma.hspsi_draw_approve_output.findFirst({
      where: {
        draw_id: drawId,
        generation_key: { startsWith: 'direct-requisition-output:' },
        deleted_at: null,
      },
      select: { draw_output_id: true },
    });
    let applicantStaffId: bigint;
    if (directOutput) {
      if (!appBrief.applicant_id || appBrief.applicant_id <= 0n) {
        throw new BadRequestException('领用申请领用人无效，无法发起OA');
      }
      applicantStaffId = appBrief.applicant_id;
    } else {
      const identity = await this.prisma.hspsi_sys_user_oa_staff.findFirst({
        where: { user_id: BigInt(userId), account_set_id: accountSetId },
        select: { staff_id: true },
      });
      if (!identity?.staff_id) {
        throw new BadRequestException('提交人尚未关联该账套的OA员工，请先同步OA组织人员');
      }
      applicantStaffId = identity.staff_id;
    }
    const form = await this.mappingService.getMapping(BUSINESS_TYPE, accountSetId);
    const context = await this.buildSubmissionContext(drawId, form, accountSetId, applicantStaffId);
    const credential = await this.credentialService.getById(context.accountSetId);
    if (!credential) throw new BadRequestException('领用人所属OA账套未启用');

    const instance = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT draw_id FROM hspsi_draw_approve WHERE draw_id = ? FOR UPDATE',
        drawId,
      );
      const current = await tx.hspsi_draw_approve.findFirst({
        where: { draw_id: drawId, deleted_at: null },
        select: { approve_status: true, status: true },
      });
      if (!current) throw new BadRequestException('领用申请不存在');
      if (current.approve_status !== 0 || current.status !== 1) {
        throw new BadRequestException('仅已提交且待审批的领用申请可以发送OA');
      }

      const existing = await tx.hspsi_oa_approval_instance.findFirst({
        where: { business_type: BUSINESS_TYPE, business_id: drawId, deleted_at: null },
        orderBy: { id: 'desc' },
      });
      if (existing && ['RUNNING', 'BACKTOSTART', 'PASSED'].includes(existing.proc_status)) {
        return existing;
      }
      if (existing) {
        return tx.hspsi_oa_approval_instance.update({
          where: { id: existing.id },
          data: {
            proc_status: 'PENDING_PUSH',
            submitted_by: BigInt(userId),
            submitted_at: new Date(),
            updated_by: BigInt(userId),
            updated_at: new Date(),
          },
        });
      }
      return tx.hspsi_oa_approval_instance.create({
        data: {
          business_type: BUSINESS_TYPE,
          business_id: drawId,
          form_key: form.formKey,
          bus_key: context.busKey,
          proc_inst_id: '',
          proc_key: '',
          proc_status: 'PENDING_PUSH',
          submitted_by: BigInt(userId),
          submitted_at: new Date(),
          account_set_id: context.accountSetId,
          created_by: BigInt(userId),
          updated_by: BigInt(userId),
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
      const attachmentFields = await this.prepareOaAttachments(
        drawId,
        context.accountSetId,
        credential,
        form.fields.attachments!.uniqueName,
      );
      const commonParams = {
        formKey: form.formKey,
        busKey: context.busKey,
        formData: JSON.stringify({ ...context.formData, ...attachmentFields }),
        starterId: context.starterId,
        starterOrgId: context.starterOrgId,
      } as const;
      const response = await this.approvalService.startFormProcess(credential, {
        ...commonParams,
        procStartType: 'trialStart',
      });
      const body = response.body;
      if (!body?.procInstId || !body.procStatus) {
        throw new Error('OA发起审批成功响应缺少procInstId或procStatus');
      }
      const updated = await this.prisma.hspsi_oa_approval_instance.update({
        where: { id: instance.id },
        data: {
          form_key: body.formKey || form.formKey,
          bus_key: body.busKey || context.busKey,
          proc_inst_id: body.procInstId,
          proc_status: body.procStatus,
          updated_by: BigInt(userId),
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
        data: { proc_status: 'PUSH_FAILED', updated_by: BigInt(userId), updated_at: new Date() },
      });
      const detail = error instanceof Error ? error.message : String(error);
      return {
        instanceId: instance.id,
        procInstId: '',
        procStatus: 'PUSH_FAILED',
        busKey: context.busKey,
        errorMessage: detail,
      };
    }
  }

  /**
   * 领用人（创建人）主动撤销已在 OA 运行中的借用申请流程。
   * 以领用人在单据账套下的 OA 员工身份执行撤销；OA 已撤销（上次本地落账失败后的重试）视为成功。
   * OA 失败时抛错，由调用方保证本地单据仍保持审批中。
   */
  async cancelRemoteProcess(
    instance: { account_set_id: bigint; bus_key: string; business_id: bigint },
    applicantStaffId: bigint,
    approveComment = '创建人终止审批',
  ): Promise<void> {
    const credential = await this.credentialService.getById(instance.account_set_id);
    if (!credential) throw new BadRequestException('领用申请所属账套未启用，无法撤销OA审批');
    const staff = await this.prisma.hspsi_basic_staff.findFirst({
      where: {
        id: applicantStaffId,
        account_set_id: instance.account_set_id,
        status: 1,
        deleted_at: null,
      },
      select: { outer_ref_id: true },
    });
    if (!staff?.outer_ref_id) {
      throw new BadRequestException('领用人尚未关联有效OA账号，请先同步OA组织人员');
    }
    const busKey = instance.bus_key || `${BUSINESS_TYPE}:${instance.business_id}`;
    try {
      await this.approvalService.dealProcess(credential, {
        approverId: staff.outer_ref_id,
        operateType: 'cancel',
        busKey,
        approveComment,
      });
    } catch (error) {
      if (this.isAlreadyCanceledError(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`撤销OA审批失败：${message}`);
    }
  }

  private isAlreadyCanceledError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /已撤销|已取消|已经撤销|已经取消|already\s*cancel|already\s*revok/i.test(message);
  }

  private async prepareOaAttachments(
    drawId: bigint,
    accountSetId: bigint,
    credential: Parameters<XinfutongOaApprovalService['uploadFile']>[0],
    attachmentUniqueName: string,
  ) {
    const attachments = await this.attachmentsService.listForIntegration(
      BUSINESS_TYPE,
      String(drawId),
    );
    if (!attachments.length) return {};

    const files: Array<{ id: string; objectKey: string; name: string }> = [];
    const tempDirectory = await mkdtemp(join(tmpdir(), 'hspsi-oa-upload-'));
    try {
      for (const attachment of attachments) {
        const cached = attachment.oaUploads?.find(
          (item) =>
            item.accountSetId === String(accountSetId) &&
            item.size === attachment.size &&
            item.fileId &&
            item.objectKey,
        );
        let oaFile: { id: string; objectKey: string; name: string };
        if (cached) {
          oaFile = { id: cached.fileId, objectKey: cached.objectKey, name: attachment.fileName };
        } else {
          oaFile = await this.uploadAttachmentToOa(
            drawId,
            accountSetId,
            attachment,
            credential,
            tempDirectory,
          );
        }
        files.push(oaFile);
      }
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
    return files.length ? { [attachmentUniqueName]: files } : {};
  }

  private async uploadAttachmentToOa(
    drawId: bigint,
    accountSetId: bigint,
    attachment: Attachment,
    credential: Parameters<XinfutongOaApprovalService['uploadFile']>[0],
    tempDirectory: string,
  ) {
    const localPath = join(tempDirectory, `${randomUUID()}${extname(attachment.fileName)}`);
    await this.attachmentsService.downloadToFileForIntegration(attachment.objectKey, localPath);
    const downloaded = await stat(localPath);
    if (downloaded.size !== attachment.size) {
      throw new Error(`附件 ${attachment.fileName} 下载后大小不一致`);
    }
    const response = await this.approvalService.uploadFile(credential, {
      fileName: attachment.fileName,
      fileBuffer: await readFile(localPath),
      mimeType: attachment.contentType,
    });
    const fileId = response.body?.fileId;
    const objectKey = response.body?.objectKey;
    if (!fileId || !objectKey) throw new Error(`附件 ${attachment.fileName} 上传OA后缺少文件标识`);
    await this.attachmentsService.cacheOaUpload(BUSINESS_TYPE, String(drawId), attachment.id, {
      accountSetId: String(accountSetId),
      fileId,
      objectKey,
      uploadedAt: new Date().toISOString(),
      size: attachment.size,
    });
    return { id: fileId, objectKey, name: attachment.fileName };
  }

  private async buildSubmissionContext(
    drawId: bigint,
    form: OaFormMapping,
    accountSetId: bigint,
    applicantStaffId: bigint,
  ) {
    const un = (key: string) => form.fields[key]!.uniqueName;
    const f = {
      organization: un('organization'),
      department: un('department'),
      drawType: un('drawType'),
      warehouse: un('warehouse'),
      applicant: un('applicant'),
      applicationDate: un('applicationDate'),
      reason: un('reason'),
      details: un('details'),
      goodsName: un('goodsName'),
      quantity: un('quantity'),
    };
    const application = await this.prisma.hspsi_draw_approve.findFirst({
      where: { draw_id: drawId, deleted_at: null },
    });
    if (!application) throw new BadRequestException('领用申请不存在');
    // 后端兜底：单据领用人必须是提交人在单据账套下的员工身份，
    // 防止前端自动填入其他账套的主身份导致跨账套错配。
    if (application.applicant_id !== applicantStaffId) {
      throw new BadRequestException(
        '领用人与提交人OA身份不一致，请刷新页面重新选择领用人后提交',
      );
    }
    const [details, organization, department, warehouse, applicant, drawTypeCategory] =
      await Promise.all([
        this.prisma.hspsi_draw_approve_detail.findMany({
          where: { draw_id: drawId },
          orderBy: { draw_detail_id: 'asc' },
        }),
        this.prisma.hspsi_basic_organization.findFirst({
          where: { org_id: application.org_id, deleted_at: null },
          select: { name: true },
        }),
        this.prisma.hspsi_basic_dept.findFirst({
          where: { dept_id: application.dept_id, deleted_at: null },
          select: { name: true },
        }),
        this.prisma.hspsi_basic_warehouse.findFirst({
          where: { warehouse_id: application.warehouse_id, status: 1, deleted_at: null },
          select: { name: true },
        }),
        this.prisma.hspsi_basic_staff.findFirst({
          where: { id: applicantStaffId, account_set_id: accountSetId, status: 1, deleted_at: null },
          select: {
            id: true,
            name: true,
            account_set_id: true,
            outer_ref_id: true,
            out_staff_id: true,
          },
        }),
        this.prisma.hspsi_sys_dictionary_category.findFirst({
          where: { dict_catg_code: 'draw_type', deleted_at: null },
          select: { dict_catg_id: true },
        }),
      ]);
    if (!details.length) throw new BadRequestException('领用申请没有商品明细');
    if (!organization) throw new BadRequestException('领用申请所属组织不存在');
    if (!department) throw new BadRequestException('领用部门不存在');
    if (!warehouse) throw new BadRequestException('领用仓库不存在或已停用');
    if (!applicant) throw new BadRequestException('领用人不存在或已停用');
    if (!applicant.account_set_id || !applicant.outer_ref_id || !applicant.out_staff_id) {
      throw new BadRequestException('领用人尚未关联有效OA账号，请先同步OA组织人员');
    }

    // 部门有条件跟随：优先单据所选部门（须属于该员工，主/兼任），否则回退主部门
    const primaryMembership = await this.prisma.hspsi_basic_staff_organizations.findFirst({
      where: {
        staff_id: applicant.id,
        account_set_id: applicant.account_set_id,
        type: 1,
        deleted_at: null,
      },
      orderBy: [{ org_type: 'desc' }, { id: 'asc' }],
    });
    if (!primaryMembership) throw new BadRequestException('领用人没有有效的OA主部门');
    let orgSeq = '';
    if (application.dept_id > 0n) {
      const deptBelongs = await this.prisma.hspsi_basic_staff_organizations.findFirst({
        where: {
          staff_id: applicant.id,
          account_set_id: applicant.account_set_id,
          org_type: 2,
          org_id: application.dept_id,
          deleted_at: null,
        },
        select: { id: true },
      });
      if (deptBelongs) {
        const selectedDept = await this.prisma.hspsi_basic_dept.findFirst({
          where: { dept_id: application.dept_id, deleted_at: null },
          select: { outer_ref_id: true },
        });
        if (selectedDept?.outer_ref_id) orgSeq = selectedDept.outer_ref_id;
      }
    }
    if (!orgSeq) {
      const primaryOrg =
        primaryMembership.org_type === 2
          ? await this.prisma.hspsi_basic_dept.findFirst({
              where: { dept_id: primaryMembership.org_id, deleted_at: null },
              select: { outer_ref_id: true },
            })
          : await this.prisma.hspsi_basic_organization.findFirst({
              where: { org_id: primaryMembership.org_id, deleted_at: null },
              select: { outer_ref_id: true },
            });
      if (!primaryOrg?.outer_ref_id) {
        throw new BadRequestException('领用人的OA主部门标识缺失，请先同步OA组织人员');
      }
      orgSeq = primaryOrg.outer_ref_id;
    }

    const drawType = drawTypeCategory
      ? await this.prisma.hspsi_sys_dictionary.findFirst({
          where: {
            dict_catg_id: drawTypeCategory.dict_catg_id,
            dict_value: String(application.draw_type),
            deleted_at: null,
          },
          select: { dict_name: true },
        })
      : null;
    if (!drawType) throw new BadRequestException('领用类型字典不存在');

    const goods = await this.prisma.hspsi_goods_info.findMany({
      where: { goods_id: { in: details.map((item) => item.goods_id) } },
      select: { goods_id: true, goods_name: true },
    });
    const goodsNames = new Map(goods.map((item) => [String(item.goods_id), item.goods_name]));
    const detailData = details.map((item) => {
      const goodsName = goodsNames.get(String(item.goods_id));
      if (!goodsName) throw new BadRequestException(`商品 ${item.goods_id} 不存在`);
      return { [f.goodsName]: goodsName, [f.quantity]: item.draw_qty };
    });
    const applicationDate = application.draw_date;
    if (!applicationDate) throw new BadRequestException('申请日期不能为空');

    return {
      accountSetId: applicant.account_set_id,
      busKey: `${BUSINESS_TYPE}:${drawId}`,
      starterId: applicant.outer_ref_id,
      starterOrgId: orgSeq,
      formData: {
        [f.organization]: organization.name,
        [f.department]: department.name,
        [f.drawType]: drawType.dict_name,
        [f.warehouse]: warehouse.name,
        [f.applicant]: [
          {
            USRNAM: applicant.name,
            STFSEQ: applicant.out_staff_id,
            USRNBR: applicant.outer_ref_id,
            ORGSEQ: orgSeq,
          },
        ],
        [f.applicationDate]: this.formatDate(applicationDate),
        [f.reason]: application.draw_reason.trim(),
        [f.details]: detailData,
      },
    };
  }

  private formatDate(value: Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
