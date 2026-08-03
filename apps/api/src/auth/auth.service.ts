import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AuthUser } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(RedisService) private redis: RedisService,
    @Inject(JwtService) private jwt: JwtService,
    @Inject(ConfigService) private config: ConfigService,
  ) {}
  private async sessionData(userId: string) {
    const user = await this.prisma.hspsi_sys_user.findFirst({
      where: { id: BigInt(userId), deleted_at: null, status: 1 },
    });
    if (!user) throw new UnauthorizedException('账号不存在或已停用');
    const roles = await this.prisma.hspsi_sys_user_role.findMany({
      where: { user_id: Number(user.id) },
    });
    const roleIds = roles.map((item) => BigInt(item.role_id));
    const roleMenus = roleIds.length
      ? await this.prisma.hspsi_sys_role_menu.findMany({ where: { role_id: { in: roleIds } } })
      : [];
    const menuIds = [...new Set(roleMenus.map((item) => Number(item.menu_id)))];
    const menus = menuIds.length
      ? await this.prisma.hspsi_sys_menu.findMany({
          where: { id: { in: menuIds }, deleted_at: null, status: 1 },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        })
      : [];
    const isAdmin = roleIds.length
      ? await this.prisma.hspsi_sys_role.findFirst({
          where: { id: { in: roleIds }, code: 'admin', status: 1, deleted_at: null },
        })
      : null;
    const authUser: AuthUser = {
      id: user.id.toString(),
      username: user.username,
      orgId: user.org_id?.toString() ?? null,
      deptId: user.dept_id?.toString() ?? null,
      permissions: isAdmin ? ['*'] : menus.map((item) => item.code),
    };
    return { user: authUser, menus };
  }
  async login(username: string, password: string) {
    const normalizedUsername = username.trim();
    const user = await this.prisma.hspsi_sys_user.findFirst({
      where: { username: normalizedUsername, deleted_at: null, status: 1 },
    });
    if (!user || !(await compare(password, user.password)))
      throw new UnauthorizedException('账号或密码错误');
    const { user: authUser, menus } = await this.sessionData(user.id.toString());
    const sid = randomUUID();
    const ttl = Number(this.config.get('SESSION_TTL_SECONDS') ?? 28800);
    await this.redis.ensureConnected();
    await this.redis.client.set(`session:${sid}`, user.id.toString(), 'EX', ttl);
    return { token: await this.jwt.signAsync({ ...authUser, sid }), user: authUser, menus };
  }
  session(userId: string) {
    return this.sessionData(userId);
  }
  async logout(sid: string) {
    await this.redis.ensureConnected();
    await this.redis.client.del(`session:${sid}`);
  }
}
