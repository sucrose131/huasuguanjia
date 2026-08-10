import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OSS from 'ali-oss';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../database/prisma.service';

type Workflow = 'approval' | 'confirm' | 'plain' | 'completed' | 'bom-return';
type Attachment = {
  id: string;
  objectKey: string;
  fileName: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
};
export type DocumentConfig = {
  table: string;
  id: string;
  permission: string;
  workflow: Workflow;
};
export type AttachmentAuditContext = { ip?: string };

export const ATTACHMENT_DOCUMENTS: Record<string, DocumentConfig> = {
  purchase_application: {
    table: 'hspsi_purchase_approve',
    id: 'pur_id',
    permission: 'purchase',
    workflow: 'approval',
  },
  purchase_order: {
    table: 'hspsi_purchase_order',
    id: 'po_id',
    permission: 'purchase',
    workflow: 'plain',
  },
  purchase_receipt: {
    table: 'hspsi_purchase_order_input',
    id: 'po_input_id',
    permission: 'purchase',
    workflow: 'confirm',
  },
  purchase_return: {
    table: 'hspsi_purchase_order_input_exit',
    id: 'po_exit_id',
    permission: 'purchase',
    workflow: 'approval',
  },
  purchase_payment: {
    table: 'hspsi_purchase_order_payment',
    id: 'pay_id',
    permission: 'purchase',
    workflow: 'completed',
  },
  purchase_refund: {
    table: 'hspsi_purchase_refund',
    id: 'refund_id',
    permission: 'purchase',
    workflow: 'plain',
  },
  inventory_adjust: {
    table: 'hspsi_inventory_adjust',
    id: 'adjust_id',
    permission: 'inventory',
    workflow: 'approval',
  },
  inventory_check: {
    table: 'hspsi_inventory_check',
    id: 'check_id',
    permission: 'inventory',
    workflow: 'approval',
  },
  inventory_loss: {
    table: 'hspsi_inventory_loss',
    id: 'loss_id',
    permission: 'inventory',
    workflow: 'approval',
  },
  inventory_loss_output: {
    table: 'hspsi_inventory_loss_output',
    id: 'loss_id',
    permission: 'inventory',
    workflow: 'approval',
  },
  inventory_overflow: {
    table: 'hspsi_inventory_overflow',
    id: 'overflow_id',
    permission: 'inventory',
    workflow: 'approval',
  },
  inventory_general_order: {
    table: 'hspsi_inventory_general_order',
    id: 'id',
    permission: 'inventory',
    workflow: 'completed',
  },
  inventory_transfer: {
    table: 'hspsi_inventory_transfer',
    id: 'transfer_id',
    permission: 'inventory',
    workflow: 'approval',
  },
  production_bom: {
    table: 'hspsi_production_bom',
    id: 'bom_id',
    permission: 'production',
    workflow: 'plain',
  },
  production_material_output: {
    table: 'hspsi_production_material_out',
    id: 'out_id',
    permission: 'production',
    workflow: 'confirm',
  },
  production_plan: {
    table: 'hspsi_production_plan',
    id: 'plan_id',
    permission: 'production',
    workflow: 'approval',
  },
  production_input: {
    table: 'hspsi_production_plan_input',
    id: 'id',
    permission: 'production',
    workflow: 'completed',
  },
  production_shortage: {
    table: 'hspsi_production_shortage',
    id: 'shortage_id',
    permission: 'production',
    workflow: 'plain',
  },
  production_material_return: {
    table: 'hspsi_production_material_return',
    id: 'return_id',
    permission: 'production',
    workflow: 'bom-return',
  },
  sales_order: {
    table: 'hspsi_sale_order',
    id: 'so_id',
    permission: 'sales',
    workflow: 'approval',
  },
  sales_return: {
    table: 'hspsi_sale_order_exit',
    id: 'so_exit_id',
    permission: 'sales',
    workflow: 'confirm',
  },
  sales_output: {
    table: 'hspsi_sale_order_output',
    id: 'so_output_id',
    permission: 'sales',
    workflow: 'confirm',
  },
  sales_service: {
    table: 'hspsi_sale_order_service',
    id: 'service_id',
    permission: 'sales',
    workflow: 'plain',
  },
  sales_payment: {
    table: 'hspsi_sales_order_payment',
    id: 'pay_id',
    permission: 'sales',
    workflow: 'completed',
  },
  sales_refund: {
    table: 'hspsi_sales_order_payment',
    id: 'pay_id',
    permission: 'sales',
    workflow: 'completed',
  },
  requisition_application: {
    table: 'hspsi_draw_approve',
    id: 'draw_id',
    permission: 'requisitions',
    workflow: 'approval',
  },
  requisition_output: {
    table: 'hspsi_draw_approve_output',
    id: 'draw_output_id',
    permission: 'requisitions',
    workflow: 'confirm',
  },
  requisition_return: {
    table: 'hspsi_draw_approve_output_exit',
    id: 'draw_exit_id',
    permission: 'requisitions',
    workflow: 'confirm',
  },
};

