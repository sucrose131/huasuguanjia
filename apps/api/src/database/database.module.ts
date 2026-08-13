import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BusinessReferenceService } from './business-reference.service';
import { BusinessMasterDataService } from './business-master-data.service';

@Global()
@Module({
  providers: [PrismaService, BusinessReferenceService, BusinessMasterDataService],
  exports: [PrismaService, BusinessReferenceService, BusinessMasterDataService],
})
export class DatabaseModule {}
