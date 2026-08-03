import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BusinessReferenceService } from './business-reference.service';

@Global()
@Module({
  providers: [PrismaService, BusinessReferenceService],
  exports: [PrismaService, BusinessReferenceService],
})
export class DatabaseModule {}