const DEFAULT_ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
const EXTENSIONS_BY_TYPE: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'text/plain': ['.txt'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};

function csv(value: unknown) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

@Injectable()
export class AttachmentsService {
  private readonly client: OSS | null;
  private readonly maxSize: number;
  private readonly maxCount: number;
  private readonly allowedTypes: Set<string>;
  private readonly allowedExtensions: Set<string>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    const region = this.config.get<string>('OSS_REGION');
    const bucket = this.config.get<string>('OSS_BUCKET');
    const accessKeyId = this.config.get<string>('OSS_ACCESS_KEY_ID');
    const accessKeySecret = this.config.get<string>('OSS_ACCESS_KEY_SECRET');
    this.maxSize = Number(this.config.get('OSS_ATTACHMENT_MAX_SIZE_MB') ?? 20) * 1024 * 1024;
    this.maxCount = Number(this.config.get('OSS_ATTACHMENT_MAX_COUNT') ?? 10);
    const configuredTypes = csv(this.config.get('OSS_ALLOWED_MIME_TYPES'));
    const configuredExtensions = csv(this.config.get('OSS_ALLOWED_EXTENSIONS')).map((item) =>
      item.startsWith('.') ? item : `.${item}`,
    );
    this.allowedTypes = new Set(
      configuredTypes.length ? configuredTypes : DEFAULT_ALLOWED_TYPES,
    );
    this.allowedExtensions = new Set(
      configuredExtensions.length
        ? configuredExtensions
        : Object.values(EXTENSIONS_BY_TYPE).flat(),
    );
    this.client =
      region && bucket && accessKeyId && accessKeySecret
        ? new OSS({
            region,
            bucket,
            accessKeyId,
            accessKeySecret,
            stsToken: this.config.get<string>('OSS_STS_TOKEN') || undefined,
            cname: Boolean(this.config.get<string>('OSS_CNAME')),
            endpoint: this.config.get<string>('OSS_CNAME') || undefined,
          })
        : null;
  }

  private document(type: string) {
    const config = ATTACHMENT_DOCUMENTS[type];
    if (!config) throw new BadRequestException('不支持的业务单据类型');
    return config;
  }

  private authorize(config: DocumentConfig, user: AuthUser) {
    const allowed = user.permissions.some(
      (permission) =>
        permission === '*' ||
        permission === config.permission ||
        permission.startsWith(`${config.permission}:`),
    );
    if (!allowed) throw new ForbiddenException('当前账号没有查看或操作该单据附件的权限');
  }

  private attachments(value: unknown): Attachment[] {
    if (Array.isArray(value)) return value as Attachment[];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private async row(type: string, id: string, user: AuthUser, db: any = this.prisma, lock = false) {
    const config = this.document(type);
    this.authorize(config, user);
    if (!/^\d+$/.test(id)) throw new BadRequestException('单据ID无效');
    const rows = await db.$queryRawUnsafe(
      `SELECT * FROM \`${config.table}\` WHERE \`${config.id}\` = ? AND deleted_at IS NULL LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      BigInt(id),
    );
    if (!rows[0]) throw new NotFoundException('业务单据不存在');
    return { config, row: rows[0], attachments: this.attachments(rows[0].attachments) };
  }

  private state(config: DocumentConfig, row: any) {
    if (config.workflow === 'completed') return 'approved';
    if (config.workflow === 'bom-return') {
      const status = Number(row.status ?? 0);
      if (status === 0) return 'draft';
      if (status === 1) return 'approved';
      return 'closed';
    }
    if (config.workflow === 'confirm')
      return Number(row.comfirm_status ?? row.confirm_tag ?? 0) === 0 ? 'draft' : 'approved';
    if (config.workflow === 'approval') {
      const approve = Number(row.approve_status ?? 0);
      if (approve === 1) return 'approved';
      if (approve === 2) return 'rejected';
      return Number(row.status ?? 0) === 0 ? 'draft' : 'review';
    }
    const status = Number(row.status ?? row.event_status ?? 0);
    return status === 0 || status === 1 ? 'draft' : 'closed';
  }

  private assertUpload(state: string) {
    if (state === 'review') throw new BadRequestException('审核中单据不允许上传附件');
    if (state === 'closed') throw new BadRequestException('已作废或已关闭单据不允许上传附件');
  }

  private oss() {
    if (!this.client) throw new ServiceUnavailableException('阿里云 OSS 尚未配置完整');
    return this.client;
  }

  private validFileType(contentType: string, suffix: string) {
    return (
      this.allowedTypes.has(contentType) &&
      this.allowedExtensions.has(suffix) &&
      Boolean(EXTENSIONS_BY_TYPE[contentType]?.includes(suffix))
    );
  }

  async list(type: string, id: string, user: AuthUser) {
    const data = await this.row(type, id, user);
    const state = this.state(data.config, data.row);
    return {
      items: data.attachments,
      state,
      canUpload: !['review', 'closed'].includes(state),
      canDelete: state === 'draft',
      limits: {
        maxSize: this.maxSize,
        maxCount: this.maxCount,
        contentTypes: [...this.allowedTypes],
        extensions: [...this.allowedExtensions],
      },
    };
  }

  async createUploadUrl(type: string, id: string, body: Record<string, unknown>, user: AuthUser) {
    const data = await this.row(type, id, user);
    this.assertUpload(this.state(data.config, data.row));
    if (data.attachments.length >= this.maxCount)
      throw new BadRequestException('附件数量已达到上限');
    const fileName = String(body.fileName ?? '').trim();
    const contentType = String(body.contentType ?? '')
      .trim()
      .toLowerCase();
    const size = Number(body.size);
    const suffix = extname(fileName).toLowerCase();
    if (!fileName || !this.validFileType(contentType, suffix))
      throw new BadRequestException('附件格式、扩展名或MIME类型不允许');
    if (!Number.isSafeInteger(size) || size <= 0 || size > this.maxSize)
      throw new BadRequestException('附件大小无效或超过限制');
    const attachmentId = randomUUID();
    const objectKey = `documents/tmp/${user.id}/${attachmentId}${suffix}`;
    const expires = Number(this.config.get('OSS_UPLOAD_URL_TTL_SECONDS') ?? 900);
    const uploadUrl = this.oss().signatureUrl(objectKey, {
      method: 'PUT',
      expires,
      'Content-Type': contentType,
    });
    return {
      attachmentId,
      objectKey,
      uploadUrl,
      expiresIn: expires,
      headers: { 'Content-Type': contentType },
    };
  }

  async complete(
    type: string,
    id: string,
    body: Record<string, unknown>,
    user: AuthUser,
    auditContext: AttachmentAuditContext = {},
  ) {
    const data = await this.row(type, id, user);
    this.assertUpload(this.state(data.config, data.row));
    const attachmentId = String(body.attachmentId ?? '');
    const objectKey = String(body.objectKey ?? '');
    const fileName = String(body.fileName ?? '').trim();
    const contentType = String(body.contentType ?? '')
      .trim()
      .toLowerCase();
    const size = Number(body.size);
    const suffix = extname(fileName).toLowerCase();
    const expectedKey = `documents/tmp/${user.id}/${attachmentId}${suffix}`;
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        attachmentId,
      ) ||
      objectKey !== expectedKey
    )
      throw new BadRequestException('附件对象标识无效');
    if (!fileName || !this.validFileType(contentType, suffix))
      throw new BadRequestException('附件格式、扩展名或MIME类型不允许');
    if (!Number.isSafeInteger(size) || size <= 0 || size > this.maxSize)
      throw new BadRequestException('附件大小无效或超过限制');
    if (data.attachments.some((item) => item.id === attachmentId)) return { id: attachmentId };
    const head = await this.oss().head(objectKey);
    const headers = (head.res.headers ?? {}) as Record<string, string | string[] | undefined>;
    const actualSize = Number(headers['content-length']);
    const actualType = String(headers['content-type'] ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase();
    if (actualSize !== size || actualType !== contentType) {
      await this.oss()
        .delete(objectKey)
        .catch(() => undefined);
      throw new BadRequestException('附件与上传申请不一致');
    }
    const finalKey = `documents/${type}/${id}/${attachmentId}${suffix}`;
    await this.oss().copy(finalKey, objectKey);
    await this.oss()
      .delete(objectKey)
      .catch(() => undefined);
    const attachment: Attachment = {
      id: attachmentId,
      objectKey: finalKey,
      fileName,
      contentType,
      size,
      uploadedBy: user.id,
      uploadedAt: new Date().toISOString(),
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await this.row(type, id, user, tx, true);
        this.assertUpload(this.state(locked.config, locked.row));
        const existing = locked.attachments.find((item) => item.id === attachmentId);
        if (existing) return existing;
        if (locked.attachments.length >= this.maxCount)
          throw new BadRequestException('附件数量已达到上限');
        const next = [...locked.attachments, attachment];
        await tx.$executeRawUnsafe(
          `UPDATE \`${locked.config.table}\` SET attachments = ? WHERE \`${locked.config.id}\` = ?`,
          JSON.stringify(next),
          BigInt(id),
        );
        await this.audit('UPLOAD', type, id, attachment, user, auditContext, tx);
        return attachment;
      });
    } catch (error) {
      await this.oss()
        .delete(finalKey)
        .catch(() => undefined);
      throw error;
    }
  }

  private async accessUrl(
    type: string,
    id: string,
    attachmentId: string,
    user: AuthUser,
    auditContext: AttachmentAuditContext,
    action: 'PREVIEW' | 'DOWNLOAD',
  ) {
    const data = await this.row(type, id, user);
    const attachment = data.attachments.find((item) => item.id === attachmentId);
    if (!attachment) throw new NotFoundException('附件不存在');
    const expires = Number(this.config.get('OSS_DOWNLOAD_URL_TTL_SECONDS') ?? 600);
    const url = this.oss().signatureUrl(attachment.objectKey, {
      expires,
      response: {
        'content-disposition': `${action === 'PREVIEW' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      },
    });
    await this.audit(action, type, id, attachment, user, auditContext);
    return { url, expiresIn: expires };
  }

  downloadUrl(
    type: string,
    id: string,
    attachmentId: string,
    user: AuthUser,
    auditContext: AttachmentAuditContext = {},
  ) {
    return this.accessUrl(type, id, attachmentId, user, auditContext, 'DOWNLOAD');
  }

  previewUrl(
    type: string,
    id: string,
    attachmentId: string,
    user: AuthUser,
    auditContext: AttachmentAuditContext = {},
  ) {
    return this.accessUrl(type, id, attachmentId, user, auditContext, 'PREVIEW');
  }

  async remove(
    type: string,
    id: string,
    attachmentId: string,
    user: AuthUser,
    auditContext: AttachmentAuditContext = {},
  ) {
    const attachment = await this.prisma.$transaction(async (tx) => {
      const data = await this.row(type, id, user, tx, true);
      if (this.state(data.config, data.row) !== 'draft')
        throw new BadRequestException('仅草稿状态允许删除附件');
      const found = data.attachments.find((item) => item.id === attachmentId);
      if (!found) throw new NotFoundException('附件不存在');
      const next = data.attachments.filter((item) => item.id !== attachmentId);
      await tx.$executeRawUnsafe(
        `UPDATE \`${data.config.table}\` SET attachments = ? WHERE \`${data.config.id}\` = ?`,
        JSON.stringify(next),
        BigInt(id),
      );
      await this.audit('DELETE', type, id, found, user, auditContext, tx);
      return found;
    });
    await this.oss()
      .delete(attachment.objectKey)
      .catch(() => undefined);
    return { id: attachmentId, message: '附件已删除' };
  }

  private audit(
    action: string,
    type: string,
    id: string,
    attachment: Attachment,
    user: AuthUser,
    auditContext: AttachmentAuditContext = {},
    db: any = this.prisma,
  ) {
    return db.hspsi_sys_oper_log.create({
      data: {
        method: action,
        router: `attachments/${type}/${id}`,
        url: attachment.objectKey,
        service_name: 'attachments',
        ip: auditContext.ip || null,
        request_data: JSON.stringify({ documentType: type, documentId: id, attachment }),
        response_code: '200',
        response_data: action,
        created_by: Number(user.id),
        updated_by: Number(user.id),
      },
    });
  }
}
