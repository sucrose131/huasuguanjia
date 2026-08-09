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
import { GoodsService } from './goods.service';

@UseGuards(AuthGuard, PermissionGuard)
@Controller('goods')
export class GoodsController {
  constructor(@Inject(GoodsService) private service: GoodsService) {}
  @RequirePermissions('goods')
  @Get('categories')
  categories(@Query() query: Record<string, string | undefined>, @CurrentUser() user: AuthUser) {
    return this.service.categories(query, user);
  }
  @RequirePermissions('goods')
  @Post('categories')
  createCategory(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.service.saveCategory(null, body, user.id);
  }
  @RequirePermissions('goods')
  @Patch('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.saveCategory(id, body, user.id);
  }
  @RequirePermissions('goods')
  @Patch('categories/:id/status')
  setCategoryStatus(
    @Param('id') id: string,
    @Body('status') status: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setCategoryStatus(id, Number(status), user.id);
  }
  @RequirePermissions('goods')
  @Delete('categories/:id')
  removeCategory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.removeCategory(id, user.id);
  }
  @RequirePermissions('goods')
  @Get('properties')
  properties(@Query() query: Record<string, string | undefined>) {
    return this.service.properties(query);
  }
  @RequirePermissions('goods')
  @Get('name-availability')
  nameAvailability(@Query('name') name: string, @CurrentUser() user: AuthUser) {
    return this.service.nameAvailability(name, user);
  }
  @RequirePermissions('goods')
  @Get()
  list(@Query() query: Record<string, string | undefined>, @CurrentUser() user: AuthUser) {
    return this.service.list(query, user);
  }
  @RequirePermissions('goods')
  @Get(':id')
  detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.detail(id, user);
  }
  @RequirePermissions('goods')
  @Post()
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: AuthUser) {
    return this.service.save(null, body, user);
  }
  @RequirePermissions('goods')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.save(id, body, user);
  }
  @RequirePermissions('goods')
  @Patch(':id/status')
  setStatus(
    @Param('id') id: string,
    @Body('status') status: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setStatus(id, Number(status), user);
  }
  @RequirePermissions('goods')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
