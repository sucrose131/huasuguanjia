import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientService } from '../common/http-client.service';

/**
 * 十方清源对接服务
 * 职责：调用十方清源外部接口获取信息
 * 凭证：走 .env 环境变量
 */
@Injectable()
export class ShifangQingyuanService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(HttpClientService) private readonly http: HttpClientService,
  ) {}

  private get baseUrl() {
    return this.config.getOrThrow<string>('SHIFANG_QINGYUAN_BASE_URL');
  }

  private get appId() {
    return this.config.getOrThrow<string>('SHIFANG_QINGYUAN_APP_ID');
  }

  private get appSecret() {
    return this.config.getOrThrow<string>('SHIFANG_QINGYUAN_APP_SECRET');
  }

  // TODO: 按业务需求补充具体调用方法
}
