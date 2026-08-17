import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { BusinessReferenceService } from './business-reference.service';
import { BusinessMasterDataService } from './business-master-data.service';
import { DataScopeInterceptor } from './data-scope.interceptor';

@Global()
@Module({
  providers: [
    PrismaService,
    BusinessReferenceService,
    BusinessMasterDataService,
    { provide: APP_INTERCEPTOR, useClass: DataScopeInterceptor },
  ],
  exports: [PrismaService, BusinessReferenceService, BusinessMasterDataService],
})
export class DatabaseModule {}
