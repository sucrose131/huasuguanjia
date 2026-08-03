import { Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AuthUser } from '../auth/auth.types';
import { DashboardService } from './dashboard.service';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly service: DashboardService) {}

  @Get()
  @RequirePermissions('dashboard:1:view', 'dashboard:4:view')
  overview(@CurrentUser() user: AuthUser) {
    return this.service.overview(user);
  }

  @Get('todos')
  @RequirePermissions('dashboard:2:view')
  todos(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.service.todos(user, query);
  }

  @Get('messages')
  @RequirePermissions('dashboard:3:view')
  messages(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return this.service.messages(user, query);
  }

  @Post('messages/:id/read')
  @RequirePermissions('dashboard:3:view')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.readMessage(user, id);
  }
}
