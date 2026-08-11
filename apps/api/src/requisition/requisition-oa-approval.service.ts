import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { XinfutongOaApprovalService } from '../integrations/xinfutong-oa/approval/approval.service';
import { XinfutongOaCredentialService } from '../integrations/xinfutong-oa/core/credential.service';

const BUSINESS_TYPE = 'requisition_application';
const FORM_KEY = 'AAC15400_NFORM_380014832305831937';

const OA_FIELDS = {
  drawType: 'vwzkeepgpoz8',
  warehouse: '405ncqs7i1t1',
  applicantName: 'h79q090vsr0x',
  applicant: 'tmsbylvkrr78',
  applicationDate: 'ig65sy4c1pr2',
  reason: 'nvm0e6c6sezz',
  details: '92c4it1x97yp',
  goodsName: '6a30y3q8ar2v',
  quantity: 'xn9kyuz6yi46',
} as const;

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
  ) {}

  async submit(drawId: bigint, userId: string): Promise<OaSubmissionResult> {
    const context = await this.buildSubmissionContext(drawId);
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
          form_key: FORM_KEY,
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
      const commonParams = {
        formKey: FORM_KEY,
        busKey: context.busKey,
        formData: JSON.stringify(context.formData),
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
          form_key: body.formKey || FORM_KEY,
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

  private async buildSubmissionContext(drawId: bigint) {
    const application = await this.prisma.hspsi_draw_approve.findFirst({
      where: { draw_id: drawId, deleted_at: null },
    });
    if (!application) throw new BadRequestException('领用申请不存在');
    const [details, warehouse, applicant, drawTypeCategory] = await Promise.all([
      this.prisma.hspsi_draw_approve_detail.findMany({
        where: { draw_id: drawId },
        orderBy: { draw_detail_id: 'asc' },
      }),
      this.prisma.hspsi_basic_warehouse.findFirst({
        where: { warehouse_id: application.warehouse_id, status: 1, deleted_at: null },
        select: { name: true },
      }),
      this.prisma.hspsi_basic_staff.findFirst({
        where: { id: application.applicant_id, status: 1, deleted_at: null },
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
    if (!warehouse) throw new BadRequestException('领用仓库不存在或已停用');
    if (!applicant) throw new BadRequestException('领用人不存在或已停用');
    if (!applicant.account_set_id || !applicant.outer_ref_id || !applicant.out_staff_id) {
      throw new BadRequestException('领用人尚未关联有效OA账号，请先同步OA组织人员');
    }

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
      return { [OA_FIELDS.goodsName]: goodsName, [OA_FIELDS.quantity]: item.draw_qty };
    });
    const applicationDate = application.draw_date;
    if (!applicationDate) throw new BadRequestException('申请日期不能为空');

    return {
      accountSetId: applicant.account_set_id,
      busKey: `${BUSINESS_TYPE}:${drawId}`,
      starterId: applicant.outer_ref_id,
      starterOrgId: primaryOrg.outer_ref_id,
      formData: {
        [OA_FIELDS.drawType]: drawType.dict_name,
        [OA_FIELDS.warehouse]: warehouse.name,
        [OA_FIELDS.applicantName]: applicant.name,
        [OA_FIELDS.applicant]: [
          {
            USRNAM: applicant.name,
            STFSEQ: applicant.out_staff_id,
            USRNBR: applicant.outer_ref_id,
            ORGSEQ: primaryOrg.outer_ref_id,
          },
        ],
        [OA_FIELDS.applicationDate]: this.formatDate(applicationDate),
        [OA_FIELDS.reason]: application.draw_reason.trim(),
        [OA_FIELDS.details]: detailData,
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
