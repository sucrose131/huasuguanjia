import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Attachment, AttachmentsService } from '../attachments/attachments.service';
import { PrismaService } from '../database/prisma.service';
import { XinfutongOaApprovalService } from '../integrations/xinfutong-oa/approval/approval.service';
import { XinfutongOaCredentialService } from '../integrations/xinfutong-oa/core/credential.service';
import { OA_FORM_MAPPINGS } from '../integrations/xinfutong-oa/form/form-mapping.constants';

const BUSINESS_TYPE = 'purchase_application';
const FORM = OA_FORM_MAPPINGS.purchase_application;
const FIELDS = Object.fromEntries(
  Object.entries(FORM.fields).map(([key, value]) => [key, value.uniqueName]),
) as { [K in keyof typeof FORM.fields]: string };

type SubmissionResult = {
  instanceId: bigint;
  procInstId: string;
  procStatus: string;
  busKey: string;
  errorMessage?: string;
};

@Injectable()
export class PurchaseOaApprovalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(XinfutongOaCredentialService)
    private readonly credentials: XinfutongOaCredentialService,
    @Inject(XinfutongOaApprovalService)
    private readonly approval: XinfutongOaApprovalService,
    @Inject(AttachmentsService) private readonly attachments: AttachmentsService,
  ) {}

  async submit(purId: bigint, userId: string): Promise<SubmissionResult> {
    const context = await this.buildContext(purId, userId);
    const credential = await this.credentials.getById(context.accountSetId);
    if (!credential) throw new BadRequestException('采购申请所属OA账套未启用');

    const instance = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT pur_id FROM hspsi_purchase_approve WHERE pur_id = ? FOR UPDATE',
        purId,
      );
      const application = await tx.hspsi_purchase_approve.findFirst({
        where: { pur_id: purId, deleted_at: null },
        select: { status: true, approve_status: true },
      });
      if (!application) throw new BadRequestException('采购申请不存在');
      if (application.status !== 1 || application.approve_status !== 0) {
        throw new BadRequestException('仅已提交且待审批的采购申请可以发送OA');
      }
      const existing = await tx.hspsi_oa_approval_instance.findFirst({
        where: { business_type: BUSINESS_TYPE, business_id: purId, deleted_at: null },
        orderBy: { id: 'desc' },
      });
      if (existing && ['RUNNING', 'BACKTOSTART', 'PASSED'].includes(existing.proc_status)) {
        return existing;
      }
      if (existing) {
        return tx.hspsi_oa_approval_instance.update({
          where: { id: existing.id },
          data: {
            form_key: FORM.formKey,
            bus_key: context.busKey,
            proc_status: 'PENDING_PUSH',
            submitted_by: BigInt(userId),
            submitted_at: new Date(),
            account_set_id: context.accountSetId,
            updated_by: BigInt(userId),
            updated_at: new Date(),
          },
        });
      }
      return tx.hspsi_oa_approval_instance.create({
        data: {
          business_type: BUSINESS_TYPE,
          business_id: purId,
          form_key: FORM.formKey,
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
      const files = await this.prepareAttachments(purId, context.accountSetId, credential);
      const response = await this.approval.startFormProcess(credential, {
        formKey: FORM.formKey,
        busKey: context.busKey,
        procStartType: 'trialStart',
        formData: JSON.stringify({
          ...context.formData,
          ...(files.length ? { [FIELDS.attachments]: files } : {}),
        }),
        starterId: context.starterId,
        starterOrgId: context.starterOrgId,
      });
      const body = response.body;
      if (!body?.procInstId || !body.procStatus) {
        throw new Error('OA发起审批成功响应缺少procInstId或procStatus');
      }
      const updated = await this.prisma.hspsi_oa_approval_instance.update({
        where: { id: instance.id },
        data: {
          form_key: body.formKey || FORM.formKey,
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
      return {
        instanceId: instance.id,
        procInstId: '',
        procStatus: 'PUSH_FAILED',
        busKey: context.busKey,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async buildContext(purId: bigint, userId: string) {
    const application = await this.prisma.hspsi_purchase_approve.findFirst({
      where: { pur_id: purId, deleted_at: null },
    });
    if (!application) throw new BadRequestException('采购申请不存在');
    const [details, warehouse, user, organization, sourcePlan] = await Promise.all([
      this.prisma.hspsi_purchase_approve_detail.findMany({
        where: { pur_id: purId },
        orderBy: { id: 'asc' },
      }),
      this.prisma.hspsi_basic_warehouse.findFirst({
        where: { warehouse_id: application.warehouse_id, status: 1, deleted_at: null },
        select: { name: true },
      }),
      this.prisma.hspsi_sys_user.findFirst({
        where: { id: BigInt(userId), status: 1, deleted_at: null },
        select: { username: true },
      }),
      this.prisma.hspsi_basic_organization.findFirst({
        where: { org_id: application.org_id, deleted_at: null },
        select: { account_set_id: true },
      }),
      application.source_type === 'production_plan' && application.source_id > 0n
        ? this.prisma.hspsi_production_plan.findFirst({
            where: { plan_id: application.source_id, deleted_at: null },
            select: { plan_no: true },
          })
        : null,
    ]);
    if (!details.length) throw new BadRequestException('采购申请没有商品明细');
    if (!warehouse) throw new BadRequestException('目标仓库不存在或已停用');
    if (!user) throw new BadRequestException('提交人账号不存在或已停用');
    if (!organization?.account_set_id)
      throw new BadRequestException('采购申请所属组织未关联OA账套');

    const staff = await this.prisma.hspsi_basic_staff.findFirst({
      where: {
        mobile: user.username,
        account_set_id: organization.account_set_id,
        status: 1,
        deleted_at: null,
      },
      select: { id: true, outer_ref_id: true },
    });
    if (!staff?.outer_ref_id) throw new BadRequestException('提交人尚未关联有效OA账号');
    const membership = await this.prisma.hspsi_basic_staff_organizations.findFirst({
      where: {
        staff_id: staff.id,
        account_set_id: organization.account_set_id,
        type: 1,
        deleted_at: null,
      },
      orderBy: [{ org_type: 'desc' }, { id: 'asc' }],
    });
    if (!membership) throw new BadRequestException('提交人没有有效的OA主部门');
    const starterOrg =
      membership.org_type === 2
        ? await this.prisma.hspsi_basic_dept.findFirst({
            where: { dept_id: membership.org_id, deleted_at: null },
            select: { outer_ref_id: true },
          })
        : await this.prisma.hspsi_basic_organization.findFirst({
            where: { org_id: membership.org_id, deleted_at: null },
            select: { outer_ref_id: true },
          });
    if (!starterOrg?.outer_ref_id) throw new BadRequestException('提交人的OA主部门标识缺失');

    const goodsIds = [...new Set(details.map((item) => item.goods_id))];
    const skuIds = [...new Set(details.map((item) => item.sku_id))];
    const unitIds = [...new Set(details.map((item) => BigInt(item.unit_type)))];
    const [goods, skus, units] = await Promise.all([
      this.prisma.hspsi_goods_info.findMany({
        where: { goods_id: { in: goodsIds } },
        select: { goods_id: true, goods_name: true },
      }),
      this.prisma.hspsi_goods_info_sku.findMany({
        where: { sku_id: { in: skuIds } },
        select: { sku_id: true, spec_models: true },
      }),
      this.prisma.hspsi_basic_unit.findMany({
        where: { id: { in: unitIds }, deleted_at: null },
        select: { id: true, name: true },
      }),
    ]);
    const goodsMap = new Map(goods.map((item) => [String(item.goods_id), item.goods_name]));
    const skuMap = new Map(skus.map((item) => [String(item.sku_id), item.spec_models]));
    const unitMap = new Map(units.map((item) => [String(item.id), item.name]));
    const detailData = details.map((item) => {
      const goodsName = goodsMap.get(String(item.goods_id));
      if (!goodsName) throw new BadRequestException(`商品 ${item.goods_id} 不存在`);
      return {
        [FIELDS.goodsName]: goodsName,
        [FIELDS.skuName]: skuMap.get(String(item.sku_id)) ?? '',
        [FIELDS.quantity]: item.qty,
        [FIELDS.unit]: unitMap.get(String(item.unit_type)) ?? '',
        [FIELDS.detailRemark]: item.remark,
      };
    });
    const source = sourcePlan?.plan_no
      ? `生产计划：${sourcePlan.plan_no}`
      : application.source_type && application.source_id > 0n
        ? `${application.source_type}:${application.source_id}`
        : '';
    return {
      accountSetId: organization.account_set_id,
      starterId: staff.outer_ref_id,
      starterOrgId: starterOrg.outer_ref_id,
      busKey: `${BUSINESS_TYPE}:${purId}`,
      formData: {
        [FIELDS.reason]: application.pur_reson,
        [FIELDS.warehouse]: warehouse.name,
        [FIELDS.source]: source,
        [FIELDS.remark]: application.remark,
        [FIELDS.details]: detailData,
      },
    };
  }

  private async prepareAttachments(
    purId: bigint,
    accountSetId: bigint,
    credential: Parameters<XinfutongOaApprovalService['uploadFile']>[0],
  ) {
    const attachments = await this.attachments.listForIntegration(BUSINESS_TYPE, String(purId));
    if (!attachments.length) return [];
    const files: Array<{ id: string; objectKey: string; name: string }> = [];
    const directory = await mkdtemp(join(tmpdir(), 'hspsi-oa-upload-'));
    try {
      for (const attachment of attachments) {
        const cached = attachment.oaUploads?.find(
          (item) =>
            item.accountSetId === String(accountSetId) &&
            item.size === attachment.size &&
            item.fileId &&
            item.objectKey,
        );
        if (cached) {
          files.push({
            id: cached.fileId,
            objectKey: cached.objectKey,
            name: attachment.fileName,
          });
          continue;
        }
        files.push(
          await this.uploadAttachment(purId, accountSetId, attachment, credential, directory),
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    return files;
  }

  private async uploadAttachment(
    purId: bigint,
    accountSetId: bigint,
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
    await this.attachments.cacheOaUpload(BUSINESS_TYPE, String(purId), attachment.id, {
      accountSetId: String(accountSetId),
      fileId,
      objectKey,
      uploadedAt: new Date().toISOString(),
      size: attachment.size,
    });
    return { id: fileId, objectKey, name: attachment.fileName };
  }
}
