import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OaDocumentSubmissionService } from '../integrations/xinfutong-oa/approval/document-submission.service';
import { OaStarterContextService } from '../integrations/xinfutong-oa/approval/starter-context.service';
import { OaFormMappingService } from '../integrations/xinfutong-oa/form/form-mapping.service';
import type { OaFormMapping } from '../integrations/xinfutong-oa/form/form-mapping.constants';
import { SalesService } from './sales.service';

const oaFields = (form: OaFormMapping) =>
  Object.fromEntries(
    Object.entries(form.fields).map(([key, value]) => [key, value.uniqueName]),
  ) as Record<string, string>;

@Injectable()
export class SalesOaApprovalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SalesService) private readonly sales: SalesService,
    @Inject(OaStarterContextService) private readonly starters: OaStarterContextService,
    @Inject(OaDocumentSubmissionService) private readonly submissions: OaDocumentSubmissionService,
    @Inject(OaFormMappingService) private readonly mappingService: OaFormMappingService,
  ) {}

  async submitDiscountOrder(id: bigint, userId: string) {
    const order = await this.sales.order(String(id));
    if (Number(order.propertyType) !== 2 || Number(order.approve_status) !== 0)
      throw new BadRequestException('仅待审批的折价销售单可以发送OA');
    if (!order.orderDate) throw new BadRequestException('折价销售日期不能为空');
    const [organization, warehouse, goods, skus, units] = await Promise.all([
      this.prisma.hspsi_basic_organization.findFirst({ where: { org_id: BigInt(order.orgId) } }),
      this.prisma.hspsi_basic_warehouse.findFirst({
        where: { warehouse_id: BigInt(order.warehouseId) },
      }),
      this.prisma.hspsi_goods_info.findMany({
        where: { goods_id: { in: order.details.map((x: any) => BigInt(x.goodsId)) } },
      }),
      this.prisma.hspsi_goods_info_sku.findMany({
        where: { sku_id: { in: order.details.map((x: any) => BigInt(x.skuId)) } },
      }),
      this.prisma.hspsi_basic_unit.findMany(),
    ]);
    if (!organization || !warehouse) throw new BadRequestException('折价销售单组织或仓库不存在');
    const starter = await this.starters.resolve(userId, BigInt(order.orgId));
    const form = await this.mappingService.getMapping('sales_order', starter.accountSetId);
    const fields = oaFields(form);
    return this.submissions.submit({
      businessType: 'sales_order',
      businessId: id,
      userId,
      accountSetId: starter.accountSetId,
      form,
      attachmentField: fields.attachments!,
      busKey: `sales_order:${id}`,
      starterId: starter.starterId,
      starterOrgId: starter.starterOrgId,
      formData: {
        [fields.organization!]: organization.name,
        [fields.customerName!]: order.customerName,
        [fields.orderDate!]: new Date(order.orderDate).toISOString().slice(0, 10),
        [fields.salesperson!]: order.salesName,
        [fields.warehouse!]: warehouse.name,
        [fields.totalQuantity!]: order.so_qty,
        [fields.originalAmount!]: Number(order.so_amount),
        [fields.transactionAmount!]: Number(order.fact_amount),
        [fields.discountAmount!]: Number(order.priceoff_amount),
        [fields.source!]: order.businessSourceNo,
        [fields.remark!]: order.remark,
        [fields.details!]: order.details.map((line: any) => {
          const sku = skus.find((x) => x.sku_id === BigInt(line.skuId));
          return {
            [fields.goodsName!]:
              goods.find((x) => x.goods_id === BigInt(line.goodsId))?.goods_name ?? '',
            [fields.skuName!]: sku?.spec_models ?? '',
            [fields.quantity!]: line.quantity,
            [fields.unit!]: units.find((x) => x.id === BigInt(line.unitType ?? 0))?.name ?? '',
            [fields.originalUnitPrice!]: Number(line.price),
            [fields.transactionUnitPrice!]: Number(line.factAmount) / Number(line.quantity),
            [fields.originalLineAmount!]: Number(line.amount),
            [fields.transactionLineAmount!]: Number(line.factAmount),
          };
        }),
      },
    });
  }
}
