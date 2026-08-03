import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BaseDataController } from './base-data.controller';
import { BaseDataService } from './base-data.service';

@Module({ imports: [AuthModule], controllers: [BaseDataController], providers: [BaseDataService] })
export class BaseDataModule {}
