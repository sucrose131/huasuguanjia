import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type KeyObject } from 'crypto';
import { HttpClientService } from '../common/http-client.service';
import { buildSortedJson, generateNonce, loadPublicKey, signWithPublicKey } from './huasu-home.crypto';
import {
  HUASU_HOME_SUCCESS_CODE,
  type HuasuHomeProductListData,
  type HuasuHomeConferenceOrderListData,
  type HuasuHomeInstallmentOrderListData,
  type HuasuHomeOrder,
  type HuasuHomeOrderListData,
  type HuasuHomeOrderListQuery,
  type HuasuHomeRequestOptions,
  type HuasuHomeResponse,
  type HuasuHomeUserListData,
  type HuasuHomeUserListQuery,
} from './huasu-home.types';

/**
 * 华溯之家对接服务
 *
 * 职责：封装华溯之家外部接口的基础请求能力，包括：
 * - 请求参数按 Key ASCII 升序排序
 * - 公钥加密生成签名（RSA_PKCS1_PADDING）
 * - 请求头注入（X-Sign / X-Timestamp / X-Nonce）
 * - 统一返回码校验（code === 200）
 *
 * 凭证：走 .env 环境变量（HUASU_HOME_APP_PUBLIC_KEY）
 *
 * 对应 docs/integrations/huasu-home/请求规则.md
 */
@Injectable()
export class HuasuHomeService {
  private static readonly logger = new Logger(HuasuHomeService.name);

  /** 默认请求超时（毫秒） */
  private static readonly DEFAULT_TIMEOUT_MS = 30_000;

