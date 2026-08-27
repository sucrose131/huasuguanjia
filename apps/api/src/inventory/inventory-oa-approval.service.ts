import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { OaDocumentSubmissionService } from '../integrations/xinfutong-oa/approval/document-submission.service';
import { OaStarterContextService } from '../integrations/xinfutong-oa/approval/starter-context.service';
import { OaFormMappingService } from '../integrations/xinfutong-oa/form/form-mapping.service';
import type { OaFormMapping } from '../integrations/xinfutong-oa/form/form-mapping.constants';

const names = (form: OaFormMapping) =>
  Object.fromEntries(
    Object.entries(form.fields).map(([key, value]) => [key, value.uniqueName]),
  ) as Record<string, string>;

@Injectable()
export class InventoryOaApprovalService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OaStarterContextService) private readonly starters: OaStarterContextService,
    @Inject(OaDocumentSubmissionService) private readonly submissions: OaDocumentSubmissionService,
    @Inject(OaFormMappingService) private readonly mappingService: OaFormMappingService,
  ) {}

  async submitTransfer(id: bigint, userId: string) {
    const document = await this.prisma.hspsi_inventory_transfer.findFirst({
      where: { transfer_id: id, deleted_at: null },
    });
    if (!document || document.status !== 1 || document.approve_status !== 0)
      throw new BadRequestException('仅已提交且待审批的调拨单可以发送OA');
    const details = await this.prisma.hspsi_inventory_transfer_detail.findMany({
      where: { transfer_id: id },
      orderBy: { id: 'asc' },
    });
    if (!details.length) throw new BadRequestException('调拨单没有商品明细');
    const starter = await this.starters.resolve(userId, document.org_id);
    const [sourceOrg, targetOrg, sourceWarehouse, targetWarehouse, sender, receiver, refs] =
      await Promise.all([
        this.prisma.hspsi_basic_organization.findFirst({ where: { org_id: document.org_id } }),
        this.prisma.hspsi_basic_organization.findFirst({ where: { org_id: document.to_org_id } }),
        this.prisma.hspsi_basic_warehouse.findFirst({
          where: { warehouse_id: document.warehouse_id },
        }),
        this.prisma.hspsi_basic_warehouse.findFirst({
          where: { warehouse_id: document.to_warehouse_id },
        }),
        this.starters.resolvePerson(document.send_by, starter.accountSetId),
        this.starters.resolvePerson(document.receive_by, starter.accountSetId),
        this.references(details),
      ]);
    if (!sourceOrg || !targetOrg || !sourceWarehouse || !targetWarehouse)
      throw new BadRequestException('调拨组织或仓库不存在');
    const form = await this.mappingService.getMapping('inventory_transfer', starter.accountSetId);
    const f = names(form);
    return this.submissions.submit({
      businessType: 'inventory_transfer',
      businessId: id,
      userId,
      accountSetId: starter.accountSetId,
      form,
      attachmentField: f.attachments!,
      busKey: `inventory_transfer:${id}`,
      starterId: starter.starterId,
      starterOrgId: starter.starterOrgId,
      formData: {
        [f.transferDate!]: this.date(document.transfer_date),
        [f.reason!]: document.transfer_reason,
        [f.sourceOrganization!]: sourceOrg.name,
        [f.sourceWarehouse!]: sourceWarehouse.name,
        [f.targetOrganization!]: targetOrg.name,
        [f.targetWarehouse!]: targetWarehouse.name,
        [f.sender!]: [sender],
        [f.receiver!]: [receiver],
        [f.remark!]: document.remark,
        [f.details!]: details.map((line) => this.line(f, line, refs, line.transfer_qty)),
      },
    });
  }

  async submitAdjustment(id: bigint, userId: string) {
    const document = await this.prisma.hspsi_inventory_adjust.findFirst({
      where: { adjust_id: id, deleted_at: null },
    });
    if (!document || document.status !== 1 || document.approve_status !== 0)
      throw new BadRequestException('仅已提交且待审批的调整单可以发送OA');
    const details = await this.prisma.hspsi_inventory_adjust_detail.findMany({
      where: { adjust_id: id },
      orderBy: { detail_id: 'asc' },
    });
    if (!details.length) throw new BadRequestException('调整单没有商品明细');
    const warehouses = await this.prisma.hspsi_basic_warehouse.findMany({
      where: { warehouse_id: { in: details.map((x) => x.warehouse_id) }, deleted_at: null },
    });
    const first = warehouses[0];
    if (!first) throw new BadRequestException('调整仓库不存在');
    const starter = await this.starters.resolve(userId, first.org_id);
    const refs = await this.references(details);
    const types = await this.dictionary('inventory_adjust_type');
    const form = await this.mappingService.getMapping('inventory_adjust', starter.accountSetId);
    const f = names(form);
    return this.submissions.submit({
      businessType: 'inventory_adjust',
      businessId: id,
      userId,
      accountSetId: starter.accountSetId,
      form,
      attachmentField: f.attachments!,
      busKey: `inventory_adjust:${id}`,
      starterId: starter.starterId,
      starterOrgId: starter.starterOrgId,
      formData: {
        [f.applicationDate!]: this.date(document.applicant_date),
        [f.reason!]: document.adjust_reason,
        [f.remark!]: document.remark,
        [f.details!]: details.map((line) => ({
          ...this.line(f, line, refs, line.adjust_qty),
          [f.warehouse!]: warehouses.find((x) => x.warehouse_id === line.warehouse_id)?.name ?? '',
          [f.adjustType!]: types.get(String(line.adjust_type)) ?? '',
          [f.beforeQuantity!]: Number(line.before_qty),
          [f.adjustQuantity!]: line.adjust_qty,
          [f.afterQuantity!]:
            Number(line.before_qty) + (line.adjust_type === 1 ? line.adjust_qty : -line.adjust_qty),
          [f.detailRemark!]: line.remark,
        })),
      },
    });
  }

  async submitCheck(id: bigint, userId: string) {
    const document: any = await (this.prisma as any).hspsi_inventory_check.findFirst({
      where: { check_id: id, deleted_at: null },
    });
    if (!document || document.status !== 1 || document.approve_status !== 0)
      throw new BadRequestException('仅已提交且待审批的盘点单可以发送OA');
    const details: any[] = await (this.prisma as any).hspsi_inventory_check_detail.findMany({
      where: { check_id: id },
      orderBy: { check_detail_id: 'asc' },
    });
    const starter = await this.starters.resolve(userId, document.org_id);
    const refs = await this.references(details);
    const [org, warehouse, types] = await Promise.all([
      this.prisma.hspsi_basic_organization.findFirst({ where: { org_id: document.org_id } }),
      this.prisma.hspsi_basic_warehouse.findFirst({
        where: { warehouse_id: document.warehouse_id },
      }),
      this.dictionary('inventory_check_type'),
    ]);
    const form = await this.mappingService.getMapping('inventory_check', starter.accountSetId),
      f = names(form);
    return this.submissions.submit({
      businessType: 'inventory_check',
      businessId: id,
      userId,
      accountSetId: starter.accountSetId,
      form,
      attachmentField: f.attachments!,
      busKey: `inventory_check:${id}`,
      starterId: starter.starterId,
      starterOrgId: starter.starterOrgId,
      formData: {
        [f.checkType!]: types.get(String(document.check_type)) ?? '',
        [f.checkDate!]: this.date(document.check_date),
        [f.organization!]: org?.name ?? '',
        [f.warehouse!]: warehouse?.name ?? '',
        [f.bookQuantity!]: document.all_qty,
        [f.bookAmount!]: Number(document.all_value ?? 0),
        [f.lossQuantity!]: document.less_qty,
        [f.lossAmount!]: Number(document.less_value ?? 0),
        [f.overflowQuantity!]: document.overflow_qty,
        [f.overflowAmount!]: Number(document.overflow_value ?? 0),
        [f.remark!]: document.remark,
        [f.details!]: details
          .filter((x) => x.different_qty !== 0 || x.damaged_qty > 0)
          .map((line) => ({
            ...this.line(f, line, refs, line.different_qty),
            [f.detailBookQuantity!]: line.inventory_qty,
            [f.actualQuantity!]: line.check_qty,
            [f.damagedQuantity!]: line.damaged_qty,
            [f.differenceQuantity!]: line.different_qty,
            [f.differenceAmount!]: Number(line.different_amount),
            [f.detailRemark!]: line.remark,
          })),
      },
    });
  }

  async submitInventoryDocument(
    type: 'loss' | 'loss-output' | 'overflow',
    id: bigint,
    userId: string,
  ) {
    const config =
      type === 'loss'
        ? {
            model: 'hspsi_inventory_loss',
            detail: 'hspsi_inventory_loss_detail',
            key: 'loss_id',
            business: 'inventory_loss',
            form: 'inventory_loss',
            qty: 'loss_qty',
            amount: 'loss_amount',
            date: 'loss_date',
            reason: 'loss_reson',
            docType: 'loss_type',
          }
        : type === 'loss-output'
          ? {
              model: 'hspsi_inventory_loss_output',
              detail: 'hspsi_inventory_loss_output_detail',
              key: 'loss_id',
              business: 'inventory_loss_output',
              form: 'inventory_loss_output',
              qty: 'loss_qty',
              amount: 'loss_amount',
              date: 'loss_date',
              reason: 'loss_reson',
              docType: 'loss_type',
            }
          : {
              model: 'hspsi_inventory_overflow',
              detail: 'hspsi_inventory_overflow_detail',
              key: 'overflow_id',
              business: 'inventory_overflow',
              form: 'inventory_overflow',
              qty: 'overflow_qty',
              amount: 'overflow_amount',
              date: 'overflow_date',
              reason: 'overflow_reson',
              docType: 'overflow_type',
            };
    const document: any = await (this.prisma as any)[config.model].findFirst({
      where: { [config.key]: id, deleted_at: null },
    });
    if (!document || document.status !== 1 || document.approve_status !== 0)
      throw new BadRequestException('仅已提交且待审批的库存单据可以发送OA');
    const details: any[] = await (this.prisma as any)[config.detail].findMany({
      where: { [config.key]: id },
    });
    const starter = await this.starters.resolve(userId, document.org_id),
      refs = await this.references(details);
    const [org, dept, warehouse, sourceCheck, sourceLoss, types, disposals] = await Promise.all([
      this.prisma.hspsi_basic_organization.findFirst({ where: { org_id: document.org_id } }),
      this.prisma.hspsi_basic_dept.findFirst({ where: { dept_id: document.dept_id } }),
      this.prisma.hspsi_basic_warehouse.findFirst({
        where: { warehouse_id: document.warehouse_id },
      }),
      document.source_check_id > 0n
        ? (this.prisma as any).hspsi_inventory_check.findFirst({
            where: { check_id: document.source_check_id },
          })
        : null,
      type === 'loss-output' && document.source_loss_id > 0n
        ? (this.prisma as any).hspsi_inventory_loss.findFirst({
            where: { loss_id: document.source_loss_id },
          })
        : null,
      this.dictionary(
        type === 'loss'
          ? 'inventory_loss_type'
          : type === 'loss-output'
            ? 'inventory_loss_output_type'
            : 'inventory_overflow_type',
      ),
      this.dictionary('inventory_loss_disposal'),
    ]);
    const form = await this.mappingService.getMapping(config.form, starter.accountSetId),
      f = names(form);
    const prefix = type === 'overflow' ? 'overflow' : 'loss';
    return this.submissions.submit({
      businessType: config.business,
      businessId: id,
      userId,
      accountSetId: starter.accountSetId,
      form,
      attachmentField: f.attachments!,
      busKey: `${config.business}:${id}`,
      starterId: starter.starterId,
      starterOrgId: starter.starterOrgId,
      formData: {
        ...(f.businessCategory
          ? { [f.businessCategory]: document.business_kind === 2 ? '报损' : '报亏' }
          : {}),
        [f[`${prefix}Type`]!]: types.get(String(document[config.docType])) ?? '',
        [f[`${prefix}Date`]!]: this.date(document[config.date]),
        [f.organization!]: org?.name ?? '',
        [f.department!]: dept?.name ?? '',
        [f.warehouse!]: warehouse?.name ?? '',
        [f.reason!]: document[config.reason],
        [f.totalQuantity!]: document[type === 'overflow' ? 'overflow_qty' : 'loss_qty'],
        [f.totalAmount!]: Number(
          document[type === 'overflow' ? 'overflow_total_amount' : 'loss_total_amount'],
        ),
        ...(f.disposalDestination
          ? { [f.disposalDestination]: disposals.get(String(document.go_where)) ?? '' }
          : {}),
        [f.sourceCheck!]: sourceCheck?.check_no ?? '',
        ...(f.sourceLoss ? { [f.sourceLoss]: sourceLoss?.loss_no ?? '' } : {}),
        [f.remark!]: document.remark,
        [f.details!]: details.map((line) => ({
          ...this.line(f, line, refs, line[config.qty]),
          [f.amount!]: Number(line[config.amount]),
        })),
      },
    });
  }

  private async references(lines: Array<{ goods_id: bigint; sku_id: bigint }>) {
    const [goods, skus, units] = await Promise.all([
      this.prisma.hspsi_goods_info.findMany({
        where: { goods_id: { in: lines.map((x) => x.goods_id) } },
      }),
      this.prisma.hspsi_goods_info_sku.findMany({
        where: { sku_id: { in: lines.map((x) => x.sku_id) } },
      }),
      this.prisma.hspsi_basic_unit.findMany(),
    ]);
    return { goods, skus, units };
  }
  private line(f: Record<string, string>, line: any, refs: any, quantity: number) {
    const sku = refs.skus.find((x: any) => x.sku_id === line.sku_id);
    const result: Record<string, unknown> = {};
    if (f.goodsName)
      result[f.goodsName] =
        refs.goods.find((x: any) => x.goods_id === line.goods_id)?.goods_name ?? '';
    if (f.skuName) result[f.skuName] = sku?.spec_models ?? '';
    if (f.batchNo) result[f.batchNo] = line.batch_no ?? '';
    if (f.quantity) result[f.quantity] = quantity;
    if (f.unit)
      result[f.unit] =
        refs.units.find((x: any) => x.id === BigInt(sku?.unit_type ?? line.unit_type ?? 0))?.name ??
        '';
    return result;
  }
  private async dictionary(code: string) {
    const cat = await this.prisma.hspsi_sys_dictionary_category.findFirst({
      where: { dict_catg_code: code, deleted_at: null },
    });
    const rows = cat
      ? await this.prisma.hspsi_sys_dictionary.findMany({
          where: { dict_catg_id: cat.dict_catg_id, deleted_at: null },
        })
      : [];
    return new Map(rows.map((x) => [String(x.dict_value), x.dict_name]));
  }
  private date(value: Date | null) {
    if (!value) throw new BadRequestException('单据日期不能为空');
    return value.toISOString().slice(0, 10);
  }
}
