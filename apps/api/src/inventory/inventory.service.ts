import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { DocumentTraceService } from '../document-trace/document-trace.service';
import { BUSINESS_PREFIX } from '../business-number/business-number.constants';
import type { ApprovalCallbackPayload } from '../integrations/xinfutong-oa/approval/approval.types';
import { BusinessNumberService } from '../business-number/business-number.service';
import { BusinessMasterDataService } from '../database/business-master-data.service';
import { BusinessReferenceService } from '../database/business-reference.service';
import { InventoryLine, InventoryPostingService } from './inventory-posting.service';
import { INVENTORY_BUSINESS_MODE } from './inventory-dictionary';
import {
  InventoryCheckQuantityResult,
  InventoryDamageLine,
  assertGeneratedDamageLinesUnchanged,
  calculateInventoryCheckProgress,
  classifyInventoryCheckQuantities,
  parseInventoryLossDisposal,
  partitionInventoryCheckDetails,
  splitInventoryDamageDetails,
} from './inventory-helpers';

export type { InventoryCheckQuantityResult };

type Body = Record<string, any>;

/** quantityAlerts 页行（$queryRaw 原样行，字段值以驱动返回为准） */
type QuantityAlertRow = {
  stock_id: unknown;
  config_id: unknown;
  org_id: unknown;
  warehouse_id: unknown;
  goods_id: unknown;
  sku_id: unknown;
  fact_qty: unknown;
  inventory_amount: unknown;
  safe_qty: unknown;
  gap_qty: unknown;
  purchase_qty: unknown;
};

/** quantityAlerts 按仓库统计行 */
type QuantityAlertStatRow = {
  warehouse_id: unknown;
  item_count: unknown;
  total_amount: unknown;
  warning_count: unknown;
};

/** expiryAlerts 页行（$queryRaw 原样行） */
type ExpiryAlertRow = {
  period_id: unknown;
  warehouse_id: unknown;
  goods_id: unknown;
  sku_id: unknown;
  batch_no: unknown;
  end_day: unknown;
  alter_type: unknown;
  alter_day: unknown;
  inventory_qty: unknown;
  inventory_amount: unknown;
};

/** expiryAlerts 按仓库统计行 */
type ExpiryAlertStatRow = {
  warehouse_id: unknown;
  item_count: unknown;
};

