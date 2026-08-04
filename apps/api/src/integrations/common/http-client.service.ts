import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * 统一外部对接 HTTP 客户端
 * 职责：封装超时、重试、流水日志，供三个对接模块复用
 */
@Injectable()
export class HttpClientService {
  private readonly logger = new Logger(HttpClientService.name);

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  /**
   * 发起外部请求（骨架占位，后续按需接入 fetch/axios）
   * @param provider 对接方标识，如 'xinfutong-oa'，用于日志归类
   * @param url 完整请求地址
   * @param init 请求参数
   */
  async request(provider: string, url: string, init?: RequestInit): Promise<Response> {
    this.logger.log(`[${provider}] -> ${init?.method ?? 'GET'} ${url}`);
    // TODO: 实现超时、重试、签名注入、流水落库
    return fetch(url, init);
  }
}
