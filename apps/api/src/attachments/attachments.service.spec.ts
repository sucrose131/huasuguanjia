import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AttachmentsService, LOGIN_OPERATION_GUIDE_CATEGORY, publicDocumentObjectKey } from './attachments.service';

const user = { id: '9', username: 'tester', orgId: '1', deptId: '2', permissions: ['purchase'] };

function setup(row: Record<string, unknown>) {
  const prisma: any = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ attachments: null, ...row }]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    hspsi_sys_oper_log: { create: vi.fn().mockResolvedValue({}) },
    hspsi_sys_dictionary_category: { findFirst: vi.fn().mockResolvedValue(null) },
    hspsi_sys_dictionary: { findMany: vi.fn().mockResolvedValue([]) },
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

describe('AttachmentsService staging (新建态临时附件)', () => {
  it('issues a staged upload url without requiring an existing document', async () => {
    const { service } = setup({ status: 0, approve_status: 0 });
    const oss = {
      signatureUrl: vi.fn().mockReturnValue('https://oss.example.com/put'),
    };
    (service as any).client = oss;

    const result = await service.stageUploadUrl(
      'purchase_application',
      { fileName: '需求说明.pdf', contentType: 'application/pdf', size: 2048 },
      user as never,
    );

    expect(result).toMatchObject({
      attachmentId: expect.any(String),
      objectKey: expect.stringMatching(/^documents\/tmp\/9\/.+\.pdf$/),
      uploadUrl: 'https://oss.example.com/put',
      expiresIn: expect.any(Number),
    });
    expect(oss.signatureUrl).toHaveBeenCalledWith(
      result.objectKey,
      expect.objectContaining({ method: 'PUT' }),
    );
  });

  it('rejects staged uploads with disallowed file types', async () => {
    const { service } = setup({ status: 0, approve_status: 0 });
    (service as any).client = { signatureUrl: vi.fn() };

    await expect(
      service.stageUploadUrl(
        'purchase_application',
        { fileName: 'virus.exe', contentType: 'application/x-msdownload', size: 10 },
        user as never,
      ),
    ).rejects.toThrow('附件格式、扩展名或MIME类型不允许');
  });

  it('binds staged attachments to a saved document and writes metadata', async () => {
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

    const result = await service.commitStaged(
      'purchase_application',
      '12',
      [
        {
          attachmentId,
          objectKey: `documents/tmp/9/${attachmentId}.pdf`,
          fileName: 'test.pdf',
          contentType: 'application/pdf',
          size: 10,
        },
      ],
      user as never,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: attachmentId,
      objectKey: `documents/purchase_application/12/${attachmentId}.pdf`,
      fileName: 'test.pdf',
      uploadedBy: '9',
    });
    expect(oss.copy).toHaveBeenCalledOnce();
    expect(oss.delete).toHaveBeenCalledOnce();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SET attachments = ?'),
      expect.stringContaining(attachmentId),
      BigInt(12),
    );
    expect(prisma.hspsi_sys_oper_log.create).toHaveBeenCalledOnce();
  });

  it('cleans up copied finals when binding fails', async () => {
    const { service, prisma } = setup({ status: 0, approve_status: 0 });
    const oss = {
      head: vi.fn().mockResolvedValue({
        res: { headers: { 'content-length': '999', 'content-type': 'application/pdf' } },
      }),
      delete: vi.fn().mockResolvedValue({}),
    };
    (service as any).client = oss;
    const attachmentId = '123e4567-e89b-42d3-a456-426614174000';

    await expect(
      service.commitStaged(
        'purchase_application',
        '12',
        [
          {
            attachmentId,
            objectKey: `documents/tmp/9/${attachmentId}.pdf`,
            fileName: 'test.pdf',
            contentType: 'application/pdf',
            size: 10,
          },
        ],
        user as never,
      ),
    ).rejects.toThrow('附件与上传申请不一致');
    expect(oss.delete).toHaveBeenCalledOnce();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('discards only the current user staging objects', async () => {
    const { service } = setup({ status: 0, approve_status: 0 });
    const oss = { delete: vi.fn().mockResolvedValue({}) };
    (service as any).client = oss;

    await service.discardStaged(
      'purchase_application',
      user as never,
      ['documents/tmp/9/abc.pdf', 'documents/tmp/999/other.pdf'],
    );

    expect(oss.delete).toHaveBeenCalledOnce();
    expect(oss.delete).toHaveBeenCalledWith('documents/tmp/9/abc.pdf');
  });
});

