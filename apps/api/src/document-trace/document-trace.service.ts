import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

type Db = Prisma.TransactionClient | PrismaClient;

export type DocumentLinkInput = {
  upstreamType: string;
  upstreamId: bigint | string | number;
  upstreamNo?: string | null;
  downstreamType: string;
  downstreamId: bigint | string | number;
  downstreamNo?: string | null;
  relationKind?: string;
  createdBy?: bigint | string | number;
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  sales_order: '销售订单',
  sales_output: '销售出库单',
  sales_return: '销售退货单',
  sales_payment: '销售收款单',
  sales_refund: '销售退款单',
  discount_sale_order: '折价销售单',
  discount_sale_output: '折价销售出库单',
  production_plan: '生产计划单',
  production_shortage: '生产缺料清单',
  production_material_output: '生产原料出库单',
  production_input: '生产成品入库单',
  purchase_application: '采购申请单',
  purchase_order: '采购订单',
  purchase_receipt: '采购入库单',
  purchase_return: '采购退货单',
  purchase_payment: '采购付款单',
  purchase_refund: '采购退款单',
  purchase_refund_flow: '采购退款流水',
  inventory_check: '库存盘点单',
  inventory_shortage: '报亏单',
  inventory_loss: '报损出库单',
  inventory_loss_output: '报亏出库单',
  inventory_overflow: '报盈入库单',
  inventory_overflow_input: '报盈入库单',
  requisition_application: '领用申请单',
  requisition_output: '领用出库单',
  requisition_return: '领用退还单',
};