@Injectable()
export class InventoryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InventoryPostingService) private readonly posting: InventoryPostingService,
    @Inject(DocumentTraceService) private readonly documentTrace: DocumentTraceService,
    @Inject(BusinessNumberService) private readonly businessNumber: BusinessNumberService,
    @Inject(BusinessMasterDataService) private readonly masterData: BusinessMasterDataService,
    @Inject(BusinessReferenceService) private readonly references: BusinessReferenceService,
  ) {}
  private page(query: Body) {
    return {
      page: Math.max(1, Number(query.page ?? 1)),
      pageSize: Math.min(100, Math.max(1, Number(query.pageSize ?? 20))),
    };
  }
  private dec(value: unknown) {
    return new Prisma.Decimal(String(value ?? 0));
  }
  private qty(value: unknown, label = '数量', allowZero = false) {
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || (allowZero ? quantity < 0 : quantity <= 0)) {
      throw new BadRequestException(`${label}必须为${allowZero ? '非负' : '正'}整数`);
    }
    return quantity;
  }
  private lines(input: unknown) {
    if (!Array.isArray(input) || !input.length) throw new BadRequestException('至少需要一条明细');
    return input as Body[];
  }
  private rejectIndependentInventoryDocument(message: string): void {
    throw new BadRequestException(message);
  }
  private async names(items: Body[]) {
    const goodsIds = [
      ...new Set(
        items.map((i) => BigInt(String(i.goodsId ?? i.goods_id ?? 0))).filter((id) => id > 0n),
      ),
    ];
    const skuIds = [
      ...new Set(
        items.map((i) => BigInt(String(i.skuId ?? i.sku_id ?? 0))).filter((id) => id > 0n),
      ),
    ];
    const warehouseIds = [
      ...new Set(
        items
          .map((i) => BigInt(String(i.warehouseId ?? i.warehouse_id ?? 0)))
          .filter((id) => id > 0n),
      ),
    ];
    const orgIds = [
      ...new Set(
        items.map((i) => BigInt(String(i.orgId ?? i.org_id ?? 0))).filter((id) => id > 0n),
      ),
    ];
    const [goods, skus, warehouses, orgs] = await Promise.all([
      this.prisma.hspsi_goods_info.findMany({ where: { goods_id: { in: goodsIds } } }),
      this.prisma.hspsi_goods_info_sku.findMany({ where: { sku_id: { in: skuIds } } }),
      this.prisma.hspsi_basic_warehouse.findMany({ where: { warehouse_id: { in: warehouseIds } } }),
      this.prisma.hspsi_basic_organization.findMany({ where: { org_id: { in: orgIds } } }),
    ]);
    return { goods, skus, warehouses, orgs };
  }

  private async users(ids: Array<bigint | number | string | null | undefined>) {
    const userIds = [...new Set(ids.filter(Boolean).map((id) => String(id)))].map(BigInt);
    if (!userIds.length) return new Map<string, string>();
    const rows = await this.prisma.hspsi_sys_user.findMany({
      where: { id: { in: userIds }, deleted_at: null },
      select: { id: true, username: true, nickname: true },
    });
    return new Map(rows.map((row) => [String(row.id), row.nickname || row.username]));
  }

  private async dictionary(code: string) {
    const category = await this.prisma.hspsi_sys_dictionary_category.findFirst({
      where: { dict_catg_code: code, deleted_at: null },
    });
    if (!category) return new Map<string, string>();
    const rows = await this.prisma.hspsi_sys_dictionary.findMany({
      where: { dict_catg_id: category.dict_catg_id, deleted_at: null },
    });
    return new Map(rows.map((row) => [String(row.dict_value), row.dict_name ?? '']));
  }

  private async inventoryKeywordIds(keyword: unknown) {
    const key = String(keyword ?? '').trim();
    if (!key) return null;
    const [goods, skus] = await Promise.all([
      this.prisma.hspsi_goods_info.findMany({
        where: {
          deleted_at: null,
          OR: [{ query_code: { contains: key } }, { goods_name: { contains: key } }],
        },
        select: { goods_id: true },
      }),
      this.prisma.hspsi_goods_info_sku.findMany({
        where: { deleted_at: null, spec_models: { contains: key } },
        select: { sku_id: true },
      }),
    ]);
    // 纯数字关键字同时精确匹配 sku_id（SKU 编号即 sku_id 主键，不在 spec_models 文本中）
    const numericSkuId = /^\d+$/.test(key) ? BigInt(key) : null;
    return {
      goodsIds: goods.map((item) => item.goods_id),
      skuIds: [...skus.map((item) => item.sku_id), ...(numericSkuId ? [numericSkuId] : [])],
    };
  }

  private async validateTransferWarehouses(body: Body) {
    const fromId = BigInt(String(body.warehouseId ?? 0));
    const toId = BigInt(String(body.toWarehouseId ?? 0));
    if (fromId <= 0n || toId <= 0n) throw new BadRequestException('请选择有效的调出和调入仓库');
    if (fromId === toId) throw new BadRequestException('调出和调入仓库不能相同');
    const warehouses = await this.prisma.hspsi_basic_warehouse.findMany({
      where: { warehouse_id: { in: [fromId, toId] }, status: 1, deleted_at: null },
      select: { warehouse_id: true, org_id: true, warehouse_type: true, name: true },
    });
    const from = warehouses.find((item) => item.warehouse_id === fromId);
    const to = warehouses.find((item) => item.warehouse_id === toId);
    if (!from || !to) throw new BadRequestException('调出或调入仓库不存在、已停用或已删除');
    if (
      from.org_id !== BigInt(String(body.orgId ?? 0)) ||
      to.org_id !== BigInt(String(body.toOrgId ?? 0))
    ) {
      throw new BadRequestException('调拨仓库必须属于所选组织');
    }
    if (from.warehouse_type !== to.warehouse_type) {
      throw new BadRequestException(`调入仓库“${to.name}”与调出仓库“${from.name}”类型不一致`);
    }
    return { from, to };
  }

  async userOptions() {
    const rows = await this.prisma.hspsi_sys_user.findMany({
      where: { status: 1, deleted_at: null },
      orderBy: { username: 'asc' },
      select: { id: true, username: true, nickname: true, org_id: true, dept_id: true },
    });
    return rows.map((row) => ({
      value: row.id,
      label: row.nickname || row.username,
      raw: { username: row.username, orgId: row.org_id, deptId: row.dept_id },
    }));
  }

  async warehouseTabs(orgId?: string) {
    const organizationId = orgId ? BigInt(orgId) : undefined;
    const [warehouses, grouped] = await Promise.all([
      this.prisma.hspsi_basic_warehouse.findMany({
        where: {
          status: 1,
          deleted_at: null,
          ...(organizationId ? { org_id: organizationId } : {}),
        },
        orderBy: [{ sort: 'asc' }, { warehouse_id: 'asc' }],
      }),
      this.prisma.hspsi_inventory_batch_total.groupBy({
        by: ['warehouse_id'],
        where: { inventory_qty: { gt: 0 }, ...(organizationId ? { org_id: organizationId } : {}) },
        _count: { _all: true },
      }),
    ]);
    return warehouses.map((warehouse) => ({
      value: warehouse.warehouse_id,
      label: warehouse.name,
      orgId: warehouse.org_id,
      warehouseType: warehouse.warehouse_type,
      count: grouped.find((item) => item.warehouse_id === warehouse.warehouse_id)?._count._all ?? 0,
    }));
  }

  async stocks(query: Body) {
    const { page, pageSize } = this.page(query);
    const where: Prisma.hspsi_inventory_batch_totalWhereInput = {};
    if (query.orgId) where.org_id = BigInt(query.orgId);
    if (query.warehouseId) where.warehouse_id = BigInt(query.warehouseId);
    if (query.batchNo) where.batch_no = { contains: String(query.batchNo) };
    if (String(query.inStockOnly ?? '') === 'true' || String(query.inStockOnly) === '1')
      where.inventory_qty = { gt: 0 };
    if (query.keyword) {
      const key = String(query.keyword);
      const [goods, skus] = await Promise.all([
        this.prisma.hspsi_goods_info.findMany({
          where: {
            deleted_at: null,
            OR: [{ query_code: { contains: key } }, { goods_name: { contains: key } }],
          },
          select: { goods_id: true },
        }),
        this.prisma.hspsi_goods_info_sku.findMany({
          where: { deleted_at: null, spec_models: { contains: key } },
          select: { sku_id: true },
        }),
      ]);
      const skuIds = skus.map((item) => item.sku_id);
      // keyword 为数字时同时精确匹配 sku_id（如直接输入 SKU 编号）
      const numericSkuId = /^\d+$/.test(key) ? BigInt(key) : null;
      where.OR = [
        { goods_id: { in: goods.map((item) => item.goods_id) } },
        { sku_id: { in: skuIds } },
        ...(numericSkuId ? [{ sku_id: numericSkuId }] : []),
      ];
    }
    const [records, total, summaryRows] = await Promise.all([
      this.prisma.hspsi_inventory_batch_total.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ warehouse_id: 'asc' }, { goods_id: 'asc' }],
      }),
      this.prisma.hspsi_inventory_batch_total.count({ where }),
      this.prisma.hspsi_inventory_batch_total.findMany({
        where,
        select: { inventory_qty: true, inventory_amount: true },
      }),
    ]);
    const mapInput = records.map((i) => ({
      goodsId: i.goods_id,
      skuId: i.sku_id,
      warehouseId: i.warehouse_id,
      orgId: i.org_id,
    }));
    const refs = await this.names(mapInput);
    const unitIds = [...new Set(records.map((i) => BigInt(i.unit_type)).filter((i) => i > 0n))];
    const categoryIds = [
      ...new Set(refs.goods.map((item) => item.goods_catg_id).filter((id) => id > 0n)),
    ];
    const [units, categories] = await Promise.all([
      this.prisma.hspsi_basic_unit.findMany({ where: { id: { in: unitIds } } }),
      this.prisma.hspsi_goods_info_category.findMany({
        where: { goods_catg_id: { in: categoryIds }, deleted_at: null },
      }),
    ]);
    const items = records.map((item) => {
      const goods = refs.goods.find((g) => g.goods_id === item.goods_id);
      return {
        id: `${item.goods_id}-${item.sku_id}-${item.warehouse_id}-${item.batch_no}`,
        goodsId: item.goods_id,
        skuId: item.sku_id,
        goodsCode: goods?.query_code,
        goodsName: goods?.goods_name,
        categoryId: goods?.goods_catg_id,
        categoryName: categories.find((category) => category.goods_catg_id === goods?.goods_catg_id)
          ?.goods_name,
        skuSpec: refs.skus.find((s) => s.sku_id === item.sku_id)?.spec_models,
        unitType: item.unit_type,
        unitName: units.find((u) => u.id === BigInt(item.unit_type))?.name,
        orgId: item.org_id,
        orgName: refs.orgs.find((o) => o.org_id === item.org_id)?.name,
        warehouseId: item.warehouse_id,
        warehouseName: refs.warehouses.find((w) => w.warehouse_id === item.warehouse_id)?.name,
        batchNo: item.batch_no,
        inputQty: item.input_qty,
        outputQty: item.output_qty,
        inventoryQty: item.inventory_qty,
        inventoryAmount: item.inventory_amount,
        unitCost: Number(item.inventory_qty)
          ? Number(item.inventory_amount) / Number(item.inventory_qty)
          : 0,
        inventoryStatus: Number(item.inventory_qty) > 0 ? '有库存' : '无库存',
      };
    });
    const warningCount = await this.quantityAlertCount(query.orgId, query.warehouseId);
    return {
      items,
      total,
      page,
      pageSize,
      summary: {
        itemCount: summaryRows.filter((i) => Number(i.inventory_qty) > 0).length,
        totalAmount: summaryRows.reduce((s, i) => s + Number(i.inventory_amount), 0),
        warningCount,
      },
    };
  }

  async requisitionHistory(query: Body) {
    const { page, pageSize } = this.page(query);
    const outputWhere: Prisma.hspsi_draw_approve_outputWhereInput = {
      comfirm_status: 1,
      deleted_at: null,
    };
    if (query.orgId) outputWhere.org_id = BigInt(query.orgId);
    if (query.departmentId) outputWhere.dept_id = BigInt(query.departmentId);
    if (query.receiverId) outputWhere.receiver_id = BigInt(query.receiverId);
    if (query.startDate || query.endDate) {
      outputWhere.output_date = {};
      if (query.startDate)
        outputWhere.output_date.gte = new Date(`${query.startDate}T00:00:00+08:00`);
      if (query.endDate) {
        const end = new Date(`${query.endDate}T00:00:00+08:00`);
        if (Number.isNaN(end.getTime())) throw new BadRequestException('结束日期无效');
        end.setDate(end.getDate() + 1);
        outputWhere.output_date.lt = end;
      }
    }
    const outputs = await this.prisma.hspsi_draw_approve_output.findMany({
      where: outputWhere,
      orderBy: [{ output_date: 'desc' }, { draw_output_id: 'desc' }],
    });
    if (!outputs.length)
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        summary: { issuedQty: 0, returnedQty: 0, holdingQty: 0, holdingLines: 0 },
      };
    const outputIds = outputs.map((item) => item.draw_output_id);
    const detailWhere: Prisma.hspsi_draw_approve_output_detailWhereInput = {
      draw_output_id: { in: outputIds },
    };
    if (query.batchNo) detailWhere.batch_no = { contains: String(query.batchNo).trim() };
    const keywordIds = await this.inventoryKeywordIds(query.keyword);
    if (keywordIds)
      detailWhere.OR = [
        { goods_id: { in: keywordIds.goodsIds } },
        { sku_id: { in: keywordIds.skuIds } },
      ];
    const details = await this.prisma.hspsi_draw_approve_output_detail.findMany({
      where: detailWhere,
      orderBy: { output_detail_id: 'desc' },
    });
    const detailOutputIds = [...new Set(details.map((item) => item.draw_output_id))];
    const returnHeads = detailOutputIds.length
      ? await this.prisma.hspsi_draw_approve_output_exit.findMany({
          where: {
            draw_output_id: { in: detailOutputIds },
            comfirm_status: 1,
            deleted_at: null,
          },
          select: { draw_exit_id: true },
        })
      : [];
    const returnDetails = returnHeads.length
      ? await this.prisma.hspsi_draw_approve_output_exit_detail.findMany({
          where: { draw_exit_id: { in: returnHeads.map((item) => item.draw_exit_id) } },
        })
      : [];
    const returnedByLine = new Map<string, number>();
    for (const line of returnDetails) {
      const key = String(line.draw_output_detail_id);
      returnedByLine.set(key, (returnedByLine.get(key) ?? 0) + Number(line.exit_qty));
    }
    const outputMap = new Map(outputs.map((item) => [String(item.draw_output_id), item]));
    let computed = details.map((line) => {
      const output = outputMap.get(String(line.draw_output_id))!;
      const issuedQty = Number(line.fact_draw_qty);
      const returnedQty = Math.min(
        issuedQty,
        returnedByLine.get(String(line.output_detail_id)) ?? 0,
      );
      const remainingQty = Math.max(0, issuedQty - returnedQty);
      return { line, output, issuedQty, returnedQty, remainingQty };
    });
    const holdingStatus = String(query.holdingStatus ?? 'all');
    if (holdingStatus === 'holding')
      computed = computed.filter((item) => item.line.is_returnable === 1 && item.remainingQty > 0);
    else if (holdingStatus === 'returned')
      computed = computed.filter(
        (item) => item.line.is_returnable === 1 && item.remainingQty === 0,
      );
    const total = computed.length;
    const summary = computed.reduce(
      (result, item) => ({
        issuedQty: result.issuedQty + item.issuedQty,
        returnedQty: result.returnedQty + item.returnedQty,
        holdingQty: result.holdingQty + (item.line.is_returnable === 1 ? item.remainingQty : 0),
        holdingLines:
          result.holdingLines + (item.line.is_returnable === 1 && item.remainingQty > 0 ? 1 : 0),
      }),
      { issuedQty: 0, returnedQty: 0, holdingQty: 0, holdingLines: 0 },
    );
    const records = computed.slice((page - 1) * pageSize, page * pageSize);
    const applications = await this.prisma.hspsi_draw_approve.findMany({
      where: {
        draw_id: { in: [...new Set(records.map((item) => item.output.draw_id))] },
      },
      select: { draw_id: true, draw_no: true },
    });
    const applicationNo = new Map(applications.map((item) => [String(item.draw_id), item.draw_no]));
    const referenceInput = records.map(({ line, output }) => ({
      goodsId: line.goods_id,
      skuId: line.sku_id,
      warehouseId: output.warehouse_id,
      orgId: output.org_id,
    }));
    const [refs, departments, receivers, units] = await Promise.all([
      this.names(referenceInput),
      this.prisma.hspsi_basic_dept.findMany({
        where: { dept_id: { in: [...new Set(records.map((item) => item.output.dept_id))] } },
        select: { dept_id: true, name: true },
      }),
      this.prisma.hspsi_basic_staff.findMany({
        where: {
          id: { in: [...new Set(records.map((item) => item.output.receiver_id))] },
          deleted_at: null,
        },
        select: { id: true, name: true },
      }),
      this.prisma.hspsi_basic_unit.findMany({
        where: { id: { in: [...new Set(records.map((item) => BigInt(item.line.unit_type)))] } },
      }),
    ]);
    return {
      items: records.map(({ line, output, issuedQty, returnedQty, remainingQty }) => ({
        id: line.output_detail_id,
        outputId: output.draw_output_id,
        outputNo: output.draw_output_no,
        applicationId: output.draw_id,
        applicationNo: applicationNo.get(String(output.draw_id)) ?? '',
        outputDate: output.output_date,
        orgId: output.org_id,
        orgName: refs.orgs.find((item) => item.org_id === output.org_id)?.name ?? '',
        warehouseId: output.warehouse_id,
        warehouseName:
          refs.warehouses.find((item) => item.warehouse_id === output.warehouse_id)?.name ?? '',
        departmentId: output.dept_id,
        departmentName: departments.find((item) => item.dept_id === output.dept_id)?.name ?? '',
        receiverId: output.receiver_id,
        receiverName: receivers.find((item) => item.id === output.receiver_id)?.name ?? '',
        goodsId: line.goods_id,
        goodsCode: refs.goods.find((item) => item.goods_id === line.goods_id)?.query_code ?? '',
        goodsName: refs.goods.find((item) => item.goods_id === line.goods_id)?.goods_name ?? '',
        skuId: line.sku_id,
        skuSpec: refs.skus.find((item) => item.sku_id === line.sku_id)?.spec_models ?? '',
        batchNo: line.batch_no,
        unitType: line.unit_type,
        unitName: units.find((item) => item.id === BigInt(line.unit_type))?.name ?? '',
        issuedQty,
        returnedQty,
        remainingQty,
        returnable: line.is_returnable === 1,
        holdingStatusName:
          line.is_returnable !== 1 ? '无需归还' : remainingQty > 0 ? '持有中' : '已退清',
      })),
      total,
      page,
      pageSize,
      summary,
    };
  }

  async ledger(query: Body) {
    const { page, pageSize } = this.page(query);
    const where: Prisma.hspsi_inventory_total_detailWhereInput = {};
    if (query.orgId) where.org_id = BigInt(query.orgId);
    if (query.goodsId) where.goods_id = BigInt(query.goodsId);
    if (query.skuId) where.sku_id = BigInt(query.skuId);
    if (query.warehouseId) where.warehouse_id = BigInt(query.warehouseId);
    if (query.batchNo) where.batch_no = String(query.batchNo);
    if (query.inventoryMode) where.inventory_mode = Number(query.inventoryMode);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_inventory_total_detail.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { id: 'desc' },
      }),
      this.prisma.hspsi_inventory_total_detail.count({ where }),
    ]);
    const [users, refs, operationTypes, businessModes] = await Promise.all([
      this.prisma.hspsi_sys_user.findMany({
        where: { id: { in: [...new Set(items.map((i) => i.operation_by))] } },
      }),
      this.names(
        items.map((item) => ({
          goodsId: item.goods_id,
          skuId: item.sku_id,
          warehouseId: item.warehouse_id,
          orgId: item.org_id,
        })),
      ),
      this.dictionary('inventory_operation_type'),
      this.dictionary('inventory_business_mode'),
    ]);
    return {
      items: items.map((i) => ({
        id: i.id,
        goodsId: i.goods_id,
        skuId: i.sku_id,
        goodsCode:
          i.goods_code || refs.goods.find((goods) => goods.goods_id === i.goods_id)?.query_code,
        goodsName:
          i.goods_name || refs.goods.find((goods) => goods.goods_id === i.goods_id)?.goods_name,
        skuSpec: i.sku_spec || refs.skus.find((sku) => sku.sku_id === i.sku_id)?.spec_models,
        warehouseId: i.warehouse_id,
        warehouseName:
          i.warehouse_name ||
          refs.warehouses.find((warehouse) => warehouse.warehouse_id === i.warehouse_id)?.name,
        batchNo: i.batch_no,
        operationType: i.operation_type,
        operationTypeName: operationTypes.get(String(i.operation_type)),
        operationQty: i.operation_qty,
        inputQty: i.operation_type === 1 ? i.operation_qty : 0,
        outputQty: i.operation_type === 2 ? Math.abs(i.operation_qty) : 0,
        inventoryMode: i.inventory_mode,
        businessModeName: businessModes.get(String(i.inventory_mode)),
        sourceType: i.source_type,
        sourceId: i.source_id,
        sourceNo: i.source_no,
        afterQty: i.after_qty,
        operatorName:
          users.find((u) => u.id === i.operation_by)?.nickname ??
          users.find((u) => u.id === i.operation_by)?.username,
        remark: i.remark,
        createdAt: i.created_at,
      })),
      total,
      page,
      pageSize,
    };
  }

  async stockOptions(query: Body) {
    // 该接口只服务于已确定组织和仓库的业务表单，禁止无条件返回全系统库存。
    if (!query.orgId || !query.warehouseId) return [];
    const orgId = BigInt(query.orgId),
      warehouseId = BigInt(query.warehouseId);
    await this.masterData.assertWarehouse(orgId, warehouseId);
    const where: Prisma.hspsi_inventory_batch_totalWhereInput = {
      org_id: orgId,
      warehouse_id: warehouseId,
      inventory_qty: { gt: 0 },
    };
    const rows = await this.prisma.hspsi_inventory_batch_total.findMany({
      where,
      orderBy: [{ goods_id: 'asc' }, { batch_no: 'asc' }],
    });
    const refs = await this.names(
      rows.map((i) => ({
        goodsId: i.goods_id,
        skuId: i.sku_id,
        warehouseId: i.warehouse_id,
        orgId: i.org_id,
      })),
    );
    const units = await this.prisma.hspsi_basic_unit.findMany({
      where: {
        id: {
          in: [...new Set(rows.map((item) => BigInt(item.unit_type)).filter((id) => id > 0n))],
        },
      },
    });
    const categories = await this.prisma.hspsi_goods_info_category.findMany({
      where: {
        goods_catg_id: { in: [...new Set(refs.goods.map((goods) => goods.goods_catg_id))] },
        deleted_at: null,
      },
    });
    return rows.map((i) => {
      const goods = refs.goods.find((g) => g.goods_id === i.goods_id);
      return {
        goodsId: i.goods_id,
        goodsCode: goods?.query_code,
        goodsName: goods?.goods_name,
        categoryWarehouseType: categories.find(
          (category) => category.goods_catg_id === goods?.goods_catg_id,
        )?.warehouse_type,
        skuId: i.sku_id,
        skuSpec: refs.skus.find((s) => s.sku_id === i.sku_id)?.spec_models,
        orgId: i.org_id,
        warehouseId: i.warehouse_id,
        warehouseName: refs.warehouses.find((w) => w.warehouse_id === i.warehouse_id)?.name,
        batchNo: i.batch_no,
        unitType: i.unit_type,
        unitName: units.find((unit) => unit.id === BigInt(i.unit_type))?.name,
        inventoryQty: i.inventory_qty,
        inventoryAmount: i.inventory_amount,
        unitPrice: Number(i.inventory_qty)
          ? Number(i.inventory_amount) / Number(i.inventory_qty)
          : 0,
      };
    });
  }

  async transfers(query: Body) {
    const { page, pageSize } = this.page(query);
    const where: Prisma.hspsi_inventory_transferWhereInput = { deleted_at: null };
    if (query.status !== undefined && query.status !== '') where.status = Number(query.status);
    const and: Prisma.hspsi_inventory_transferWhereInput[] = [];
    if (query.warehouseId)
      and.push({
        OR: [
          { warehouse_id: BigInt(query.warehouseId) },
          { to_warehouse_id: BigInt(query.warehouseId) },
        ],
      });
    if (query.orgId)
      and.push({ OR: [{ org_id: BigInt(query.orgId) }, { to_org_id: BigInt(query.orgId) }] });
    const keywordIds = await this.inventoryKeywordIds(query.keyword);
    if (keywordIds) {
      const matchedDetails = await this.prisma.hspsi_inventory_transfer_detail.findMany({
        where: {
          OR: [{ goods_id: { in: keywordIds.goodsIds } }, { sku_id: { in: keywordIds.skuIds } }],
        },
        select: { transfer_id: true },
      });
      and.push({
        transfer_id: { in: [...new Set(matchedDetails.map((item) => item.transfer_id))] },
      });
    }
    if (and.length) where.AND = and;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.hspsi_inventory_transfer.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { transfer_id: 'desc' },
      }),
      this.prisma.hspsi_inventory_transfer.count({ where }),
    ]);
    const [refs, details, users] = await Promise.all([
      this.names(
        rows.flatMap((i) => [
          { warehouseId: i.warehouse_id, orgId: i.org_id },
          { warehouseId: i.to_warehouse_id, orgId: i.to_org_id },
        ]),
      ),
      this.prisma.hspsi_inventory_transfer_detail.findMany({
        where: { transfer_id: { in: rows.map((i) => i.transfer_id) } },
      }),
      this.users(rows.flatMap((item) => [item.send_by, item.receive_by, item.created_by])),
    ]);
    return {
      items: rows.map((i) => ({
        id: i.transfer_id,
        transferNo: i.transfer_no,
        orgId: i.org_id,
        orgName: refs.orgs.find((o) => o.org_id === i.org_id)?.name,
        warehouseId: i.warehouse_id,
        warehouseName: refs.warehouses.find((w) => w.warehouse_id === i.warehouse_id)?.name,
        toOrgId: i.to_org_id,
        toOrgName: refs.orgs.find((o) => o.org_id === i.to_org_id)?.name,
        toWarehouseId: i.to_warehouse_id,
        toWarehouseName: refs.warehouses.find((w) => w.warehouse_id === i.to_warehouse_id)?.name,
        sendBy: i.send_by,
        sendByName: users.get(String(i.send_by)),
        receiveBy: i.receive_by,
        receiveByName: users.get(String(i.receive_by)),
        receiveStatus: i.receive_date ? 1 : 0,
        reason: i.transfer_reason,
        transferDate: i.transfer_date,
        quantity: details
          .filter((d) => d.transfer_id === i.transfer_id)
          .reduce((s, d) => s + Number(d.transfer_qty), 0),
        status: i.status,
        approveStatus: i.approve_status,
        createdBy: i.created_by,
        createdByName: users.get(String(i.created_by)),
        createdAt: i.created_at,
      })),
      total,
      page,
      pageSize,
    };
  }
  async transfer(id: string) {
    const item = await this.prisma.hspsi_inventory_transfer.findFirst({
      where: { transfer_id: BigInt(id), deleted_at: null },
    });
    if (!item) throw new NotFoundException('调拨单不存在');
    const details = await this.prisma.hspsi_inventory_transfer_detail.findMany({
      where: { transfer_id: item.transfer_id },
    });
    const [refs, units, stocks, postings] = await Promise.all([
      this.names(
        details.map((line) => ({
          goodsId: line.goods_id,
          skuId: line.sku_id,
          warehouseId: item.warehouse_id,
          orgId: item.org_id,
        })),
      ),
      this.prisma.hspsi_basic_unit.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                details.map((line) => BigInt(line.unit_type)).filter((unitId) => unitId > 0n),
              ),
            ],
          },
        },
      }),
      this.prisma.hspsi_inventory_batch_total.findMany({
        where: {
          warehouse_id: item.warehouse_id,
          OR: details.map((line) => ({
            goods_id: line.goods_id,
            sku_id: line.sku_id,
            batch_no: line.batch_no,
          })),
        },
      }),
      this.prisma.hspsi_inventory_total_detail.findMany({
        where: {
          source_type: 'inventory_transfer',
          source_id: item.transfer_id,
          warehouse_id: item.warehouse_id,
          operation_type: 2,
        },
      }),
    ]);
    const mappedDetails = details.map((line) => {
      const goods = refs.goods.find((record) => record.goods_id === line.goods_id);
      const sku = refs.skus.find((record) => record.sku_id === line.sku_id);
      const stock = stocks.find(
        (record) =>
          record.goods_id === line.goods_id &&
          record.sku_id === line.sku_id &&
          record.batch_no === line.batch_no,
      );
      const posting = postings.find(
        (record) =>
          record.goods_id === line.goods_id &&
          record.sku_id === line.sku_id &&
          record.batch_no === line.batch_no,
      );
      return {
        id: line.id,
        goodsId: line.goods_id,
        goodsCode: goods?.query_code,
        goodsName: goods?.goods_name,
        skuId: line.sku_id,
        skuSpec: sku?.spec_models,
        batchNo: line.batch_no,
        unitType: line.unit_type,
        unitName: units.find((unit) => unit.id === BigInt(line.unit_type))?.name,
        warehouseId: item.warehouse_id,
        warehouseName: refs.warehouses.find((record) => record.warehouse_id === item.warehouse_id)
          ?.name,
        inventoryQty: posting
          ? Number(posting.after_qty) - Number(posting.operation_qty)
          : Number(stock?.inventory_qty ?? 0),
        quantity: line.transfer_qty,
      };
    });
    const enrichedDetails = await this.references.enrichGoods(mappedDetails);
    return {
      ...item,
      id: item.transfer_id,
      transferNo: item.transfer_no,
      reason: item.transfer_reason,
      orgId: item.org_id,
      warehouseId: item.warehouse_id,
      toOrgId: item.to_org_id,
      toWarehouseId: item.to_warehouse_id,
      sendBy: item.send_by,
      receiveBy: item.receive_by,
      transferDate: item.transfer_date,
      approveStatus: item.approve_status,
      details: enrichedDetails,
    };
  }
  async saveTransfer(id: string | null, body: Body, userId: string, submit: boolean) {
    const lines = this.lines(body.details);
    await this.validateTransferWarehouses(body);
    await this.masterData.assertGoodsLines(
      body.orgId,
      body.warehouseId,
      lines.map((line) => ({ goodsId: line.goodsId, skuId: line.skuId })),
    );
    const validUsers = await this.prisma.hspsi_sys_user.count({
      where: {
        id: { in: [BigInt(body.sendBy ?? 0), BigInt(body.receiveBy ?? 0)] },
        status: 1,
        deleted_at: null,
      },
    });
    if (validUsers !== new Set([String(body.sendBy), String(body.receiveBy)]).size)
      throw new BadRequestException('发出人或接收人不是有效系统用户');
    if (id) {
      const old = await this.transfer(id);
      if (![0, 2].includes(Number(old.status)) || Number(old.approveStatus) === 1)
        throw new BadRequestException('当前调拨单不能编辑');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const data = {
        org_id: BigInt(body.orgId),
        warehouse_id: BigInt(body.warehouseId),
        to_org_id: BigInt(body.toOrgId),
        to_warehouse_id: BigInt(body.toWarehouseId),
        transfer_reason: String(body.reason ?? ''),
        transfer_date: new Date(body.transferDate ?? Date.now()),
        send_by: BigInt(body.sendBy),
        receive_by: BigInt(body.receiveBy),
        status: submit ? 1 : 0,
        approve_status: 0,
        approve_comment: '',
        remark: String(body.remark ?? ''),
        updated_by: BigInt(userId),
        updated_at: new Date(),
      };
      const newTransferNo = id
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.INVENTORY_TRANSFER);
      const header = id
        ? await tx.hspsi_inventory_transfer.update({ where: { transfer_id: BigInt(id) }, data })
        : await tx.hspsi_inventory_transfer.create({
            data: {
              ...data,
              transfer_no: newTransferNo,
              created_by: BigInt(userId),
              created_at: new Date(),
            },
          });
      await tx.hspsi_inventory_transfer_detail.deleteMany({
        where: { transfer_id: header.transfer_id },
      });
      await tx.hspsi_inventory_transfer_detail.createMany({
        data: lines.map((l) => ({
          transfer_id: header.transfer_id,
          goods_id: BigInt(l.goodsId),
          sku_id: BigInt(l.skuId),
          batch_no: String(l.batchNo ?? ''),
          unit_type: Number(l.unitType),
          transfer_qty: this.qty(l.quantity, '调拨数量'),
        })),
      });
      return header.transfer_id;
    });
    return { id: result, message: submit ? '调拨单已提交' : '调拨草稿已保存' };
  }
  async submitTransfer(id: string) {
    const item = await this.transfer(id);
    if (Number(item.status) !== 0) throw new BadRequestException('仅草稿可提交');
    await this.prisma.hspsi_inventory_transfer.update({
      where: { transfer_id: BigInt(id) },
      data: { status: 1, approve_status: 0 },
    });
    return { id, message: '已提交审批' };
  }
  async removeTransfer(id: string, userId: string) {
    const item = await this.transfer(id);
    if (Number(item.status) !== 0) throw new BadRequestException('仅草稿可删除');
    await this.prisma.hspsi_inventory_transfer.update({
      where: { transfer_id: BigInt(id) },
      data: { deleted_at: new Date(), updated_by: BigInt(userId) },
    });
    return { id, message: '删除成功' };
  }
  async approveTransfer(id: string, approved: boolean, comment: string, userId: string) {
    return this.prisma.$transaction((tx) =>
      this.applyTransferApproval(tx, BigInt(id), approved, comment, userId, false),
    );
  }

  private async applyTransferApproval(
    tx: Prisma.TransactionClient,
    transferId: bigint,
    approved: boolean,
    comment: string,
    userId: string,
    fromOa: boolean,
  ) {
    const id = String(transferId);
    await tx.$queryRaw`SELECT transfer_id FROM hspsi_inventory_transfer WHERE transfer_id=${transferId} FOR UPDATE`;
    const item = await tx.hspsi_inventory_transfer.findFirst({
      where: { transfer_id: transferId, deleted_at: null },
    });
    if (!item || item.status !== 1 || item.approve_status !== 0)
      throw new BadRequestException('仅待审批调拨单可操作');
    if (!fromOa) {
      const active = await tx.hspsi_oa_approval_instance.findFirst({
        where: {
          business_type: 'inventory_transfer',
          business_id: transferId,
          proc_status: { in: ['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'] },
          deleted_at: null,
        },
      });
      if (active) throw new BadRequestException('该调拨单正在OA审批，不能在本系统审批');
    }
    const details = await tx.hspsi_inventory_transfer_detail.findMany({
      where: { transfer_id: transferId },
    });
    if (!details.length) throw new BadRequestException('调拨单没有商品明细');
    const actor = fromOa ? String(item.created_by) : userId;
    if (approved) {
      const lines: InventoryLine[] = details.map((d) => ({
        goodsId: d.goods_id,
        skuId: d.sku_id,
        batchNo: d.batch_no,
        unitType: d.unit_type,
        quantity: String(d.transfer_qty),
      }));
      await this.posting.post(
        {
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          direction: -1,
          operationType: 2,
          inventoryMode: INVENTORY_BUSINESS_MODE.INVENTORY_TRANSFER,
          sourceId: item.transfer_id,
          sourceType: 'inventory_transfer',
          sourceNo: item.transfer_no,
          operationBy: actor,
          idempotencyKey: `transfer:${id}:out`,
          remark: '库存调拨出库',
          lines,
        },
        tx,
      );
      await this.posting.post(
        {
          orgId: item.to_org_id,
          warehouseId: item.to_warehouse_id,
          direction: 1,
          operationType: 1,
          inventoryMode: INVENTORY_BUSINESS_MODE.INVENTORY_TRANSFER,
          sourceId: item.transfer_id,
          sourceType: 'inventory_transfer',
          sourceNo: item.transfer_no,
          operationBy: actor,
          idempotencyKey: `transfer:${id}:in`,
          remark: '库存调拨入库',
          lines,
        },
        tx,
      );
    }
    await tx.hspsi_inventory_transfer.update({
      where: { transfer_id: item.transfer_id },
      data: {
        status: approved ? 2 : 0,
        approve_status: approved ? 1 : 2,
        approve_comment: comment,
        approve_by: fromOa ? 0n : BigInt(userId),
        approve_date: new Date(),
        send_date: approved ? new Date() : null,
        receive_date: approved ? new Date() : null,
      },
    });
    return { id, message: approved ? '调拨审批通过，双边库存已过账' : '调拨已驳回' };
  }

  async adjustments(query: Body) {
    const { page, pageSize } = this.page(query);
    const where: Prisma.hspsi_inventory_adjustWhereInput = { deleted_at: null };
    const detailWhere: Prisma.hspsi_inventory_adjust_detailWhereInput = {};
    if (query.warehouseId) detailWhere.warehouse_id = BigInt(query.warehouseId);
    if (query.orgId) {
      const warehouses = await this.prisma.hspsi_basic_warehouse.findMany({
        where: { org_id: BigInt(query.orgId), deleted_at: null },
        select: { warehouse_id: true },
      });
      const warehouseIds = warehouses.map((item) => item.warehouse_id);
      detailWhere.warehouse_id =
        query.warehouseId && warehouseIds.includes(BigInt(query.warehouseId))
          ? BigInt(query.warehouseId)
          : { in: query.warehouseId ? [] : warehouseIds };
    }
    const keywordIds = await this.inventoryKeywordIds(query.keyword);
    if (keywordIds)
      detailWhere.OR = [
        { goods_id: { in: keywordIds.goodsIds } },
        { sku_id: { in: keywordIds.skuIds } },
      ];
    if (Object.keys(detailWhere).length) {
      const matchedDetails = await this.prisma.hspsi_inventory_adjust_detail.findMany({
        where: detailWhere,
        select: { adjust_id: true },
      });
      where.adjust_id = { in: [...new Set(matchedDetails.map((item) => item.adjust_id))] };
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.hspsi_inventory_adjust.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { adjust_id: 'desc' },
      }),
      this.prisma.hspsi_inventory_adjust.count({ where }),
    ]);
    const [details, users] = await Promise.all([
      this.prisma.hspsi_inventory_adjust_detail.findMany({
        where: { adjust_id: { in: rows.map((i) => i.adjust_id) } },
      }),
      this.users(rows.map((item) => item.created_by)),
    ]);
    return {
      items: rows.map((i) => ({
        id: i.adjust_id,
        adjustNo: i.adjust_no,
        reason: i.adjust_reason,
        applicantDate: i.applicant_date,
        detailCount: details.filter((d) => d.adjust_id === i.adjust_id).length,
        quantity: details
          .filter((d) => d.adjust_id === i.adjust_id)
          .reduce((s, d) => s + Number(d.adjust_qty), 0),
        status: i.status,
        approveStatus: i.approve_status,
        createdBy: i.created_by,
        createdByName: users.get(String(i.created_by)),
        createdAt: i.created_at,
      })),
      total,
      page,
      pageSize,
    };
  }
  async adjustment(id: string) {
    const item = await this.prisma.hspsi_inventory_adjust.findFirst({
      where: { adjust_id: BigInt(id), deleted_at: null },
    });
    if (!item) throw new NotFoundException('库存调整单不存在');
    const details = await this.prisma.hspsi_inventory_adjust_detail.findMany({
      where: { adjust_id: item.adjust_id },
    });
    const [refs, units, types] = await Promise.all([
      this.names(
        details.map((line) => ({
          goodsId: line.goods_id,
          skuId: line.sku_id,
          warehouseId: line.warehouse_id,
        })),
      ),
      this.prisma.hspsi_basic_unit.findMany(),
      this.dictionary('inventory_adjust_type'),
    ]);
    const mappedDetails = details.map((d) => ({
      id: d.detail_id,
      goodsId: d.goods_id,
      goodsCode: refs.goods.find((goods) => goods.goods_id === d.goods_id)?.query_code,
      goodsName: refs.goods.find((goods) => goods.goods_id === d.goods_id)?.goods_name,
      skuId: d.sku_id,
      skuSpec: refs.skus.find((sku) => sku.sku_id === d.sku_id)?.spec_models,
      warehouseId: d.warehouse_id,
      warehouseName: refs.warehouses.find((warehouse) => warehouse.warehouse_id === d.warehouse_id)
        ?.name,
      batchNo: d.batch_no,
      unitType: refs.skus.find((sku) => sku.sku_id === d.sku_id)?.unit_type ?? 0,
      unitName: units.find(
        (unit) =>
          unit.id === BigInt(refs.skus.find((sku) => sku.sku_id === d.sku_id)?.unit_type ?? 0),
      )?.name,
      adjustType: d.adjust_type,
      adjustTypeName: types.get(String(d.adjust_type)),
      beforeQty: d.before_qty,
      quantity: d.adjust_qty,
      afterQty:
        Number(d.before_qty) +
        (Number(d.adjust_type) === 1 ? Number(d.adjust_qty) : -Number(d.adjust_qty)),
      remark: d.remark,
    }));
    const enrichedDetails = await this.references.enrichGoods(mappedDetails);
    return {
      ...item,
      id: item.adjust_id,
      adjustNo: item.adjust_no,
      reason: item.adjust_reason,
      applicantDate: item.applicant_date,
      approveStatus: item.approve_status,
      details: enrichedDetails,
    };
  }
  async saveAdjustment(id: string | null, body: Body, userId: string, submit: boolean) {
    const lines = this.lines(body.details);
    if (id) {
      const old = await this.adjustment(id);
      if (Number(old.status) !== 0 && Number(old.approveStatus) !== 2)
        throw new BadRequestException('当前调整单不能编辑');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const newAdjustmentNo = id
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.INVENTORY_ADJUSTMENT);
      const header = id
        ? await tx.hspsi_inventory_adjust.update({
            where: { adjust_id: BigInt(id) },
            data: {
              adjust_reason: String(body.reason),
              applicant_date: new Date(body.applicantDate ?? Date.now()),
              status: submit ? 1 : 0,
              approve_status: 0,
              remark: String(body.remark ?? ''),
              updated_by: BigInt(userId),
            },
          })
        : await tx.hspsi_inventory_adjust.create({
            data: {
              adjust_no: newAdjustmentNo,
              adjust_reason: String(body.reason),
              applicant_date: new Date(body.applicantDate ?? Date.now()),
              status: submit ? 1 : 0,
              approve_status: 0,
              remark: String(body.remark ?? ''),
              created_by: BigInt(userId),
              updated_by: BigInt(userId),
            },
          });
      await tx.hspsi_inventory_adjust_detail.deleteMany({ where: { adjust_id: header.adjust_id } });
      for (const l of lines) {
        const stock = await tx.hspsi_inventory_batch_total.findUnique({
          where: {
            goods_id_sku_id_warehouse_id_batch_no: {
              goods_id: BigInt(l.goodsId),
              sku_id: BigInt(l.skuId),
              warehouse_id: BigInt(l.warehouseId),
              batch_no: String(l.batchNo ?? ''),
            },
          },
        });
        if (!stock) throw new BadRequestException('调整的库存批次不存在');
        await tx.hspsi_inventory_adjust_detail.create({
          data: {
            adjust_id: header.adjust_id,
            goods_id: BigInt(l.goodsId),
            sku_id: BigInt(l.skuId),
            warehouse_id: BigInt(l.warehouseId),
            batch_no: String(l.batchNo ?? ''),
            adjust_type: Number(l.adjustType),
            before_qty: stock.inventory_qty,
            adjust_qty: this.qty(l.quantity, '调整数量'),
            remark: String(l.remark ?? ''),
          },
        });
      }
      return header.adjust_id;
    });
    return { id: result, message: submit ? '调整单已提交' : '调整草稿已保存' };
  }
  async removeAdjustment(id: string, userId: string) {
    const item = await this.adjustment(id);
    if (Number(item.status) !== 0) throw new BadRequestException('仅草稿调整单可删除');
    await this.prisma.hspsi_inventory_adjust.update({
      where: { adjust_id: BigInt(id) },
      data: { deleted_at: new Date(), updated_by: BigInt(userId) },
    });
    return { id, message: '删除成功' };
  }
  async submitAdjustment(id: string) {
    const item = await this.adjustment(id);
    if (Number(item.status) !== 0) throw new BadRequestException('仅草稿调整单可提交');
    await this.prisma.hspsi_inventory_adjust.update({
      where: { adjust_id: BigInt(id) },
      data: { status: 1, approve_status: 0 },
    });
    return { id, message: '已提交审批' };
  }
  async approveAdjustment(id: string, approved: boolean, comment: string, userId: string) {
    return this.prisma.$transaction((tx) =>
      this.applyAdjustmentApproval(tx, BigInt(id), approved, comment, userId, false),
    );
  }

  private async applyAdjustmentApproval(
    tx: Prisma.TransactionClient,
    adjustId: bigint,
    approved: boolean,
    comment: string,
    userId: string,
    fromOa: boolean,
  ) {
    const id = String(adjustId);
    await tx.$queryRaw`SELECT adjust_id FROM hspsi_inventory_adjust WHERE adjust_id=${adjustId} FOR UPDATE`;
    const item = await tx.hspsi_inventory_adjust.findFirst({
      where: { adjust_id: adjustId, deleted_at: null },
    });
    if (!item || item.status !== 1 || item.approve_status !== 0)
      throw new BadRequestException('仅待审批调整单可操作');
    if (!fromOa) {
      const active = await tx.hspsi_oa_approval_instance.findFirst({
        where: {
          business_type: 'inventory_adjust',
          business_id: adjustId,
          proc_status: { in: ['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'] },
          deleted_at: null,
        },
      });
      if (active) throw new BadRequestException('该调整单正在OA审批，不能在本系统审批');
    }
    const details = await tx.hspsi_inventory_adjust_detail.findMany({
      where: { adjust_id: adjustId },
    });
    const actor = fromOa ? String(item.created_by) : userId;
    if (approved)
      for (const l of details) {
        const wh = await tx.hspsi_basic_warehouse.findUniqueOrThrow({
          where: { warehouse_id: l.warehouse_id },
        });
        await this.posting.post(
          {
            orgId: wh.org_id,
            warehouseId: l.warehouse_id,
            direction: l.adjust_type === 1 ? 1 : -1,
            operationType: l.adjust_type === 1 ? 1 : 2,
            inventoryMode: INVENTORY_BUSINESS_MODE.INVENTORY_ADJUSTMENT,
            sourceId: item.adjust_id,
            sourceType: 'inventory_adjust',
            sourceNo: item.adjust_no,
            operationBy: actor,
            idempotencyKey: `adjust:${id}:${l.detail_id}`,
            remark: item.adjust_reason,
            lines: [
              {
                goodsId: l.goods_id,
                skuId: l.sku_id,
                batchNo: l.batch_no,
                quantity: String(l.adjust_qty),
              },
            ],
          },
          tx,
        );
      }
    await tx.hspsi_inventory_adjust.update({
      where: { adjust_id: item.adjust_id },
      data: {
        status: approved ? 1 : 0,
        approve_status: approved ? 1 : 2,
        approve_comment: comment,
        approve_by: fromOa ? 0n : BigInt(userId),
        approve_date: new Date(),
      },
    });
    return { id, message: approved ? '调整审批通过，库存已过账' : '调整已驳回，可修改后重新提交' };
  }

  async handleOaApprovalResult(
    payload: ApprovalCallbackPayload,
    rawPayload: unknown,
    logId: bigint,
  ) {
    const instance = await this.prisma.hspsi_oa_approval_instance.findFirst({
      where: {
        business_type: {
          in: [
            'inventory_transfer',
            'inventory_adjust',
            'inventory_check',
            'inventory_loss',
            'inventory_loss_output',
            'inventory_overflow',
          ],
        },
        bus_key: payload.busKey,
        proc_inst_id: payload.procInstId,
        deleted_at: null,
      },
      orderBy: { id: 'desc' },
    });
    if (!instance) throw new NotFoundException('未找到对应的库存OA审批实例');
    if (!['inventory_transfer', 'inventory_adjust'].includes(instance.business_type)) {
      return this.handleComplexOaApproval(instance, payload, rawPayload, logId);
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT id FROM hspsi_oa_approval_instance WHERE id = ? FOR UPDATE',
        instance.id,
      );
      const current = await tx.hspsi_oa_approval_instance.findUniqueOrThrow({
        where: { id: instance.id },
      });
      const passed = payload.procStatus === 'PASSED';
      const expected = passed ? 1 : 2;
      const document =
        current.business_type === 'inventory_transfer'
          ? await tx.hspsi_inventory_transfer.findFirst({
              where: { transfer_id: current.business_id, deleted_at: null },
            })
          : await tx.hspsi_inventory_adjust.findFirst({
              where: { adjust_id: current.business_id, deleted_at: null },
            });
      if (!document) throw new NotFoundException('OA审批对应的库存单据不存在');
      const duplicate =
        current.proc_status === payload.procStatus && document.approve_status === expected;
      if (!duplicate) {
        const comment = this.oaComment(payload.procStatus);
        if (current.business_type === 'inventory_transfer')
          await this.applyTransferApproval(tx, current.business_id, passed, comment, '0', true);
        else
          await this.applyAdjustmentApproval(tx, current.business_id, passed, comment, '0', true);
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
        where: { id: logId },
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
          process_result: duplicate ? '重复回调，已幂等确认' : '库存审批结果已处理',
          account_set_id: current.account_set_id,
        },
      });
      return {
        processed: true,
        duplicate,
        businessType: current.business_type,
        businessId: current.business_id,
        procStatus: payload.procStatus,
      };
    });
  }

  private oaComment(status: ApprovalCallbackPayload['procStatus']) {
    return {
      PASSED: 'OA审批通过',
      REJECTED: 'OA审批驳回',
      CANCELED: 'OA审批取消',
      DELETED: 'OA审批流程删除',
    }[status];
  }

  private async handleComplexOaApproval(
    instance: any,
    payload: ApprovalCallbackPayload,
    rawPayload: unknown,
    logId: bigint,
  ) {
    const passed = payload.procStatus === 'PASSED',
      expected = passed ? 1 : 2,
      id = instance.business_id as bigint;
    const document: any =
      instance.business_type === 'inventory_check'
        ? await this.prisma.hspsi_inventory_check.findFirst({
            where: { check_id: id, deleted_at: null },
          })
        : instance.business_type === 'inventory_loss'
          ? await this.prisma.hspsi_inventory_loss.findFirst({
              where: { loss_id: id, deleted_at: null },
            })
          : instance.business_type === 'inventory_loss_output'
            ? await this.prisma.hspsi_inventory_loss_output.findFirst({
                where: { loss_id: id, deleted_at: null },
              })
            : await this.prisma.hspsi_inventory_overflow.findFirst({
                where: { overflow_id: id, deleted_at: null },
              });
    if (!document) throw new NotFoundException('OA审批对应的库存单据不存在');
    const duplicate =
      instance.proc_status === payload.procStatus && document.approve_status === expected;
    let businessResult: any = {};
    if (!duplicate) {
      const actor = String(document.created_by),
        comment = this.oaComment(payload.procStatus);
      businessResult =
        instance.business_type === 'inventory_check'
          ? await this.approveCheck(String(id), passed, comment, actor, true)
          : instance.business_type === 'inventory_loss_output'
            ? await this.approveLossOutput(String(id), passed, comment, actor, true)
            : await this.approveDocument(
                instance.business_type === 'inventory_loss' ? 'loss' : 'overflow',
                String(id),
                passed,
                comment,
                actor,
                true,
              );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.hspsi_oa_approval_instance.update({
        where: { id: instance.id },
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
        where: { id: logId },
        data: {
          instance_id: instance.id,
          event_code: 'XFTOAFPS',
          prj_cod: payload.prjCod,
          proc_status: payload.procStatus,
          bus_key: payload.busKey,
          proc_inst_id: payload.procInstId,
          proc_key: payload.procKey,
          raw_payload: JSON.stringify(rawPayload),
          processed: 1,
          process_result: duplicate ? '重复回调，已幂等确认' : '库存审批结果已处理',
          account_set_id: instance.account_set_id,
        },
      });
    });
    return {
      processed: true,
      duplicate,
      businessType: instance.business_type,
      businessId: id,
      procStatus: payload.procStatus,
      ...businessResult,
    };
  }

  private async assertNoActiveOa(businessType: string, businessId: bigint, message: string) {
    const repository = this.prisma.hspsi_oa_approval_instance;
    if (!repository) return;
    const active = await repository.findFirst({
      where: {
        business_type: businessType,
        business_id: businessId,
        proc_status: { in: ['PENDING_PUSH', 'RUNNING', 'BACKTOSTART'] },
        deleted_at: null,
      },
      select: { id: true },
    });
    if (active) throw new BadRequestException(message);
  }

  async checks(query: Body) {
    const { page, pageSize } = this.page(query);
    // 仅统计/展示启用仓库（status=1）的盘点单；停用仓库的单据不计入「全部」与各仓库统计
    const enabledWarehouseIds = (
      await this.prisma.hspsi_basic_warehouse.findMany({
        where: {
          status: 1,
          deleted_at: null,
          ...(query.orgId ? { org_id: BigInt(query.orgId) } : {}),
        },
        select: { warehouse_id: true },
      })
    ).map((warehouse) => warehouse.warehouse_id);
    const where: Prisma.hspsi_inventory_checkWhereInput = { deleted_at: null };
    if (query.orgId) where.org_id = BigInt(query.orgId);
    if (query.warehouseId) where.warehouse_id = BigInt(query.warehouseId);
    else where.warehouse_id = { in: enabledWarehouseIds };
    // 仓库筛选统计：按组织统计各启用仓库盘点单数（不受已选仓库影响，供「全部」与仓库 Tab 展示）
    const warehouseCounts = Object.fromEntries(
      (
        await this.prisma.hspsi_inventory_check.groupBy({
          by: ['warehouse_id'],
          where: {
            deleted_at: null,
            ...(query.orgId ? { org_id: BigInt(query.orgId) } : {}),
            warehouse_id: { in: enabledWarehouseIds },
          },
          _count: { _all: true },
        })
      ).map((group) => [String(group.warehouse_id), group._count._all]),
    );
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_inventory_check.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { check_id: 'desc' },
      }),
      this.prisma.hspsi_inventory_check.count({ where }),
    ]);
    const checkIds = items.map((item) => item.check_id);
    const [details, refs, users, types, losses, lossOutputs, overflows] = await Promise.all([
      this.prisma.hspsi_inventory_check_detail.findMany({
        where: { check_id: { in: checkIds } },
        select: { check_id: true, goods_id: true, sku_id: true, damaged_qty: true },
      }),
      this.names(items.map((item) => ({ orgId: item.org_id, warehouseId: item.warehouse_id }))),
      this.users(items.map((item) => item.created_by)),
      this.dictionary('inventory_check_type'),
      this.prisma.hspsi_inventory_loss.findMany({
        where: { source_check_id: { in: checkIds }, business_kind: 2, deleted_at: null },
        select: {
          loss_id: true,
          source_check_id: true,
          business_kind: true,
          approve_status: true,
          go_where: true,
          loss_qty: true,
          loss_no: true,
        },
      }),
      this.prisma.hspsi_inventory_loss_output.findMany({
        where: { source_check_id: { in: checkIds }, deleted_at: null },
        select: { source_check_id: true, approve_status: true, loss_no: true },
      }),
      this.prisma.hspsi_inventory_overflow.findMany({
        where: { source_check_id: { in: checkIds }, deleted_at: null },
        select: {
          source_check_id: true,
          approve_status: true,
          input_status: true,
          overflow_no: true,
          input_no: true,
        },
      }),
    ]);
    const discountLossIds = losses
      .filter((loss) => Number(loss.business_kind) === 2 && Number(loss.go_where) === 1)
      .map((loss) => loss.loss_id);
    const discountOrders = discountLossIds.length
      ? await this.prisma.hspsi_sale_order.findMany({
          where: {
            so_property_type: 2,
            business_source_type: 'inventory_loss',
            business_source_id: { in: discountLossIds },
            deleted_at: null,
          },
          select: { so_id: true, business_source_id: true },
        })
      : [];
    const confirmedDiscountOutputs = discountOrders.length
      ? await this.prisma.hspsi_sale_order_output.findMany({
          where: {
            so_id: { in: discountOrders.map((order) => order.so_id) },
            comfirm_status: 1,
            deleted_at: null,
          },
          select: { so_output_id: true, so_id: true },
        })
      : [];
    const confirmedDiscountDetails = confirmedDiscountOutputs.length
      ? await this.prisma.hspsi_sale_order_output_detail.findMany({
          where: {
            so_output_id: { in: confirmedDiscountOutputs.map((output) => output.so_output_id) },
          },
          select: { so_output_id: true, output_qty: true },
        })
      : [];
    const discountProcessedByLoss = new Map<string, number>();
    for (const line of confirmedDiscountDetails) {
      const output = confirmedDiscountOutputs.find(
        (candidate) => candidate.so_output_id === line.so_output_id,
      );
      const order = discountOrders.find((candidate) => candidate.so_id === output?.so_id);
      if (!order) continue;
      const key = String(order.business_source_id);
      discountProcessedByLoss.set(
        key,
        (discountProcessedByLoss.get(key) ?? 0) + Number(line.output_qty),
      );
    }
    return {
      items: items.map((item) => {
        const damageDocuments = losses.filter((loss) => loss.source_check_id === item.check_id);
        const shortageDocuments = lossOutputs.filter(
          (output) => output.source_check_id === item.check_id,
        );
        const damagedQty = details
          .filter((detail) => detail.check_id === item.check_id)
          .reduce((sum, detail) => sum + Number(detail.damaged_qty), 0);
        const processedDamageQty = damageDocuments.reduce((sum, loss) => {
          if (Number(loss.approve_status) !== 1) return sum;
          const quantity = Number(loss.loss_qty);
          if (Number(loss.go_where) === 0) return sum + quantity;
          if (
            Number(loss.go_where) === 1 &&
            (discountProcessedByLoss.get(String(loss.loss_id)) ?? 0) + 0.000001 >= quantity
          ) {
            return sum + quantity;
          }
          return sum;
        }, 0);
        const progress = calculateInventoryCheckProgress(
          Number(item.less_qty),
          Number(item.overflow_qty),
          damagedQty,
          Number(item.less_process_qty),
          Number(item.overflow_process_qty),
          processedDamageQty,
        );
        const checkDetails = details.filter((detail) => detail.check_id === item.check_id);
        const goodsCount = new Set(
          checkDetails.map((detail) => `${detail.goods_id.toString()}:${detail.sku_id.toString()}`),
        ).size;
        const children = [
          ...damageDocuments.map((loss) => ({
            type: 'damage',
            no: loss.loss_no,
            completed:
              Number(loss.approve_status) === 1 &&
              (Number(loss.go_where) === 0 ||
                (Number(loss.go_where) === 1 &&
                  (discountProcessedByLoss.get(String(loss.loss_id)) ?? 0) + 0.000001 >=
                    Number(loss.loss_qty))),
          })),
          ...shortageDocuments.map((output) => ({
            type: 'shortage',
            no: output.loss_no,
            completed: Number(output.approve_status) === 1,
          })),
          ...overflows
            .filter((overflow) => overflow.source_check_id === item.check_id)
            .map((overflow) => ({
              type: 'overflow',
              no: overflow.input_no || overflow.overflow_no,
              completed:
                Number(overflow.approve_status) === 1 && Number(overflow.input_status) === 1,
            })),
        ];
        return {
          id: item.check_id,
          checkNo: item.check_no,
          checkType: item.check_type,
          checkTypeName: types.get(String(item.check_type)),
          orgId: item.org_id,
          orgName: refs.orgs.find((org) => org.org_id === item.org_id)?.name,
          warehouseId: item.warehouse_id,
          warehouseName: refs.warehouses.find(
            (warehouse) => warehouse.warehouse_id === item.warehouse_id,
          )?.name,
          checkDate: item.check_date,
          goodsCount,
          allQty: item.all_qty,
          lessQty: item.less_qty,
          overflowQty: item.overflow_qty,
          damagedQty,
          processedDamageQty,
          processedQty: progress.processed,
          differenceQty: progress.total,
          progressPct: progress.progressPct,
          generatedDocumentCount: children.length,
          completedDocumentCount: children.filter((child) => child.completed).length,
          status: item.status,
          approveStatus: item.approve_status,
          createdBy: item.created_by,
          createdByName: users.get(String(item.created_by)),
          createdAt: item.created_at,
        };
      }),
      total,
      page,
      pageSize,
      warehouseCounts,
    };
  }

  async check(id: string) {
    const item = await this.prisma.hspsi_inventory_check.findFirst({
      where: { check_id: BigInt(id), deleted_at: null },
    });
    if (!item) throw new NotFoundException('盘点单不存在');
    const details = await this.prisma.hspsi_inventory_check_detail.findMany({
      where: { check_id: item.check_id },
    });
    const [refs, units, losses, lossOutputs, overflows] = await Promise.all([
      this.names(
        details.map((line) => ({
          goodsId: line.goods_id,
          skuId: line.sku_id,
          warehouseId: item.warehouse_id,
          orgId: item.org_id,
        })),
      ),
      this.prisma.hspsi_basic_unit.findMany(),
      this.prisma.hspsi_inventory_loss.findMany({
        where: { source_check_id: item.check_id, business_kind: 2, deleted_at: null },
        select: {
          loss_id: true,
          loss_no: true,
          business_kind: true,
          status: true,
          approve_status: true,
        },
      }),
      this.prisma.hspsi_inventory_loss_output.findMany({
        where: { source_check_id: item.check_id, deleted_at: null },
        select: { loss_id: true, loss_no: true, status: true, approve_status: true },
      }),
      this.prisma.hspsi_inventory_overflow.findMany({
        where: { source_check_id: item.check_id, deleted_at: null },
        select: {
          overflow_id: true,
          overflow_no: true,
          input_no: true,
          input_status: true,
          status: true,
          approve_status: true,
        },
      }),
    ]);
    const mappedDetails = details.map((detail) => {
      const damaged = Number(detail.damaged_qty) > 0;
      const difference = Number(detail.different_qty);
      const quantityResult = difference < 0 ? -1 : difference > 0 ? 1 : 0;
      const resultNames = [
        difference < 0 ? '盘亏' : difference > 0 ? '盘盈' : '',
        damaged ? '损坏' : '',
      ].filter(Boolean);
      return {
        id: detail.check_detail_id,
        goodsId: detail.goods_id,
        goodsCode: refs.goods.find((goods) => goods.goods_id === detail.goods_id)?.query_code,
        goodsName: refs.goods.find((goods) => goods.goods_id === detail.goods_id)?.goods_name,
        skuId: detail.sku_id,
        skuSpec: refs.skus.find((sku) => sku.sku_id === detail.sku_id)?.spec_models,
        batchNo: detail.batch_no,
        unitType: detail.unit_type,
        unitName: units.find((unit) => unit.id === BigInt(detail.unit_type))?.name,
        inventoryQty: detail.inventory_qty,
        checkQty: detail.check_qty,
        damagedQty: detail.damaged_qty,
        differentQty: detail.different_qty,
        unitPrice: detail.unit_price,
        differentAmount: detail.different_amount,
        result: damaged ? 2 : quantityResult,
        quantityResult,
        damagedResult: damaged ? 1 : 0,
        resultName: resultNames.join(' + ') || '正常',
        remark: detail.remark,
      };
    });
    const enrichedDetails = await this.references.enrichGoods(mappedDetails);
    return {
      ...item,
      id: item.check_id,
      checkNo: item.check_no,
      checkType: item.check_type,
      orgId: item.org_id,
      warehouseId: item.warehouse_id,
      checkDate: item.check_date,
      approveStatus: item.approve_status,
      generatedDocuments: [
        ...losses.map((loss) => ({
          id: loss.loss_id,
          type: '报损出库单',
          businessNo: loss.loss_no,
          status: loss.status,
          approveStatus: loss.approve_status,
        })),
        ...lossOutputs.map((output) => ({
          id: output.loss_id,
          type: '报亏出库单',
          businessNo: output.loss_no,
          status: output.status,
          approveStatus: output.approve_status,
        })),
        ...overflows.map((overflow) => ({
          id: overflow.overflow_id,
          type: '报盈入库单',
          businessNo: overflow.overflow_no,
          inputStatus: overflow.input_status,
          status: overflow.status,
          approveStatus: overflow.approve_status,
        })),
      ],
      details: enrichedDetails,
    };
  }
  async createCheck(body: Body, userId: string) {
    await this.masterData.assertWarehouse(body.orgId, body.warehouseId);
    const stocks = await this.prisma.hspsi_inventory_batch_total.findMany({
      where: {
        org_id: BigInt(body.orgId),
        warehouse_id: BigInt(body.warehouseId),
        inventory_qty: { gt: 0 },
      },
    });
    if (!stocks.length) throw new BadRequestException('所选仓库当前没有可盘点库存');
    await this.masterData.assertGoodsLines(
      body.orgId,
      body.warehouseId,
      stocks.map((line) => ({ goodsId: line.goods_id, skuId: line.sku_id })),
    );
    const id = await this.prisma.$transaction(async (tx) => {
      const checkNo = await this.businessNumber.generate(BUSINESS_PREFIX.INVENTORY_CHECK);
      const header = await tx.hspsi_inventory_check.create({
        data: {
          check_no: checkNo,
          check_type: Number(body.checkType),
          check_date: new Date(body.checkDate ?? Date.now()),
          check_state: 3,
          all_qty: stocks.reduce((s, i) => s + i.inventory_qty, 0),
          all_value: this.dec(stocks.reduce((s, i) => s + Number(i.inventory_amount), 0)),
          org_id: BigInt(body.orgId),
          warehouse_id: BigInt(body.warehouseId),
          status: 0,
          approve_status: 0,
          remark: String(body.remark ?? ''),
          created_by: BigInt(userId),
          updated_by: BigInt(userId),
        },
      });
      await tx.hspsi_inventory_check_detail.createMany({
        data: stocks.map((s) => ({
          check_id: header.check_id,
          goods_id: s.goods_id,
          sku_id: s.sku_id,
          batch_no: s.batch_no,
          unit_type: s.unit_type,
          inventory_qty: s.inventory_qty,
          check_qty: s.inventory_qty,
          damaged_qty: 0,
          different_qty: 0,
          unit_price: this.dec(
            Number(s.inventory_qty) ? Number(s.inventory_amount) / Number(s.inventory_qty) : 0,
          ),
          different_amount: this.dec(0),
          remark: '',
        })),
      });
      return header.check_id;
    });
    return { id, message: '盘点单已创建并载入即时库存' };
  }
  async saveCheck(id: string, body: Body, userId: string, submit: boolean) {
    const item = await this.check(id);
    if (Number(item.status) !== 0) throw new BadRequestException('当前盘点单不能继续录入');
    const inputs = this.lines(body.details);
    if (
      inputs.length !== item.details.length ||
      item.details.some((old: Body) => !inputs.some((input) => String(input.id) === String(old.id)))
    ) {
      throw new BadRequestException('盘点明细必须完整提交，不允许遗漏库存快照行');
    }
    let less = 0;
    let overflow = 0;
    let lessValue = 0;
    let overflowValue = 0;
    const normalized = item.details.map((old: Body) => {
      const input = inputs.find((candidate) => String(candidate.id) === String(old.id))!;
      const { actual, damaged, difference, quantityBranch } = classifyInventoryCheckQuantities(
        old.inventoryQty,
        input.checkQty,
        input.damagedQty,
        old.goodsName || '商品',
      );
      const amount = difference * Number(old.unitPrice);
      // 数量差异与损坏是两个独立维度：同一批次可同时进入数量差异链和报损链。
      // 最终可用库存恒为：账面库存 + 数量差异 - 损坏数量 = 实盘数量 - 损坏数量。
      if (quantityBranch === 'shortage') {
        less += Math.abs(difference);
        lessValue += Math.abs(amount);
      } else if (quantityBranch === 'overflow') {
        overflow += difference;
        overflowValue += amount;
      }
      return { old, input, actual, damaged, difference, amount };
    });
    await this.prisma.$transaction(async (tx) => {
      for (const line of normalized) {
        await tx.hspsi_inventory_check_detail.update({
          where: { check_detail_id: BigInt(line.old.id) },
          data: {
            check_qty: this.qty(line.actual, '实盘数量', true),
            damaged_qty: this.qty(line.damaged, '损坏数量', true),
            different_qty: Number(line.difference),
            different_amount: this.dec(line.amount),
            remark: String(line.input.remark ?? ''),
          },
        });
      }
      await tx.hspsi_inventory_check.update({
        where: { check_id: BigInt(id) },
        data: {
          status: submit ? 1 : 0,
          check_state: less > 0 ? 1 : overflow > 0 ? 2 : 3,
          less_qty: less,
          less_value: this.dec(lessValue),
          overflow_qty: overflow,
          overflow_value: this.dec(overflowValue),
          updated_by: BigInt(userId),
        },
      });
    });
    return { id, message: submit ? '盘点已完成并提交审批' : '盘点数据已保存' };
  }
  async removeCheck(id: string, userId: string) {
    const item = await this.check(id);
    if (Number(item.status) !== 0) throw new BadRequestException('仅进行中的盘点单可删除');
    await this.prisma.hspsi_inventory_check.update({
      where: { check_id: BigInt(id) },
      data: { deleted_at: new Date(), updated_by: BigInt(userId) },
    });
    return { id, message: '删除成功' };
  }
  async approveCheck(
    id: string,
    approved: boolean,
    comment: string,
    userId: string,
    fromOa = false,
  ) {
    const item = await this.check(id);
    if (Number(item.status) !== 1 || Number(item.approveStatus) !== 0)
      throw new BadRequestException('仅待审批盘点单可操作');
    if (!fromOa)
      await this.assertNoActiveOa(
        'inventory_check',
        BigInt(id),
        '该盘点单正在OA审批，不能在本系统审批',
      );
    const generated: Array<{ type: string; id: bigint; no: string }> = [];
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT check_id FROM hspsi_inventory_check WHERE check_id=${BigInt(id)} FOR UPDATE`;
      const locked = await tx.hspsi_inventory_check.findUniqueOrThrow({
        where: { check_id: BigInt(id) },
      });
      if (Number(locked.status) !== 1 || Number(locked.approve_status) !== 0)
        throw new BadRequestException('该盘点单已经处理，请勿重复审批');
      if (approved) {
        const { negative, positive, damaged } = partitionInventoryCheckDetails(item.details);

        if (negative.length) {
          const shortageOutputNo = await this.businessNumber.generate(
            BUSINESS_PREFIX.INVENTORY_SHORTAGE_OUTPUT,
          );
          const shortageOutput = await tx.hspsi_inventory_loss_output.create({
            data: {
              loss_no: shortageOutputNo,
              loss_type: 1,
              loss_reson: `盘点 ${item.check_no} 数量盘亏`,
              org_id: item.org_id,
              warehouse_id: item.warehouse_id,
              dept_id: 0,
              loss_date: new Date(),
              source_loss_id: 0,
              source_check_id: item.check_id,
              loss_qty: negative.reduce(
                (sum: number, detail: Body) => sum + Math.abs(Number(detail.differentQty)),
                0,
              ),
              loss_total_amount: this.dec(
                negative.reduce(
                  (sum: number, detail: Body) => sum + Math.abs(Number(detail.differentAmount)),
                  0,
                ),
              ),
              status: 1,
              approve_status: 0,
              remark: '盘点审批自动生成，待审核；审核通过后整单扣减来源批次库存',
              created_by: BigInt(userId),
              updated_by: BigInt(userId),
            },
          });
          await tx.hspsi_inventory_loss_output_detail.createMany({
            data: negative.map((detail: Body) => ({
              loss_id: shortageOutput.loss_id,
              goods_id: BigInt(detail.goodsId),
              sku_id: BigInt(detail.skuId),
              batch_no: String(detail.batchNo ?? ''),
              unit_type: Number(detail.unitType),
              loss_qty: Math.abs(Number(detail.differentQty)),
              loss_amount: this.dec(Math.abs(Number(detail.differentAmount))),
            })),
          });
          await this.documentTrace.link(
            {
              upstreamType: 'inventory_check',
              upstreamId: item.check_id,
              upstreamNo: item.check_no,
              downstreamType: 'inventory_loss_output',
              downstreamId: shortageOutput.loss_id,
              downstreamNo: shortageOutputNo,
              relationKind: 'generated',
              createdBy: userId,
            },
            tx,
          );
          generated.push({
            type: '报亏出库单（待审批）',
            id: shortageOutput.loss_id,
            no: shortageOutputNo,
          });
        }

        for (const [detail] of splitInventoryDamageDetails(damaged)) {
          const damageNo = await this.businessNumber.generate(
            BUSINESS_PREFIX.INVENTORY_DAMAGE_OUTPUT,
          );
          const damage = await tx.hspsi_inventory_loss.create({
            data: {
              loss_no: damageNo,
              business_kind: 2,
              loss_type: 1,
              loss_reson: `盘点 ${item.check_no} 批次 ${String(detail.batchNo ?? '')} 物料损坏`,
              org_id: item.org_id,
              warehouse_id: item.warehouse_id,
              dept_id: 0,
              loss_date: new Date(),
              source_check_id: item.check_id,
              loss_qty: Number(detail.damagedQty),
              loss_total_amount: this.dec(Number(detail.damagedQty) * Number(detail.unitPrice)),
              go_where: -1,
              status: 0,
              approve_status: 0,
              remark: '盘点审批按损坏批次自动生成；请在报损出库单界面编辑并选择报损去向后提交',
              created_by: BigInt(userId),
              updated_by: BigInt(userId),
            },
          });
          await tx.hspsi_inventory_loss_detail.create({
            data: {
              loss_id: damage.loss_id,
              goods_id: BigInt(detail.goodsId),
              sku_id: BigInt(detail.skuId),
              batch_no: String(detail.batchNo ?? ''),
              unit_type: Number(detail.unitType),
              loss_qty: Number(detail.damagedQty),
              loss_amount: this.dec(Number(detail.damagedQty) * Number(detail.unitPrice)),
            },
          });
          await this.documentTrace.link(
            {
              upstreamType: 'inventory_check',
              upstreamId: item.check_id,
              upstreamNo: item.check_no,
              downstreamType: 'inventory_loss',
              downstreamId: damage.loss_id,
              downstreamNo: damageNo,
              relationKind: 'generated',
              createdBy: userId,
            },
            tx,
          );
          generated.push({ type: '报损出库单（草稿）', id: damage.loss_id, no: damageNo });
        }

        if (positive.length) {
          const overflowNo = await this.businessNumber.generate(
            BUSINESS_PREFIX.INVENTORY_OVERFLOW_INPUT,
          );
          const overflow = await tx.hspsi_inventory_overflow.create({
            data: {
              overflow_no: overflowNo,
              overflow_type: 1,
              overflow_reson: `盘点 ${item.check_no} 数量盘盈`,
              org_id: item.org_id,
              warehouse_id: item.warehouse_id,
              dept_id: 0,
              overflow_date: new Date(),
              source_check_id: item.check_id,
              overflow_qty: positive.reduce(
                (sum: number, detail: Body) => sum + Number(detail.differentQty),
                0,
              ),
              overflow_total_amount: this.dec(
                positive.reduce(
                  (sum: number, detail: Body) => sum + Number(detail.differentAmount),
                  0,
                ),
              ),
              status: 1,
              approve_status: 0,
              remark: '盘点审批自动生成，待报盈审核',
              created_by: BigInt(userId),
              updated_by: BigInt(userId),
            },
          });
          await tx.hspsi_inventory_overflow_detail.createMany({
            data: positive.map((detail: Body) => ({
              overflow_id: overflow.overflow_id,
              goods_id: BigInt(detail.goodsId),
              sku_id: BigInt(detail.skuId),
              batch_no: String(detail.batchNo ?? ''),
              unit_type: Number(detail.unitType),
              overflow_qty: Number(detail.differentQty),
              overflow_amount: this.dec(detail.differentAmount),
            })),
          });
          await this.documentTrace.link(
            {
              upstreamType: 'inventory_check',
              upstreamId: item.check_id,
              upstreamNo: item.check_no,
              downstreamType: 'inventory_overflow',
              downstreamId: overflow.overflow_id,
              downstreamNo: overflowNo,
              relationKind: 'generated',
              createdBy: userId,
            },
            tx,
          );
          generated.push({
            type: '报盈入库单（待审批）',
            id: overflow.overflow_id,
            no: overflowNo,
          });
        }
      }
      await tx.hspsi_inventory_check.update({
        where: { check_id: item.check_id },
        data: {
          approve_status: approved ? 1 : 2,
          approve_comment: comment,
          approve_by: BigInt(userId),
          approve_date: new Date(),
          // 子单审批/入库完成后再累计处理进度。
          less_process_qty: 0,
          overflow_process_qty: 0,
          less_process_value: this.dec(0),
          overflow_process_value: this.dec(0),
        },
      });
    });
    return {
      id,
      generated,
      message: approved
        ? `盘点审批通过，已生成 ${generated.map((document) => document.type).join('、') || '无差异单据'}；库存尚未变动`
        : '盘点已驳回',
    };
  }

  private async documentList(type: 'loss' | 'loss-output' | 'overflow', query: Body) {
    const { page, pageSize } = this.page(query);
    const model: any =
      type === 'loss'
        ? this.prisma.hspsi_inventory_loss
        : type === 'loss-output'
          ? this.prisma.hspsi_inventory_loss_output
          : this.prisma.hspsi_inventory_overflow;
    const key = type === 'overflow' ? 'overflow_id' : 'loss_id';
    const where: Body = { deleted_at: null };
    if (query.orgId) where.org_id = BigInt(query.orgId);
    if (query.warehouseId) where.warehouse_id = BigInt(query.warehouseId);
    if (type === 'loss') where.business_kind = Number(query.businessKind ?? 2);
    if (type === 'overflow' && query.onlyInputs) Object.assign(where, { input_no: { not: null } });
    const [rows, total] = await Promise.all([
      model.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [key]: 'desc' },
      }),
      model.count({ where }),
    ]);
    const sourceLossIds: bigint[] = rows
      .map((item: Body) => BigInt(item.source_loss_id ?? 0))
      .filter((sourceId: bigint) => sourceId > 0n);
    const sourceLosses = sourceLossIds.length
      ? await this.prisma.hspsi_inventory_loss.findMany({
          where: { loss_id: { in: [...new Set(sourceLossIds)] } },
        })
      : [];
    const sourceCheckIds: bigint[] = rows
      .map((item: Body) => {
        const directSourceId = BigInt(item.source_check_id ?? 0);
        return directSourceId > 0n
          ? directSourceId
          : BigInt(
              sourceLosses.find((loss) => loss.loss_id === item.source_loss_id)?.source_check_id ??
                0,
            );
      })
      .filter((sourceId: bigint) => sourceId > 0n);
    const [refs, users, departments, checks, types, shortageTypes, disposal] = await Promise.all([
      this.names(
        rows.map((item: Body) => ({ orgId: item.org_id, warehouseId: item.warehouse_id })),
      ),
      this.users(rows.map((item: Body) => item.created_by)),
      this.prisma.hspsi_basic_dept.findMany({
        where: {
          dept_id: {
            in: [
              ...new Set<bigint>(
                rows
                  .map((item: Body) => BigInt(item.dept_id ?? 0))
                  .filter((deptId: bigint) => deptId > 0n),
              ),
            ],
          },
          deleted_at: null,
        },
      }),
      this.prisma.hspsi_inventory_check.findMany({
        where: { check_id: { in: [...new Set(sourceCheckIds)] } },
      }),
      this.dictionary(
        type === 'loss'
          ? 'inventory_loss_type'
          : type === 'loss-output'
            ? 'inventory_loss_output_type'
            : 'inventory_overflow_type',
      ),
      this.dictionary('inventory_loss_output_type'),
      this.dictionary('inventory_loss_disposal'),
    ]);
    const onlyInputs = type === 'overflow' && !!query.onlyInputs;
    const purchaseReturns =
      type === 'loss' && rows.length
        ? await this.prisma.hspsi_purchase_order_input_exit.findMany({
            where: {
              source_document_type: 'inventory_loss',
              source_document_id: { in: rows.map((row: Body) => BigInt(row.loss_id)) },
              deleted_at: null,
            },
            select: { po_exit_id: true, po_exit_no: true, source_document_id: true },
          })
        : [];
    const items = rows.map((item: Body) => {
      const sourceLoss = sourceLosses.find((loss) => loss.loss_id === item.source_loss_id);
      const directSourceId = BigInt(item.source_check_id ?? 0);
      const sourceCheckId =
        directSourceId > 0n ? directSourceId : BigInt(sourceLoss?.source_check_id ?? 0);
      const businessKind = type === 'loss' ? Number(item.business_kind) : 0;
      const documentType = type === 'overflow' ? item.overflow_type : item.loss_type;
      return {
        id: item[key],
        businessNo: onlyInputs
          ? item.input_no
          : type === 'overflow'
            ? item.overflow_no
            : item.loss_no,
        sourceOverflowNo: onlyInputs ? item.overflow_no : undefined,
        businessKind,
        businessKindName: businessKind === 1 ? '报亏单' : businessKind === 2 ? '报损出库单' : '',
        orgId: item.org_id,
        orgName: refs.orgs.find((org) => org.org_id === item.org_id)?.name,
        warehouseId: item.warehouse_id,
        warehouseName: refs.warehouses.find(
          (warehouse) => warehouse.warehouse_id === item.warehouse_id,
        )?.name,
        deptId: item.dept_id,
        deptName: departments.find((dept) => dept.dept_id === item.dept_id)?.name,
        documentType,
        documentTypeName:
          type === 'loss' && businessKind === 1
            ? shortageTypes.get(String(documentType))
            : types.get(String(documentType)),
        reason: type === 'overflow' ? item.overflow_reson : item.loss_reson,
        date: onlyInputs
          ? item.input_date
          : type === 'overflow'
            ? item.overflow_date
            : item.loss_date,
        quantity: type === 'overflow' ? item.overflow_qty : item.loss_qty,
        amount: type === 'overflow' ? item.overflow_total_amount : item.loss_total_amount,
        goWhere: Number(item.go_where) >= 0 ? item.go_where : null,
        goWhereName: Number(item.go_where) >= 0 ? disposal.get(String(item.go_where)) : '',
        status: onlyInputs ? (Number(item.input_status) === 1 ? 1 : 0) : item.status,
        approveStatus: onlyInputs ? (Number(item.input_status) === 1 ? 1 : 0) : item.approve_status,
        inputNo: item.input_no,
        inputStatus: item.input_status,
        inputBy: item.input_by,
        inputDate: item.input_date,
        sourceCheckId,
        sourceCheckNo: checks.find((check) => check.check_id === sourceCheckId)?.check_no,
        sourceLossId: item.source_loss_id,
        sourceLossNo: sourceLoss?.loss_no,
        purchaseReturns: purchaseReturns
          .filter((purchaseReturn) => purchaseReturn.source_document_id === BigInt(item.loss_id))
          .map((purchaseReturn) => ({
            id: purchaseReturn.po_exit_id,
            returnNo: purchaseReturn.po_exit_no,
          })),
        createdBy: item.created_by,
        createdByName: users.get(String(item.created_by)),
        createdAt: item.created_at,
      };
    });
    return { items, total, page, pageSize };
  }

  losses(query: Body) {
    return this.documentList('loss', query);
  }
  lossOutputs(query: Body) {
    return this.documentList('loss-output', query);
  }
  overflows(query: Body) {
    return this.documentList('overflow', query);
  }
  overflowInputs(query: Body) {
    return this.documentList('overflow', { ...query, onlyInputs: true });
  }

  private async document(type: 'loss' | 'loss-output' | 'overflow', id: string) {
    const model: any =
      type === 'loss'
        ? this.prisma.hspsi_inventory_loss
        : type === 'loss-output'
          ? this.prisma.hspsi_inventory_loss_output
          : this.prisma.hspsi_inventory_overflow;
    const detailModel: any =
      type === 'loss'
        ? this.prisma.hspsi_inventory_loss_detail
        : type === 'loss-output'
          ? this.prisma.hspsi_inventory_loss_output_detail
          : this.prisma.hspsi_inventory_overflow_detail;
    const key = type === 'overflow' ? 'overflow_id' : 'loss_id';
    const item = await model.findFirst({ where: { [key]: BigInt(id), deleted_at: null } });
    if (!item) throw new NotFoundException('库存单据不存在');
    const details = await detailModel.findMany({ where: { [key]: BigInt(id) } });
    const sourceLoss =
      type === 'loss-output' && item.source_loss_id
        ? await this.prisma.hspsi_inventory_loss.findUnique({
            where: { loss_id: item.source_loss_id },
          })
        : null;
    const directSourceId = BigInt(item.source_check_id ?? 0);
    const sourceCheckId =
      directSourceId > 0n ? directSourceId : BigInt(sourceLoss?.source_check_id ?? 0);
    const [refs, units, stocks, sourceCheck] = await Promise.all([
      this.names(
        details.map((line: Body) => ({
          goodsId: line.goods_id,
          skuId: line.sku_id,
          warehouseId: item.warehouse_id,
          orgId: item.org_id,
        })),
      ),
      this.prisma.hspsi_basic_unit.findMany(),
      this.prisma.hspsi_inventory_batch_total.findMany({
        where: {
          warehouse_id: item.warehouse_id,
          OR: details.map((line: Body) => ({
            goods_id: line.goods_id,
            sku_id: line.sku_id,
            batch_no: line.batch_no ?? '',
          })),
        },
      }),
      sourceCheckId > 0n
        ? this.prisma.hspsi_inventory_check.findUnique({ where: { check_id: sourceCheckId } })
        : null,
    ]);
    const businessKind = type === 'loss' ? Number(item.business_kind) : 0;
    const mappedDetails = details.map((detail: Body) => {
      const stock = stocks.find(
        (row) =>
          row.goods_id === detail.goods_id &&
          row.sku_id === detail.sku_id &&
          row.batch_no === (detail.batch_no ?? ''),
      );
      const quantity = Number(type === 'overflow' ? detail.overflow_qty : detail.loss_qty);
      const amount = Number(type === 'overflow' ? detail.overflow_amount : detail.loss_amount);
      return {
        id: detail.id ?? detail.loss_detail_id,
        goodsId: detail.goods_id,
        goodsCode: refs.goods.find((goods) => goods.goods_id === detail.goods_id)?.query_code,
        goodsName: refs.goods.find((goods) => goods.goods_id === detail.goods_id)?.goods_name,
        skuId: detail.sku_id,
        skuSpec: refs.skus.find((sku) => sku.sku_id === detail.sku_id)?.spec_models,
        batchNo: detail.batch_no,
        unitType: detail.unit_type,
        unitName: units.find((unit) => unit.id === BigInt(detail.unit_type))?.name,
        inventoryQty: stock?.inventory_qty ?? 0,
        unitPrice: quantity
          ? amount / quantity
          : stock && Number(stock.inventory_qty)
            ? Number(stock.inventory_amount) / Number(stock.inventory_qty)
            : 0,
        quantity,
        amount,
        sourceReceiptDetailId: detail.source_receipt_detail_id ?? 0,
      };
    });
    const enrichedDetails = await this.references.enrichGoods(mappedDetails);
    return {
      ...item,
      id: item[key],
      businessNo: type === 'overflow' ? item.overflow_no : item.loss_no,
      businessKind,
      businessKindName: businessKind === 1 ? '报亏单' : businessKind === 2 ? '报损出库单' : '',
      documentType: type === 'overflow' ? item.overflow_type : item.loss_type,
      reason: type === 'overflow' ? item.overflow_reson : item.loss_reson,
      date: type === 'overflow' ? item.overflow_date : item.loss_date,
      orgId: item.org_id,
      warehouseId: item.warehouse_id,
      deptId: item.dept_id,
      sourceCheckId,
      sourceCheckNo: sourceCheck?.check_no,
      sourceLossId: item.source_loss_id,
      sourceLossNo: sourceLoss?.loss_no,
      goWhere: Number(item.go_where) >= 0 ? String(item.go_where) : null,
      approveStatus: item.approve_status,
      inputNo: item.input_no,
      inputStatus: item.input_status,
      inputBy: item.input_by,
      inputDate: item.input_date,
      details: enrichedDetails,
    };
  }

  loss(id: string) {
    return this.document('loss', id);
  }

  async lossPurchaseSourceOptions(query: Body) {
    const orgId = BigInt(query.orgId);
    const warehouseId = BigInt(query.warehouseId);
    const details = await this.prisma.hspsi_purchase_order_input_detail.findMany({
      where: {
        goods_id: BigInt(query.goodsId),
        sku_id: BigInt(query.skuId),
        batch_no: String(query.batchNo ?? '').trim(),
        deleted_at: null,
      },
      orderBy: { id: 'desc' },
    });
    if (!details.length) return [];
    const receipts = await this.prisma.hspsi_purchase_order_input.findMany({
      where: {
        po_input_id: { in: details.map((detail) => detail.po_input_id) },
        org_id: orgId,
        warehouse_id: warehouseId,
        comfirm_status: 1,
        deleted_at: null,
      },
    });
    const receiptMap = new Map(receipts.map((receipt) => [String(receipt.po_input_id), receipt]));
    return details
      .filter((detail) => receiptMap.has(String(detail.po_input_id)))
      .map((detail) => {
        const receipt = receiptMap.get(String(detail.po_input_id))!;
        return {
          value: detail.id,
          label: `${receipt.po_input_no} · 入库${detail.input_qty}`,
          receiptId: receipt.po_input_id,
          receiptNo: receipt.po_input_no,
          orderId: receipt.po_id,
          inputQuantity: detail.input_qty,
          inputPosition: detail.input_position,
        };
      });
  }
  lossOutput(id: string) {
    return this.document('loss-output', id);
  }
  overflow(id: string) {
    return this.document('overflow', id);
  }
  async overflowInput(id: string) {
    const item = await this.document('overflow', id);
    if (!item.inputNo) throw new NotFoundException('报盈入库单不存在');
    const confirmed = Number(item.inputStatus) === 1;
    return {
      ...item,
      businessNo: item.inputNo,
      sourceOverflowNo: item.businessNo,
      date: item.inputDate ?? item.approve_date,
      status: confirmed ? 1 : 0,
      approveStatus: confirmed ? 1 : 0,
    };
  }

  private async normalizeInventoryDocumentLines(
    orgId: bigint,
    warehouseId: bigint,
    lines: Body[],
    requiresAvailable: boolean,
  ) {
    const warehouse = await this.prisma.hspsi_basic_warehouse.findFirst({
      where: { warehouse_id: warehouseId, org_id: orgId, status: 1, deleted_at: null },
    });
    if (!warehouse) throw new BadRequestException('组织与仓库不匹配，或仓库未启用');
    const seen = new Set<string>();
    const stocks = await this.prisma.hspsi_inventory_batch_total.findMany({
      where: {
        org_id: orgId,
        warehouse_id: warehouseId,
        OR: lines.map((line) => ({
          goods_id: BigInt(line.goodsId),
          sku_id: BigInt(line.skuId),
          batch_no: String(line.batchNo ?? ''),
        })),
      },
    });
    return lines.map((line) => {
      const goodsId = BigInt(line.goodsId);
      const skuId = BigInt(line.skuId);
      const batchNo = String(line.batchNo ?? '');
      const lineKey = `${goodsId}:${skuId}:${batchNo}`;
      if (seen.has(lineKey)) throw new BadRequestException('同一商品、SKU和批次不能重复录入');
      seen.add(lineKey);
      const stock = stocks.find(
        (candidate) =>
          candidate.goods_id === goodsId &&
          candidate.sku_id === skuId &&
          candidate.batch_no === batchNo,
      );
      if (!stock) throw new BadRequestException(`批次 ${batchNo || '无批号'} 不属于所选组织和仓库`);
      const quantity = Number(line.quantity);
      if (!Number.isSafeInteger(quantity) || quantity <= 0)
        throw new BadRequestException('明细数量必须为正整数');
      if (requiresAvailable && quantity > Number(stock.inventory_qty))
        throw new BadRequestException(`批次 ${batchNo || '无批号'} 处理数量超过当前库存`);
      const unitCost = Number(stock.inventory_qty)
        ? Number(stock.inventory_amount) / Number(stock.inventory_qty)
        : 0;
      const amount = quantity * unitCost;
      if (!Number.isFinite(amount) || amount < 0)
        throw new BadRequestException('明细金额不能为负数');
      return { goodsId, skuId, batchNo, unitType: stock.unit_type, quantity, amount };
    });
  }

  private async ensureOverflowPostedBeforeDamage(item: Body, tx: Prisma.TransactionClient) {
    const sourceCheckId = BigInt(item.sourceCheckId ?? 0);
    if (sourceCheckId <= 0n) return;
    const positiveSourceLine = await tx.hspsi_inventory_check_detail.findFirst({
      where: {
        check_id: sourceCheckId,
        different_qty: { gt: 0 },
        OR: item.details.map((line: Body) => ({
          goods_id: BigInt(line.goodsId),
          sku_id: BigInt(line.skuId),
          batch_no: String(line.batchNo ?? ''),
        })),
      },
      select: { check_detail_id: true },
    });
    if (!positiveSourceLine) return;
    const overflow = await tx.hspsi_inventory_overflow.findFirst({
      where: { source_check_id: sourceCheckId, deleted_at: null },
      select: { approve_status: true, input_status: true },
    });
    if (!overflow || Number(overflow.approve_status) !== 1 || Number(overflow.input_status) !== 1) {
      throw new BadRequestException('报损包含盘盈批次，请先审批并完成关联报盈入库，再处理报损');
    }
  }

  private async lockDraftDocumentHeader(
    tx: Prisma.TransactionClient,
    type: 'loss' | 'loss-output' | 'overflow',
    documentId: bigint,
    stateMessage: string,
  ) {
    const tableName =
      type === 'loss'
        ? Prisma.raw('hspsi_inventory_loss')
        : type === 'loss-output'
          ? Prisma.raw('hspsi_inventory_loss_output')
          : Prisma.raw('hspsi_inventory_overflow');
    const keyName = type === 'overflow' ? Prisma.raw('overflow_id') : Prisma.raw('loss_id');
    await tx.$queryRaw`SELECT ${keyName} FROM ${tableName} WHERE ${keyName}=${documentId} FOR UPDATE`;
    const header =
      type === 'loss'
        ? await tx.hspsi_inventory_loss.findUnique({ where: { loss_id: documentId } })
        : type === 'loss-output'
          ? await tx.hspsi_inventory_loss_output.findUnique({ where: { loss_id: documentId } })
          : await tx.hspsi_inventory_overflow.findUnique({ where: { overflow_id: documentId } });
    if (!header || header.deleted_at) throw new NotFoundException('库存单据不存在');
    if (Number(header.status) !== 0 || Number(header.approve_status) !== 0) {
      throw new BadRequestException(stateMessage);
    }
    return header;
  }

  async saveDocument(
    type: 'loss' | 'loss-output' | 'overflow',
    id: string | null,
    body: Body,
    userId: string,
    submit: boolean,
  ) {
    if (type === 'loss-output') throw new BadRequestException('报亏出库单必须从已审批报亏单生成');
    if (type === 'overflow')
      this.rejectIndependentInventoryDocument('报盈入库单只能由库存盘点生成，不允许独立新增或编辑');
    const inputLines = this.lines(body.details);
    const old = id ? await this.document(type, id) : null;
    if (type === 'loss' && Number(old?.businessKind ?? body.businessKind ?? 2) !== 2) {
      throw new BadRequestException('报亏只能由库存盘点生成，当前入口仅允许新增报损出库单');
    }
    if (old && (Number(old.status) !== 0 || Number(old.approveStatus) !== 0))
      throw new BadRequestException('仅草稿单据可编辑');
    const orgId = BigInt(body.orgId);
    const warehouseId = BigInt(body.warehouseId);
    const generatedDamage =
      type === 'loss' &&
      !!old &&
      BigInt(old.sourceCheckId ?? 0) > 0n &&
      Number(old.businessKind) === 2;
    // 来源盘点可能同时盘盈且损坏；报损草稿保存时不以尚未入账的当前库存阻断，
    // 明细真实性由下方 sourceCheckId + damaged_qty 的严格比对保证。
    const lines = await this.normalizeInventoryDocumentLines(
      orgId,
      warehouseId,
      inputLines,
      type === 'loss' && !generatedDamage,
    );
    await this.masterData.assertGoodsLines(
      orgId,
      warehouseId,
      lines.map((line) => ({ goodsId: line.goodsId, skuId: line.skuId })),
    );
    const quantity = lines.reduce((sum, line) => sum + line.quantity, 0);
    const amount = lines.reduce((sum, line) => sum + line.amount, 0);
    const sourceCheckId = BigInt(body.sourceCheckId ?? old?.sourceCheckId ?? 0);
    const businessKind = type === 'loss' ? Number(body.businessKind ?? old?.businessKind ?? 2) : 0;
    if (type === 'loss' && ![1, 2].includes(businessKind))
      throw new BadRequestException('报亏/报损业务类别无效');
    if (old?.sourceCheckId && Number(old.businessKind) !== businessKind)
      throw new BadRequestException('盘点生成单据不允许改变业务类别');
    if (generatedDamage) {
      const originalSourceCheckId = BigInt(old.sourceCheckId);
      if (sourceCheckId !== originalSourceCheckId)
        throw new BadRequestException('盘点生成的报损单不允许改变来源盘点');
      const sourceCheck = await this.prisma.hspsi_inventory_check.findFirst({
        where: { check_id: originalSourceCheckId, deleted_at: null },
        select: { org_id: true, warehouse_id: true },
      });
      if (!sourceCheck) throw new BadRequestException('来源盘点单不存在');
      if (sourceCheck.org_id !== orgId || sourceCheck.warehouse_id !== warehouseId) {
        throw new BadRequestException('盘点生成的报损单不允许改变组织或仓库');
      }
      assertGeneratedDamageLinesUnchanged(
        (old.details ?? []).map((line: Body) => ({
          goodsId: BigInt(line.goodsId),
          skuId: BigInt(line.skuId),
          batchNo: String(line.batchNo ?? ''),
          unitType: Number(line.unitType),
          quantity: Number(line.quantity),
          amount: Number(line.amount),
        })),
        lines,
      );
    }
    const goWhereInput = body.goWhere !== undefined ? body.goWhere : old?.goWhere;
    const goWhere =
      type === 'loss' && businessKind === 2 ? parseInventoryLossDisposal(goWhereInput, submit) : -1;
    const purchaseSourceIds = lines.map((_, index) =>
      BigInt(
        inputLines[index]?.sourceReceiptDetailId ??
          inputLines[index]?.source_receipt_detail_id ??
          0,
      ),
    );
    if (type === 'loss' && businessKind === 2 && goWhere === 2) {
      if (purchaseSourceIds.some((sourceId) => sourceId <= 0n)) {
        throw new BadRequestException('退货报损的每条明细都必须选择原采购入库来源');
      }
      const sourceDetails = await this.prisma.hspsi_purchase_order_input_detail.findMany({
        where: { id: { in: purchaseSourceIds }, deleted_at: null },
      });
      const sourceReceipts = await this.prisma.hspsi_purchase_order_input.findMany({
        where: {
          po_input_id: { in: sourceDetails.map((source) => source.po_input_id) },
          org_id: orgId,
          warehouse_id: warehouseId,
          comfirm_status: 1,
          deleted_at: null,
        },
      });
      const receiptIds = new Set(sourceReceipts.map((receipt) => String(receipt.po_input_id)));
      lines.forEach((line, index) => {
        const source = sourceDetails.find((detail) => detail.id === purchaseSourceIds[index]);
        if (
          !source ||
          !receiptIds.has(String(source.po_input_id)) ||
          source.goods_id !== line.goodsId ||
          source.sku_id !== line.skuId ||
          source.batch_no !== line.batchNo
        ) {
          throw new BadRequestException('所选采购入库来源与报损商品、SKU、批号或仓库不一致');
        }
        if (line.quantity > Number(source.input_qty)) {
          throw new BadRequestException('报损退货数量不能超过所选采购入库明细数量');
        }
      });
    }
    if (!String(body.reason ?? '').trim()) throw new BadRequestException('请填写单据原因');
    const data: Body = {
      org_id: orgId,
      warehouse_id: warehouseId,
      dept_id: BigInt(body.deptId ?? 0),
      status: submit ? 1 : 0,
      approve_status: 0,
      approve_comment: '',
      remark: String(body.remark ?? ''),
      updated_by: BigInt(userId),
    };
    if (type === 'overflow') {
      Object.assign(data, {
        overflow_type: Number(body.documentType || 1),
        overflow_reson: String(body.reason),
        overflow_date: new Date(body.date ?? Date.now()),
        overflow_qty: quantity,
        overflow_total_amount: this.dec(amount),
        source_check_id: sourceCheckId,
      });
    } else {
      Object.assign(data, {
        business_kind: businessKind,
        loss_type: Number(body.documentType || 1),
        loss_reson: String(body.reason),
        loss_date: new Date(body.date ?? Date.now()),
        loss_qty: quantity,
        loss_total_amount: this.dec(amount),
        go_where: businessKind === 1 ? -1 : goWhere,
        source_check_id: sourceCheckId,
      });
    }
    const recordId = await this.prisma.$transaction(async (tx) => {
      if (id) {
        await this.lockDraftDocumentHeader(tx, type, BigInt(id), '仅草稿单据可编辑');
      }
      if (!id && sourceCheckId > 0n) {
        const duplicate =
          type === 'loss'
            ? await tx.hspsi_inventory_loss.findFirst({
                where: {
                  source_check_id: sourceCheckId,
                  business_kind: businessKind,
                  deleted_at: null,
                },
              })
            : await tx.hspsi_inventory_overflow.findFirst({
                where: { source_check_id: sourceCheckId, deleted_at: null },
              });
        if (duplicate) throw new BadRequestException('该盘点单已经生成同类差异单据');
      }
      const newBusinessNo = id
        ? ''
        : await this.businessNumber.generate(
            type === 'overflow'
              ? BUSINESS_PREFIX.INVENTORY_OVERFLOW_INPUT
              : businessKind === 1
                ? BUSINESS_PREFIX.INVENTORY_SHORTAGE
                : BUSINESS_PREFIX.INVENTORY_DAMAGE_OUTPUT,
          );
      const header =
        type === 'loss'
          ? id
            ? await tx.hspsi_inventory_loss.update({ where: { loss_id: BigInt(id) }, data })
            : await tx.hspsi_inventory_loss.create({
                data: {
                  ...data,
                  loss_no: newBusinessNo,
                  created_by: BigInt(userId),
                  created_at: new Date(),
                },
              })
          : id
            ? await tx.hspsi_inventory_overflow.update({ where: { overflow_id: BigInt(id) }, data })
            : await tx.hspsi_inventory_overflow.create({
                data: {
                  ...data,
                  overflow_no: newBusinessNo,
                  created_by: BigInt(userId),
                  created_at: new Date(),
                },
              });
      const recordKey = type === 'loss' ? (header as Body).loss_id : (header as Body).overflow_id;
      if (!id) {
        if (sourceCheckId > 0n) {
          const sourceCheck = await tx.hspsi_inventory_check.findUnique({
            where: { check_id: sourceCheckId },
          });
          if (sourceCheck) {
            await this.documentTrace.link(
              {
                upstreamType: 'inventory_check',
                upstreamId: sourceCheckId,
                upstreamNo: sourceCheck.check_no,
                downstreamType:
                  type === 'overflow'
                    ? 'inventory_overflow'
                    : businessKind === 1
                      ? 'inventory_shortage'
                      : 'inventory_loss',
                downstreamId: recordKey,
                downstreamNo: newBusinessNo,
                relationKind: 'generated',
                createdBy: userId,
              },
              tx,
            );
          }
        }
      }
      if (type === 'loss') {
        await tx.hspsi_inventory_loss_detail.deleteMany({ where: { loss_id: recordKey } });
        await tx.hspsi_inventory_loss_detail.createMany({
          data: lines.map((line, index) => ({
            loss_id: recordKey,
            goods_id: line.goodsId,
            sku_id: line.skuId,
            batch_no: line.batchNo,
            unit_type: line.unitType,
            loss_qty: Number(line.quantity),
            loss_amount: this.dec(line.amount),
            source_receipt_detail_id: goWhere === 2 ? purchaseSourceIds[index] : 0n,
          })),
        });
      } else {
        await tx.hspsi_inventory_overflow_detail.deleteMany({ where: { overflow_id: recordKey } });
        await tx.hspsi_inventory_overflow_detail.createMany({
          data: lines.map((line) => ({
            overflow_id: recordKey,
            goods_id: line.goodsId,
            sku_id: line.skuId,
            batch_no: line.batchNo,
            unit_type: line.unitType,
            overflow_qty: Number(line.quantity),
            overflow_amount: this.dec(line.amount),
          })),
        });
      }
      return recordKey as bigint;
    });
    return { id: recordId, message: submit ? '单据已提交' : '草稿已保存' };
  }

  async submitDocument(type: 'loss' | 'overflow', id: string) {
    if (type === 'overflow')
      throw new BadRequestException('报盈入库单由盘点自动提交，不允许手工提交');
    const documentId = BigInt(id);
    await this.prisma.$transaction(async (tx) => {
      const item = await this.lockDraftDocumentHeader(tx, type, documentId, '仅草稿单据可提交');
      if (type === 'loss' && Number((item as Body).business_kind) === 2) {
        parseInventoryLossDisposal((item as Body).go_where, true);
      }
      if (type === 'loss')
        await tx.hspsi_inventory_loss.update({
          where: { loss_id: documentId },
          data: { status: 1, approve_status: 0 },
        });
      else
        await tx.hspsi_inventory_overflow.update({
          where: { overflow_id: documentId },
          data: { status: 1, approve_status: 0 },
        });
    });
    return { id, message: '已提交审批' };
  }

  async approvedLossOptions() {
    return [];
  }

  async saveLossOutput(id: string | null, body: Body, userId: string) {
    this.rejectIndependentInventoryDocument('报亏出库单只能由库存盘点生成，不允许独立新增或编辑');
    const recordId = await this.prisma.$transaction(async (tx) => {
      const outputId = id ? BigInt(id) : null;
      const old = outputId
        ? await this.lockDraftDocumentHeader(
            tx,
            'loss-output',
            outputId,
            '仅未确认报亏出库单可编辑',
          )
        : null;
      const storedSourceId = old ? BigInt((old as Body).source_loss_id ?? 0) : 0n;
      const sourceId = BigInt(body.sourceLossId ?? storedSourceId);
      if (old && sourceId !== storedSourceId) {
        throw new BadRequestException('报亏出库单创建后不允许更换来源报亏单');
      }
      if (sourceId <= 0n) throw new BadRequestException('请选择已审批来源报亏单');

      // 来源报亏单是同一来源只能生成一张有效出库单的串行化锁。
      // 新建时它是事务内取得的第一把行锁，保证随后 duplicate 检查不会并发穿透。
      await tx.$queryRaw`SELECT loss_id FROM hspsi_inventory_loss WHERE loss_id=${sourceId} FOR UPDATE`;
      const source = await tx.hspsi_inventory_loss.findUnique({ where: { loss_id: sourceId } });
      if (!source || source.deleted_at) throw new NotFoundException('库存单据不存在');
      if (Number(source.business_kind) !== 1)
        throw new BadRequestException('报损出库单不能再生成报亏出库，避免重复扣减库存');
      if (Number(source.approve_status) !== 1)
        throw new BadRequestException('来源报亏单尚未审批通过');
      const duplicate = await tx.hspsi_inventory_loss_output.findFirst({
        where: {
          source_loss_id: sourceId,
          deleted_at: null,
          ...(outputId ? { loss_id: { not: outputId } } : {}),
        },
      });
      if (duplicate) throw new BadRequestException('该报亏单已经生成报亏出库单，请勿重复生成');
      const sourceDetails = await tx.hspsi_inventory_loss_detail.findMany({
        where: { loss_id: sourceId },
      });
      const data = {
        loss_type: Number(body.documentType ?? source.loss_type ?? 1),
        loss_reson: String(body.reason ?? source.loss_reson),
        org_id: source.org_id,
        warehouse_id: source.warehouse_id,
        dept_id: source.dept_id,
        loss_date: new Date(body.date ?? Date.now()),
        source_loss_id: sourceId,
        source_check_id: BigInt(source.source_check_id ?? 0),
        loss_qty: sourceDetails.reduce((sum, line) => sum + Number(line.loss_qty), 0),
        loss_total_amount: this.dec(
          sourceDetails.reduce((sum, line) => sum + Number(line.loss_amount), 0),
        ),
        status: 0,
        approve_status: 0,
        approve_comment: '',
        remark: String(body.remark ?? ''),
        updated_by: BigInt(userId),
      };
      const newOutputNo = outputId
        ? ''
        : await this.businessNumber.generate(BUSINESS_PREFIX.INVENTORY_SHORTAGE_OUTPUT);
      const header = outputId
        ? await tx.hspsi_inventory_loss_output.update({ where: { loss_id: outputId }, data })
        : await tx.hspsi_inventory_loss_output.create({
            data: { ...data, loss_no: newOutputNo, created_by: BigInt(userId) },
          });
      const outputNo = header.loss_no;
      await tx.hspsi_inventory_loss_output_detail.deleteMany({
        where: { loss_id: header.loss_id },
      });
      await tx.hspsi_inventory_loss_output_detail.createMany({
        data: sourceDetails.map((line) => ({
          loss_id: header.loss_id,
          goods_id: line.goods_id,
          sku_id: line.sku_id,
          batch_no: String(line.batch_no ?? ''),
          unit_type: Number(line.unit_type),
          loss_qty: line.loss_qty,
          loss_amount: line.loss_amount,
        })),
      });
      await this.documentTrace.link(
        {
          upstreamType: 'inventory_shortage',
          upstreamId: sourceId,
          upstreamNo: source.loss_no,
          downstreamType: 'inventory_loss_output',
          downstreamId: header.loss_id,
          downstreamNo: outputNo,
          relationKind: 'generated',
          createdBy: userId,
        },
        tx,
      );
      return header.loss_id;
    });
    return { id: recordId, message: '报亏出库单已按来源报亏单生成' };
  }

  async approveLossOutput(
    id: string,
    approved: boolean,
    comment: string,
    userId: string,
    fromOa = false,
  ) {
    const documentId = BigInt(id);
    if (!fromOa)
      await this.assertNoActiveOa(
        'inventory_loss_output',
        documentId,
        '该盘亏出库单正在OA审批，不能在本系统审批',
      );
    let inventoryPosted = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT loss_id FROM hspsi_inventory_loss_output WHERE loss_id=${documentId} FOR UPDATE`;
      const output = await tx.hspsi_inventory_loss_output.findUnique({
        where: { loss_id: documentId },
      });
      if (!output || output.deleted_at) throw new NotFoundException('报亏出库单不存在');
      // 新单据统一为 status=1；status=0 仅兼容改造前盘点已经生成但尚未确认的历史记录。
      if (![0, 1].includes(Number(output.status)) || Number(output.approve_status) !== 0) {
        throw new BadRequestException('仅待审批报亏出库单可操作');
      }
      if (!approved) {
        await tx.hspsi_inventory_loss_output.update({
          where: { loss_id: documentId },
          data: {
            status: 1,
            approve_status: 2,
            approve_comment: comment,
            approve_by: BigInt(userId),
            approve_date: new Date(),
            updated_by: BigInt(userId),
          },
        });
        return;
      }
      const sourceId = BigInt(output.source_loss_id ?? 0);
      const sourceCheckId = BigInt(output.source_check_id ?? 0);
      let source: Body | null = null;
      let sourceCheck: Body | null = null;
      if (sourceId > 0n) {
        // 兼容改造前已经生成的“报亏单→报亏出库单”历史链路。
        await tx.$queryRaw`SELECT loss_id FROM hspsi_inventory_loss WHERE loss_id=${sourceId} FOR UPDATE`;
        source = await tx.hspsi_inventory_loss.findUnique({ where: { loss_id: sourceId } });
        if (!source || source.deleted_at) throw new NotFoundException('来源报亏单不存在');
        if (Number(source.business_kind) !== 1)
          throw new BadRequestException('来源不是报亏单，禁止出库');
        if (Number(source.approve_status) !== 1)
          throw new BadRequestException('来源报亏单尚未审批通过');
      } else {
        if (sourceCheckId <= 0n) throw new BadRequestException('报亏出库单必须来源于库存盘点');
        await tx.$queryRaw`SELECT check_id FROM hspsi_inventory_check WHERE check_id=${sourceCheckId} FOR UPDATE`;
        sourceCheck = await tx.hspsi_inventory_check.findUnique({
          where: { check_id: sourceCheckId },
        });
        if (!sourceCheck || sourceCheck.deleted_at) throw new NotFoundException('来源盘点单不存在');
        if (Number(sourceCheck.approve_status) !== 1)
          throw new BadRequestException('来源盘点单尚未审批通过');
      }
      const details = await tx.hspsi_inventory_loss_output_detail.findMany({
        where: { loss_id: documentId },
      });
      const duplicated = await tx.hspsi_inventory_loss_output.findFirst({
        where: {
          ...(sourceId > 0n ? { source_loss_id: sourceId } : { source_check_id: sourceCheckId }),
          approve_status: 1,
          deleted_at: null,
          loss_id: { not: documentId },
        },
      });
      if (duplicated) throw new BadRequestException('该来源盘亏已经确认过报亏出库');
      await this.posting.post(
        {
          orgId: output.org_id,
          warehouseId: output.warehouse_id,
          direction: -1,
          operationType: 2,
          inventoryMode: INVENTORY_BUSINESS_MODE.SHORTAGE_OUTPUT,
          sourceId: documentId,
          sourceType: 'inventory_loss_output',
          sourceNo: output.loss_no,
          operationBy: userId,
          idempotencyKey: `loss-output:${id}:confirm`,
          remark: output.loss_reson,
          lines: details.map((line) => ({
            goodsId: line.goods_id,
            skuId: line.sku_id,
            batchNo: line.batch_no,
            unitType: line.unit_type,
            quantity: String(line.loss_qty),
            amount: String(line.loss_amount),
          })),
        },
        tx,
      );
      inventoryPosted = true;
      await this.documentTrace.link(
        {
          upstreamType: sourceId > 0n ? 'inventory_shortage' : 'inventory_check',
          upstreamId: sourceId > 0n ? sourceId : sourceCheckId,
          upstreamNo: sourceId > 0n ? source!.loss_no : sourceCheck!.check_no,
          downstreamType: 'inventory_loss_output',
          downstreamId: documentId,
          downstreamNo: output.loss_no,
          relationKind: 'generated',
          createdBy: userId,
        },
        tx,
      );
      await tx.hspsi_inventory_loss_output.update({
        where: { loss_id: documentId },
        data: {
          status: 1,
          approve_status: 1,
          approve_comment: comment,
          approve_by: BigInt(userId),
          approve_date: new Date(),
          updated_by: BigInt(userId),
        },
      });
      const progressCheckId =
        sourceCheckId > 0n ? sourceCheckId : BigInt(source?.source_check_id ?? 0);
      if (progressCheckId > 0n) {
        await tx.hspsi_inventory_check.update({
          where: { check_id: progressCheckId },
          data: { less_process_qty: output.loss_qty, less_process_value: output.loss_total_amount },
        });
      }
    });
    return {
      id,
      inventoryPosted,
      message: approved
        ? '报亏出库审核通过，库存已按全部来源批次一次性扣减'
        : '报亏出库审核未通过，库存未变动',
    };
  }

  /** 兼容历史客户端；新界面统一使用 approve 接口。 */
  confirmLossOutput(id: string, comment: string, userId: string) {
    return this.approveLossOutput(id, true, comment, userId);
  }

  async removeDocument(type: 'loss' | 'loss-output' | 'overflow', id: string, userId: string) {
    const documentId = BigInt(id);
    await this.prisma.$transaction(async (tx) => {
      const item = await this.lockDraftDocumentHeader(tx, type, documentId, '仅草稿单据可删除');
      if (
        type === 'loss-output' ||
        type === 'overflow' ||
        (type === 'loss' && Number((item as Body).business_kind) === 1)
      ) {
        throw new BadRequestException('盘点衍生的报亏和报盈单据不允许删除');
      }
      if (
        type === 'loss' &&
        Number((item as Body).business_kind) === 2 &&
        BigInt((item as Body).source_check_id ?? 0) > 0n
      ) {
        throw new BadRequestException('盘点生成的报损出库单不能删除，请编辑处置方式后继续处理');
      }
      if (type === 'loss')
        await tx.hspsi_inventory_loss.update({
          where: { loss_id: documentId },
          data: { deleted_at: new Date(), updated_by: BigInt(userId) },
        });
      else if (type === 'loss-output')
        await tx.hspsi_inventory_loss_output.update({
          where: { loss_id: documentId },
          data: { deleted_at: new Date(), updated_by: BigInt(userId) },
        });
      else
        await tx.hspsi_inventory_overflow.update({
          where: { overflow_id: documentId },
          data: { deleted_at: new Date(), updated_by: BigInt(userId) },
        });
      await this.documentTrace.removeForDocument(
        type === 'loss'
          ? Number((item as Body).business_kind) === 1
            ? 'inventory_shortage'
            : 'inventory_loss'
          : type === 'loss-output'
            ? 'inventory_loss_output'
            : 'inventory_overflow',
        id,
        tx,
      );
    });
    return { id, message: '删除成功' };
  }

  async approveDocument(
    type: 'loss' | 'loss-output' | 'overflow',
    id: string,
    approved: boolean,
    comment: string,
    userId: string,
    fromOa = false,
  ) {
    if (type === 'loss-output') throw new BadRequestException('报亏出库请使用确认出库操作');
    const item: Body = await this.document(type, id);
    if (Number(item.status) !== 1 || Number(item.approveStatus) !== 0)
      throw new BadRequestException('仅待审批单据可操作');
    if (!fromOa)
      await this.assertNoActiveOa(
        type === 'loss' ? 'inventory_loss' : 'inventory_overflow',
        BigInt(id),
        '该库存单据正在OA审批，不能在本系统审批',
      );
    const businessKind = type === 'loss' ? Number(item.businessKind) : 0;
    if (type === 'loss' && businessKind !== 2)
      throw new BadRequestException('中间报亏单已停用，报亏出库只能由库存盘点直接生成');
    if (type === 'overflow' && BigInt(item.sourceCheckId ?? 0) <= 0n) {
      throw new BadRequestException('报盈入库单必须来源于库存盘点，历史非盘点记录仅供查看');
    }
    let damageDisposal: -1 | 0 | 1 | 2 = -1;
    let discountOrderId: bigint | null = null;
    const purchaseReturnIds: bigint[] = [];
    let lossOutputId: bigint | null = null;
    let overflowInputNo: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      const tableName =
        type === 'loss'
          ? Prisma.raw('hspsi_inventory_loss')
          : Prisma.raw('hspsi_inventory_overflow');
      const keyName = type === 'loss' ? Prisma.raw('loss_id') : Prisma.raw('overflow_id');
      await tx.$queryRaw`SELECT ${keyName} FROM ${tableName} WHERE ${keyName}=${BigInt(id)} FOR UPDATE`;
      const locked =
        type === 'loss'
          ? await tx.hspsi_inventory_loss.findUniqueOrThrow({ where: { loss_id: BigInt(id) } })
          : await tx.hspsi_inventory_overflow.findUniqueOrThrow({
              where: { overflow_id: BigInt(id) },
            });
      if (Number(locked.status) !== 1 || Number(locked.approve_status) !== 0)
        throw new BadRequestException('该单据已经处理，请勿重复审批');
      if (approved && type === 'loss' && businessKind === 2) {
        // 锁行后以数据库原值做最终校验，禁止空值、-1 或隐式数值转换落入报废分支。
        damageDisposal = parseInventoryLossDisposal((locked as Body).go_where, true);
        // 盘盈新增的实物必须先入账，随后报废或折价出库才有完整、可过账的批次数量。
        await this.ensureOverflowPostedBeforeDamage(item, tx);
      }

      if (approved && type === 'loss' && businessKind === 1) {
        const existing = await tx.hspsi_inventory_loss_output.findFirst({
          where: { source_loss_id: BigInt(id), deleted_at: null },
        });
        if (existing) throw new BadRequestException('该报亏单已经生成报亏出库单');
        const outputNo = await this.businessNumber.generate(
          BUSINESS_PREFIX.INVENTORY_SHORTAGE_OUTPUT,
        );
        const output = await tx.hspsi_inventory_loss_output.create({
          data: {
            loss_no: outputNo,
            loss_type: Number(item.documentType || 1),
            loss_reson: item.reason,
            org_id: item.org_id,
            warehouse_id: item.warehouse_id,
            dept_id: item.dept_id,
            loss_date: new Date(),
            source_loss_id: BigInt(id),
            source_check_id: BigInt(item.sourceCheckId ?? 0),
            loss_qty: item.loss_qty,
            loss_total_amount: item.loss_total_amount,
            status: 1,
            approve_status: 1,
            approve_comment: comment,
            approve_by: BigInt(userId),
            approve_date: new Date(),
            remark: `报亏单 ${item.businessNo} 审批自动生成并确认`,
            created_by: BigInt(userId),
            updated_by: BigInt(userId),
          },
        });
        await tx.hspsi_inventory_loss_output_detail.createMany({
          data: item.details.map((line: Body) => ({
            loss_id: output.loss_id,
            goods_id: BigInt(line.goodsId),
            sku_id: BigInt(line.skuId),
            batch_no: String(line.batchNo ?? ''),
            unit_type: Number(line.unitType),
            loss_qty: Number(line.quantity),
            loss_amount: this.dec(line.amount),
          })),
        });
        await this.posting.post(
          {
            orgId: item.org_id,
            warehouseId: item.warehouse_id,
            direction: -1,
            operationType: 2,
            inventoryMode: INVENTORY_BUSINESS_MODE.SHORTAGE_OUTPUT,
            sourceId: output.loss_id,
            sourceType: 'inventory_loss_output',
            sourceNo: outputNo,
            operationBy: userId,
            idempotencyKey: `loss-output:${output.loss_id}:confirm`,
            remark: `来源报亏单 ${item.businessNo}`,
            lines: item.details.map((line: Body) => ({
              goodsId: line.goodsId,
              skuId: line.skuId,
              batchNo: line.batchNo,
              unitType: line.unitType,
              quantity: String(line.quantity),
              amount: String(line.amount),
            })),
          },
          tx,
        );
        await this.documentTrace.link(
          {
            upstreamType: 'inventory_shortage',
            upstreamId: item.id,
            upstreamNo: item.businessNo,
            downstreamType: 'inventory_loss_output',
            downstreamId: output.loss_id,
            downstreamNo: outputNo,
            relationKind: 'generated',
            createdBy: userId,
          },
          tx,
        );
        lossOutputId = output.loss_id;
        if (BigInt(item.sourceCheckId ?? 0) > 0n) {
          await tx.hspsi_inventory_check.update({
            where: { check_id: BigInt(item.sourceCheckId) },
            data: { less_process_qty: item.loss_qty, less_process_value: item.loss_total_amount },
          });
        }
      }

      if (approved && type === 'loss' && businessKind === 2 && damageDisposal === 0) {
        await this.posting.post(
          {
            orgId: item.org_id,
            warehouseId: item.warehouse_id,
            direction: -1,
            operationType: 2,
            inventoryMode: INVENTORY_BUSINESS_MODE.DAMAGE_SCRAP_OUTPUT,
            sourceId: item.id,
            sourceType: 'inventory_damage_scrap',
            sourceNo: item.businessNo,
            operationBy: userId,
            idempotencyKey: `damage:${id}:scrap`,
            remark: item.reason,
            lines: item.details.map((line: Body) => ({
              goodsId: line.goodsId,
              skuId: line.skuId,
              batchNo: line.batchNo,
              unitType: line.unitType,
              quantity: String(line.quantity),
              amount: String(line.amount),
            })),
          },
          tx,
        );
      }

      if (approved && type === 'loss' && businessKind === 2 && damageDisposal === 1) {
        const existing = await tx.hspsi_sale_order.findFirst({
          where: { so_property_type: 2, so_source: 4, so_source_id: BigInt(id), deleted_at: null },
        });
        if (existing) discountOrderId = existing.so_id;
        else {
          let customer = await tx.hspsi_basic_customer.findFirst({
            where: { name: '内部折价处置客户', org_id: item.org_id, deleted_at: null },
          });
          customer ??= await tx.hspsi_basic_customer.create({
            data: {
              org_id: item.org_id,
              name: '内部折价处置客户',
              gender: 0,
              mobile: '',
              address: '系统内部折价处置',
              referrer_name: '',
              referrer_mobile: '',
              source_type: 0,
              related_customer_id: 0,
              status: 1,
              remark: '系统固定折价处置客户',
              sort: 9999,
              created_by: BigInt(userId),
              updated_by: BigInt(userId),
            },
          });
          const totalQty = item.details.reduce(
            (sum: number, line: Body) => sum + Number(line.quantity),
            0,
          );
          const totalAmount = item.details.reduce(
            (sum: number, line: Body) => sum + Number(line.amount ?? 0),
            0,
          );
          const orderNo = await this.businessNumber.generate(BUSINESS_PREFIX.DISCOUNT_SALES_ORDER);
          const order = await tx.hspsi_sale_order.create({
            data: {
              org_id: item.org_id,
              warehouse_id: item.warehouse_id,
              so_no: orderNo,
              so_type: 1,
              so_source: 4,
              so_source_id: BigInt(id),
              business_source_type: 'inventory_loss',
              business_source_id: BigInt(id),
              business_source_no: item.businessNo,
              so_property_type: 2,
              customer_id: customer.customer_id,
              customer_name: customer.name.slice(0, 30),
              customer_mobile: customer.mobile,
              customer_address: customer.address.slice(0, 100),
              sales_name: '系统自动生成',
              sales_mobile: '',
              so_qty: totalQty,
              so_amount: this.dec(totalAmount),
              fact_amount: this.dec(totalAmount),
              priceoff_amount: this.dec(0),
              order_status: 1,
              delivery_status: 1,
              service_status: 3,
              shipper: '',
              status: 1,
              approve_status: 0,
              remark: `来源报损出库单 ${item.businessNo}；审批不扣库存，待生成折价销售出库单后确认扣库`,
              created_by: BigInt(userId),
              updated_by: BigInt(userId),
            },
          });
          const groupedOrderLines = new Map<
            string,
            { goodsId: bigint; skuId: bigint; unitType: number; quantity: number; amount: number }
          >();
          for (const line of item.details) {
            const goodsId = BigInt(line.goodsId);
            const skuId = BigInt(line.skuId);
            const key = `${goodsId}:${skuId}`;
            const current = groupedOrderLines.get(key) ?? {
              goodsId,
              skuId,
              unitType: Number(line.unitType),
              quantity: 0,
              amount: 0,
            };
            current.quantity += Number(line.quantity);
            current.amount += Number(line.amount ?? 0);
            groupedOrderLines.set(key, current);
          }
          await tx.hspsi_sale_order_detail.createMany({
            data: [...groupedOrderLines.values()].map((line) => {
              return {
                so_id: order.so_id,
                goods_id: BigInt(line.goodsId),
                sku_id: BigInt(line.skuId),
                unit_type: Number(line.unitType),
                sale_qty: Number(line.quantity),
                sale_price: this.dec(line.quantity ? line.amount / line.quantity : 0),
                sale_amount: this.dec(line.amount),
                fact_sale_amount: this.dec(line.amount),
              };
            }),
          });
          await this.documentTrace.link(
            {
              upstreamType: 'inventory_loss',
              upstreamId: item.id,
              upstreamNo: item.businessNo,
              downstreamType: 'discount_sale_order',
              downstreamId: order.so_id,
              downstreamNo: orderNo,
              relationKind: 'generated',
              createdBy: userId,
            },
            tx,
          );
          discountOrderId = order.so_id;
        }
      }

      if (approved && type === 'loss' && businessKind === 2 && damageDisposal === 2) {
        const lossDetails = await tx.hspsi_inventory_loss_detail.findMany({
          where: { loss_id: BigInt(id) },
          orderBy: { loss_detail_id: 'asc' },
        });
        if (
          !lossDetails.length ||
          lossDetails.some((detail) => detail.source_receipt_detail_id <= 0n)
        ) {
          throw new BadRequestException('报损退货明细缺少原采购入库来源');
        }
        const sourceDetails = await tx.hspsi_purchase_order_input_detail.findMany({
          where: {
            id: { in: lossDetails.map((detail) => detail.source_receipt_detail_id) },
            deleted_at: null,
          },
        });
        const grouped = new Map<bigint, typeof lossDetails>();
        for (const detail of lossDetails) {
          const source = sourceDetails.find(
            (sourceDetail) => sourceDetail.id === detail.source_receipt_detail_id,
          );
          if (
            !source ||
            source.goods_id !== detail.goods_id ||
            source.sku_id !== detail.sku_id ||
            source.batch_no !== detail.batch_no
          ) {
            throw new BadRequestException('报损退货的采购来源与商品、SKU或批号不一致');
          }
          const current = grouped.get(source.po_input_id) ?? [];
          current.push(detail);
          grouped.set(source.po_input_id, current);
        }
        for (const [receiptId, groupLines] of grouped) {
          const receipt = await tx.hspsi_purchase_order_input.findFirst({
            where: {
              po_input_id: receiptId,
              org_id: locked.org_id,
              warehouse_id: locked.warehouse_id,
              comfirm_status: 1,
              deleted_at: null,
            },
          });
          if (!receipt) throw new BadRequestException('原采购入库单不存在、未确认或仓库不一致');
          const generationKey = `inventory-loss-return:${id}:${receiptId}`;
          const existing = await tx.hspsi_purchase_order_input_exit.findUnique({
            where: { generation_key: generationKey },
          });
          if (existing) {
            if (existing.deleted_at) throw new BadRequestException('自动生成的采购退货单已被删除');
            purchaseReturnIds.push(existing.po_exit_id);
            continue;
          }
          const returnNo = await this.businessNumber.generate(BUSINESS_PREFIX.PURCHASE_RETURN);
          const purchaseReturn = await tx.hspsi_purchase_order_input_exit.create({
            data: {
              po_exit_no: returnNo,
              po_input_id: receipt.po_input_id,
              po_id: receipt.po_id,
              generation_key: generationKey,
              auto_created: 1,
              source_document_type: 'inventory_loss',
              source_document_id: BigInt(id),
              exit_reson: String((locked as Body).loss_reson || '报损退货'),
              exit_date: new Date(),
              exit_type: 1,
              status: false,
              approve_status: 0,
              approve_by: 0n,
              remark: `由报损出库单${(locked as Body).loss_no}自动生成；确认采购退货时执行唯一一次库存扣减`,
              created_by: BigInt(userId),
              updated_by: BigInt(userId),
              created_at: new Date(),
              updated_at: new Date(),
            },
          });
          await tx.hspsi_purchase_order_input_exit_detail.createMany({
            data: groupLines.map((detail) => {
              const source = sourceDetails.find(
                (sourceDetail) => sourceDetail.id === detail.source_receipt_detail_id,
              )!;
              return {
                po_exit_id: purchaseReturn.po_exit_id,
                po_input_id: receipt.po_input_id,
                po_id: receipt.po_id,
                goods_id: detail.goods_id,
                sku_id: detail.sku_id,
                batch_no: detail.batch_no,
                unit_type: BigInt(detail.unit_type),
                po_qty: source.po_qty,
                input_qty: source.input_qty,
                exit_qty: detail.loss_qty,
                remark: `来源报损明细${detail.loss_detail_id}`,
                created_at: new Date(),
                updated_at: new Date(),
              };
            }),
          });
          await this.documentTrace.link(
            {
              upstreamType: 'inventory_loss',
              upstreamId: BigInt(id),
              upstreamNo: (locked as Body).loss_no,
              downstreamType: 'purchase_return',
              downstreamId: purchaseReturn.po_exit_id,
              downstreamNo: returnNo,
              relationKind: 'damage_return',
              createdBy: userId,
            },
            tx,
          );
          purchaseReturnIds.push(purchaseReturn.po_exit_id);
        }
      }

      if (approved && type === 'overflow') {
        // 报盈记录本身就是入库执行单据，不再生成第二张“报盈入库单”。
        const inputNo = String(item.businessNo);
        overflowInputNo = inputNo;
        if (Number(item.inputStatus) === 1)
          throw new BadRequestException('该报盈入库单已经完成入库');
        await this.posting.post(
          {
            orgId: item.org_id,
            warehouseId: item.warehouse_id,
            direction: 1,
            operationType: 1,
            inventoryMode: INVENTORY_BUSINESS_MODE.OVERFLOW_INPUT,
            sourceId: item.id,
            sourceType: 'inventory_overflow',
            sourceNo: inputNo,
            operationBy: userId,
            idempotencyKey: `overflow:${id}:approve`,
            remark: `来源盘点 ${item.sourceCheckNo || item.sourceCheckId}`,
            lines: item.details.map((line: Body) => ({
              goodsId: line.goodsId,
              skuId: line.skuId,
              batchNo: line.batchNo,
              unitType: line.unitType,
              quantity: String(line.quantity),
              amount: String(line.amount),
            })),
          },
          tx,
        );
        if (BigInt(item.sourceCheckId ?? 0) > 0n) {
          await tx.hspsi_inventory_check.update({
            where: { check_id: BigInt(item.sourceCheckId) },
            data: {
              overflow_process_qty: item.overflow_qty,
              overflow_process_value: item.overflow_total_amount,
            },
          });
        }
      }

      if (type === 'loss') {
        await tx.hspsi_inventory_loss.update({
          where: { loss_id: BigInt(id) },
          data: {
            approve_status: approved ? 1 : 2,
            approve_comment: comment,
            approve_by: BigInt(userId),
            approve_date: new Date(),
          },
        });
      } else {
        await tx.hspsi_inventory_overflow.update({
          where: { overflow_id: BigInt(id) },
          data: {
            approve_status: approved ? 1 : 2,
            approve_comment: comment,
            approve_by: BigInt(userId),
            approve_date: new Date(),
            ...(approved
              ? {
                  input_no: overflowInputNo,
                  input_status: 1,
                  input_by: BigInt(userId),
                  input_date: new Date(),
                }
              : {}),
          },
        });
      }
    });
    const message = !approved
      ? '单据已驳回'
      : overflowInputNo
        ? `报盈入库单 ${overflowInputNo} 审批通过，库存已增加`
        : lossOutputId
          ? '报亏单审批通过，已生成并确认报亏出库单，库存已扣减'
          : discountOrderId
            ? '报损审批通过，已生成折价销售单；本次未扣库存'
            : purchaseReturnIds.length
              ? `报损审批通过，已生成${purchaseReturnIds.length}张采购退货草稿；本次未扣库存`
              : '报损审批通过，已按报废去向扣减库存';
    return { id, lossOutputId, overflowInputNo, discountOrderId, purchaseReturnIds, message };
  }

  async confirmOverflowInput(id: string, comment: string, userId: string) {
    const item = await this.document('overflow', id);
    if (Number(item.approveStatus) !== 1 || !item.inputNo)
      throw new BadRequestException('报盈单尚未审批生成报盈入库单');
    if (Number(item.inputStatus) === 1)
      return {
        id,
        inputNo: item.inputNo,
        alreadyConfirmed: true,
        message: '报盈入库单已在报盈审批时完成入库',
      };
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT overflow_id FROM hspsi_inventory_overflow WHERE overflow_id=${BigInt(id)} FOR UPDATE`;
      const locked = await tx.hspsi_inventory_overflow.findUniqueOrThrow({
        where: { overflow_id: BigInt(id) },
      });
      if (Number(locked.approve_status) !== 1 || !locked.input_no)
        throw new BadRequestException('报盈单尚未审批生成报盈入库单');
      if (Number(locked.input_status) === 1) throw new BadRequestException('该报盈入库单已经确认');
      await this.posting.post(
        {
          orgId: item.org_id,
          warehouseId: item.warehouse_id,
          direction: 1,
          operationType: 1,
          inventoryMode: INVENTORY_BUSINESS_MODE.OVERFLOW_INPUT,
          sourceId: item.id,
          sourceType: 'inventory_overflow_input',
          sourceNo: locked.input_no,
          operationBy: userId,
          idempotencyKey: `overflow-input:${id}:confirm`,
          remark: comment || `来源报盈单 ${item.businessNo}`,
          lines: item.details.map((line: Body) => ({
            goodsId: line.goodsId,
            skuId: line.skuId,
            batchNo: line.batchNo,
            unitType: line.unitType,
            quantity: String(line.quantity),
            amount: String(line.amount),
          })),
        },
        tx,
      );
      await tx.hspsi_inventory_overflow.update({
        where: { overflow_id: BigInt(id) },
        data: {
          input_status: 1,
          input_by: BigInt(userId),
          input_date: new Date(),
          updated_by: BigInt(userId),
        },
      });
      if (BigInt(item.sourceCheckId ?? 0) > 0n) {
        await tx.hspsi_inventory_check.update({
          where: { check_id: BigInt(item.sourceCheckId) },
          data: {
            overflow_process_qty: item.overflow_qty,
            overflow_process_value: item.overflow_total_amount,
          },
        });
      }
    });
    return { id, inputNo: item.inputNo, message: '报盈入库已确认，库存已按来源批次增加' };
  }

  private async quantityAlertCount(orgId?: string, warehouseId?: string) {
    const stocks = await this.prisma.hspsi_inventory_total.findMany({
      where: {
        ...(orgId ? { org_id: BigInt(orgId) } : {}),
        ...(warehouseId ? { warehouse_id: BigInt(warehouseId) } : {}),
        deleted_at: null,
      },
    });
    const warehouseIds = [...new Set(stocks.map((stock) => stock.warehouse_id))];
    const configs = warehouseIds.length
      ? await this.prisma.hspsi_inventory_alert_qty.findMany({
          where: { warehouse_id: { in: warehouseIds } },
        })
      : [];
    return stocks.filter(
      (s) =>
        Number(s.inventory_qty) <
        Number(
          configs.find(
            (c) =>
              c.warehouse_id === s.warehouse_id &&
              c.goods_id === s.goods_id &&
              c.sku_id === s.sku_id,
          )?.safe_qty ?? 0,
        ),
    ).length;
  }
  async quantityAlerts(query: Body) {
    // 仅统计/展示启用仓库（status=1）的预警项；停用仓库不计入「全部」与各仓库统计。
    // SQL 真分页：页行按派生条件 + 仓库过滤 LIMIT/OFFSET 返回；统计/摘要走 GROUP BY
    // 聚合（不带仓库过滤），保证 warehouseCounts、total、summary 不随选中仓库与页码变化，
    // 统计口径与 2026-08-31 确认口径一致：全部 = 各仓库之和 = 当前筛选下列表条数。
    const enabledWarehouseIds = (
      await this.prisma.hspsi_basic_warehouse.findMany({
        where: {
          status: 1,
          deleted_at: null,
          ...(query.orgId ? { org_id: BigInt(query.orgId) } : {}),
        },
        select: { warehouse_id: true },
      })
    ).map((warehouse) => warehouse.warehouse_id);
    const { page, pageSize } = this.page(query);
    const status = query.status == null ? '' : String(query.status).trim();
    if (!['', '0', '1'].includes(status)) throw new BadRequestException('库存状态参数无效');
    const keywordIds = await this.inventoryKeywordIds(query.keyword);
    const warehouseFilter = query.warehouseId ? String(query.warehouseId) : undefined;

    const scope = (includeWarehouse: boolean) =>
      this.quantityAlertConditions(
        enabledWarehouseIds,
        query.orgId,
        keywordIds,
        status,
        includeWarehouse ? warehouseFilter : undefined,
      );
    const join = Prisma.sql`hspsi_inventory_total s
      LEFT JOIN hspsi_inventory_alert_qty c
        ON c.warehouse_id = s.warehouse_id
       AND c.goods_id = s.goods_id
       AND c.sku_id = s.sku_id`;

    const stats = await this.prisma.$queryRaw<QuantityAlertStatRow[]>(
      Prisma.sql`
        SELECT s.warehouse_id AS warehouse_id,
               COUNT(*) AS item_count,
               COALESCE(SUM(s.inventory_amount), 0) AS total_amount,
               COALESCE(SUM(s.inventory_qty < COALESCE(c.safe_qty, 0)), 0) AS warning_count
        FROM ${join}
        WHERE ${scope(false)}
        GROUP BY s.warehouse_id
      `,
    );
    const statByWarehouse = new Map(stats.map((row) => [String(row.warehouse_id), row]));
    // 选中仓库时取该仓库统计（列表即该仓库分页），未选仓库时对全部仓库求和；行按仓库互斥，等价改动前逐行统计口径。
    const scopedStats = warehouseFilter
      ? statByWarehouse.get(warehouseFilter)
        ? [statByWarehouse.get(warehouseFilter)!]
        : []
      : stats;
    const itemCount = scopedStats.reduce((sum, row) => sum + Number(row.item_count), 0);
    const totalAmount = scopedStats.reduce((sum, row) => sum + Number(row.total_amount), 0);
    const warningCount = scopedStats.reduce((sum, row) => sum + Number(row.warning_count), 0);
    const warehouseCounts = Object.fromEntries(
      stats.map((row) => [String(row.warehouse_id), Number(row.item_count)]),
    );

    const rows = await this.prisma.$queryRaw<QuantityAlertRow[]>(
      Prisma.sql`
        SELECT s.id AS stock_id,
               c.id AS config_id,
               s.org_id AS org_id,
               s.warehouse_id AS warehouse_id,
               s.goods_id AS goods_id,
               s.sku_id AS sku_id,
               s.inventory_qty AS fact_qty,
               s.inventory_amount AS inventory_amount,
               COALESCE(c.safe_qty, 0) AS safe_qty,
               GREATEST(0, COALESCE(c.safe_qty, 0) - s.inventory_qty) AS gap_qty,
               COALESCE(
                 c.purchase_qty,
                 GREATEST(0, COALESCE(c.safe_qty, 0) - s.inventory_qty)
               ) AS purchase_qty
        FROM ${join}
        WHERE ${scope(true)}
        ORDER BY s.warehouse_id ASC, s.goods_id ASC, s.sku_id ASC, s.id ASC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `,
    );
    const refs = await this.names(
      rows.map((row) => ({
        goodsId: BigInt(String(row.goods_id)),
        skuId: BigInt(String(row.sku_id)),
        warehouseId: BigInt(String(row.warehouse_id)),
        orgId: BigInt(String(row.org_id)),
      })),
    );
    const items = rows.map((row) => {
      const goods = refs.goods.find((g) => g.goods_id === BigInt(String(row.goods_id)));
      const sku = refs.skus.find((k) => k.sku_id === BigInt(String(row.sku_id)));
      const warehouse = refs.warehouses.find(
        (w) => w.warehouse_id === BigInt(String(row.warehouse_id)),
      );
      const fact = Number(row.fact_qty),
        safe = Number(row.safe_qty);
      return {
        id: row.config_id == null ? undefined : BigInt(String(row.config_id)),
        orgId: BigInt(String(row.org_id)),
        goodsId: BigInt(String(row.goods_id)),
        goodsCode: goods?.query_code,
        goodsName: goods?.goods_name,
        skuId: BigInt(String(row.sku_id)),
        skuSpec: sku?.spec_models,
        warehouseId: BigInt(String(row.warehouse_id)),
        warehouseName: warehouse?.name,
        factQty: fact,
        safeQty: safe,
        gapQty: Number(row.gap_qty),
        purchaseQty: Number(row.purchase_qty),
        inventoryAmount: Number(row.inventory_amount),
        warning: fact < safe,
      };
    });
    return {
      items,
      total: itemCount,
      page,
      pageSize,
      warehouseCounts,
      summary: { itemCount, totalAmount, warningCount },
    };
  }
  async saveQuantityAlert(body: Body) {
    const safe = Number(body.safeQty);
    const purchase =
      body.purchaseQty === '' || body.purchaseQty == null ? undefined : Number(body.purchaseQty);
    if (!Number.isSafeInteger(safe) || safe < 0)
      throw new BadRequestException('安全库存必须是非负整数');
    if (purchase !== undefined && (!Number.isSafeInteger(purchase) || purchase < 0))
      throw new BadRequestException('建议补货数量必须是非负整数');
    const key = {
      warehouse_id_goods_id_sku_id: {
        warehouse_id: BigInt(body.warehouseId),
        goods_id: BigInt(body.goodsId),
        sku_id: BigInt(body.skuId),
      },
    };
    const stock = await this.prisma.hspsi_inventory_total.findUnique({
      where: {
        org_id_warehouse_id_goods_id_sku_id: {
          org_id: BigInt(body.orgId),
          warehouse_id: BigInt(body.warehouseId),
          goods_id: BigInt(body.goodsId),
          sku_id: BigInt(body.skuId),
        },
      },
    });
    if (!stock) throw new BadRequestException('对应组织、仓库和商品的库存记录不存在');
    const fact = Number(stock.inventory_qty),
      gap = Math.max(0, safe - fact);
    const item = await this.prisma.hspsi_inventory_alert_qty.upsert({
      where: key,
      create: {
        warehouse_id: BigInt(body.warehouseId),
        goods_id: BigInt(body.goodsId),
        sku_id: BigInt(body.skuId),
        safe_qty: safe,
        safe_less_qty: gap,
        purchase_qty: purchase ?? gap,
        fact_qty: fact,
      },
      update: { safe_qty: safe, safe_less_qty: gap, purchase_qty: purchase ?? gap, fact_qty: fact },
    });
    return { id: item.id, message: '安全库存与建议补货量已更新' };
  }
  async expiryAlerts(query: Body) {
    // 仅统计/展示启用仓库（status=1）的预警项；停用仓库不计入「全部」与各仓库统计。
    // SQL 真分页：period × batch_total 内连接确认有库存批次；页行 LIMIT/OFFSET，
    // warehouseCounts/total 走 GROUP BY 聚合（不带仓库过滤，稳定不随选中仓库/页码变化）。
    const enabledWarehouseIds = (
      await this.prisma.hspsi_basic_warehouse.findMany({
        where: {
          status: 1,
          deleted_at: null,
          ...(query.orgId ? { org_id: BigInt(query.orgId) } : {}),
        },
        select: { warehouse_id: true },
      })
    ).map((warehouse) => warehouse.warehouse_id);
    const { page, pageSize } = this.page(query);
    const keywordIds = await this.inventoryKeywordIds(query.keyword);
    const warehouseFilter = query.warehouseId ? String(query.warehouseId) : undefined;

    const scope = (includeWarehouse: boolean) =>
      this.expiryAlertConditions(
        enabledWarehouseIds,
        keywordIds,
        includeWarehouse ? warehouseFilter : undefined,
      );
    const join = Prisma.sql`hspsi_inventory_alert_period p
      JOIN hspsi_inventory_batch_total b
        ON b.goods_id = p.goods_id
       AND b.sku_id = p.sku_id
       AND b.warehouse_id = p.warehouse_id
       AND b.batch_no = p.batch_no`;

    const stats = await this.prisma.$queryRaw<ExpiryAlertStatRow[]>(
      Prisma.sql`
        SELECT p.warehouse_id AS warehouse_id, COUNT(*) AS item_count
        FROM ${join}
        WHERE ${scope(false)}
        GROUP BY p.warehouse_id
      `,
    );
    const statByWarehouse = new Map(stats.map((row) => [String(row.warehouse_id), row]));
    const warehouseCounts = Object.fromEntries(
      stats.map((row) => [String(row.warehouse_id), Number(row.item_count)]),
    );
    const total = warehouseFilter
      ? Number(statByWarehouse.get(warehouseFilter)?.item_count ?? 0)
      : stats.reduce((sum, row) => sum + Number(row.item_count), 0);

    const rows = await this.prisma.$queryRaw<ExpiryAlertRow[]>(
      Prisma.sql`
        SELECT p.id AS period_id,
               p.warehouse_id AS warehouse_id,
               p.goods_id AS goods_id,
               p.sku_id AS sku_id,
               p.batch_no AS batch_no,
               p.alter_type AS alter_type,
               p.alter_day AS alter_day,
               b.inventory_qty AS inventory_qty,
               b.inventory_amount AS inventory_amount
        FROM ${join}
        WHERE ${scope(true)}
        ORDER BY p.end_day ASC, p.id ASC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `,
    );
    const [types, refs, endDays] = await Promise.all([
      this.dictionary('expiry_alert_type'),
      this.names(
        rows.map((row) => ({
          goodsId: BigInt(String(row.goods_id)),
          skuId: BigInt(String(row.sku_id)),
          warehouseId: BigInt(String(row.warehouse_id)),
        })),
      ),
      // 仅当前页取日期：end_day 为 DATE 列，经模型读取保持与旧实现一致的 Date 语义，
      // 避免 raw 结果对剩余天数/效期状态的时区漂移。
      rows.length
        ? this.prisma.hspsi_inventory_alert_period.findMany({
            where: { id: { in: rows.map((row) => BigInt(String(row.period_id))) } },
            select: { id: true, end_day: true },
          })
        : [],
    ]);
    const endDayById = new Map(endDays.map((item) => [String(item.id), item.end_day]));
    const items = rows.map((row) => {
      const goods = refs.goods.find((g) => g.goods_id === BigInt(String(row.goods_id)));
      const sku = refs.skus.find((k) => k.sku_id === BigInt(String(row.sku_id)));
      const warehouse = refs.warehouses.find(
        (w) => w.warehouse_id === BigInt(String(row.warehouse_id)),
      );
      const endDay = endDayById.get(String(row.period_id));
      const remainingDays = endDay
        ? Math.ceil((new Date(endDay).getTime() - Date.now()) / 86400000)
        : 0;
      return {
        id: BigInt(String(row.period_id)),
        goodsId: BigInt(String(row.goods_id)),
        goodsCode: goods?.query_code,
        goodsName: goods?.goods_name,
        skuId: BigInt(String(row.sku_id)),
        skuSpec: sku?.spec_models,
        warehouseId: BigInt(String(row.warehouse_id)),
        warehouseName: warehouse?.name,
        batchNo: String(row.batch_no ?? ''),
        endDay,
        remainingDays,
        inventoryQty: Number(row.inventory_qty),
        alertQty: Number(row.inventory_qty),
        alertType: Number(row.alter_type),
        alertTypeName: types.get(String(row.alter_type)),
        alertDays: row.alter_day == null ? null : Number(row.alter_day),
        alertValue: Number(row.inventory_amount),
        expiryStatus:
          remainingDays < 0
            ? '已过期'
            : remainingDays <= Number(row.alter_day ?? 0)
              ? '临期'
              : '正常',
      };
    });
    return { items, total, page, pageSize, warehouseCounts };
  }

  /** quantityAlerts 公共 WHERE 片段（不含 WHERE 关键字），供页查询与统计查询复用 */
  private quantityAlertConditions(
    enabledWarehouseIds: bigint[],
    orgId: string | undefined,
    keywordIds: { goodsIds: bigint[]; skuIds: bigint[] } | null,
    status: string,
    warehouseId: string | undefined,
  ) {
    const parts: Prisma.Sql[] = [Prisma.sql`s.deleted_at IS NULL`];
    if (enabledWarehouseIds.length)
      parts.push(Prisma.sql`s.warehouse_id IN (${Prisma.join(enabledWarehouseIds)})`);
    else parts.push(Prisma.sql`1 = 0`);
    if (orgId) parts.push(Prisma.sql`s.org_id = ${BigInt(orgId)}`);
    if (keywordIds) {
      const matched = this.keywordIdConditions(keywordIds, 's');
      parts.push(matched ?? Prisma.sql`1 = 0`);
    }
    if (status === '1') parts.push(Prisma.sql`s.inventory_qty < COALESCE(c.safe_qty, 0)`);
    if (status === '0') parts.push(Prisma.sql`NOT (s.inventory_qty < COALESCE(c.safe_qty, 0))`);
    if (warehouseId) parts.push(Prisma.sql`s.warehouse_id = ${BigInt(warehouseId)}`);
    return Prisma.join(parts, ' AND ');
  }

  /** expiryAlerts 公共 WHERE 片段（不含 WHERE 关键字），供页查询与统计查询复用 */
  private expiryAlertConditions(
    enabledWarehouseIds: bigint[],
    keywordIds: { goodsIds: bigint[]; skuIds: bigint[] } | null,
    warehouseId: string | undefined,
  ) {
    const parts: Prisma.Sql[] = [Prisma.sql`p.end_day IS NOT NULL`];
    if (enabledWarehouseIds.length)
      parts.push(Prisma.sql`p.warehouse_id IN (${Prisma.join(enabledWarehouseIds)})`);
    else parts.push(Prisma.sql`1 = 0`);
    if (keywordIds) {
      const matched = this.keywordIdConditions(keywordIds, 'p');
      parts.push(matched ?? Prisma.sql`1 = 0`);
    }
    parts.push(Prisma.sql`b.inventory_qty > 0`);
    if (warehouseId) parts.push(Prisma.sql`p.warehouse_id = ${BigInt(warehouseId)}`);
    return Prisma.join(parts, ' AND ');
  }

  /** 关键字命中的商品/SKU id 集合 OR 片段；未命中（两表都为空）返回 null 表示无条件匹配 */
  private keywordIdConditions(
    keywordIds: { goodsIds: bigint[]; skuIds: bigint[] },
    alias: 's' | 'p',
  ) {
    const ors: Prisma.Sql[] = [];
    if (keywordIds.goodsIds.length)
      ors.push(Prisma.sql`${Prisma.raw(alias)}.goods_id IN (${Prisma.join(keywordIds.goodsIds)})`);
    if (keywordIds.skuIds.length)
      ors.push(Prisma.sql`${Prisma.raw(alias)}.sku_id IN (${Prisma.join(keywordIds.skuIds)})`);
    if (!ors.length) return null;
    return ors.length === 1 ? ors[0] : Prisma.sql`(${Prisma.join(ors, ' OR ')})`;
  }
}
