import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AmountAccessService } from './amount-access.service';
import { AmountAccessInterceptor } from './amount-access.interceptor';

@Global()
@Module({
  providers: [
    AmountAccessService,
    { provide: APP_INTERCEPTOR, useClass: AmountAccessInterceptor },
  ],
  exports: [AmountAccessService],
})
export class AmountAccessModule {}
