import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { ScheduledTaskRunner } from './scheduled-task.runner';
import { ScheduledTaskService } from './scheduled-task.service';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('system')
export class ScheduledTaskController {
  constructor(
    @Inject(ScheduledTaskService) private readonly service: ScheduledTaskService,
    @Inject(ScheduledTaskRunner) private readonly runner: ScheduledTaskRunner,
  ) {}

  @Get('scheduled-task-types')
  @RequirePermissions('system:view', 'system:4:view')
  types() {
    return this.service.types();
  }

  @Get('scheduled-task-cron-preview')
  @RequirePermissions('system:view', 'system:4:view')
  preview(@Query('cronExpr') cronExpr: string) {
    return this.service.previewCron(cronExpr);
  }

  @Get('scheduled-tasks')
  @RequirePermissions('system:view', 'system:4:view')
  list() {
    return this.service.list();
  }

  @Post('scheduled-tasks')
  @RequirePermissions('system:create')
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.service.create(body, user.id);
  }

  @Put('scheduled-tasks/:id')
  @RequirePermissions('system:update')
  update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, body, user.id);
  }

  @Delete('scheduled-tasks/:id')
  @RequirePermissions('system:delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }

  @Post('scheduled-tasks/:id/run')
  @RequirePermissions('system:update')
  run(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.runner.start(id, user.id);
  }

  @Get('scheduled-tasks/:id/runs')
  @RequirePermissions('system:view', 'system:4:view')
  listRuns(@Param('id') id: string) {
    return this.service.listRuns(id);
  }

  @Get('scheduled-tasks/:id/runs/:runId')
  @RequirePermissions('system:view', 'system:4:view')
  getRun(@Param('id') id: string, @Param('runId') runId: string) {
    return this.service.getRun(id, runId);
  }
}
