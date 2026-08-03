import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/prisma.service';
import { DocumentTraceService } from '../document-trace/document-trace.service';
import { RequisitionService } from '../requisition/requisition.service';

const envFile = existsSync('.env') ? '.env' : 'apps/api/.env';
process.loadEnvFile?.(envFile);

async function main() {
  const context = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = context.get(PrismaService);
  const requisitions = context.get(RequisitionService);
  const trace = context.get(DocumentTraceService);
  const actorId = '1';
  let applicationId: bigint | null = null;
  let outputId: bigint | null = null;
  const branchId = BigInt(`98${Date.now()}`);
  const base = {
    orgId: '9',
    warehouseId: '1',
    deptId: '3',
    applicantId: actorId,
    drawType: 2,
    date: new Date().toISOString(),
    reason: '全链路自动验收临时数据',
    signatureContent: 'data:image/png;base64,dGVzdA==',
    signedBy: actorId,
    signedAt: new Date().toISOString(),
    remark: 'verify-document-chain',
    details: [
      {
        goodsId: '980000000001',
        skuId: '980000000001',
        unitType: 1,
        quantity: 1,
        returnable: true,
        remark: 'verify-document-chain',
      },
    ],
  };

  try {
    await assert.rejects(
      requisitions.saveApplication(
        null,
        { ...base, signatureContent: '', signedAt: null },
        actorId,
        true,
      ),
      /签字/,
    );
    await assert.rejects(
      requisitions.saveApplication(
        null,
        { ...base, details: [{ ...base.details[0], returnable: null }] },
        actorId,
        false,
      ),
      /物品属性/,
    );

    const application = await requisitions.saveApplication(null, base, actorId, true);
    applicationId = BigInt(application.id);
    const approved = await requisitions.approve(String(applicationId), true, '自动验收', actorId);
    outputId = BigInt(approved.outputId!);
    const approvedAgain = await requisitions.approve(
      String(applicationId),
      true,
      '幂等复验',
      actorId,
    );
    assert.equal(String(approvedAgain.outputId), String(outputId));

    const output = await requisitions.output(String(outputId));
    assert.equal(String(output.receiverId), actorId);
    assert.equal(output.autoCreated, true);
    assert.equal(output.details.length, 1);
    assert.equal(output.details[0]!.returnable, true);

    await trace.link({
      upstreamType: 'requisition_output',
      upstreamId: outputId,
      upstreamNo: output.outputNo,
      downstreamType: 'requisition_return',
      downstreamId: branchId,
      downstreamNo: `VERIFY${branchId}`,
      relationKind: 'verification_branch',
      createdBy: actorId,
    });
    const graph = await trace.trace('requisition_application', String(applicationId), 20);
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);
    assert(graph.nodes.some((node) => node.type === 'requisition_output'));
    assert(graph.nodes.some((node) => node.type === 'requisition_return'));

    const applicationLinks = await prisma.hspsi_business_document_relation.count({
      where: {
        upstream_type: 'requisition_application',
        upstream_id: applicationId,
        downstream_type: 'requisition_output',
        downstream_id: outputId,
        deleted_at: null,
      },
    });
    assert.equal(applicationLinks, 1);
    console.log(
      'PASS: requisition validation, automatic output, idempotency and document trace graph',
    );
  } finally {
    if (applicationId || outputId) {
      await prisma.$transaction(async (tx) => {
        await tx.hspsi_business_document_relation.deleteMany({
          where: {
            OR: [
              ...(applicationId
                ? [
                    { upstream_type: 'requisition_application', upstream_id: applicationId },
                    { downstream_type: 'requisition_application', downstream_id: applicationId },
                  ]
                : []),
              ...(outputId
                ? [
                    { upstream_type: 'requisition_output', upstream_id: outputId },
                    { downstream_type: 'requisition_output', downstream_id: outputId },
                  ]
                : []),
              { upstream_type: 'requisition_return', upstream_id: branchId },
              { downstream_type: 'requisition_return', downstream_id: branchId },
            ],
          },
        });
        if (outputId) {
          await tx.hspsi_draw_approve_output_detail.deleteMany({
            where: { draw_output_id: outputId },
          });
          await tx.hspsi_draw_approve_output.deleteMany({ where: { draw_output_id: outputId } });
        }
        if (applicationId) {
          await tx.hspsi_draw_approve_detail.deleteMany({ where: { draw_id: applicationId } });
          await tx.hspsi_draw_approve.deleteMany({ where: { draw_id: applicationId } });
        }
      });
    }
    await context.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
