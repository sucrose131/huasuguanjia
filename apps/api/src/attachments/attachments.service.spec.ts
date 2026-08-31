import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentsService } from './attachments.service';

const user = { id: '9', username: 'tester', orgId: '1', deptId: '2', permissions: ['purchase'] };

function setup(row: Record<string, unknown>) {
  const prisma: any = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ attachments: null, ...row }]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    hspsi_sys_oper_log: { create: vi.fn().mockResolvedValue({}) },
  };
  prisma.$transaction = vi.fn((callback: (tx: any) => unknown) => callback(prisma));
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'OSS_ATTACHMENT_MAX_SIZE_MB') return 20;
      if (key === 'OSS_ATTACHMENT_MAX_COUNT') return 10;
      return undefined;
    }),
  };
  const service = new AttachmentsService(prisma as never, config as never);
  return { service, prisma };
}

describe('AttachmentsService workflow rules', () => {
  it('allows draft upload and deletion', async () => {
    const { service } = setup({ status: 0, approve_status: 0 });

    const result = await service.list('purchase_application', '12', user as never);

    expect(result.state).toBe('draft');
    expect(result.canUpload).toBe(true);
    expect(result.canDelete).toBe(true);
  });

  it('blocks upload and deletion while reviewing', async () => {
    const { service } = setup({ status: 1, approve_status: 0 });

    const result = await service.list('purchase_application', '12', user as never);

    expect(result.state).toBe('review');
    expect(result.canUpload).toBe(false);
    expect(result.canDelete).toBe(false);
    await expect(
      service.createUploadUrl(
        'purchase_application',
        '12',
        { fileName: 'test.pdf', contentType: 'application/pdf', size: 10 },
        user as never,
      ),
    ).rejects.toThrow('审核中单据不允许上传附件');
  });

  it('allows approved documents to add but not delete attachments', async () => {
    const { service } = setup({ status: 1, approve_status: 1 });

    const result = await service.list('purchase_application', '12', user as never);

    expect(result.state).toBe('approved');
    expect(result.canUpload).toBe(true);
    expect(result.canDelete).toBe(false);
  });

  it('keeps rejected document history non-deletable while allowing new attachments', async () => {
    const { service } = setup({ status: 0, approve_status: 2 });

    const result = await service.list('purchase_application', '12', user as never);

    expect(result.state).toBe('rejected');
    expect(result.canUpload).toBe(true);
    expect(result.canDelete).toBe(false);
  });
});

describe('AttachmentsService OSS verification', () => {
  it('rejects and removes an OSS object whose actual size differs', async () => {
    const { service, prisma } = setup({ status: 0, approve_status: 0 });
    const oss = {
      head: vi.fn().mockResolvedValue({
        res: { headers: { 'content-length': '11', 'content-type': 'application/pdf' } },
      }),
      delete: vi.fn().mockResolvedValue({}),
    };
    (service as any).client = oss;
    const attachmentId = '123e4567-e89b-42d3-a456-426614174000';

    await expect(
      service.complete(
        'purchase_application',
        '12',
        {
          attachmentId,
          objectKey: `documents/tmp/9/${attachmentId}.pdf`,
          fileName: 'test.pdf',
          contentType: 'application/pdf',
          size: 10,
        },
        user as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(oss.delete).toHaveBeenCalledOnce();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('stores verified OSS metadata and an operation log', async () => {
    const { service, prisma } = setup({ status: 0, approve_status: 0 });
    const oss = {
      head: vi.fn().mockResolvedValue({
        res: { headers: { 'content-length': '10', 'content-type': 'application/pdf' } },
      }),
      copy: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    (service as any).client = oss;
    const attachmentId = '123e4567-e89b-42d3-a456-426614174000';

    const result = await service.complete(
      'purchase_application',
      '12',
      {
        attachmentId,
        objectKey: `documents/tmp/9/${attachmentId}.pdf`,
        fileName: 'test.pdf',
        contentType: 'application/pdf',
        size: 10,
      },
      user as never,
      { ip: '2001:db8::1' },
    );

    expect(result).toMatchObject({ fileName: 'test.pdf' });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledOnce();
    expect(prisma.hspsi_sys_oper_log.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ip: '2001:db8::1' }) }),
    );
  });
});

describe('AttachmentsService OA integration cache', () => {
  it('preserves the OSS original metadata and adds an OA upload cache entry', async () => {
    const attachment = {
      id: 'attachment-1',
      objectKey: 'documents/requisition_application/7/source.pdf',
      fileName: 'source.pdf',
      contentType: 'application/pdf',
      size: 10,
      uploadedBy: '9',
      uploadedAt: '2026-08-11T00:00:00.000Z',
    };
    const { service, prisma } = setup({ attachments: [attachment] });

    await service.cacheOaUpload('requisition_application', '7', 'attachment-1', {
      accountSetId: '1',
      fileId: 'OA-FILE-1',
      objectKey: 'OA-OBJECT-1',
      uploadedAt: '2026-08-11T01:00:00.000Z',
      size: 10,
    });

    const stored = JSON.parse(prisma.$executeRawUnsafe.mock.calls[0]![1]);
    expect(stored[0]).toMatchObject({
      objectKey: attachment.objectKey,
      oaUploads: [expect.objectContaining({ accountSetId: '1', fileId: 'OA-FILE-1', size: 10 })],
    });
  });
});

describe('AttachmentsService handwritten signatures', () => {
  it('uploads PNG signature bytes to OSS and returns attachment metadata only', async () => {
    const { service } = setup({ status: 0, approve_status: 0 });
    const oss = { put: vi.fn().mockResolvedValue({}) };
    (service as any).client = oss;

    const result = await service.uploadSignatureDataUrlForIntegration(
      'requisition_application',
      'data:image/png;base64,YWJj',
      '9',
    );

    expect(result).toMatchObject({
      contentType: 'image/png',
      size: 3,
      uploadedBy: '9',
      category: 'signature',
    });
    expect(result).not.toHaveProperty('base64');
    expect(oss.put).toHaveBeenCalledWith(
      expect.stringMatching(/^documents\/requisition_application\/signatures\/.+\.png$/),
      Buffer.from('abc'),
      { headers: { 'Content-Type': 'image/png' } },
    );
  });
});
