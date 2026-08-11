import { Global, Module } from '@nestjs/common';
import { HttpClientService } from './common/http-client.service';
import { IntegrationLoggerService } from './common/integration-logger';
import { XinfutongOaModule } from './xinfutong-oa/xinfutong-oa.module';
import { ShifangQingyuanModule } from './shifang-qingyuan/shifang-qingyuan.module';
import { HuasuHomeModule } from './huasu-home/huasu-home.module';

/**
 * 外部对接聚合模块
 * 聚合三个对接子模块，并导出公共 HTTP 客户端与日志服务
 */
@Global()
@Module({
  imports: [XinfutongOaModule, ShifangQingyuanModule, HuasuHomeModule],
  providers: [HttpClientService, IntegrationLoggerService],
  exports: [HttpClientService, IntegrationLoggerService, XinfutongOaModule],
})
export class IntegrationsModule {}
