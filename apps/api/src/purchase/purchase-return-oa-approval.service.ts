import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OaDocumentSubmissionService } from '../integrations/xinfutong-oa/approval/document-submission.service';
import { OaStarterContextService } from '../integrations/xinfutong-oa/approval/starter-context.service';
import { OA_FORM_MAPPINGS } from '../integrations/xinfutong-oa/form/form-mapping.constants';

const BUSINESS_TYPE = 'purchase_return';
const FORM = OA_FORM_MAPPINGS.purchase_return;
const FIELDS = Object.fromEntries(
  Object.entries(FORM.fields).map(([key, value]) => [key, value.uniqueName]),
) as { [K in keyof typeof FORM.fields]: string };

@Injectable()
export class PurchaseReturnOaApprovalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OaStarterContextService) private readonly starters: OaStarterContextService,
    @Inject(OaDocumentSubmissionService) private readonly submissions: OaDocumentSubmissionService,
  ) {}

  async submit(exitId: bigint, userId: string) {
    const header = await this.prisma.hspsi_purchase_order_input_exit.findFirst({
      where: { po_exit_id: exitId, deleted_at: null },
    });
    if (!header) throw new BadRequestException('采购退货不存在');
    if (!header.status || header.approve_status !== 0) {
      throw new BadRequestException('仅已提交且待审批的采购退货可以发送OA');
    }
    const [details, receipt, order, returnType] = await Promise.all([
      this.prisma.hspsi_purchase_order_input_exit_detail.findMany({
        where: { po_exit_id: exitId, deleted_at: null },
        orderBy: { serial_number: 'asc' },
      }),
      header.po_input_id > 0n
        ? this.prisma.hspsi_purchase_order_input.findFirst({
            where: { po_input_id: header.po_input_id, deleted_at: null },
            select: { po_input_no: true },
          })
        : null,
      this.prisma.hspsi_purchase_order.findFirst({
        where: { po_id: header.po_id, deleted_at: null },
        select: { po_no: true, org_id: true },
      }),
      this.dictionaryName('purchase_return_type', header.exit_type),
    ]);
    if (!details.length) throw new BadRequestException('采购退货没有商品明细');
    if (!order) throw new BadRequestException('来源采购订单不存在');
    const starter = await this.starters.resolve(userId, order.org_id);
    const [goods, skus, units] = await Promise.all([
      this.prisma.hspsi_goods_info.findMany({
        where: { goods_id: { in: details.map((item) => item.goods_id) } },
        select: { goods_id: true, goods_name: true },
      }),
      this.prisma.hspsi_goods_info_sku.findMany({
        where: { sku_id: { in: details.map((item) => item.sku_id) } },
        select: { sku_id: true, spec_models: true },
      }),
      this.prisma.hspsi_basic_unit.findMany({
        where: { id: { in: details.map((item) => item.unit_type) }, deleted_at: null },
        select: { id: true, name: true },
      }),
    ]);
    const goodsMap = new Map(goods.map((item) => [String(item.goods_id), item.goods_name]));
    const skuMap = new Map(skus.map((item) => [String(item.sku_id), item.spec_models]));
    const unitMap = new Map(units.map((item) => [String(item.id), item.name]));
    return this.submissions.submit({
      businessType: BUSINESS_TYPE,
      businessId: exitId,
      userId,
      accountSetId: starter.accountSetId,
      form: FORM,
      attachmentField: FIELDS.attachments,
      busKey: `${BUSINESS_TYPE}:${exitId}`,
      starterId: starter.starterId,
      starterOrgId: starter.starterOrgId,
      formData: {
        [FIELDS.returnDate]: this.formatDate(header.exit_date),
        [FIELDS.returnType]: returnType,
        [FIELDS.reason]: header.exit_reson,
        [FIELDS.sourceReceipt]: receipt?.po_input_no ?? '',
        [FIELDS.sourcePurchaseOrder]: order.po_no,
        [FIELDS.remark]: header.remark,
        [FIELDS.details]: details.map((item) => ({
          [FIELDS.goodsName]: goodsMap.get(String(item.goods_id)) ?? '',
          [FIELDS.skuName]: skuMap.get(String(item.sku_id)) ?? '',
          [FIELDS.batchNo]: item.batch_no,
          [FIELDS.quantity]: item.exit_qty,
          [FIELDS.unit]: unitMap.get(String(item.unit_type)) ?? '',
          [FIELDS.detailRemark]: item.remark,
        })),
      },
    });
  }

  private async dictionaryName(code: string, value: number) {
    const category = await this.prisma.hspsi_sys_dictionary_category.findFirst({
      where: { dict_catg_code: code, deleted_at: null },
      select: { dict_catg_id: true },
    });
    const item = category
      ? await this.prisma.hspsi_sys_dictionary.findFirst({
          where: {
            dict_catg_id: category.dict_catg_id,
            dict_value: String(value),
            deleted_at: null,
          },
          select: { dict_name: true },
        })
      : null;
    if (!item) throw new BadRequestException('采购退货类型字典不存在');
    return item.dict_name;
  }

  private formatDate(value: Date | null) {
    if (!value) throw new BadRequestException('退货日期不能为空');
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