describe('publicDocumentObjectKey', () => {
  it('accepts a pdf object key and strips the leading slash', () => {
    expect(publicDocumentObjectKey('/guides/华溯管家医院业务操作培训手册-20260903.pdf')).toBe(
      'guides/华溯管家医院业务操作培训手册-20260903.pdf',
    );
  });

  it('rejects path traversal, urls or non-pdf keys', () => {
    expect(() => publicDocumentObjectKey('folder/../secret.pdf')).toThrow(BadRequestException);
    expect(() => publicDocumentObjectKey('https://oss.example.com/manual.pdf')).toThrow(
      BadRequestException,
    );
    expect(() => publicDocumentObjectKey('manual.txt')).toThrow(BadRequestException);
  });
});

describe('AttachmentsService login operation guides', () => {
  const objectKey = 'documents/华溯管家医院业务操作培训手册-20260903.pdf';
  const fileName = '华溯管家医院业务操作培训手册-20260903.pdf';
  const dictionaryItem = {
    dict_name: '医护操作指引',
    dict_value: objectKey,
    remark: null,
  };

  function withGuide(servicePrisma: any) {
    servicePrisma.hspsi_sys_dictionary_category.findFirst.mockResolvedValue({
      dict_catg_id: 8,
      dict_catg_code: LOGIN_OPERATION_GUIDE_CATEGORY,
    });
    servicePrisma.hspsi_sys_dictionary.findMany.mockResolvedValue([dictionaryItem]);
  }

  it('lists the dictionary item without signing', async () => {
    const { service, prisma } = setup({ status: 0, approve_status: 0 });
    withGuide(prisma);

    await expect(service.listPublicOperationGuides()).resolves.toEqual([
      { value: objectKey, label: '医护操作指引' },
    ]);
  });

  it('signs the dictionary value for inline preview', async () => {
    const { service, prisma } = setup({ status: 0, approve_status: 0 });
    withGuide(prisma);
    const oss = {
      head: vi.fn().mockResolvedValue({ res: { headers: {} } }),
      signatureUrl: vi.fn().mockReturnValue('https://oss.example.com/guide.pdf?sign=1'),
    };
    (service as any).client = oss;

    const result = await service.publicOperationGuidePreviewUrl(objectKey);

    expect(result).toEqual({
      url: 'https://oss.example.com/guide.pdf?sign=1',
      expiresIn: 600,
      fileName,
      label: '医护操作指引',
    });
    expect(oss.head).toHaveBeenCalledWith(objectKey);
    expect(oss.signatureUrl).toHaveBeenCalledWith(
      objectKey,
      expect.objectContaining({
        expires: 600,
        response: {
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        },
      }),
    );
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('returns not found when the OSS object is missing', async () => {
    const { service, prisma } = setup({ status: 0, approve_status: 0 });
    withGuide(prisma);
    (service as any).client = {
      head: vi.fn().mockRejectedValue(
        Object.assign(new Error('missing'), { status: 404, code: 'NoSuchKey' }),
      ),
      signatureUrl: vi.fn(),
    };

    await expect(service.publicOperationGuidePreviewUrl(objectKey)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns not found when the dictionary item is missing', async () => {
    const { service } = setup({ status: 0, approve_status: 0 });
    (service as any).client = { head: vi.fn(), signatureUrl: vi.fn() };

    await expect(service.publicOperationGuidePreviewUrl(objectKey)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('streams the dictionary pdf for same-origin preview', async () => {
    const { service, prisma } = setup({ status: 0, approve_status: 0 });
    withGuide(prisma);
    const stream = { pipe: vi.fn() };
    const oss = { getStream: vi.fn().mockResolvedValue({ stream }) };
    (service as any).client = oss;

    const result = await service.publicOperationGuideFile(objectKey);

    expect(result).toMatchObject({ fileName, label: '医护操作指引', stream });
    expect(oss.getStream).toHaveBeenCalledWith(objectKey);
  });

  it('rejects when OSS is not configured', async () => {
    const { service, prisma } = setup({ status: 0, approve_status: 0 });
    withGuide(prisma);
    (service as any).client = null;

    await expect(service.publicOperationGuidePreviewUrl(objectKey)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
