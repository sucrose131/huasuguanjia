import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

/**
 * 账套凭证信息
 */
export interface AccountSetCredential {
  /** 账套主键 ID */
  id: bigint;
  /** 账套名称 */
  name: string;
  /** 应用 ID（薪福通 header appid） */
  appId: string;
  /** 授权密钥（hex，用于 SM2 加签与 SM4 加密） */
  appSecret: string;
}

/**
 * 薪福通凭证服务
 *
 * 职责：从 hspsi_sys_account_set 读取启用的账套凭证，带内存缓存。
 *
 * 对应 PHP 版：handle() 中遍历 status=1 的账套，逐个设置 appId/authoritySecret。
 * 一个系统可能对接多个薪福通企业账号，每个账号对应一条账套记录。
 */
@Injectable()
export class XinfutongOaCredentialService {
  private static readonly logger = new Logger(XinfutongOaCredentialService.name);
  /** 缓存：所有启用账套，TTL 5 分钟 */
  private cache: { credentials: AccountSetCredential[]; expireAt: number } | null = null;
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 获取所有启用的账套凭证
   *
   * 对应 PHP 版：DB::table('hspsi_sys_account_set')->where('status', 1)->get()
   */
  async getAllEnabled(): Promise<AccountSetCredential[]> {
    if (this.cache && Date.now() < this.cache.expireAt) {
      return this.cache.credentials;
    }
    const records = await this.prisma.hspsi_sys_account_set.findMany({
      where: { status: 1, deleted_at: null },
      select: { id: true, name: true, app_id: true, app_secret: true },
    });
    const credentials: AccountSetCredential[] = records.map((r) => ({
      id: r.id,
      name: r.name,
      appId: r.app_id,
      appSecret: r.app_secret,
    }));
    if (credentials.length === 0) {
      XinfutongOaCredentialService.logger.warn('hspsi_sys_account_set 表中没有启用的应用配置');
    }
    this.cache = { credentials, expireAt: Date.now() + this.cacheTtlMs };
    return credentials;
  }

  /**
   * 按 ID 获取单个账套凭证
   */
  async getById(id: bigint): Promise<AccountSetCredential | null> {
    const all = await this.getAllEnabled();
    return all.find((c) => c.id === id) ?? null;
  }

  /** 清除缓存（凭证变更后可手动调用） */
  invalidate() {
    this.cache = null;
  }
}
