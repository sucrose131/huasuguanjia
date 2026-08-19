import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionGuard } from '../auth/permission.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { AuthUser } from '../auth/auth.types';
import { SystemService } from './system.service';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('system')
export class SystemController {
  constructor(@Inject(SystemService) private readonly service: SystemService) {}

  @Get('roles')
  @RequirePermissions('system:view', 'system:1:view')
  roles() {
    return this.service.roles();
  }

  @Post('roles')
  @RequirePermissions('system:roles:create')
  createRole(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.service.createRole(body, user.id);
  }

  @Put('roles/:id')
  @RequirePermissions('system:roles:update')
  updateRole(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateRole(id, body, user.id);
  }

  @Get('users')
  @RequirePermissions('system:view', 'system:2:view')
  users() {
    return this.service.users();
  }

  @Get('user-options')
  @RequirePermissions('system:view', 'system:2:view')
  userOptions(@CurrentUser() user: AuthUser) {
    return this.service.userOptions(
      user.isSuperAdmin === true ? undefined : user.authorizedOrganizations?.map((item) => item.id),
    );
  }

  @Post('users')
  @RequirePermissions('system:users:create')
  createUser(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.service.createUser(body, user.id, user.isSuperAdmin === true);
  }

  @Put('users/:id')
  @RequirePermissions('system:users:update')
  updateUser(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateUser(id, body, user.id, user.isSuperAdmin === true);
  }

  @Put('users/:id/roles')
  @RequirePermissions('system:users:authorize-role')
  updateUserRoles(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateUserRoles(id, body, user.id, user.isSuperAdmin === true);
  }

  @Put('users/:id/amount-access')
  @RequirePermissions('system:users:configure-amount')
  updateUserAmountAccess(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateUserAmountAccess(id, body, user.id);
  }

  @Get('menus')
  @RequirePermissions('system:view', 'system:3:view')
  menus() {
    return this.service.menus();
  }

  @Get('menu-options')
  @RequirePermissions('system:view', 'system:3:view')
  menuOptions() {
    return this.service.menuOptions();
  }

  @Post('menus')
  @RequirePermissions('system:config:create')
  createMenu(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.service.createMenu(body, user.id);
  }

  @Put('menus/:id')
  @RequirePermissions('system:config:update')
  updateMenu(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateMenu(id, body, user.id);
  }

  @Delete('menus/:id')
  @RequirePermissions('system:config:delete')
  deleteMenu(@Param('id') id: string) {
    return this.service.deleteMenu(id);
  }
}
