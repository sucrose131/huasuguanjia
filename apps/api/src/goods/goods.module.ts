import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GoodsController } from './goods.controller';
import { GoodsService } from './goods.service';
@Module({ imports: [AuthModule], controllers: [GoodsController], providers: [GoodsService] })
export class GoodsModule {}
