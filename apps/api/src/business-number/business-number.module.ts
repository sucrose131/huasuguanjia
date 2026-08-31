import { Global, Module } from '@nestjs/common';
import { BusinessNumberService } from './business-number.service';

@Global()
@Module({ providers: [BusinessNumberService], exports: [BusinessNumberService] })
export class BusinessNumberModule {}
