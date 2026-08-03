import { Controller, Get, Inject, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PrismaService } from '../database/prisma.service';

@UseGuards(AuthGuard)
@Controller('dictionaries')
export class DictionaryController {
  constructor(@Inject(PrismaService) private prisma: PrismaService) {}
  @Get(':code') async list(@Param('code') code: string) {
    const category = await this.prisma.hspsi_sys_dictionary_category.findFirst({
      where: { dict_catg_code: code, deleted_at: null },
    });
    if (!category) return [];
    const items = await this.prisma.hspsi_sys_dictionary.findMany({
      where: { dict_catg_id: category.dict_catg_id, deleted_at: null },
      orderBy: { sort: 'asc' },
    });
    return items.map((item) => ({
      label: item.dict_name,
      value: item.dict_value,
      remark: item.remark,
    }));
  }
}
