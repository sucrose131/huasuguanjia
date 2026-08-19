import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OaDocumentSubmissionService } from '../integrations/xinfutong-oa/approval/document-submission.service';
import { OaStarterContextService } from '../integrations/xinfutong-oa/approval/starter-context.service';
import { OaFormMappingService } from '../integrations/xinfutong-oa/form/form-mapping.service';
import type { OaFormMapping } from '../integrations/xinfutong-oa/form/form-mapping.constants';
import { ProductionService } from './production.service';

const oaFields = (form: OaFormMapping) =>
  Object.fromEntries(
    Object.entries(form.fields).map(([key, value]) => [key, value.uniqueName]),
  ) as Record<string, string>;

@Injectable()
export class ProductionOaApprovalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProductionService) private readonly production: ProductionService,
    @Inject(OaStarterContextService) private readonly starters: OaStarterContextService,
    @Inject(OaDocumentSubmissionService) private readonly submissions: OaDocumentSubmissionService,
    @Inject(OaFormMappingService) private readonly mappingService: OaFormMappingService,
  ) {}

  async submitPlan(id: bigint, userId: string) {
    const plan = await this.production.plan(String(id));
    if (Number(plan.planStatus) !== 1 || Number(plan.approveStatus) !== 0)
      throw new BadRequestException('仅待审批的生产计划可以发送OA');
    if (!plan.planDate) throw new BadRequestException('生产计划日期不能为空');
    const [organization, materialWarehouse, finishedWarehouse, bom, productSku] = await Promise.all(
      [
        this.prisma.hspsi_basic_organization.findFirst({ where: { org_id: BigInt(plan.orgId) } }),
        this.prisma.hspsi_basic_warehouse.findFirst({
          where: { warehouse_id: BigInt(plan.warehouseId) },
        }),
        this.prisma.hspsi_basic_warehouse.findFirst({
          where: { warehouse_id: BigInt(plan.productWarehouseId) },
        }),
        this.prisma.hspsi_production_bom.findFirst({ where: { bom_id: BigInt(plan.bomId) } }),
        this.prisma.hspsi_goods_info_sku.findFirst({ where: { sku_id: BigInt(plan.skuId) } }),
      ],
    );
    if (!organization || !materialWarehouse || !finishedWarehouse || !bom)
      throw new BadRequestException('生产计划的组织、仓库或BOM资料不完整');
    const starter = await this.starters.resolve(userId, BigInt(plan.orgId));
    const form = await this.mappingService.getMapping('production_plan', starter.accountSetId);
    const fields = oaFields(form);
    return this.submissions.submit({
      businessType: 'production_plan',
      businessId: id,
      userId,
      accountSetId: starter.accountSetId,
      form,
      attachmentField: fields.attachments!,
      busKey: `production_plan:${id}`,
      starterId: starter.starterId,
      starterOrgId: starter.starterOrgId,
      formData: {
        [fields.organization!]: organization.name,
        [fields.product!]: plan.goodsName,
        [fields.skuName!]: productSku?.spec_models ?? '',
        [fields.bom!]: bom.bom_name,
        [fields.quantity!]: plan.planQty,
        [fields.planDate!]: new Date(plan.planDate).toISOString().slice(0, 10),
        [fields.materialWarehouse!]: materialWarehouse.name,
        [fields.finishedWarehouse!]: finishedWarehouse.name,
        [fields.source!]: plan.sourceOrderNo,
        [fields.remark!]: plan.remark,
        [fields.details!]: plan.details.map((line: any) => ({
          [fields.materialName!]: line.goodsName,
          [fields.materialSkuName!]: line.skuSpec,
          [fields.bomUnitQuantity!]: line.bomUnitQty,
          [fields.standardQuantity!]: line.standardQty,
          [fields.requiredQuantity!]: line.quantity,
          [fields.plannedOutputQuantity!]: line.planOutQty,
          [fields.unit!]: line.unitName,
          [fields.detailRemark!]: line.remark,
        })),
      },
    });
  }
}
