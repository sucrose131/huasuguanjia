import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientService } from '../common/http-client.service';

/**
 * 华溯之家对接服务
 * 职责：调用华溯之家外部接口获取信息
 * 凭证：走 .env 环境变量
 */
@Injectable()
export class HuasuHomeService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(HttpClientService) private readonly http: HttpClientService,
  ) {}

  private get baseUrl() {
    return this.config.getOrThrow<string>('HUASU_HOME_BASE_URL');
  }

  private get appId() {
    return this.config.getOrThrow<string>('HUASU_HOME_APP_ID');
  }

  private get appSecret() {
    return this.config.getOrThrow<string>('HUASU_HOME_APP_SECRET');
  }

  // TODO: 按业务需求补充具体调用方法
}