@Injectable()
export class DocumentTraceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  labels() {
    return DOCUMENT_TYPE_LABELS;
  }

  private type(value: unknown) {
    const result = String(value ?? '').trim();
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(result)) throw new BadRequestException('单据类型无效');
    return result;
  }

  private id(value: unknown) {
    const raw = String(value ?? '').trim();
    if (!/^[1-9]\d*$/.test(raw)) throw new BadRequestException('单据ID无效');
    return BigInt(raw);
  }

  async link(input: DocumentLinkInput, tx?: Prisma.TransactionClient) {
    const db: Db = tx ?? this.prisma;
    const upstreamType = this.type(input.upstreamType);
    const downstreamType = this.type(input.downstreamType);
    const upstreamId = this.id(input.upstreamId);
    const downstreamId = this.id(input.downstreamId);
    const upstreamNo = String(input.upstreamNo ?? '').slice(0, 50);
    const downstreamNo = String(input.downstreamNo ?? '').slice(0, 50);
    if (upstreamType === downstreamType && upstreamId === downstreamId)
      throw new BadRequestException('单据不能关联自身');
    return db.hspsi_business_document_relation.upsert({
      where: {
        document_relation_key: {
          upstream_type: upstreamType,
          upstream_id: upstreamId,
          downstream_type: downstreamType,
          downstream_id: downstreamId,
        },
      },
      create: {
        upstream_type: upstreamType,
        upstream_id: upstreamId,
        upstream_no: upstreamNo,
        downstream_type: downstreamType,
        downstream_id: downstreamId,
        downstream_no: downstreamNo,
        relation_kind: String(input.relationKind ?? 'generated').slice(0, 30),
        created_by: BigInt(String(input.createdBy ?? 0)),
      },
      update: {
        ...(input.upstreamNo !== undefined && input.upstreamNo !== null
          ? { upstream_no: upstreamNo }
          : {}),
        ...(input.downstreamNo !== undefined && input.downstreamNo !== null
          ? { downstream_no: downstreamNo }
          : {}),
        relation_kind: String(input.relationKind ?? 'generated').slice(0, 30),
        deleted_at: null,
        updated_at: new Date(),
      },
    });
  }

  async removeForDocument(
    typeInput: string,
    idInput: string | number | bigint,
    tx?: Prisma.TransactionClient,
  ) {
    const db: Db = tx ?? this.prisma;
    const type = this.type(typeInput);
    const id = this.id(idInput);
    return db.hspsi_business_document_relation.updateMany({
      where: {
        deleted_at: null,
        OR: [
          { upstream_type: type, upstream_id: id },
          { downstream_type: type, downstream_id: id },
        ],
      },
      data: { deleted_at: new Date(), updated_at: new Date() },
    });
  }

  async trace(typeInput: string, idInput: string, maxDepthInput?: number) {
    const rootType = this.type(typeInput);
    const rootId = this.id(idInput);
    const maxDepth = Math.min(30, Math.max(1, Number(maxDepthInput ?? 12)));
    const rootKey = `${rootType}:${rootId}`;
    const nodes = new Map<
      string,
      { key: string; type: string; id: bigint; no: string; label: string; depth: number }
    >();
    const edges = new Map<string, { id: bigint; from: string; to: string; relationKind: string }>();
    nodes.set(rootKey, {
      key: rootKey,
      type: rootType,
      id: rootId,
      no: '',
      label: DOCUMENT_TYPE_LABELS[rootType] ?? rootType,
      depth: 0,
    });

    let frontier = [{ type: rootType, id: rootId, depth: 0 }];
    const expanded = new Set<string>();
    while (frontier.length) {
      const active = frontier.filter(
        (item) => item.depth < maxDepth && !expanded.has(`${item.type}:${item.id}`),
      );
      if (!active.length) break;
      for (const item of active) expanded.add(`${item.type}:${item.id}`);
      const relations = await this.prisma.hspsi_business_document_relation.findMany({
        where: {
          deleted_at: null,
          OR: active.flatMap((item) => [
            { upstream_type: item.type, upstream_id: item.id },
            { downstream_type: item.type, downstream_id: item.id },
          ]),
        },
        orderBy: { relation_id: 'asc' },
      });
      const next: typeof frontier = [];
      for (const relation of relations) {
        const from = `${relation.upstream_type}:${relation.upstream_id}`;
        const to = `${relation.downstream_type}:${relation.downstream_id}`;
        edges.set(String(relation.relation_id), {
          id: relation.relation_id,
          from,
          to,
          relationKind: relation.relation_kind,
        });
        const activeFrom = active.find((item) => `${item.type}:${item.id}` === from);
        const activeTo = active.find((item) => `${item.type}:${item.id}` === to);
        const fromDepth = activeFrom ? activeFrom.depth : (activeTo?.depth ?? 0) + 1;
        const toDepth = activeTo ? activeTo.depth : (activeFrom?.depth ?? 0) + 1;
        const existingFrom = nodes.get(from);
        const existingTo = nodes.get(to);
        nodes.set(from, {
          key: from,
          type: relation.upstream_type,
          id: relation.upstream_id,
          no: relation.upstream_no || existingFrom?.no || '',
          label: DOCUMENT_TYPE_LABELS[relation.upstream_type] ?? relation.upstream_type,
          depth: Math.min(existingFrom?.depth ?? fromDepth, fromDepth),
        });
        nodes.set(to, {
          key: to,
          type: relation.downstream_type,
          id: relation.downstream_id,
          no: relation.downstream_no || existingTo?.no || '',
          label: DOCUMENT_TYPE_LABELS[relation.downstream_type] ?? relation.downstream_type,
          depth: Math.min(existingTo?.depth ?? toDepth, toDepth),
        });
        if (!expanded.has(from))
          next.push({ type: relation.upstream_type, id: relation.upstream_id, depth: fromDepth });
        if (!expanded.has(to))
          next.push({ type: relation.downstream_type, id: relation.downstream_id, depth: toDepth });
      }
      if (nodes.size > 300) throw new BadRequestException('单据关联数量过多，请缩小追溯范围');
      frontier = next;
    }

    return {
      root: rootKey,
      nodes: [...nodes.values()].sort(
        (a, b) => a.depth - b.depth || a.label.localeCompare(b.label, 'zh-CN'),
      ),
      edges: [...edges.values()],
    };
  }
}
