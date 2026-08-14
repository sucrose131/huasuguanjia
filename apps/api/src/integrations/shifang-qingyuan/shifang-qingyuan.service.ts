import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientService } from '../common/http-client.service';
import {
  SHIFANG_QINGYUAN_SUCCESS_CODE,
  type ShifangQingyuanGoodsConstantsData,
  type ShifangQingyuanGoodsDetailData,
  type ShifangQingyuanGoodsListData,
  type ShifangQingyuanGoodsListQuery,
  type ShifangQingyuanOrderConstantsData,
  type ShifangQingyuanOrderDetailData,
  type ShifangQingyuanOrderListData,
  type ShifangQingyuanOrderListQuery,
  type ShifangQingyuanRefundListData,
  type ShifangQingyuanRefundListQuery,
  type ShifangQingyuanRequestOptions,
  type ShifangQingyuanResponse,
  type ShifangQingyuanUserListData,
  type ShifangQingyuanUserListQuery,
} from './shifang-qingyuan.types';

/**
 * 十方清源对接服务
 *
 * 职责：封装十方清源商品接口的基础请求能力，包括：
 * - 请求头注入 x-mall-sign / Host
 * - 统一返回码校验（code === 0）
 *
 * 凭证：走 .env 环境变量（SHIFANG_QINGYUAN_MALL_SIGN / SHIFANG_QINGYUAN_HOST）
 *
 * 对应 docs/global/integrations/shifang-qingyuan/goods-api.md
 */
@Injectable()
export class ShifangQingyuanService {
  private static readonly logger = new Logger(ShifangQingyuanService.name);

