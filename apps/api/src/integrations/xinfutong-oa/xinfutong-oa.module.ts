import { Module } from '@nestjs/common';
import { XinfutongOaCredentialService } from './xinfutong-oa-credential.service';
import { XinfutongOaService } from './xinfutong-oa.service';
import { XinfutongOaSyncService } from './xinfutong-oa-sync.service';

@Module({
  providers: [XinfutongOaCredentialService, XinfutongOaService, XinfutongOaSyncService],
  exports: [XinfutongOaService, XinfutongOaSyncService, XinfutongOaCredentialService],
})
export class XinfutongOaModule {}
