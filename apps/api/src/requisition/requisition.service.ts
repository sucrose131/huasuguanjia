import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BusinessReferenceService } from '../database/business-reference.service';
import { PrismaService } from '../database/prisma.service';
import { DocumentTraceService } from '../document-trace/document-trace.service';
import { INVENTORY_BUSINESS_MODE } from '../inventory/inventory-dictionary';
import { BUSINESS_PREFIX } from '../business-number/business-number.constants';
import { BusinessNumberService } from '../business-number/business-number.service';
import {
  InventoryPostingService,
  type InventoryLine,
} from '../inventory/inventory-posting.service';
import { RequisitionOaApprovalService } from './requisition-oa-approval.service';
import type { ApprovalCallbackPayload } from '../integrations/xinfutong-oa/approval/approval.types';
import { Attachment, AttachmentsService } from '../attachments/attachments.service';
import { BusinessMasterDataService } from '../database/business-master-data.service';

type Body = Record<string, any>;
type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class RequisitionService {
  /**
   * 领用管理只允许行政类、健服类仓库。
   * 值来自 hspsi-dev-ai-02 的 warehouse_type 字典：
   * 礼品赠品、办公设备/家具/耗材、废旧物资、医疗耗材/器械、药品、实验用品。
   */
  private readonly requisitionWarehouseTypes = [4, 5, 6, 7, 8, 9, 10, 11, 12];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InventoryPostingService) private readonly posting: InventoryPostingService,
    @Inject(BusinessReferenceService) private readonly references: BusinessReferenceService,
    @Inject(DocumentTraceService) private readonly documentTrace: DocumentTraceService,
    @Inject(BusinessNumberService) private readonly businessNumber: BusinessNumberService,
    @Inject(RequisitionOaApprovalService)
    private readonly oaApproval: RequisitionOaApprovalService,
    @Inject(AttachmentsService)
    private readonly attachmentsService: AttachmentsService,
    @Inject(BusinessMasterDataService) private readonly masterData: BusinessMasterDataService,
  ) {}

  private attachmentItems(value: unknown): Attachment[] {
    if (Array.isArray(value)) return value as Attachment[];
    if (typeof value !== 'string') return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as Attachment[]) : [];
    } catch {
      return [];
    }
  }

  private decimal(value: unknown) {
    return new Prisma.Decimal(String(value ?? 0));
  }

  private paging(query: Body) {
    return {
      page: Math.max(1, Number(query.page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(query.pageSize) || 20)),
    };
  }

  private positiveQuantity(value: unknown, label = '数量') {
    const quantity = Number(String(value ?? '').trim());
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new BadRequestException(`${label}必须为正整数`);
    }
    return quantity;
  }

  private bigint(value: unknown, label: string) {
    try {
      const result = BigInt(String(value ?? ''));
      if (result <= 0n) throw new Error();
      return result;
    } catch {
      throw new BadRequestException(`${label}无效`);
    }
  }

  private returnable(value: unknown) {
    if (value === true || value === 1 || value === '1') return 1;
    if (value === false || value === 0 || value === '0') return 0;
    throw new BadRequestException('每条领用明细必须选择物品属性（可归还/无需归还）');
  }

  private detailLines(value: unknown) {
    if (!Array.isArray(value) || !value.length) throw new BadRequestException('至少一条明细');
    return value as Body[];
  }

  private directOutputGenerationKey(value: unknown) {
    const requestKey = String(value ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestKey)) {
      throw new BadRequestException('直接领用出库请求标识无效');
    }
    return `direct-requisition-output:${requestKey}`;
  }

  private async validateApplicationReferences(
    tx: Db,
    values: {
      orgId: bigint;
      deptId: bigint;
      warehouseId: bigint;
      applicantId: bigint;
      drawType: number;
    },
  ) {
    const [organization, department, warehouse, applicant, drawTypeCategory] = await Promise.all([
      tx.hspsi_basic_organization.findFirst({
        where: { org_id: values.orgId, operation_status: 1, deleted_at: null },
        select: { org_id: true },
      }),
      tx.hspsi_basic_dept.findFirst({
        where: { dept_id: values.deptId, org_id: values.orgId, status: 1, deleted_at: null },
        select: { dept_id: true },
      }),
      tx.hspsi_basic_warehouse.findFirst({
        where: {
          warehouse_id: values.warehouseId,
          org_id: values.orgId,
          warehouse_type: { in: this.requisitionWarehouseTypes },
          status: 1,
          deleted_at: null,
        },
        select: { warehouse_id: true },
      }),
      tx.hspsi_basic_staff.findFirst({
        where: { id: values.applicantId, status: 1, deleted_at: null },
        select: { id: true },
      }),
      tx.hspsi_sys_dictionary_category.findFirst({
        where: { dict_catg_code: 'draw_type', deleted_at: null },
        select: { dict_catg_id: true },
      }),
    ]);
    if (!organization) throw new BadRequestException('所属组织不存在或未正常运营');
    if (!department) throw new BadRequestException('领用部门不属于所选组织或已停用');
    if (!warehouse)
      throw new BadRequestException('领用仓库仅限所选组织下已启用的行政类、健服类仓库');
    if (!applicant) throw new BadRequestException('领用人必须选择已启用的基础员工');

    const [membership, drawType] = await Promise.all([
      tx.hspsi_basic_staff_organizations.findFirst({
        where: {
          staff_id: values.applicantId,
          deleted_at: null,
          OR: [
            { org_type: 1, org_id: values.orgId },
            { org_type: 2, org_id: values.deptId },
          ],
        },
        select: { id: true },
      }),
      drawTypeCategory
        ? tx.hspsi_sys_dictionary.findFirst({
            where: {
              dict_catg_id: drawTypeCategory.dict_catg_id,
              dict_value: String(values.drawType),
              deleted_at: null,
            },
            select: { dict_id: true },
          })
        : null,
    ]);
    if (!membership) throw new BadRequestException('领用人不属于所选组织或领用部门');
    if (!drawType) throw new BadRequestException('领用类型未在数据字典中配置');
  }

  private async enrichRequisitionStaff<T extends Body>(rows: T[]): Promise<T[]> {
    const staffIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.applicantId, row.receiverId, row.signedBy])
          .filter(
            (value) =>
              value !== undefined &&
              value !== null &&
              String(value) !== '' &&
              String(value) !== '0',
          )
          .map(String),
      ),
    ].map(BigInt);
    const userIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.approveBy, row.confirmBy])
          .filter(
            (value) =>
              value !== undefined &&
              value !== null &&
              String(value) !== '' &&
              String(value) !== '0',
          )
          .map(String),
      ),
    ].map(BigInt);
    const [staff, users] = await Promise.all([
      staffIds.length
        ? this.prisma.hspsi_basic_staff.findMany({
            where: { id: { in: staffIds }, deleted_at: null },
            select: { id: true, name: true, staff_code: true },
          })
        : [],
      userIds.length
        ? this.prisma.hspsi_sys_user.findMany({
            where: { id: { in: userIds }, deleted_at: null },
            select: { id: true, username: true, nickname: true },
          })
        : [],
    ]);
    const names = new Map(staff.map((item) => [String(item.id), item.name]));
    const userNames = new Map(
      users.map((item) => [String(item.id), item.nickname || item.username]),
    );
    return rows.map((row) => ({
      ...row,
      ...(row.applicantId ? { applicantIdName: names.get(String(row.applicantId)) ?? '' } : {}),
      ...(row.receiverId ? { receiverIdName: names.get(String(row.receiverId)) ?? '' } : {}),
      ...(row.signedBy ? { signedByName: names.get(String(row.signedBy)) ?? '' } : {}),
      ...(row.approveBy ? { approveByName: userNames.get(String(row.approveBy)) ?? '' } : {}),
      ...(row.confirmBy ? { confirmByName: userNames.get(String(row.confirmBy)) ?? '' } : {}),
    }));
  }

  async applicationFormOptions(orgIdValue: string) {
    const orgId = this.bigint(orgIdValue, '所属组织');
    const departments = await this.prisma.hspsi_basic_dept.findMany({
      where: { org_id: orgId, status: 1, deleted_at: null },
      orderBy: [{ sort: 'asc' }, { dept_id: 'asc' }],
      select: { dept_id: true, name: true },
    });
    const departmentIds = departments.map((item) => item.dept_id);
    const memberships = await this.prisma.hspsi_basic_staff_organizations.findMany({
      where: {
        deleted_at: null,
        OR: [
          { org_type: 1, org_id: orgId },
          { org_type: 2, org_id: { in: departmentIds } },
        ],
      },
      select: { staff_id: true },
    });
    const staffIds = [...new Set(memberships.map((item) => String(item.staff_id)))].map(BigInt);
    const [warehouses, staff] = await Promise.all([
      this.prisma.hspsi_basic_warehouse.findMany({
        where: {
          org_id: orgId,
          warehouse_type: { in: this.requisitionWarehouseTypes },
          status: 1,
          deleted_at: null,
        },
        orderBy: [{ sort: 'asc' }, { warehouse_id: 'asc' }],
        select: { warehouse_id: true, name: true, warehouse_type: true, dept_id: true },
      }),
      staffIds.length
        ? this.prisma.hspsi_basic_staff.findMany({
            where: { id: { in: staffIds }, status: 1, deleted_at: null },
            orderBy: [{ staff_code: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true, staff_code: true },
          })
        : [],
    ]);
    return {
      warehouses: warehouses.map((item) => ({
        value: item.warehouse_id,
        label: item.name,
        raw: { warehouseType: item.warehouse_type, deptId: item.dept_id, orgId },
      })),
      departments: departments.map((item) => ({ value: item.dept_id, label: item.name })),
      employees: staff.map((item) => ({
        value: item.id,
        label: item.staff_code ? `${item.name}（${item.staff_code}）` : item.name,
        raw: item,
      })),
    };
  }

  async productOptions(orgIdValue: unknown, warehouseIdValue: unknown) {
    if (!orgIdValue || !warehouseIdValue) return [];
    return this.masterData.goodsOptions(
      BigInt(String(orgIdValue)),
      BigInt(String(warehouseIdValue)),
    );
  }

  private aggregatePostingLines(
    orgId: bigint | string | number,
    warehouseId: bigint | string | number,
    lines: InventoryLine[],
  ): InventoryLine[] {
    const grouped = new Map<string, Omit<InventoryLine, 'quantity'> & { quantity: number }>();
    for (const line of lines) {
      const batchNo = String(line.batchNo ?? '').trim();
      const unitType = Number(line.unitType ?? 0);
      const key = JSON.stringify([
        String(orgId),
        String(warehouseId),
        String(line.goodsId),
        String(line.skuId),
        batchNo,
        unitType,
      ]);
      const existing = grouped.get(key);
      if (existing) {
        existing.quantity += Number(line.quantity);
        continue;
      }
      grouped.set(key, {
        goodsId: line.goodsId,
        skuId: line.skuId,
        batchNo,
        unitType,
        quantity: Number(line.quantity),
      });
    }
    return [...grouped.values()].map((line) => ({
      ...line,
      quantity: line.quantity,
    }));
  }

  private async lockRow(tx: Prisma.TransactionClient, table: string, key: string, id: bigint) {
    const allowed = new Map([
      ['hspsi_draw_approve', 'draw_id'],
      ['hspsi_draw_approve_output', 'draw_output_id'],
      ['hspsi_draw_approve_output_exit', 'draw_exit_id'],
    ]);
    if (allowed.get(table) !== key) throw new Error('Unsupported requisition lock target');
    await tx.$queryRawUnsafe(
      `SELECT \`${key}\` FROM \`${table}\` WHERE \`${key}\` = ? FOR UPDATE`,
      id,
    );
  }

  private async confirmedOutputUsage(db: Db, drawId: bigint) {
    const heads = await db.hspsi_draw_approve_output.findMany({
      where: { draw_id: drawId, comfirm_status: 1, deleted_at: null },
      select: { draw_output_id: true },
    });
    const details = heads.length
      ? await db.hspsi_draw_approve_output_detail.findMany({
          where: { draw_output_id: { in: heads.map((item) => item.draw_output_id) } },
        })
      : [];
    const usage = new Map<string, number>();
    for (const detail of details) {
      const key =
        detail.draw_detail_id > 0n
          ? `detail:${detail.draw_detail_id}`
          : `legacy:${detail.goods_id}:${detail.sku_id}`;
      usage.set(key, (usage.get(key) ?? 0) + Number(detail.fact_draw_qty));
    }
    return usage;
  }

  private async confirmedReturnUsage(db: Db, outputId: bigint, excludeReturnId?: bigint) {
    const heads = await db.hspsi_draw_approve_output_exit.findMany({
      where: {
        draw_output_id: outputId,
        comfirm_status: 1,
        deleted_at: null,
        ...(excludeReturnId ? { draw_exit_id: { not: excludeReturnId } } : {}),
      },
      select: { draw_exit_id: true },
    });
    const details = heads.length
      ? await db.hspsi_draw_approve_output_exit_detail.findMany({
          where: { draw_exit_id: { in: heads.map((item) => item.draw_exit_id) } },
        })
      : [];
    const usage = new Map<string, number>();
    for (const detail of details) {
      const key = String(detail.draw_output_detail_id);
      usage.set(key, (usage.get(key) ?? 0) + Number(detail.exit_qty));
    }
    return usage;
  }

  private async syncApplicationActualQuantity(tx: Prisma.TransactionClient, drawId: bigint) {
    const heads = await tx.hspsi_draw_approve_output.findMany({
      where: { draw_id: drawId, comfirm_status: 1, deleted_at: null },
      select: { draw_output_id: true },
    });
    const total = heads.length
      ? await tx.hspsi_draw_approve_output_detail.aggregate({
          where: { draw_output_id: { in: heads.map((item) => item.draw_output_id) } },
          _sum: { fact_draw_qty: true },
        })
      : null;
    await tx.hspsi_draw_approve.update({
      where: { draw_id: drawId },
      data: { fact_draw_qty: total?._sum.fact_draw_qty ?? 0 },
    });
  }

  private oaStatusName(status: string) {
    return (
      {
        PENDING_PUSH: '待提交OA',
        PUSH_FAILED: 'OA提交失败',
        RUNNING: 'OA审批中',
        BACKTOSTART: 'OA退回发起人',
        PASSED: 'OA已通过',
        REJECTED: 'OA已驳回',
        CANCELED: 'OA已取消',
        DELETED: 'OA已删除',
      }[status] ?? ''
    );
  }

  async applications(query: Body) {
    const { page, pageSize } = this.paging(query);
    const where: Prisma.hspsi_draw_approveWhereInput = { deleted_at: null };
    if (query.status !== undefined && query.status !== '')
      where.approve_status = Number(query.status);
    if (query.keyword) where.draw_no = { contains: String(query.keyword) };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.hspsi_draw_approve.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { draw_id: 'desc' },
      }),
      this.prisma.hspsi_draw_approve.count({ where }),
    ]);
    const generated = records.length
      ? await this.prisma.hspsi_draw_approve_output.findMany({
          where: {
            draw_id: { in: records.map((item) => item.draw_id) },
            generation_key: { not: null },
            deleted_at: null,
          },
          orderBy: { draw_output_id: 'desc' },
        })
      : [];
    const generatedMap = new Map(generated.map((item) => [String(item.draw_id), item]));
    const oaInstances = records.length
      ? await this.prisma.hspsi_oa_approval_instance.findMany({
          where: {
            business_type: 'requisition_application',
            business_id: { in: records.map((item) => item.draw_id) },
            deleted_at: null,
          },
          orderBy: { id: 'desc' },
        })
      : [];
    const oaMap = new Map<string, (typeof oaInstances)[number]>();
    for (const instance of oaInstances) {
      if (!oaMap.has(String(instance.business_id)))
        oaMap.set(String(instance.business_id), instance);
    }
    const referencedItems = await this.references.enrich(
      records.map((item) => {
        const output = generatedMap.get(String(item.draw_id));
        const oa = oaMap.get(String(item.draw_id));
        return {
          ...item,
          id: item.draw_id,
          applicationNo: item.draw_no,
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          deptId: item.dept_id,
          receiverId: item.applicant_id,
          applicantId: item.applicant_id,
          reason: item.draw_reason,
          drawType: item.draw_type,
          date: item.draw_date,
          quantity: item.draw_qty,
          actualQty: item.fact_draw_qty,
          signatureContent: item.signature_content,
          signatureAttachment: item.signature_attachment,
          signedBy: item.signed_by,
          signedAt: item.signed_at,
          status: item.status,
          approveStatus: item.approve_status,
          autoOutputId: output?.draw_output_id ?? null,
          autoOutputNo: output?.draw_output_no ?? '',
          autoOutputConfirmStatus: output?.comfirm_status ?? null,
          reverseGenerated:
            output?.generation_key?.startsWith('direct-requisition-output:') ?? false,
          oaStatus: oa?.proc_status ?? '',
          oaStatusName: this.oaStatusName(oa?.proc_status ?? ''),
          oaProcessId: oa?.proc_inst_id ?? '',
          oaBusKey: oa?.bus_key ?? '',
          createdBy: item.created_by,
          updatedBy: item.updated_by,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        };
      }),
      {
        drawType: 'draw_type',
        status: 'requisition_status',
        approveStatus: 'requisition_approval_status',
      },
    );
    const items = await this.enrichRequisitionStaff(referencedItems);
    return { items, total, page, pageSize };
  }

  async application(id: string) {
    const item = await this.prisma.hspsi_draw_approve.findFirst({
      where: { draw_id: BigInt(id), deleted_at: null },
    });
    if (!item) throw new NotFoundException('领用申请不存在');
    const [details, usage, autoOutput, oa] = await Promise.all([
      this.prisma.hspsi_draw_approve_detail.findMany({
        where: { draw_id: item.draw_id },
        orderBy: { draw_detail_id: 'asc' },
      }),
      this.confirmedOutputUsage(this.prisma, item.draw_id),
      this.prisma.hspsi_draw_approve_output.findFirst({
        where: { draw_id: item.draw_id, generation_key: { not: null }, deleted_at: null },
        orderBy: { draw_output_id: 'desc' },
      }),
      this.prisma.hspsi_oa_approval_instance.findFirst({
        where: {
          business_type: 'requisition_application',
          business_id: item.draw_id,
          deleted_at: null,
        },
        orderBy: { id: 'desc' },
      }),
    ]);
    const [enriched] = await this.enrichRequisitionStaff([
      {
        ...item,
        id: item.draw_id,
        applicationNo: item.draw_no,
        orgId: item.org_id,
        warehouseId: item.warehouse_id,
        deptId: item.dept_id,
        receiverId: item.applicant_id,
        applicantId: item.applicant_id,
        drawType: item.draw_type,
        date: item.draw_date,
        reason: item.draw_reason,
        status: item.status,
        approveStatus: item.approve_status,
        approveComment: item.approve_comment,
        approveBy: item.approve_by,
        approveDate: item.approve_date,
        signatureContent: item.signature_content,
        signatureAttachment: item.signature_attachment,
        signedBy: item.signed_by,
        signedAt: item.signed_at,
        autoOutputId: autoOutput?.draw_output_id ?? null,
        autoOutputNo: autoOutput?.draw_output_no ?? '',
        autoOutputConfirmStatus: autoOutput?.comfirm_status ?? null,
        reverseGenerated:
          autoOutput?.generation_key?.startsWith('direct-requisition-output:') ?? false,
        oaStatus: oa?.proc_status ?? '',
        oaStatusName: this.oaStatusName(oa?.proc_status ?? ''),
        oaProcessId: oa?.proc_inst_id ?? '',
        oaBusKey: oa?.bus_key ?? '',
        details: details.map((detail) => {
          const historicalQty =
            (usage.get(`detail:${detail.draw_detail_id}`) ?? 0) +
            (usage.get(`legacy:${detail.goods_id}:${detail.sku_id}`) ?? 0);
          return {
            id: detail.draw_detail_id,
            goodsId: detail.goods_id,
            skuId: detail.sku_id,
            batchNo: detail.batch_no,
            unitType: detail.unit_type,
            quantity: detail.draw_qty,
            returnable: detail.is_returnable === 1,
            historicalQty,
            remainingQty: Math.max(0, Number(detail.draw_qty) - historicalQty),
            remark: detail.remark,
          };
        }),
      },
    ]);
    return enriched!;
  }

  async saveApplication(id: string | null, body: Body, userId: string, submit: boolean) {
    const lines = this.detailLines(body.details).map((line) => ({
      goodsId: this.bigint(line.goodsId, '商品'),
      skuId: this.bigint(line.skuId, 'SKU'),
      batchNo: line.batchNo ? String(line.batchNo).trim() : null,
      unitType: Number(line.unitType ?? 0),
      quantity: this.positiveQuantity(line.quantity, '申请数量'),
      returnable: this.returnable(line.returnable),
      remark: String(line.remark ?? ''),
    }));

    const submittedSignature =
      body.signatureContent !== undefined ? String(body.signatureContent ?? '').trim() : '';
    const uploadedSignature = submittedSignature
      ? await this.attachmentsService.uploadSignatureDataUrlForIntegration(
          'requisition_application',
          submittedSignature,
          userId,
        )
      : null;

    let drawId: bigint;
    try {
      drawId = await this.prisma.$transaction(async (tx) => {
        const requestedId = id ? this.bigint(id, '领用申请') : null;
        if (requestedId !== null)
          await this.lockRow(tx, 'hspsi_draw_approve', 'draw_id', requestedId);
        const current =
          requestedId !== null
            ? await tx.hspsi_draw_approve.findFirst({
                where: { draw_id: requestedId, deleted_at: null },
              })
            : null;
        if (requestedId !== null && !current) throw new NotFoundException('领用申请不存在');
        if (current?.approve_status === 1) throw new BadRequestException('已审批申请不可修改');
        if (requestedId !== null) {
          const activeOa = await tx.hspsi_oa_approval_instance.findFirst({
            where: {
              business_type: 'requisition_application',
              business_id: requestedId,
              proc_status: { in: ['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'] },
              deleted_at: null,
            },
            select: { id: true },
          });
          if (activeOa) throw new BadRequestException('领用申请已进入OA审批，不可修改');
        }

        const currentDetails =
          requestedId !== null
            ? await tx.hspsi_draw_approve_detail.findMany({
                where: { draw_id: requestedId },
                orderBy: { draw_detail_id: 'asc' },
              })
            : [];
        if (requestedId !== null) {
          const confirmed = await this.confirmedOutputUsage(tx, requestedId);
          for (const line of lines) {
            const source = currentDetails.find(
              (detail) => detail.goods_id === line.goodsId && detail.sku_id === line.skuId,
            );
            if (!source) continue;
            const used =
              (confirmed.get(`detail:${source.draw_detail_id}`) ?? 0) +
              (confirmed.get(`legacy:${line.goodsId}:${line.skuId}`) ?? 0);
            if (line.quantity < used)
              throw new BadRequestException('申请数量不得低于累计已确认出库数量');
          }
        }

        const applicantId = this.bigint(body.applicantId ?? current?.applicant_id, '领用人');
        const currentAttachments = this.attachmentItems(current?.attachments);
        const signatureWasExplicitlyCleared =
          body.signatureContent !== undefined &&
          !submittedSignature &&
          body.signatureAttachment !== undefined &&
          !String(body.signatureAttachment ?? '').trim();
        const attachments = uploadedSignature
          ? [
              ...currentAttachments.filter((item) => item.category !== 'signature'),
              uploadedSignature,
            ]
          : signatureWasExplicitlyCleared
            ? currentAttachments.filter((item) => item.category !== 'signature')
            : currentAttachments;
        const signatureAttachment = uploadedSignature
          ? uploadedSignature.id
          : signatureWasExplicitlyCleared
            ? ''
            : String(current?.signature_attachment ?? '').trim();
        const hasHistoricalSignature = Boolean(current?.signature_content);
        const hasSignature = Boolean(
          uploadedSignature ||
          signatureAttachment ||
          (!signatureWasExplicitlyCleared && hasHistoricalSignature),
        );
        if (submit && !hasSignature)
          throw new BadRequestException('提交申请前必须完成领用人签字确认');
        const previousSignedBy = current?.signed_by ?? 0n;
        const signedBy = hasSignature
          ? this.bigint(
              body.signedBy ?? (previousSignedBy > 0n ? previousSignedBy : applicantId),
              '签署人',
            )
          : 0n;
        if (hasSignature && signedBy !== applicantId) {
          throw new BadRequestException('签署人必须与领用人一致');
        }
        const signedAt = hasSignature
          ? new Date(body.signedAt ?? current?.signed_at ?? Date.now())
          : null;
        if (signedAt && Number.isNaN(signedAt.getTime()))
          throw new BadRequestException('签署时间无效');

        const orgId = this.bigint(body.orgId ?? current?.org_id, '所属组织');
        const warehouseId = this.bigint(body.warehouseId ?? current?.warehouse_id, '领用仓库');
        const deptId = this.bigint(body.deptId ?? current?.dept_id, '领用部门');
        const drawType = Number(body.drawType ?? current?.draw_type ?? 0);
        const reason = String(body.reason ?? current?.draw_reason ?? '').trim();
        if (submit && !reason) throw new BadRequestException('提交申请前必须填写申请原因');
        if (drawType === 1 && lines.some((line) => line.returnable === 1)) {
          throw new BadRequestException('直接领用的明细必须选择“无需归还”');
        }
        if (drawType === 2 && lines.some((line) => line.returnable === 0)) {
          throw new BadRequestException('借用的明细必须选择“可归还”');
        }
        await this.validateApplicationReferences(tx, {
          orgId,
          warehouseId,
          deptId,
          applicantId,
          drawType,
        });
        await this.masterData.assertGoodsLines(orgId, warehouseId, lines, tx);

        const total = lines.reduce((sum, line) => sum + line.quantity, 0);
        const data = {
          draw_qty: total,
          org_id: orgId,
          warehouse_id: warehouseId,
          dept_id: deptId,
          applicant_id: applicantId,
          draw_type: drawType,
          draw_date: new Date(body.date ?? current?.draw_date ?? Date.now()),
          draw_reason: reason,
          attachments,
          signature_content:
            uploadedSignature || signatureWasExplicitlyCleared
              ? null
              : (current?.signature_content ?? null),
          signature_attachment: signatureAttachment,
          signed_by: signedBy,
          signed_at: signedAt,
          status: submit ? 1 : 0,
          approve_status: 0,
          approve_comment: '',
          approve_by: 0n,
          approve_date: null,
          remark: String(body.remark ?? current?.remark ?? ''),
          updated_by: BigInt(userId),
        };
        const newApplicationNo =
          requestedId === null
            ? await this.businessNumber.generate(BUSINESS_PREFIX.REQUISITION_APPLICATION)
            : '';
        const header =
          requestedId !== null
            ? await tx.hspsi_draw_approve.update({ where: { draw_id: requestedId }, data })
            : await tx.hspsi_draw_approve.create({
                data: {
                  ...data,
                  draw_no: newApplicationNo,
                  fact_draw_qty: 0,
                  created_by: BigInt(userId),
                },
              });
        await tx.hspsi_draw_approve_detail.deleteMany({ where: { draw_id: header.draw_id } });
        await tx.hspsi_draw_approve_detail.createMany({
          data: lines.map((line) => ({
            draw_id: header.draw_id,
            goods_id: line.goodsId,
            sku_id: line.skuId,
            batch_no: line.batchNo,
            unit_type: line.unitType,
            draw_qty: line.quantity,
            is_returnable: line.returnable,
            remark: line.remark,
          })),
        });
        return header.draw_id;
      });
    } catch (error) {
      if (uploadedSignature) {
        await this.attachmentsService.discardUncommittedObjectForIntegration(
          uploadedSignature.objectKey,
        );
      }
      throw error;
    }
    if (!submit) return { id: drawId, message: '草稿已保存' };
    const oa = await this.oaApproval.submit(drawId, userId);
    return {
      id: drawId,
      message:
        oa.procStatus === 'PUSH_FAILED'
          ? `领用申请已保存，但提交OA失败：${oa.errorMessage ?? '请稍后重试'}`
          : '申请已提交OA审批',
      oaStatus: oa.procStatus,
      oaProcessId: oa.procInstId,
    };
  }

  private async ensureAutomaticOutput(
    tx: Prisma.TransactionClient,
    drawId: bigint,
    userId: string,
  ) {
    const generationKey = `requisition-application:${drawId}`;
    const application = await tx.hspsi_draw_approve.findUniqueOrThrow({
      where: { draw_id: drawId },
    });
    const existing = await tx.hspsi_draw_approve_output.findUnique({
      where: { generation_key: generationKey },
    });
    if (existing) {
      if (existing.deleted_at)
        throw new BadRequestException('审批自动生成的领用出库单已删除，无法重复生成');
      await this.documentTrace.link(
        {
          upstreamType: 'requisition_application',
          upstreamId: application.draw_id,
          upstreamNo: application.draw_no,
          downstreamType: 'requisition_output',
          downstreamId: existing.draw_output_id,
          downstreamNo: existing.draw_output_no,
          relationKind: 'approval_generated',
          createdBy: userId,
        },
        tx,
      );
      return existing;
    }
    const details = await tx.hspsi_draw_approve_detail.findMany({
      where: { draw_id: drawId },
      orderBy: { draw_detail_id: 'asc' },
    });
    if (!details.length) throw new BadRequestException('领用申请没有明细，不能生成出库单');
    const outputNo = await this.businessNumber.generate(BUSINESS_PREFIX.REQUISITION_OUTPUT);
    const header = await tx.hspsi_draw_approve_output.create({
      data: {
        draw_output_no: outputNo,
        draw_id: drawId,
        generation_key: generationKey,
        auto_created: 1,
        org_id: application.org_id,
        warehouse_id: application.warehouse_id,
        dept_id: application.dept_id,
        receiver_id: application.applicant_id,
        output_date: new Date(),
        status: 1,
        comfirm_status: 0,
        comfirm_comment: '',
        comfirm_by: 0n,
        posting_version: 0,
        remark: `领用申请 ${application.draw_no} 审批通过后自动生成`,
        created_by: BigInt(userId),
        updated_by: BigInt(userId),
      },
    });
    await tx.hspsi_draw_approve_output_detail.createMany({
      data: details.map((detail) => ({
        draw_output_id: header.draw_output_id,
        draw_detail_id: detail.draw_detail_id,
        goods_id: detail.goods_id,
        sku_id: detail.sku_id,
        batch_no: String(detail.batch_no ?? ''),
        unit_type: detail.unit_type,
        draw_qty: detail.draw_qty,
        fact_draw_qty: detail.draw_qty,
        is_returnable: detail.is_returnable,
        remark: detail.remark,
      })),
    });
    await this.documentTrace.link(
      {
        upstreamType: 'requisition_application',
        upstreamId: application.draw_id,
        upstreamNo: application.draw_no,
        downstreamType: 'requisition_output',
        downstreamId: header.draw_output_id,
        downstreamNo: outputNo,
        relationKind: 'approval_generated',
        createdBy: userId,
      },
      tx,
    );
    return { ...header, draw_output_no: outputNo };
  }

  async approve(id: string, approved: boolean, comment: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const drawId = BigInt(id);
      await this.lockRow(tx, 'hspsi_draw_approve', 'draw_id', drawId);
      const application = await tx.hspsi_draw_approve.findFirst({
        where: { draw_id: drawId, deleted_at: null },
      });
      if (!application) throw new NotFoundException('领用申请不存在');

      const activeOa = await tx.hspsi_oa_approval_instance.findFirst({
        where: {
          business_type: 'requisition_application',
          business_id: drawId,
          proc_status: { in: ['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'] },
          deleted_at: null,
        },
        select: { id: true },
      });
      if (activeOa) throw new BadRequestException('该申请正在OA审批，不能在本系统审批');

      if (!approved) {
        const directOutput = await tx.hspsi_draw_approve_output.findFirst({
          where: {
            draw_id: drawId,
            generation_key: { startsWith: 'direct-requisition-output:' },
            deleted_at: null,
          },
          orderBy: { draw_output_id: 'desc' },
        });
        if (directOutput && [1, 2].includes(application.approve_status)) {
          if (directOutput.comfirm_status !== 1) {
            throw new BadRequestException('直接领用出库尚未生效，不能执行否决处理');
          }
          if (application.approve_status !== 2) {
            await tx.hspsi_draw_approve.update({
              where: { draw_id: drawId },
              data: {
                approve_status: 2,
                approve_comment: comment,
                approve_by: BigInt(userId),
                approve_date: new Date(),
                status: 0,
                updated_by: BigInt(userId),
              },
            });
          }
          const returnDocument = await this.ensureRejectedDirectOutputReturn(
            tx,
            application,
            directOutput,
            userId,
          );
          return {
            outputId: directOutput.draw_output_id,
            returnId: returnDocument?.draw_exit_id ?? null,
            alreadyApproved: application.approve_status === 2,
            rejectedDirectOutput: true,
          };
        }
      }

      if (application.approve_status === 1 && approved) {
        const output = await this.ensureAutomaticOutput(tx, drawId, userId);
        return { outputId: output.draw_output_id, alreadyApproved: true };
      }
      if (application.status !== 1 || application.approve_status !== 0) {
        throw new BadRequestException('仅待审批申请可操作');
      }
      if (approved) {
        if (!application.signature_content && !application.signature_attachment) {
          throw new BadRequestException('申请缺少领用人签字，不能审批通过');
        }
        if (application.signed_by !== application.applicant_id || !application.signed_at) {
          throw new BadRequestException('领用人签署信息不完整，不能审批通过');
        }
      }
      await tx.hspsi_draw_approve.update({
        where: { draw_id: drawId },
        data: {
          approve_status: approved ? 1 : 2,
          approve_comment: comment,
          approve_by: BigInt(userId),
          approve_date: new Date(),
          status: approved ? 1 : 0,
          updated_by: BigInt(userId),
        },
      });
      if (!approved)
        return {
          outputId: null,
          returnId: null,
          alreadyApproved: false,
          rejectedDirectOutput: false,
        };
      const output = await this.ensureAutomaticOutput(tx, drawId, userId);
      return {
        outputId: output.draw_output_id,
        returnId: null,
        alreadyApproved: false,
        rejectedDirectOutput: false,
      };
    });
    return {
      id,
      outputId: result.outputId,
      returnId: result.returnId ?? null,
      message: approved
        ? result.alreadyApproved
          ? '申请已审批，领用出库草稿已存在'
          : '审批通过，已自动生成领用出库草稿'
        : result.rejectedDirectOutput
          ? result.alreadyApproved
            ? '申请已否决，领用退回草稿已存在'
            : '申请已否决，已生效出库保持不变，并已生成领用退回草稿'
          : '已驳回',
    };
  }

  async handleOaApprovalResult(
    payload: ApprovalCallbackPayload,
    rawPayload: unknown,
    callbackLogId: bigint,
  ) {
    const instance = await this.prisma.hspsi_oa_approval_instance.findFirst({
      where: {
        business_type: 'requisition_application',
        bus_key: payload.busKey,
        proc_inst_id: payload.procInstId,
        deleted_at: null,
      },
      orderBy: { id: 'desc' },
    });
    if (!instance) throw new NotFoundException('未找到对应的领用OA审批实例');

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT id FROM hspsi_oa_approval_instance WHERE id = ? FOR UPDATE',
        instance.id,
      );
      await this.lockRow(tx, 'hspsi_draw_approve', 'draw_id', instance.business_id);
      const current = await tx.hspsi_oa_approval_instance.findUniqueOrThrow({
        where: { id: instance.id },
      });
      const application = await tx.hspsi_draw_approve.findFirst({
        where: { draw_id: current.business_id, deleted_at: null },
      });
      if (!application) throw new NotFoundException('OA审批对应的领用申请不存在');

      const expectedApproveStatus = payload.procStatus === 'PASSED' ? 1 : 2;
      const duplicate =
        current.proc_status === payload.procStatus &&
        application.approve_status === expectedApproveStatus;
      let outputId: bigint | null = null;
      if (!duplicate) {
        const approved = payload.procStatus === 'PASSED';
        await tx.hspsi_draw_approve.update({
          where: { draw_id: application.draw_id },
          data: {
            approve_status: approved ? 1 : 2,
            approve_comment: this.oaApprovalComment(payload.procStatus),
            approve_by: 0n,
            approve_date: new Date(),
            status: approved ? 1 : 0,
            updated_by: 0n,
          },
        });
        if (approved) {
          const output = await this.ensureAutomaticOutput(tx, application.draw_id, '0');
          outputId = output.draw_output_id;
        }
      } else if (payload.procStatus === 'PASSED') {
        const output = await this.ensureAutomaticOutput(tx, application.draw_id, '0');
        outputId = output.draw_output_id;
      }

      await tx.hspsi_oa_approval_instance.update({
        where: { id: current.id },
        data: {
          proc_key: payload.procKey,
          proc_status: payload.procStatus,
          callback_count: { increment: 1 },
          last_callback_at: new Date(),
          updated_by: 0n,
          updated_at: new Date(),
        },
      });
      await tx.hspsi_oa_approval_callback_log.update({
        where: { id: callbackLogId },
        data: {
          instance_id: current.id,
          event_code: 'XFTOAFPS',
          prj_cod: payload.prjCod,
          proc_status: payload.procStatus,
          bus_key: payload.busKey,
          proc_inst_id: payload.procInstId,
          proc_key: payload.procKey,
          raw_payload: JSON.stringify(rawPayload),
          processed: 1,
          process_result: duplicate ? '重复回调，已幂等确认' : '领用审批结果已处理',
          account_set_id: current.account_set_id,
        },
      });
      return {
        processed: true,
        duplicate,
        applicationId: application.draw_id,
        outputId,
        procStatus: payload.procStatus,
      };
    });
  }

  private oaApprovalComment(status: ApprovalCallbackPayload['procStatus']) {
    return (
      {
        PASSED: 'OA审批通过',
        REJECTED: 'OA审批驳回',
        CANCELED: 'OA审批取消',
        DELETED: 'OA审批流程删除',
      }[status] ?? `OA审批状态：${status}`
    );
  }

  private async ensureRejectedDirectOutputReturn(
    tx: Prisma.TransactionClient,
    application: Prisma.hspsi_draw_approveGetPayload<Record<string, never>>,
    output: Prisma.hspsi_draw_approve_outputGetPayload<Record<string, never>>,
    userId: string,
  ) {
    const existing = await tx.hspsi_draw_approve_output_exit.findFirst({
      where: { draw_output_id: output.draw_output_id, deleted_at: null },
      orderBy: { draw_exit_id: 'desc' },
    });
    if (existing) return existing;

    const details = await tx.hspsi_draw_approve_output_detail.findMany({
      where: { draw_output_id: output.draw_output_id },
      orderBy: { output_detail_id: 'asc' },
    });
    const returnableDetails = details.filter(
      (detail) => detail.is_returnable === 1 && Number(detail.fact_draw_qty) > 0,
    );
    if (!returnableDetails.length) {
      throw new BadRequestException('直接领用出库没有可生成退回草稿的明细');
    }
    const returnNo = await this.businessNumber.generate(BUSINESS_PREFIX.REQUISITION_RETURN);
    const header = await tx.hspsi_draw_approve_output_exit.create({
      data: {
        draw_exit_no: returnNo,
        draw_id: application.draw_id,
        draw_output_id: output.draw_output_id,
        exit_reson: '直接领用申请被否决，待办理退回',
        exit_qty: returnableDetails.reduce((sum, detail) => sum + Number(detail.fact_draw_qty), 0),
        org_id: output.org_id,
        warehouse_id: output.warehouse_id,
        dept_id: output.dept_id,
        receiver_id: output.receiver_id,
        return_date: new Date(),
        status: 1,
        comfirm_status: 0,
        comfirm_by: 0n,
        posting_version: 0,
        remark: `由直接领用出库单${output.draw_output_no ?? ''}自动生成`,
        created_by: BigInt(userId),
        updated_by: BigInt(userId),
      },
    });
    await tx.hspsi_draw_approve_output_exit_detail.createMany({
      data: returnableDetails.map((detail) => ({
        draw_exit_id: header.draw_exit_id,
        draw_output_detail_id: detail.output_detail_id,
        goods_id: detail.goods_id,
        sku_id: detail.sku_id,
        batch_no: detail.batch_no,
        unit_type: detail.unit_type,
        so_qty: detail.fact_draw_qty,
        exit_qty: detail.fact_draw_qty,
        storage_location: '',
        remark: '',
      })),
    });
    await this.documentTrace.link(
      {
        upstreamType: 'requisition_output',
        upstreamId: output.draw_output_id,
        upstreamNo: output.draw_output_no ?? '',
        downstreamType: 'requisition_return',
        downstreamId: header.draw_exit_id,
        downstreamNo: returnNo,
        relationKind: 'rejection_return',
        createdBy: userId,
      },
      tx,
    );
    return header;
  }

  async deleteApplication(id: string, userId: string) {
    const drawId = BigInt(id);
    await this.prisma.$transaction(async (tx) => {
      await this.lockRow(tx, 'hspsi_draw_approve', 'draw_id', drawId);
      const application = await tx.hspsi_draw_approve.findFirst({
        where: { draw_id: drawId, deleted_at: null },
      });
      if (!application) throw new NotFoundException('领用申请不存在');
      const [confirmedOutputs, confirmedReturns, activeOa] = await Promise.all([
        tx.hspsi_draw_approve_output.count({
          where: { draw_id: drawId, comfirm_status: 1, deleted_at: null },
        }),
        tx.hspsi_draw_approve_output_exit.count({
          where: { draw_id: drawId, comfirm_status: 1, deleted_at: null },
        }),
        tx.hspsi_oa_approval_instance.findFirst({
          where: {
            business_type: 'requisition_application',
            business_id: drawId,
            proc_status: { in: ['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'] },
            deleted_at: null,
          },
          select: { id: true },
        }),
      ]);
      if (confirmedOutputs || confirmedReturns) {
        throw new BadRequestException('申请已有确认出入库，不可删除');
      }
      if (activeOa) throw new BadRequestException('领用申请已进入OA审批，不可删除');
      if (application.approve_status === 1) throw new BadRequestException('已审批申请不可删除');
      await tx.hspsi_draw_approve.update({
        where: { draw_id: drawId },
        data: { deleted_at: new Date(), updated_by: BigInt(userId) },
      });
    });
    return { id, message: '删除成功' };
  }

  async applicationOptions() {
    return (await this.applications({ page: 1, pageSize: 100, status: 1 })).items;
  }

  async outputs(query: Body) {
    const { page, pageSize } = this.paging(query);
    const where: Prisma.hspsi_draw_approve_outputWhereInput = { deleted_at: null };
    if (query.status !== undefined && query.status !== '')
      where.comfirm_status = Number(query.status);
    const [records, total] = await this.prisma.$transaction([
      this.prisma.hspsi_draw_approve_output.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { draw_output_id: 'desc' },
      }),
      this.prisma.hspsi_draw_approve_output.count({ where }),
    ]);
    const outputIds = records.map((item) => item.draw_output_id);
    const [applications, details, returnHeads] = await Promise.all([
      records.length
        ? this.prisma.hspsi_draw_approve.findMany({
            where: { draw_id: { in: records.map((item) => item.draw_id) } },
          })
        : [],
      outputIds.length
        ? this.prisma.hspsi_draw_approve_output_detail.findMany({
            where: { draw_output_id: { in: outputIds } },
          })
        : [],
      outputIds.length
        ? this.prisma.hspsi_draw_approve_output_exit.findMany({
            where: { draw_output_id: { in: outputIds }, comfirm_status: 1, deleted_at: null },
            select: { draw_exit_id: true },
          })
        : [],
    ]);
    const returned = returnHeads.length
      ? await this.prisma.hspsi_draw_approve_output_exit_detail.findMany({
          where: { draw_exit_id: { in: returnHeads.map((item) => item.draw_exit_id) } },
        })
      : [];
    const applicationMap = new Map(applications.map((item) => [String(item.draw_id), item]));
    const referencedItems = await this.references.enrich(
      records.map((item) => {
        const application = applicationMap.get(String(item.draw_id));
        const outputDetails = details.filter(
          (detail) => detail.draw_output_id === item.draw_output_id,
        );
        const returnableDetails = outputDetails.filter((detail) => detail.is_returnable === 1);
        const quantity = outputDetails.reduce(
          (sum, detail) => sum + Number(detail.fact_draw_qty),
          0,
        );
        const applicationQty = outputDetails.reduce(
          (sum, detail) => sum + Number(detail.draw_qty),
          0,
        );
        const returnableQuantity = returnableDetails.reduce(
          (sum, detail) => sum + Number(detail.fact_draw_qty),
          0,
        );
        const returnedQuantity = returned
          .filter((detail) =>
            returnableDetails.some(
              (source) => source.output_detail_id === detail.draw_output_detail_id,
            ),
          )
          .reduce((sum, detail) => sum + Number(detail.exit_qty), 0);
        return {
          ...item,
          id: item.draw_output_id,
          outputNo: item.draw_output_no,
          applicationId: item.draw_id,
          applicationNo: application?.draw_no ?? '',
          applicantId: application?.applicant_id ?? item.receiver_id,
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          deptId: item.dept_id,
          receiverId: item.receiver_id,
          outDate: item.output_date,
          applicationQty,
          quantity,
          returnableQuantity,
          returnedQuantity,
          returnableRemainingQuantity: Math.max(0, returnableQuantity - returnedQuantity),
          hasReturnableItems: returnableQuantity > returnedQuantity,
          autoCreated: item.auto_created === 1,
          confirmStatus: item.comfirm_status,
          createdBy: item.created_by,
          updatedBy: item.updated_by,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        };
      }),
      { confirmStatus: 'requisition_confirm_status' },
    );
    const items = await this.enrichRequisitionStaff(referencedItems);
    return { items, total, page, pageSize };
  }

  async output(id: string) {
    const item = await this.prisma.hspsi_draw_approve_output.findFirst({
      where: { draw_output_id: BigInt(id), deleted_at: null },
    });
    if (!item) throw new NotFoundException('领用出库单不存在');
    const [details, application, returned] = await Promise.all([
      this.prisma.hspsi_draw_approve_output_detail.findMany({
        where: { draw_output_id: item.draw_output_id },
        orderBy: { output_detail_id: 'asc' },
      }),
      this.prisma.hspsi_draw_approve.findFirst({
        where: { draw_id: item.draw_id, deleted_at: null },
      }),
      this.confirmedReturnUsage(this.prisma, item.draw_output_id),
    ]);
    if (!application) throw new BadRequestException('来源领用申请不存在或已删除');
    const mappedDetails = details.map((detail) => {
      const historicalQty = returned.get(String(detail.output_detail_id)) ?? 0;
      const returnable = detail.is_returnable === 1;
      return {
        id: detail.output_detail_id,
        applicationDetailId: detail.draw_detail_id,
        goodsId: detail.goods_id,
        skuId: detail.sku_id,
        batchNo: detail.batch_no,
        unitType: detail.unit_type,
        applicationQty: detail.draw_qty,
        quantity: detail.fact_draw_qty,
        returnable,
        historicalQty,
        remainingQty: returnable ? Math.max(0, Number(detail.fact_draw_qty) - historicalQty) : 0,
        remark: detail.remark,
      };
    });
    const [enriched] = await this.enrichRequisitionStaff([
      {
        ...item,
        id: item.draw_output_id,
        outputNo: item.draw_output_no ?? '',
        applicationId: item.draw_id,
        applicationNo: application.draw_no,
        applicantId: application.applicant_id,
        orgId: item.org_id,
        warehouseId: item.warehouse_id,
        deptId: item.dept_id,
        receiverId: item.receiver_id,
        outDate: item.output_date,
        autoCreated: item.auto_created === 1,
        confirmStatus: item.comfirm_status,
        confirmComment: item.comfirm_comment,
        confirmBy: item.comfirm_by,
        confirmDate: item.comfirm_date,
        hasReturnableItems: mappedDetails.some(
          (detail) => detail.returnable && detail.remainingQty > 0,
        ),
        details: mappedDetails,
      },
    ]);
    return enriched!;
  }

  async removeDocument(type: 'output' | 'return', id: string, userId: string) {
    const documentId = BigInt(id);
    if (type === 'output') {
      await this.prisma.$transaction(async (tx) => {
        await this.lockRow(tx, 'hspsi_draw_approve_output', 'draw_output_id', documentId);
        const output = await tx.hspsi_draw_approve_output.findFirst({
          where: { draw_output_id: documentId, deleted_at: null },
        });
        if (!output) throw new NotFoundException('领用出库单不存在');
        if (output.comfirm_status === 1) throw new BadRequestException('已确认单据不可删除');
        if (output.auto_created === 1) {
          throw new BadRequestException('审批自动生成的领用出库草稿不可删除，可编辑后确认');
        }
        if (
          await tx.hspsi_draw_approve_output_exit.count({
            where: { draw_output_id: documentId, deleted_at: null },
          })
        ) {
          throw new BadRequestException('领用出库单已有退回单，不可删除');
        }
        await tx.hspsi_draw_approve_output.update({
          where: { draw_output_id: documentId },
          data: { deleted_at: new Date(), updated_by: BigInt(userId) },
        });
        await this.documentTrace.removeForDocument('requisition_output', id, tx);
      });
    } else {
      await this.prisma.$transaction(async (tx) => {
        await this.lockRow(tx, 'hspsi_draw_approve_output_exit', 'draw_exit_id', documentId);
        const returnDocument = await tx.hspsi_draw_approve_output_exit.findFirst({
          where: { draw_exit_id: documentId, deleted_at: null },
        });
        if (!returnDocument) throw new NotFoundException('领用退回单不存在');
        if (returnDocument.comfirm_status === 1)
          throw new BadRequestException('已确认单据不可删除');
        await tx.hspsi_draw_approve_output_exit.update({
          where: { draw_exit_id: documentId },
          data: { deleted_at: new Date(), updated_by: BigInt(userId) },
        });
        await this.documentTrace.removeForDocument('requisition_return', id, tx);
      });
    }
    return { id, message: '删除成功' };
  }

  async saveOutput(id: string | null, body: Body, userId: string) {
    if (!id && body.directOutput === true) return this.saveDirectOutput(body, userId);
    const applicationId = this.bigint(body.applicationId, '来源领用申请');
    const explicitTargetId = id ? this.bigint(id, '领用出库单') : null;
    const automaticTarget =
      explicitTargetId !== null
        ? null
        : await this.prisma.hspsi_draw_approve_output.findFirst({
            where: {
              draw_id: applicationId,
              generation_key: { not: null },
              comfirm_status: 0,
              deleted_at: null,
            },
            select: { draw_output_id: true },
          });
    const targetId = explicitTargetId ?? automaticTarget?.draw_output_id ?? null;
    const outputId = await this.prisma.$transaction(async (tx) => {
      let current = null;
      if (targetId !== null) {
        await this.lockRow(tx, 'hspsi_draw_approve_output', 'draw_output_id', targetId);
        current = await tx.hspsi_draw_approve_output.findFirst({
          where: { draw_output_id: targetId, deleted_at: null },
        });
        if (!current) throw new NotFoundException('领用出库单不存在');
        if (current.comfirm_status === 1) throw new BadRequestException('已确认领用出库单不可编辑');
        if (current.draw_id !== applicationId) {
          throw new BadRequestException('领用出库单与来源申请不一致');
        }
        if (
          await tx.hspsi_draw_approve_output_exit.count({
            where: { draw_output_id: targetId, deleted_at: null },
          })
        ) {
          throw new BadRequestException('领用出库单已有退回单，不可编辑');
        }
      }

      await this.lockRow(tx, 'hspsi_draw_approve', 'draw_id', applicationId);
      const application = await tx.hspsi_draw_approve.findFirst({
        where: { draw_id: applicationId, deleted_at: null },
      });
      if (!application || application.approve_status !== 1) {
        throw new BadRequestException('仅已审批申请可出库');
      }
      if (
        body.receiverId !== undefined &&
        body.receiverId !== null &&
        String(body.receiverId) !== '' &&
        String(body.receiverId) !== String(application.applicant_id)
      ) {
        throw new BadRequestException('领用出库接收人必须与申请领用人一致');
      }
      if (!current) {
        const generatedDraft = await tx.hspsi_draw_approve_output.findFirst({
          where: {
            draw_id: applicationId,
            generation_key: { not: null },
            comfirm_status: 0,
            deleted_at: null,
          },
          select: { draw_output_id: true },
        });
        if (generatedDraft) {
          throw new BadRequestException('审批自动生成的领用出库草稿已存在，请刷新后编辑');
        }
      }

      const [applicationDetails, usage] = await Promise.all([
        tx.hspsi_draw_approve_detail.findMany({
          where: { draw_id: applicationId },
          orderBy: { draw_detail_id: 'asc' },
        }),
        this.confirmedOutputUsage(tx, applicationId),
      ]);
      const seen = new Set<string>();
      const lines = this.detailLines(body.details).map((line) => {
        const applicationDetailId = this.bigint(
          line.applicationDetailId ?? line.drawDetailId ?? line.id,
          '来源申请明细',
        );
        if (seen.has(String(applicationDetailId))) {
          throw new BadRequestException('同一申请明细不能重复出现在出库单中');
        }
        seen.add(String(applicationDetailId));
        const source = applicationDetails.find(
          (detail) => detail.draw_detail_id === applicationDetailId,
        );
        if (!source) throw new BadRequestException('出库明细必须来自当前领用申请');
        const quantity = this.positiveQuantity(line.quantity, '实际出库数量');
        const used =
          (usage.get(`detail:${applicationDetailId}`) ?? 0) +
          (usage.get(`legacy:${source.goods_id}:${source.sku_id}`) ?? 0);
        if (quantity > Number(source.draw_qty) - used) {
          throw new BadRequestException('本次领用超过申请剩余数量');
        }
        return {
          applicationDetailId,
          goodsId: source.goods_id,
          skuId: source.sku_id,
          batchNo: String(line.batchNo ?? source.batch_no ?? '').trim(),
          unitType: source.unit_type,
          applicationQuantity: Number(source.draw_qty),
          quantity,
          returnable: source.is_returnable,
          remark: String(line.remark ?? source.remark ?? ''),
        };
      });

      const data = {
        draw_id: application.draw_id,
        org_id: application.org_id,
        warehouse_id: application.warehouse_id,
        dept_id: application.dept_id,
        receiver_id: application.applicant_id,
        output_date: new Date(body.outDate ?? Date.now()),
        status: 1,
        remark: String(body.remark ?? ''),
        updated_by: BigInt(userId),
      };
      const newOutputNo = current
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.REQUISITION_OUTPUT);
      const header = current
        ? await tx.hspsi_draw_approve_output.update({
            where: { draw_output_id: current.draw_output_id },
            data,
          })
        : await tx.hspsi_draw_approve_output.create({
            data: {
              ...data,
              draw_output_no: newOutputNo,
              generation_key: null,
              auto_created: 0,
              comfirm_status: 0,
              comfirm_by: 0n,
              posting_version: 0,
              created_by: BigInt(userId),
            },
          });
      const outputNo = header.draw_output_no;
      await tx.hspsi_draw_approve_output_detail.deleteMany({
        where: { draw_output_id: header.draw_output_id },
      });
      await tx.hspsi_draw_approve_output_detail.createMany({
        data: lines.map((line) => ({
          draw_output_id: header.draw_output_id,
          draw_detail_id: line.applicationDetailId,
          goods_id: line.goodsId,
          sku_id: line.skuId,
          batch_no: line.batchNo,
          unit_type: line.unitType,
          draw_qty: line.applicationQuantity,
          fact_draw_qty: line.quantity,
          is_returnable: line.returnable,
          remark: line.remark,
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: 'requisition_application',
          upstreamId: application.draw_id,
          upstreamNo: application.draw_no,
          downstreamType: 'requisition_output',
          downstreamId: header.draw_output_id,
          downstreamNo: outputNo,
          relationKind: header.auto_created === 1 ? 'approval_generated' : 'source',
          createdBy: userId,
        },
        tx,
      );
      return header.draw_output_id;
    });
    return { id: outputId, message: '领用出库单已保存' };
  }

  private async saveDirectOutput(body: Body, userId: string) {
    const generationKey = this.directOutputGenerationKey(body.requestKey);
    const lines = this.detailLines(body.details).map((line) => {
      const batchNo = String(line.batchNo ?? '').trim();
      if (!batchNo) throw new BadRequestException('直接领用出库必须选择库存批次');
      return {
        goodsId: this.bigint(line.goodsId, '商品'),
        skuId: this.bigint(line.skuId, 'SKU'),
        batchNo,
        unitType: Number(line.unitType ?? 0),
        quantity: this.positiveQuantity(line.quantity, '出库数量'),
        remark: String(line.remark ?? ''),
      };
    });
    const orgId = this.bigint(body.orgId, '所属组织');
    const warehouseId = this.bigint(body.warehouseId, '领用仓库');
    const deptId = this.bigint(body.deptId, '领用部门');
    const receiverId = this.bigint(body.receiverId, '领用接收人');

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.hspsi_draw_approve_output.findUnique({
        where: { generation_key: generationKey },
      });
      if (existing) {
        if (existing.deleted_at) throw new BadRequestException('该直接出库请求对应单据已删除');
        return {
          outputId: existing.draw_output_id,
          applicationId: existing.draw_id,
          already: true,
        };
      }
      await this.validateApplicationReferences(tx, {
        orgId,
        warehouseId,
        deptId,
        applicantId: receiverId,
        drawType: 2,
      });
      await this.masterData.assertGoodsLines(orgId, warehouseId, lines, tx);
      const [applicationNo, outputNo] = await Promise.all([
        this.businessNumber.generate(BUSINESS_PREFIX.REQUISITION_APPLICATION),
        this.businessNumber.generate(BUSINESS_PREFIX.REQUISITION_OUTPUT),
      ]);
      const now = new Date();
      const total = lines.reduce((sum, line) => sum + line.quantity, 0);
      const application = await tx.hspsi_draw_approve.create({
        data: {
          draw_no: applicationNo,
          draw_qty: total,
          fact_draw_qty: total,
          org_id: orgId,
          warehouse_id: warehouseId,
          dept_id: deptId,
          applicant_id: receiverId,
          draw_type: 2,
          draw_date: new Date(body.outDate ?? now),
          draw_reason: String(body.reason ?? body.remark ?? '').trim() || '直接领用出库反向生成',
          signature_content: null,
          signature_attachment: '',
          signed_by: 0n,
          signed_at: null,
          status: 1,
          approve_status: 1,
          approve_comment: '直接领用出库后由系统自动生成并标记通过',
          approve_by: BigInt(userId),
          approve_date: now,
          remark: String(body.remark ?? ''),
          created_by: BigInt(userId),
          updated_by: BigInt(userId),
        },
      });
      const applicationDetails = await Promise.all(
        lines.map((line) =>
          tx.hspsi_draw_approve_detail.create({
            data: {
              draw_id: application.draw_id,
              goods_id: line.goodsId,
              sku_id: line.skuId,
              batch_no: line.batchNo,
              unit_type: line.unitType,
              draw_qty: line.quantity,
              is_returnable: 1,
              remark: line.remark,
            },
          }),
        ),
      );
      const output = await tx.hspsi_draw_approve_output.create({
        data: {
          draw_output_no: outputNo,
          draw_id: application.draw_id,
          generation_key: generationKey,
          auto_created: 0,
          org_id: orgId,
          warehouse_id: warehouseId,
          dept_id: deptId,
          receiver_id: receiverId,
          output_date: new Date(body.outDate ?? now),
          status: 1,
          comfirm_status: 0,
          comfirm_by: 0n,
          posting_version: 0,
          remark: String(body.remark ?? ''),
          created_by: BigInt(userId),
          updated_by: BigInt(userId),
        },
      });
      await tx.hspsi_draw_approve_output_detail.createMany({
        data: lines.map((line, index) => ({
          draw_output_id: output.draw_output_id,
          draw_detail_id: applicationDetails[index]!.draw_detail_id,
          goods_id: line.goodsId,
          sku_id: line.skuId,
          batch_no: line.batchNo,
          unit_type: line.unitType,
          draw_qty: line.quantity,
          fact_draw_qty: line.quantity,
          is_returnable: 1,
          remark: line.remark,
        })),
      });
      await this.posting.post(
        {
          orgId,
          warehouseId,
          direction: -1,
          operationType: 2,
          inventoryMode: INVENTORY_BUSINESS_MODE.REQUISITION_OR_PRODUCTION_OUTPUT,
          sourceId: output.draw_output_id,
          sourceType: 'requisition_output',
          sourceNo: outputNo,
          operationBy: userId,
          idempotencyKey: `requisition-output:${output.draw_output_id}:confirm:v1`,
          remark: String(body.remark ?? '').trim() || '直接领用出库',
          lines: this.aggregatePostingLines(
            orgId,
            warehouseId,
            lines.map((line) => ({
              goodsId: line.goodsId,
              skuId: line.skuId,
              batchNo: line.batchNo,
              unitType: line.unitType,
              quantity: line.quantity,
            })),
          ),
        },
        tx,
      );
      await tx.hspsi_draw_approve_output.update({
        where: { draw_output_id: output.draw_output_id },
        data: {
          comfirm_status: 1,
          comfirm_comment: '直接领用出库保存后自动确认',
          comfirm_by: BigInt(userId),
          comfirm_date: now,
          posting_version: 1,
          updated_by: BigInt(userId),
        },
      });
      await this.documentTrace.link(
        {
          upstreamType: 'requisition_output',
          upstreamId: output.draw_output_id,
          upstreamNo: outputNo,
          downstreamType: 'requisition_application',
          downstreamId: application.draw_id,
          downstreamNo: applicationNo,
          relationKind: 'reverse_generated',
          createdBy: userId,
        },
        tx,
      );
      return {
        outputId: output.draw_output_id,
        applicationId: application.draw_id,
        already: false,
      };
    });
    return {
      id: result.outputId,
      applicationId: result.applicationId,
      message: result.already
        ? '直接领用出库已完成'
        : '直接领用出库已完成，并已反向生成已通过的领用申请单',
    };
  }

  async confirmOutput(id: string, comment: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const outputId = BigInt(id);
      await this.lockRow(tx, 'hspsi_draw_approve_output', 'draw_output_id', outputId);
      const output = await tx.hspsi_draw_approve_output.findFirst({
        where: { draw_output_id: outputId, deleted_at: null },
      });
      if (!output) throw new NotFoundException('领用出库单不存在');
      if (output.comfirm_status === 1) return { already: true };
      await this.lockRow(tx, 'hspsi_draw_approve', 'draw_id', output.draw_id);
      const [application, applicationDetails, details] = await Promise.all([
        tx.hspsi_draw_approve.findFirst({ where: { draw_id: output.draw_id, deleted_at: null } }),
        tx.hspsi_draw_approve_detail.findMany({ where: { draw_id: output.draw_id } }),
        tx.hspsi_draw_approve_output_detail.findMany({ where: { draw_output_id: outputId } }),
      ]);
      if (!application || application.approve_status !== 1) {
        throw new BadRequestException('来源领用申请不存在或未审批通过');
      }
      if (output.receiver_id !== application.applicant_id) {
        throw new BadRequestException('领用出库接收人必须与申请领用人一致');
      }
      if (!details.length) throw new BadRequestException('领用出库单没有明细');
      const usage = await this.confirmedOutputUsage(tx, output.draw_id);
      for (const detail of details) {
        if (!detail.batch_no.trim())
          throw new BadRequestException('确认出库前必须填写全部物品批号');
        const source = applicationDetails.find(
          (line) => line.draw_detail_id === detail.draw_detail_id,
        );
        if (!source || source.goods_id !== detail.goods_id || source.sku_id !== detail.sku_id) {
          throw new BadRequestException('出库明细与来源申请明细不一致');
        }
        const used =
          (usage.get(`detail:${source.draw_detail_id}`) ?? 0) +
          (usage.get(`legacy:${source.goods_id}:${source.sku_id}`) ?? 0);
        if (Number(detail.fact_draw_qty) > Number(source.draw_qty) - used) {
          throw new BadRequestException('本次领用超过申请剩余数量');
        }
        if (detail.is_returnable !== source.is_returnable) {
          throw new BadRequestException('出库明细物品属性与来源申请不一致');
        }
      }
      const nextVersion = output.posting_version + 1;
      await this.posting.post(
        {
          orgId: output.org_id,
          warehouseId: output.warehouse_id,
          direction: -1,
          operationType: 2,
          inventoryMode: INVENTORY_BUSINESS_MODE.REQUISITION_OR_PRODUCTION_OUTPUT,
          sourceId: output.draw_output_id,
          sourceType: 'requisition_output',
          sourceNo: output.draw_output_no ?? '',
          operationBy: userId,
          idempotencyKey: `requisition-output:${id}:confirm:v${nextVersion}`,
          remark: comment || '领用出库',
          lines: this.aggregatePostingLines(
            output.org_id,
            output.warehouse_id,
            details.map((detail) => ({
              goodsId: detail.goods_id,
              skuId: detail.sku_id,
              batchNo: detail.batch_no,
              unitType: detail.unit_type,
              quantity: String(detail.fact_draw_qty),
            })),
          ),
        },
        tx,
      );
      await tx.hspsi_draw_approve_output.update({
        where: { draw_output_id: outputId },
        data: {
          comfirm_status: 1,
          comfirm_comment: comment,
          comfirm_by: BigInt(userId),
          comfirm_date: new Date(),
          posting_version: nextVersion,
          updated_by: BigInt(userId),
        },
      });
      await this.syncApplicationActualQuantity(tx, output.draw_id);
      return { already: false };
    });
    return { id, message: result.already ? '领用出库已确认' : '领用出库确认成功' };
  }

  async undoConfirmOutput(id: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const outputId = BigInt(id);
      await this.lockRow(tx, 'hspsi_draw_approve_output', 'draw_output_id', outputId);
      const output = await tx.hspsi_draw_approve_output.findFirst({
        where: { draw_output_id: outputId, deleted_at: null },
      });
      if (!output) throw new NotFoundException('领用出库单不存在');
      if (output.comfirm_status !== 1) {
        if (output.posting_version > 0) return { already: true };
        throw new BadRequestException('仅已确认出库可撤销');
      }
      await this.lockRow(tx, 'hspsi_draw_approve', 'draw_id', output.draw_id);
      if (
        await tx.hspsi_draw_approve_output_exit.count({
          where: { draw_output_id: outputId, deleted_at: null },
        })
      ) {
        throw new BadRequestException('已有领用退回单，不可撤销');
      }
      const details = await tx.hspsi_draw_approve_output_detail.findMany({
        where: { draw_output_id: outputId },
      });
      await this.posting.post(
        {
          orgId: output.org_id,
          warehouseId: output.warehouse_id,
          direction: 1,
          operationType: 1,
          inventoryMode: INVENTORY_BUSINESS_MODE.REQUISITION_OR_PRODUCTION_OUTPUT,
          sourceId: output.draw_output_id,
          sourceType: 'requisition_output_reverse',
          sourceNo: output.draw_output_no ?? '',
          operationBy: userId,
          idempotencyKey: `requisition-output:${id}:undo:v${output.posting_version}`,
          remark: '撤销领用出库',
          lines: this.aggregatePostingLines(
            output.org_id,
            output.warehouse_id,
            details.map((detail) => ({
              goodsId: detail.goods_id,
              skuId: detail.sku_id,
              batchNo: detail.batch_no,
              unitType: detail.unit_type,
              quantity: String(detail.fact_draw_qty),
            })),
          ),
        },
        tx,
      );
      await tx.hspsi_draw_approve_output.update({
        where: { draw_output_id: outputId },
        data: {
          comfirm_status: 0,
          comfirm_comment: '',
          comfirm_by: 0n,
          comfirm_date: null,
          updated_by: BigInt(userId),
        },
      });
      await this.syncApplicationActualQuantity(tx, output.draw_id);
      return { already: false };
    });
    return { id, message: result.already ? '领用出库已撤销确认' : '已撤销出库确认，库存已回退' };
  }

  async outputOptions() {
    const items = (await this.outputs({ page: 1, pageSize: 100, status: 1 })).items;
    return items.filter(
      (item: Body) => item.hasReturnableItems && Number(item.returnableRemainingQuantity) > 0,
    );
  }

  async returns(query: Body) {
    const { page, pageSize } = this.paging(query);
    const where: Prisma.hspsi_draw_approve_output_exitWhereInput = { deleted_at: null };
    if (query.status !== undefined && query.status !== '')
      where.comfirm_status = Number(query.status);
    const [records, total] = await this.prisma.$transaction([
      this.prisma.hspsi_draw_approve_output_exit.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { draw_exit_id: 'desc' },
      }),
      this.prisma.hspsi_draw_approve_output_exit.count({ where }),
    ]);
    const [outputs, applications] = await Promise.all([
      records.length
        ? this.prisma.hspsi_draw_approve_output.findMany({
            where: { draw_output_id: { in: records.map((item) => item.draw_output_id) } },
          })
        : [],
      records.length
        ? this.prisma.hspsi_draw_approve.findMany({
            where: { draw_id: { in: records.map((item) => item.draw_id) } },
          })
        : [],
    ]);
    const outputMap = new Map(outputs.map((item) => [String(item.draw_output_id), item]));
    const applicationMap = new Map(applications.map((item) => [String(item.draw_id), item]));
    const referencedItems = await this.references.enrich(
      records.map((item) => {
        const output = outputMap.get(String(item.draw_output_id));
        const application = applicationMap.get(String(item.draw_id));
        return {
          ...item,
          id: item.draw_exit_id,
          returnNo: item.draw_exit_no,
          applicationId: item.draw_id,
          applicationNo: application?.draw_no ?? '',
          applicantId: application?.applicant_id ?? 0,
          outputId: item.draw_output_id,
          outputNo: output?.draw_output_no ?? '',
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          deptId: item.dept_id,
          receiverId: item.receiver_id,
          returnDate: item.return_date,
          reason: item.exit_reson,
          quantity: item.exit_qty,
          status: item.status,
          confirmStatus: item.comfirm_status,
          createdBy: item.created_by,
          updatedBy: item.updated_by,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        };
      }),
      {
        status: 'requisition_status',
        confirmStatus: 'requisition_confirm_status',
      },
    );
    const items = await this.enrichRequisitionStaff(referencedItems);
    return { items, total, page, pageSize };
  }

  async returnOne(id: string) {
    const item = await this.prisma.hspsi_draw_approve_output_exit.findFirst({
      where: { draw_exit_id: BigInt(id), deleted_at: null },
    });
    if (!item) throw new NotFoundException('领用退回单不存在');
    const [details, output, application] = await Promise.all([
      this.prisma.hspsi_draw_approve_output_exit_detail.findMany({
        where: { draw_exit_id: item.draw_exit_id },
        orderBy: { exit_detail_id: 'asc' },
      }),
      this.prisma.hspsi_draw_approve_output.findFirst({
        where: { draw_output_id: item.draw_output_id, deleted_at: null },
      }),
      this.prisma.hspsi_draw_approve.findFirst({
        where: { draw_id: item.draw_id, deleted_at: null },
      }),
    ]);
    const sourceDetails = output
      ? await this.prisma.hspsi_draw_approve_output_detail.findMany({
          where: { draw_output_id: output.draw_output_id },
        })
      : [];
    const [enriched] = await this.enrichRequisitionStaff([
      {
        ...item,
        id: item.draw_exit_id,
        returnNo: item.draw_exit_no ?? '',
        applicationId: item.draw_id,
        applicationNo: application?.draw_no ?? '',
        applicantId: application?.applicant_id ?? 0,
        outputId: item.draw_output_id,
        outputNo: output?.draw_output_no ?? '',
        orgId: item.org_id,
        warehouseId: item.warehouse_id,
        deptId: item.dept_id,
        receiverId: item.receiver_id,
        returnDate: item.return_date,
        reason: item.exit_reson,
        status: item.status,
        confirmStatus: item.comfirm_status,
        confirmComment: item.comfirm_comment,
        confirmBy: item.comfirm_by,
        confirmDate: item.comfirm_date,
        details: details.map((detail) => {
          const source = sourceDetails.find(
            (sourceDetail) => sourceDetail.output_detail_id === detail.draw_output_detail_id,
          );
          return {
            id: detail.exit_detail_id,
            outputDetailId: detail.draw_output_detail_id,
            goodsId: detail.goods_id,
            skuId: detail.sku_id,
            batchNo: detail.batch_no,
            unitType: detail.unit_type,
            issuedQty: detail.so_qty,
            quantity: detail.exit_qty,
            storageLocation: detail.storage_location,
            returnable: source?.is_returnable === 1,
            remark: detail.remark,
          };
        }),
      },
    ]);
    return enriched!;
  }

  async saveReturn(id: string | null, body: Body, userId: string) {
    if (!String(body.reason ?? '').trim()) throw new BadRequestException('退回原因必填');
    const outputId = this.bigint(body.outputId, '来源领用出库单');
    const requestedReturnId = id ? this.bigint(id, '领用退回单') : null;
    const returnId = await this.prisma.$transaction(async (tx) => {
      let current = null;
      if (requestedReturnId !== null) {
        await this.lockRow(tx, 'hspsi_draw_approve_output_exit', 'draw_exit_id', requestedReturnId);
        current = await tx.hspsi_draw_approve_output_exit.findFirst({
          where: { draw_exit_id: requestedReturnId, deleted_at: null },
        });
        if (!current) throw new NotFoundException('领用退回单不存在');
        if (current.comfirm_status === 1) throw new BadRequestException('已确认退回单不可编辑');
        if (current.draw_output_id !== outputId) {
          throw new BadRequestException('退回单与来源领用出库单不一致');
        }
      }

      await this.lockRow(tx, 'hspsi_draw_approve_output', 'draw_output_id', outputId);
      const output = await tx.hspsi_draw_approve_output.findFirst({
        where: { draw_output_id: outputId, deleted_at: null },
      });
      if (!output || output.comfirm_status !== 1) {
        throw new BadRequestException('仅已确认出库可退回');
      }
      if (
        body.receiverId !== undefined &&
        body.receiverId !== null &&
        String(body.receiverId) !== '' &&
        String(body.receiverId) !== String(output.receiver_id)
      ) {
        throw new BadRequestException('退回人必须与领用出库接收人一致');
      }
      const [sourceDetails, returned] = await Promise.all([
        tx.hspsi_draw_approve_output_detail.findMany({
          where: { draw_output_id: outputId },
          orderBy: { output_detail_id: 'asc' },
        }),
        this.confirmedReturnUsage(tx, outputId, requestedReturnId ?? undefined),
      ]);
      const hasReturnableItems = sourceDetails.some(
        (detail) =>
          detail.is_returnable === 1 &&
          Number(detail.fact_draw_qty) > (returned.get(String(detail.output_detail_id)) ?? 0),
      );
      if (!hasReturnableItems) throw new BadRequestException('该领用出库单没有可退回物品');

      const seen = new Set<string>();
      const lines = this.detailLines(body.details).map((line) => {
        const outputDetailId = this.bigint(line.outputDetailId, '来源出库明细');
        if (seen.has(String(outputDetailId))) {
          throw new BadRequestException('同一出库明细不能重复退回');
        }
        seen.add(String(outputDetailId));
        const source = sourceDetails.find((detail) => detail.output_detail_id === outputDetailId);
        if (!source) throw new BadRequestException('退回明细必须来自所选领用出库单');
        if (source.is_returnable !== 1) {
          throw new BadRequestException('无需归还的物品不能生成领用退回单');
        }
        const quantity = this.positiveQuantity(line.quantity, '退回数量');
        const historical = returned.get(String(outputDetailId)) ?? 0;
        if (quantity > Number(source.fact_draw_qty) - historical) {
          throw new BadRequestException('退回数量超过来源出库单可退数量');
        }
        return {
          outputDetailId,
          goodsId: source.goods_id,
          skuId: source.sku_id,
          batchNo: String(source.batch_no ?? ''),
          unitType: source.unit_type,
          issuedQuantity: Number(source.fact_draw_qty),
          quantity,
          storageLocation: String(line.storageLocation ?? line.position ?? '')
            .trim()
            .slice(0, 100),
          remark: String(line.remark ?? ''),
        };
      });

      const returnWarehouseId = this.bigint(body.warehouseId ?? output.warehouse_id, '退回仓库');
      await this.masterData.assertGoodsLines(output.org_id, returnWarehouseId, lines, tx);

      const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
      const data = {
        draw_id: output.draw_id,
        draw_output_id: output.draw_output_id,
        exit_reson: String(body.reason).trim(),
        exit_qty: quantity,
        org_id: output.org_id,
        warehouse_id: returnWarehouseId,
        dept_id: output.dept_id,
        receiver_id: output.receiver_id,
        return_date: new Date(body.returnDate ?? Date.now()),
        status: 1,
        remark: String(body.remark ?? ''),
        updated_by: BigInt(userId),
      };
      const newReturnNo = current
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.REQUISITION_RETURN);
      const header = current
        ? await tx.hspsi_draw_approve_output_exit.update({
            where: { draw_exit_id: current.draw_exit_id },
            data,
          })
        : await tx.hspsi_draw_approve_output_exit.create({
            data: {
              ...data,
              draw_exit_no: newReturnNo,
              comfirm_status: 0,
              comfirm_by: 0n,
              posting_version: 0,
              created_by: BigInt(userId),
            },
          });
      const returnNo = header.draw_exit_no;
      await tx.hspsi_draw_approve_output_exit_detail.deleteMany({
        where: { draw_exit_id: header.draw_exit_id },
      });
      await tx.hspsi_draw_approve_output_exit_detail.createMany({
        data: lines.map((line) => ({
          draw_exit_id: header.draw_exit_id,
          draw_output_detail_id: line.outputDetailId,
          goods_id: line.goodsId,
          sku_id: line.skuId,
          batch_no: line.batchNo,
          unit_type: line.unitType,
          so_qty: line.issuedQuantity,
          exit_qty: line.quantity,
          storage_location: line.storageLocation,
          remark: line.remark,
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: 'requisition_output',
          upstreamId: output.draw_output_id,
          upstreamNo: output.draw_output_no ?? '',
          downstreamType: 'requisition_return',
          downstreamId: header.draw_exit_id,
          downstreamNo: returnNo,
          relationKind: 'source',
          createdBy: userId,
        },
        tx,
      );
      return header.draw_exit_id;
    });
    return { id: returnId, message: '领用退回单已保存' };
  }

  async confirmReturn(id: string, comment: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const returnId = BigInt(id);
      await this.lockRow(tx, 'hspsi_draw_approve_output_exit', 'draw_exit_id', returnId);
      const returnDocument = await tx.hspsi_draw_approve_output_exit.findFirst({
        where: { draw_exit_id: returnId, deleted_at: null },
      });
      if (!returnDocument) throw new NotFoundException('领用退回单不存在');
      if (returnDocument.comfirm_status === 1) return { already: true };

      await this.lockRow(
        tx,
        'hspsi_draw_approve_output',
        'draw_output_id',
        returnDocument.draw_output_id,
      );
      const output = await tx.hspsi_draw_approve_output.findFirst({
        where: {
          draw_output_id: returnDocument.draw_output_id,
          comfirm_status: 1,
          deleted_at: null,
        },
      });
      if (!output)
        throw new BadRequestException('来源领用出库单已撤销、删除或未确认，不能确认退回');
      const [details, sourceDetails, returned] = await Promise.all([
        tx.hspsi_draw_approve_output_exit_detail.findMany({ where: { draw_exit_id: returnId } }),
        tx.hspsi_draw_approve_output_detail.findMany({
          where: { draw_output_id: output.draw_output_id },
        }),
        this.confirmedReturnUsage(tx, output.draw_output_id, returnId),
      ]);
      if (!details.length) throw new BadRequestException('领用退回单没有明细');
      for (const detail of details) {
        const source = sourceDetails.find(
          (sourceDetail) => sourceDetail.output_detail_id === detail.draw_output_detail_id,
        );
        if (!source) throw new BadRequestException('退回明细不属于来源领用出库单');
        if (source.is_returnable !== 1) throw new BadRequestException('无需归还的物品不能确认退回');
        if (
          source.goods_id !== detail.goods_id ||
          source.sku_id !== detail.sku_id ||
          source.batch_no !== String(detail.batch_no ?? '')
        ) {
          throw new BadRequestException('退回物品或批次与来源出库明细不一致');
        }
        const historical = returned.get(String(source.output_detail_id)) ?? 0;
        if (Number(detail.exit_qty) > Number(source.fact_draw_qty) - historical) {
          throw new BadRequestException('退回数量超过来源出库单可退数量');
        }
      }
      const nextVersion = returnDocument.posting_version + 1;
      await this.posting.post(
        {
          orgId: returnDocument.org_id,
          warehouseId: returnDocument.warehouse_id,
          direction: 1,
          operationType: 1,
          inventoryMode: INVENTORY_BUSINESS_MODE.REQUISITION_RETURN,
          sourceId: returnDocument.draw_exit_id,
          sourceType: 'requisition_return',
          sourceNo: returnDocument.draw_exit_no ?? '',
          operationBy: userId,
          idempotencyKey: `requisition-return:${id}:confirm:v${nextVersion}`,
          remark: comment || '领用退回入库',
          lines: this.aggregatePostingLines(
            returnDocument.org_id,
            returnDocument.warehouse_id,
            details.map((detail) => ({
              goodsId: detail.goods_id,
              skuId: detail.sku_id,
              batchNo: detail.batch_no,
              unitType: detail.unit_type,
              quantity: String(detail.exit_qty),
            })),
          ),
        },
        tx,
      );
      await tx.hspsi_draw_approve_output_exit.update({
        where: { draw_exit_id: returnId },
        data: {
          comfirm_status: 1,
          comfirm_comment: comment,
          comfirm_by: BigInt(userId),
          comfirm_date: new Date(),
          posting_version: nextVersion,
          updated_by: BigInt(userId),
        },
      });
      return { already: false };
    });
    return { id, message: result.already ? '领用退回已确认' : '退回入库确认成功' };
  }

  async undoConfirmReturn(id: string, userId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const returnId = BigInt(id);
      await this.lockRow(tx, 'hspsi_draw_approve_output_exit', 'draw_exit_id', returnId);
      const returnDocument = await tx.hspsi_draw_approve_output_exit.findFirst({
        where: { draw_exit_id: returnId, deleted_at: null },
      });
      if (!returnDocument) throw new NotFoundException('领用退回单不存在');
      if (returnDocument.comfirm_status !== 1) {
        if (returnDocument.posting_version > 0) return { already: true };
        throw new BadRequestException('仅已确认退回可撤销');
      }
      await this.lockRow(
        tx,
        'hspsi_draw_approve_output',
        'draw_output_id',
        returnDocument.draw_output_id,
      );
      const output = await tx.hspsi_draw_approve_output.findFirst({
        where: {
          draw_output_id: returnDocument.draw_output_id,
          comfirm_status: 1,
          deleted_at: null,
        },
      });
      if (!output) throw new BadRequestException('来源领用出库单已撤销或删除，不能撤销退回');
      const details = await tx.hspsi_draw_approve_output_exit_detail.findMany({
        where: { draw_exit_id: returnId },
      });
      await this.posting.post(
        {
          orgId: returnDocument.org_id,
          warehouseId: returnDocument.warehouse_id,
          direction: -1,
          operationType: 2,
          inventoryMode: INVENTORY_BUSINESS_MODE.REQUISITION_RETURN,
          sourceId: returnDocument.draw_exit_id,
          sourceType: 'requisition_return_reverse',
          sourceNo: returnDocument.draw_exit_no ?? '',
          operationBy: userId,
          idempotencyKey: `requisition-return:${id}:undo:v${returnDocument.posting_version}`,
          remark: '撤销领用退回',
          lines: this.aggregatePostingLines(
            returnDocument.org_id,
            returnDocument.warehouse_id,
            details.map((detail) => ({
              goodsId: detail.goods_id,
              skuId: detail.sku_id,
              batchNo: detail.batch_no,
              unitType: detail.unit_type,
              quantity: String(detail.exit_qty),
            })),
          ),
        },
        tx,
      );
      await tx.hspsi_draw_approve_output_exit.update({
        where: { draw_exit_id: returnId },
        data: {
          comfirm_status: 0,
          comfirm_comment: '',
          comfirm_by: 0n,
          comfirm_date: null,
          updated_by: BigInt(userId),
        },
      });
      return { already: false };
    });
    return { id, message: result.already ? '领用退回已撤销确认' : '已撤销退回确认，库存已回退' };
  }
}