  /** 默认请求超时（毫秒） */
  private static readonly DEFAULT_TIMEOUT_MS = 30_000;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(HttpClientService) private readonly http: HttpClientService,
  ) {}

  private get baseUrl(): string {
    return this.config.getOrThrow<string>('SHIFANG_QINGYUAN_BASE_URL').replace(/\/+$/, '');
  }

  private get mallSign(): string {
    return this.config.getOrThrow<string>('SHIFANG_QINGYUAN_MALL_SIGN');
  }

  private get host(): string {
    return this.config.getOrThrow<string>('SHIFANG_QINGYUAN_HOST');
  }

  private buildUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${normalizedPath}`;
  }

  /**
   * 发送 POST 请求
   *
   * 流程：
   * 1. 注入 x-mall-sign / Host / Content-Type 请求头
   * 2. 发送请求并校验返回码（code === 0）
   *
   * @param path 接口路径，如 /open-api/v1/goods/list
   * @param body 请求体参数（对象）
   * @param options 请求选项
   * @returns 接口响应（已校验返回码）
   */
  async post<T = unknown>(
    path: string,
    body: Record<string, unknown>,
    options?: ShifangQingyuanRequestOptions,
  ): Promise<ShifangQingyuanResponse<T>> {
    const url = this.buildUrl(path);
    const bodyStr = JSON.stringify(body);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-mall-sign': this.mallSign,
      Host: this.host,
      ...options?.headers,
    };

    ShifangQingyuanService.logger.log(`[shifang-qingyuan] -> POST ${url}`);

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options?.timeout ?? ShifangQingyuanService.DEFAULT_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await this.http.request('shifang-qingyuan', url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`十方清源接口请求超时，URL: ${url}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const respBody = await response.text().catch(() => '');
      throw new Error(
        `十方清源接口请求失败，HTTP ${response.status}，URL: ${url}，响应: ${respBody}`,
      );
    }

    const text = await response.text();
    let data: ShifangQingyuanResponse<T>;
    try {
      data = JSON.parse(text) as ShifangQingyuanResponse<T>;
    } catch {
      throw new Error(`十方清源响应 JSON 解析失败，URL: ${url}，响应: ${text}`);
    }

    this.assertSuccess(data, url);
    return data;
  }

  /**
   * 校验返回码是否成功
   *
   * 成功：code === 0
   */
  protected assertSuccess(response: ShifangQingyuanResponse, url: string): void {
    if (response.code === SHIFANG_QINGYUAN_SUCCESS_CODE) {
      return;
    }
    throw new Error(
      `十方清源接口调用失败，code: ${response.code}，msg: ${response.msg}，URL: ${url}`,
    );
  }

  /**
   * 获取商品列表
   *
   * POST /open-api/v1/goods/list
   * 对应 docs/global/integrations/shifang-qingyuan/goods-api.md §1
   */
  async getGoodsList(query?: ShifangQingyuanGoodsListQuery): Promise<ShifangQingyuanGoodsListData> {
    const body: Record<string, unknown> = {};
    if (query?.page != null) body.page = query.page;
    if (query?.limit != null) body.limit = query.limit;
    if (query?.keyword) body.keyword = query.keyword;
    if (query?.is_on_sale != null) body.is_on_sale = query.is_on_sale;
    if (query?.cate_id != null) body.cate_id = query.cate_id;
    if (query?.goods_ids?.length) body.goods_ids = query.goods_ids;

    const response = await this.post<ShifangQingyuanGoodsListData>(
      '/open-api/v1/goods/list',
      body,
    );
    return response.data!;
  }

  /**
   * 获取商品详情
   *
   * POST /open-api/v1/goods/detail
   * 对应 docs/global/integrations/shifang-qingyuan/goods-api.md §2
   */
  async getGoodsDetail(goodsId: number): Promise<ShifangQingyuanGoodsDetailData> {
    const response = await this.post<ShifangQingyuanGoodsDetailData>(
      '/open-api/v1/goods/detail',
      { goods_id: goodsId },
    );
    return response.data!;
  }

  /**
   * 获取商品常量
   *
   * POST /open-api/v1/goods/constants
   * 对应 docs/global/integrations/shifang-qingyuan/goods-api.md §3
   */
  async getGoodsConstants(): Promise<ShifangQingyuanGoodsConstantsData> {
    const response = await this.post<ShifangQingyuanGoodsConstantsData>(
      '/open-api/v1/goods/constants',
      {},
    );
    return response.data!;
  }

  /**
   * 获取订单列表
   * POST /open-api/v1/order/list
   */
  async getOrderList(query?: ShifangQingyuanOrderListQuery): Promise<ShifangQingyuanOrderListData> {
    const body: Record<string, unknown> = {};
    if (query?.page != null) body.page = query.page;
    if (query?.limit != null) body.limit = query.limit;
    if (query?.order_no) body.order_no = query.order_no;
    if (query?.order_status != null) body.order_status = query.order_status;
    if (query?.pay_status != null) body.pay_status = query.pay_status;
    if (query?.shipping_status != null) body.shipping_status = query.shipping_status;
    if (query?.start_time) body.start_time = query.start_time;
    if (query?.end_time) body.end_time = query.end_time;

    const response = await this.post<ShifangQingyuanOrderListData>('/open-api/v1/order/list', body);
    return response.data!;
  }

  /**
   * 获取订单详情
   * POST /open-api/v1/order/detail
   */
  async getOrderDetail(orderId: number): Promise<ShifangQingyuanOrderDetailData> {
    const response = await this.post<ShifangQingyuanOrderDetailData>('/open-api/v1/order/detail', {
      order_id: orderId,
    });
    return response.data!;
  }

  /**
   * 获取售后列表
   * POST /open-api/v1/order/refund-list
   */
  async getRefundList(
    query?: ShifangQingyuanRefundListQuery,
  ): Promise<ShifangQingyuanRefundListData> {
    const body: Record<string, unknown> = {};
    if (query?.page != null) body.page = query.page;
    if (query?.limit != null) body.limit = query.limit;
    if (query?.order_id != null) body.order_id = query.order_id;
    if (query?.refund_status != null) body.refund_status = query.refund_status;
    if (query?.type != null) body.type = query.type;
    if (query?.start_time) body.start_time = query.start_time;
    if (query?.end_time) body.end_time = query.end_time;

    const response = await this.post<ShifangQingyuanRefundListData>(
      '/open-api/v1/order/refund-list',
      body,
    );
    return response.data!;
  }

  /**
   * 获取订单常量
   * POST /open-api/v1/order/constants
   */
  async getOrderConstants(): Promise<ShifangQingyuanOrderConstantsData> {
    const response = await this.post<ShifangQingyuanOrderConstantsData>(
      '/open-api/v1/order/constants',
      {},
    );
    return response.data!;
  }

  /**
   * 获取用户列表
   * POST /open-api/v1/user/list
   * 对应 docs/global/integrations/shifang-qingyuan/user-api.md §1
   * 每条已含 user / user_level / cloud_stock_agent，同步主流程不调用 detail。
   */
  async getUserList(query?: ShifangQingyuanUserListQuery): Promise<ShifangQingyuanUserListData> {
    const body: Record<string, unknown> = {};
    if (query?.page != null) body.page = query.page;
    if (query?.limit != null) body.limit = query.limit;
    if (query?.keyword) body.keyword = query.keyword;
    if (query?.level != null) body.level = query.level;
    if (query?.status != null) body.status = query.status;
    if (query?.start_time) body.start_time = query.start_time;
    if (query?.end_time) body.end_time = query.end_time;

    const response = await this.post<ShifangQingyuanUserListData>('/open-api/v1/user/list', body);
    return response.data!;
  }
}
