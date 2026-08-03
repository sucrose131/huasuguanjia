import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentTraceController } from './document-trace.controller';
import { DocumentTraceService } from './document-trace.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [DocumentTraceController],
  providers: [DocumentTraceService],
  exports: [DocumentTraceService],
})
export class DocumentTraceModule {}
