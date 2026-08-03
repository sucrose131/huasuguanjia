import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { BaseDataService } from './base-data.service';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('base-data')
export class BaseDataController {
  constructor(@Inject(BaseDataService) private service: BaseDataService) {}
  @RequirePermissions('master-data')
  @Get(':resource/options')
  options(
    @Param('resource') resource: string,
    @Query('keyword') keyword?: string,
    @Query('orgId') orgId?: string,
  ) {
    return this.service.options(resource, keyword, orgId);
  }
  @RequirePermissions('master-data')
  @Get(':resource')
  list(@Param('resource') resource: string, @Query() query: Record<string, string | undefined>) {
    return this.service.list(resource, query);
  }
  @RequirePermissions('master-data')
  @Get(':resource/:id')
  detail(@Param('resource') resource: string, @Param('id') id: string) {
    return this.service.detail(resource, id);
  }
  @RequirePermissions('master-data')
  @Post(':resource')
  create(
    @Param('resource') resource: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(resource, body, user.id);
  }
  @RequirePermissions('master-data')
  @Patch(':resource/:id')
  update(
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(resource, id, body, user.id);
  }
  @RequirePermissions('master-data')
  @Patch(':resource/:id/status')
  setStatus(
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body('status') status: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setStatus(resource, id, Number(status), user.id);
  }
  @RequirePermissions('master-data')
  @Delete(':resource/:id')
  remove(
    @Param('resource') resource: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.remove(resource, id, user.id);
  }
}
