import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BUSINESS_PREFIX } from '../business-number/business-number.constants';
import { BusinessNumberService } from '../business-number/business-number.service';
import { generateBatchNo } from '../common/batch-number';
import { PrismaService } from '../database/prisma.service';
import { INVENTORY_BUSINESS_MODE } from './inventory-dictionary';
import { InventoryPostingService } from './inventory-posting.service';
import { BusinessMasterDataService } from '../database/business-master-data.service';

type Body = Record<string, any>;
type Direction = 1 | -1;

const INITIAL_INPUT_SWITCH = 'initial_input.enabled';
const INPUT_TYPES = new Set(['initial', 'entrusted_purchase']);
const OUTPUT_TYPES = new Set(['direct_output']);

@Injectable()
export class InventoryGeneralService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InventoryPostingService) private readonly posting: InventoryPostingService,
    @Inject(BusinessNumberService) private readonly businessNumber: BusinessNumberService,
    @Inject(BusinessMasterDataService) private readonly masterData: BusinessMasterDataService,
  ) {}

  private positiveInteger(value: unknown, label: string) {
    const result = Number(value);
    if (!Number.isSafeInteger(result) || result <= 0)
      throw new BadRequestException(`${label}必须为正整数`);
    return result;
  }

  private money(value: unknown, label: string) {
    const result = Number(value ?? 0);
    if (!Number.isFinite(result) || result < 0)
      throw new BadRequestException(`${label}必须为非负数`);
    return result;
  }

  private identifier(value: unknown, label: string, allowZero = false) {
    try {
      const result = BigInt(String(value ?? 0));
      if (allowZero ? result < 0n : result <= 0n) throw new Error('out of range');
      return result;
    } catch {
      throw new BadRequestException(`${label}${allowZero ? '不能为负数' : '必填且必须有效'}`);
    }
  }

  async featureConfig() {
    const item = await this.prisma.hspsi_inventory_feature_config.findUnique({
      where: { config_key: INITIAL_INPUT_SWITCH },
    });
    return { initialInputEnabled: Number(item?.enabled ?? 0) === 1 };
  }

  async productOptions(orgIdValue: unknown, warehouseIdValue: unknown) {
    if (!orgIdValue || !warehouseIdValue) return [];
    const orgId = this.identifier(orgIdValue, '组织');
    const warehouseId = this.identifier(warehouseIdValue, '仓库');
    const mappedOptions = await this.masterData.goodsOptions(orgId, warehouseId);
    if (!mappedOptions.length) return [];
    const mappedGoodsIds = mappedOptions.map((item) => item.goodsId);
    const goods = await this.prisma.hspsi_goods_info.findMany({
      where: { goods_id: { in: mappedGoodsIds }, status: 1, deleted_at: null },
    });
    const skus = await this.prisma.hspsi_goods_info_sku.findMany({
      where: {
        good_id: { in: goods.map((item) => item.goods_id) },
        status: 1,
        deleted_at: null,
      },
      orderBy: [{ sort: 'asc' }, { sku_id: 'asc' }],
    });
    const unitIds = [
      ...new Set(
        [...goods.map((item) => item.unit_type), ...skus.map((item) => item.unit_type)]
          .filter((id) => id > 0)
          .map((id) => BigInt(id)),
      ),
    ];
    const units = await this.prisma.hspsi_basic_unit.findMany({ where: { id: { in: unitIds } } });
    return skus.map((sku) => {
      const item = goods.find((goodsItem) => goodsItem.goods_id === sku.good_id)!;
      return {
        goodsId: item.goods_id,
        goodsCode: item.query_code,
        goodsName: item.goods_name,
        shortName: item.short_name,
        brandName: item.brand_name,
        skuId: sku.sku_id,
        skuSpec: sku.spec_models,
        documentUnitType: sku.unit_type,
        documentUnitName: units.find((unit) => unit.id === BigInt(sku.unit_type))?.name ?? '',
        piecesUnitType: item.unit_type,
        piecesUnitName: units.find((unit) => unit.id === BigInt(item.unit_type))?.name ?? '',
        piecesPerUnit: sku.pcs_qty,
        baseCost: sku.const_price,
      };
    });
  }

  async setInitialInputEnabled(enabled: boolean, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.hspsi_inventory_feature_config.upsert({
        where: { config_key: INITIAL_INPUT_SWITCH },
        create: {
          config_key: INITIAL_INPUT_SWITCH,
          enabled: enabled ? 1 : 0,
          remark: '初期入库功能开关；由管理员手动控制',
          updated_by: BigInt(userId),
        },
        update: { enabled: enabled ? 1 : 0, updated_by: BigInt(userId), updated_at: new Date() },
      });
      await tx.hspsi_sys_oper_log.create({
        data: {
          method: 'PATCH',
          router: '/inventory/general-orders/config/initial-input',
          url: '/inventory/general-orders/config/initial-input',
          service_name: 'inventory',
          request_data: JSON.stringify({ enabled }),
          response_code: '200',
          response_data: JSON.stringify({ initialInputEnabled: enabled }),
          created_by: Number(userId),
          updated_by: Number(userId),
        },
      });
    });
    return { initialInputEnabled: enabled, message: '功能开关已更新' };
  }

  async list(direction: Direction, query: Body) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));
    const where: Prisma.hspsi_inventory_general_orderWhereInput = {
      direction,
      deleted_at: null,
    };
    if (query.orgId) where.org_id = BigInt(String(query.orgId));
    if (query.warehouseId) where.warehouse_id = BigInt(String(query.warehouseId));
    if (query.businessType) where.business_type = String(query.businessType);
    if (query.keyword) where.business_no = { contains: String(query.keyword).trim() };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.hspsi_inventory_general_order.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ business_date: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.hspsi_inventory_general_order.count({ where }),
    ]);
    const orgIds = [...new Set(items.map((item) => item.org_id))];
    const warehouseIds = [...new Set(items.map((item) => item.warehouse_id))];
    const userIds = [...new Set(items.map((item) => item.handler_id).filter((id) => id > 0n))];
    const [orgs, warehouses, users] = await Promise.all([
      this.prisma.hspsi_basic_organization.findMany({ where: { org_id: { in: orgIds } } }),
      this.prisma.hspsi_basic_warehouse.findMany({
        where: { warehouse_id: { in: warehouseIds } },
      }),
      this.prisma.hspsi_sys_user.findMany({ where: { id: { in: userIds } } }),
    ]);
    return {
      items: items.map((item) => ({
        id: item.id,
        businessNo: item.business_no,
        businessType: item.business_type,
        businessDate: item.business_date,
        orgId: item.org_id,
        orgName: orgs.find((org) => org.org_id === item.org_id)?.name ?? '',
        warehouseId: item.warehouse_id,
        warehouseName:
          warehouses.find((warehouse) => warehouse.warehouse_id === item.warehouse_id)?.name ?? '',
        departmentId: item.department_id,
        handlerId: item.handler_id,
        handlerName: (() => {
          const user = users.find((row) => row.id === item.handler_id);
          return user?.nickname || user?.username || '';
        })(),
        totalPieces: item.total_pieces,
        totalAmount: item.total_amount,
        status: item.status,
        remark: item.remark,
        createdAt: item.created_at,
      })),
      total,
      page,
      pageSize,
    };
  }

  async detail(id: string, direction: Direction) {
    const order = await this.prisma.hspsi_inventory_general_order.findFirst({
      where: { id: BigInt(id), direction, deleted_at: null },
    });
    if (!order) throw new NotFoundException('通用出入库单不存在');
    const details = await this.prisma.hspsi_inventory_general_order_detail.findMany({
      where: { order_id: order.id },
      orderBy: { id: 'asc' },
    });
    const unitIds = [
      ...new Set(
        details
          .flatMap((line) => [line.document_unit_type, line.pieces_unit_type])
          .filter((unitId) => unitId > 0)
          .map((unitId) => BigInt(unitId)),
      ),
    ];
    const units = await this.prisma.hspsi_basic_unit.findMany({ where: { id: { in: unitIds } } });
    return {
      id: order.id,
      businessNo: order.business_no,
      direction: order.direction,
      businessType: order.business_type,
      businessDate: order.business_date,
      orgId: order.org_id,
      warehouseId: order.warehouse_id,
      departmentId: order.department_id,
      handlerId: order.handler_id,
      totalPieces: order.total_pieces,
      totalAmount: order.total_amount,
      status: order.status,
      remark: order.remark,
      createdAt: order.created_at,
      lines: details.map((line) => ({
        id: line.id,
        goodsId: line.goods_id,
        skuId: line.sku_id,
        batchNo: line.batch_no,
        documentUnitType: line.document_unit_type,
        documentUnitName:
          units.find((unit) => unit.id === BigInt(line.document_unit_type))?.name ?? '',
        documentQuantity: line.document_quantity,
        quantity: line.document_quantity,
        piecesUnitType: line.pieces_unit_type,
        piecesUnitName: units.find((unit) => unit.id === BigInt(line.pieces_unit_type))?.name ?? '',
        piecesPerUnit: line.pieces_per_unit,
        piecesQuantity: line.pieces_quantity,
        baseCost: line.base_cost,
        amount: line.amount,
        custodianId: line.custodian_id,
        storageLocation: line.storage_location,
        goodsCode: line.goods_code_snapshot,
        goodsName: line.goods_name_snapshot,
        skuSpec: line.sku_spec_snapshot,
      })),
    };
  }

  async create(direction: Direction, body: Body, userId: string) {
    const requestKey = String(body.requestKey ?? '').trim();
    if (!/^[A-Za-z0-9:_-]{8,64}$/.test(requestKey)) throw new BadRequestException('幂等请求键无效');
    const existingRequest = await this.prisma.hspsi_inventory_general_order.findUnique({
      where: { request_key: requestKey },
    });
    if (existingRequest) {
      if (Number(existingRequest.direction) !== direction)
        throw new BadRequestException('幂等请求键已用于其他业务请求');
      return {
        id: existingRequest.id,
        businessNo: existingRequest.business_no,
        message: direction > 0 ? '入库成功' : '出库成功',
        duplicate: true,
      };
    }
    const businessType = String(body.businessType ?? '').trim();
    const allowedTypes = direction > 0 ? INPUT_TYPES : OUTPUT_TYPES;
    if (!allowedTypes.has(businessType)) throw new BadRequestException('通用出入库业务类型无效');
    if (businessType === 'initial') {
      const config = await this.featureConfig();
      if (!config.initialInputEnabled) throw new BadRequestException('初期入库功能当前未启用');
    }
    const sourceLines = Array.isArray(body.lines) ? (body.lines as Body[]) : [];
    if (!sourceLines.length) throw new BadRequestException('至少需要一条明细');
    const orgId = this.identifier(body.orgId, '组织');
    const warehouseId = this.identifier(body.warehouseId, '仓库');
    const goodsIds = [
      ...new Set(
        sourceLines.map((line, index) => this.identifier(line.goodsId, `第 ${index + 1} 行商品`)),
      ),
    ];
    const skuIds = [
      ...new Set(
        sourceLines.map((line, index) => this.identifier(line.skuId, `第 ${index + 1} 行 SKU`)),
      ),
    ];
    const [goodsRows, skuRows] = await Promise.all([
      this.prisma.hspsi_goods_info.findMany({
        where: { goods_id: { in: goodsIds }, status: 1, deleted_at: null },
      }),
      this.prisma.hspsi_goods_info_sku.findMany({
        where: { sku_id: { in: skuIds }, status: 1, deleted_at: null },
      }),
    ]);
    const lines = sourceLines.map((input, index) => {
      const inputGoodsId = this.identifier(input.goodsId, `第 ${index + 1} 行商品`);
      const inputSkuId = this.identifier(input.skuId, `第 ${index + 1} 行 SKU`);
      const goods = goodsRows.find((row) => row.goods_id === inputGoodsId);
      const sku = skuRows.find((row) => row.sku_id === inputSkuId);
      if (!goods || !sku || sku.good_id !== goods.goods_id)
        throw new BadRequestException(`第 ${index + 1} 行商品或 SKU 无效`);
      const documentQuantity = this.positiveInteger(input.quantity, `第 ${index + 1} 行数量`);
      const piecesPerUnit = this.positiveInteger(
        sku.pcs_qty,
        `第 ${index + 1} 行 SKU 基础件数换算系数`,
      );
      const piecesQuantity = documentQuantity * piecesPerUnit;
      if (!Number.isSafeInteger(piecesQuantity))
        throw new BadRequestException(`第 ${index + 1} 行换算后的基础件数超出安全范围`);
      const baseCost = this.money(input.baseCost ?? sku.const_price, `第 ${index + 1} 行基础成本`);
      return {
        goods,
        sku,
        batchNo:
          String(input.batchNo ?? '').trim() || (direction > 0 ? generateBatchNo() : ''),
        documentQuantity,
        piecesPerUnit,
        piecesQuantity,
        baseCost,
        amount: direction > 0 ? Number((baseCost * piecesQuantity).toFixed(2)) : 0,
        custodianId: this.identifier(input.custodianId, `第 ${index + 1} 行使用人`, true),
        storageLocation: String(input.storageLocation ?? '').trim(),
      };
    });
    const lineKeys = lines.map(
      (line) => `${line.goods.goods_id}:${line.sku.sku_id}:${line.batchNo}`,
    );
    if (new Set(lineKeys).size !== lineKeys.length)
      throw new BadRequestException('同一商品、SKU 和批次不能重复填写，请合并为一条明细');
    const businessDate = body.businessDate ? new Date(String(body.businessDate)) : new Date();
    if (Number.isNaN(businessDate.getTime())) throw new BadRequestException('业务日期无效');
    const businessNo = await this.businessNumber.generate(
      direction > 0
        ? BUSINESS_PREFIX.INVENTORY_GENERAL_INPUT
        : BUSINESS_PREFIX.INVENTORY_GENERAL_OUTPUT,
    );
    const totalPieces = lines.reduce((sum, line) => sum + line.piecesQuantity, 0);
    const totalAmount = lines.reduce((sum, line) => sum + line.amount, 0);
    const handlerId = this.identifier(body.handlerId ?? userId, '经办人');
    const departmentId = this.identifier(body.departmentId, '使用部门', true);
    const operationType = direction > 0 ? 1 : 2;
    const inventoryMode =
      direction > 0 ? INVENTORY_BUSINESS_MODE.GENERIC_INPUT : INVENTORY_BUSINESS_MODE.DIRECT_OUTPUT;

    let order;
    try {
      order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.hspsi_inventory_general_order.create({
          data: {
            business_no: businessNo,
            request_key: requestKey,
            direction,
            business_type: businessType,
            business_date: businessDate,
            org_id: orgId,
            warehouse_id: warehouseId,
            department_id: departmentId,
            handler_id: handlerId,
            total_pieces: totalPieces,
            total_amount: new Prisma.Decimal(totalAmount),
            status: 1,
            remark: String(body.remark ?? ''),
            created_by: BigInt(userId),
            updated_by: BigInt(userId),
          },
        });
        await tx.hspsi_inventory_general_order_detail.createMany({
          data: lines.map((line) => ({
            order_id: created.id,
            goods_id: line.goods.goods_id,
            sku_id: line.sku.sku_id,
            batch_no: line.batchNo,
            document_unit_type: line.sku.unit_type,
            document_quantity: line.documentQuantity,
            pieces_unit_type: line.goods.unit_type,
            pieces_per_unit: line.piecesPerUnit,
            pieces_quantity: line.piecesQuantity,
            base_cost: new Prisma.Decimal(line.baseCost),
            amount: new Prisma.Decimal(line.amount),
            custodian_id: line.custodianId,
            storage_location: line.storageLocation,
            goods_code_snapshot: line.goods.query_code,
            goods_name_snapshot: line.goods.goods_name,
            sku_spec_snapshot: line.sku.spec_models,
          })),
        });
        const postingResults = await this.posting.post(
          {
            orgId,
            warehouseId,
            direction,
            operationType,
            inventoryMode,
            sourceId: created.id,
            sourceType: direction > 0 ? 'inventory_general_input' : 'inventory_general_output',
            sourceNo: businessNo,
            operationBy: BigInt(userId),
            idempotencyKey: `inventory-general:${created.id}`,
            remark: String(body.remark ?? ''),
            lines: lines.map((line) => ({
              goodsId: line.goods.goods_id,
              skuId: line.sku.sku_id,
              batchNo: line.batchNo,
              unitType: line.goods.unit_type,
              quantity: line.piecesQuantity,
              amount: line.amount,
            })),
          },
          tx,
        );
        if (direction < 0) {
          let actualTotalAmount = 0;
          for (const result of postingResults) {
            actualTotalAmount += result.amount;
            await tx.hspsi_inventory_general_order_detail.updateMany({
              where: {
                order_id: created.id,
                goods_id: result.goodsId,
                sku_id: result.skuId,
                batch_no: result.batchNo,
              },
              data: {
                base_cost: new Prisma.Decimal(result.unitCost),
                amount: new Prisma.Decimal(result.amount),
                updated_at: new Date(),
              },
            });
          }
          await tx.hspsi_inventory_general_order.update({
            where: { id: created.id },
            data: { total_amount: new Prisma.Decimal(actualTotalAmount), updated_at: new Date() },
          });
        }
        await tx.hspsi_sys_oper_log.create({
          data: {
            method: 'POST',
            router: direction > 0 ? '/inventory/general-inputs' : '/inventory/general-outputs',
            url: direction > 0 ? '/inventory/general-inputs' : '/inventory/general-outputs',
            service_name: 'inventory',
            request_data: JSON.stringify({ requestKey, businessType, lineCount: lines.length }),
            response_code: '200',
            response_data: JSON.stringify({ id: String(created.id), businessNo }),
            created_by: Number(userId),
            updated_by: Number(userId),
          },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const duplicated = await this.prisma.hspsi_inventory_general_order.findUnique({
          where: { request_key: requestKey },
        });
        if (duplicated && Number(duplicated.direction) === direction)
          return {
            id: duplicated.id,
            businessNo: duplicated.business_no,
            message: direction > 0 ? '入库成功' : '出库成功',
            duplicate: true,
          };
      }
      throw error;
    }
    return { id: order.id, businessNo, message: direction > 0 ? '入库成功' : '出库成功' };
  }
}