  /** 公钥 KeyObject 缓存（避免重复解析） */
  private publicKeyCache: KeyObject | null = null;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(HttpClientService) private readonly http: HttpClientService,
  ) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('HUASU_HOME_BASE_URL').replace(/\/+$/, '');
  }

  private buildUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${normalizedPath}`;
  }

  private get publicKeyPem(): string {
    return this.config.getOrThrow<string>('HUASU_HOME_APP_PUBLIC_KEY');
  }

  /**
   * 发送 POST 请求
   *
   * 流程：
   * 1. 请求参数按 Key ASCII 升序排序后 JSON 序列化（签名与发送 body 需保持一致）
   * 2. 生成秒级时间戳与 32 位随机串
   * 3. 待签名串 = timestamp + sortedJson + nonce
   * 4. 公钥加密生成签名，base64 编码
   * 5. 注入 X-Sign / X-Timestamp / X-Nonce 请求头
   * 6. 发送请求并校验返回码
   *
   * @param path 接口路径，如 /api/xxx
   * @param body 请求体参数（对象）
   * @param options 请求选项
   * @returns 接口响应（已校验返回码）
   */
  async post<T = unknown>(
    path: string,
    body: Record<string, unknown>,
    options?: HuasuHomeRequestOptions,
  ): Promise<HuasuHomeResponse<T>> {
    // 1. 排序后 JSON（签名与发送 body 需保持一致）
    const sortedJson = buildSortedJson(body);

    // 2. 时间戳（秒）+ 32 位随机串
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = generateNonce();

    // 3. 待签名串：时间戳 + JSON + 随机串
    const signStr = `${timestamp}${sortedJson}${nonce}`;

    // 4. 公钥加密生成签名
    const sign = this.sign(signStr);

    // 5. 请求头
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Sign': sign,
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      ...options?.headers,
    };

    // 6. 发送请求
    const url = this.buildUrl(path);
    HuasuHomeService.logger.log(`[huasu-home] -> POST ${url}`);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options?.timeout ?? HuasuHomeService.DEFAULT_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await this.http.request('huasu-home', url, {
        method: 'POST',
        headers,
        body: sortedJson,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`华溯之家接口请求超时，URL: ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const respBody = await response.text().catch(() => '');
      throw new Error(
        `华溯之家接口请求失败，HTTP ${response.status}，URL: ${url}，响应: ${respBody}`,
      );
    }

    // 7. 解析响应
    const text = await response.text();
    let data: HuasuHomeResponse<T>;
    try {
      data = JSON.parse(text) as HuasuHomeResponse<T>;
    } catch {
      throw new Error(`华溯之家响应 JSON 解析失败，URL: ${url}，响应: ${text}`);
    }

    this.assertSuccess(data, url);
    return data;
  }

  /**
   * 校验返回码是否成功
   *
   * 成功：code === 200
   */
  protected assertSuccess(response: HuasuHomeResponse, url: string): void {
    if (response.code === HUASU_HOME_SUCCESS_CODE) {
      return;
    }
    const msg = response.message ?? response.msg ?? '未知错误';
    throw new Error(
      `华溯之家接口调用失败，code: ${response.code}，message: ${msg}，URL: ${url}`,
    );
  }

  /**
   * 使用公钥加密生成签名（缓存 KeyObject）
   */
  private sign(signStr: string): string {
    if (!this.publicKeyCache) {
      this.publicKeyCache = loadPublicKey(this.publicKeyPem);
    }
    return signWithPublicKey(signStr, this.publicKeyCache);
  }

  /**
   * 获取商品列表
   *
   * POST /hspsi/product/list
   * 返回套餐列表（packages）与单品列表（products）
   *
   * 对应 docs/integrations/huasu-home/商品列表.md
   */
  async getProductList(): Promise<HuasuHomeProductListData> {
    const response = await this.post<HuasuHomeProductListData>(
      '/hspsi/product/list',
      {},
    );
    return response.data!;
  }

  /**
   * 获取订单列表
   *
   * POST /hspsi/order/list
   * 必填 page / page_size / updated_at（Y-m-d H:i:s）
   * 对应 docs/integrations/huasu-home/订单列表.md
   */
  async getOrderList(query: HuasuHomeOrderListQuery): Promise<HuasuHomeOrderListData> {
    if (!query?.updated_at) {
      throw new Error('华溯订单列表必须传 updated_at（格式 Y-m-d H:i:s）');
    }
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.page_size) || 100);
    const response = await this.post<HuasuHomeOrderListData>('/hspsi/order/list', {
      page,
      page_size: pageSize,
      updated_at: String(query.updated_at),
    });
    return response.data!;
  }

  /**
   * 获取会议门票订单列表
   *
   * POST /hspsi/order-conference/list
   * 必填 page / page_size / updated_at（Y-m-d H:i:s）
   * 对应 docs/integrations/huasu-home/会议门票订单列表.md
   */
  async getConferenceOrderList(
    query: HuasuHomeOrderListQuery,
  ): Promise<HuasuHomeConferenceOrderListData> {
    if (!query?.updated_at) {
      throw new Error('华溯会议门票订单列表必须传 updated_at（格式 Y-m-d H:i:s）');
    }
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.page_size) || 100);
    const response = await this.post<HuasuHomeConferenceOrderListData>(
      '/hspsi/order-conference/list',
      {
        page,
        page_size: pageSize,
        updated_at: String(query.updated_at),
      },
    );
    return response.data!;
  }

  /**
   * 获取分期订单列表
   *
   * POST /hspsi/order-installment/list
   * 必填 page / page_size / updated_at（Y-m-d H:i:s）
   * 对应 docs/integrations/huasu-home/分期订单列表.md
   */
  async getInstallmentOrderList(
    query: HuasuHomeOrderListQuery,
  ): Promise<HuasuHomeInstallmentOrderListData> {
    if (!query?.updated_at) {
      throw new Error('华溯分期订单列表必须传 updated_at（格式 Y-m-d H:i:s）');
    }
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.page_size) || 100);
    const response = await this.post<HuasuHomeInstallmentOrderListData>(
      '/hspsi/order-installment/list',
      {
        page,
        page_size: pageSize,
        updated_at: String(query.updated_at),
      },
    );
    return response.data!;
  }

  /**
   * 获取订单详情（POST /hspsi/order/info，按 order_sn 查询）
   *
   * 对应 docs/integrations/huasu-home/订单详情.md
   */
  async getOrderInfo(orderSn: string): Promise<HuasuHomeOrder> {
    const response = await this.post<HuasuHomeOrder>('/hspsi/order/info', {
      order_sn: String(orderSn),
    });
    return response.data!;
  }

  /** @deprecated 使用 getOrderInfo(orderSn) */
  async getOrderDetail(orderIdOrSn: number | string): Promise<HuasuHomeOrder> {
    return this.getOrderInfo(String(orderIdOrSn));
  }

  /**
   * 获取用户列表
   *
   * POST /hspsi/user/list
   * 对应 docs/global/integrations/huasu-home/用户列表.md
   */
  async getUserList(query: HuasuHomeUserListQuery): Promise<HuasuHomeUserListData> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.max(1, Number(query.page_size) || 100);
    const id = Math.max(0, Number(query.id) || 0);
    const response = await this.post<HuasuHomeUserListData>('/hspsi/user/list', {
      page,
      page_size: pageSize,
      id,
    });
    return response.data!;
  }
}