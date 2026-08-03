import { Body, Controller, Get, Headers, Inject, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.types';

class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(50) username!: string;
  @IsString() @IsNotEmpty() @MaxLength(128) password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private service: AuthService,
    @Inject(JwtService) private jwt: JwtService,
  ) {}
  @Post('login') login(@Body() dto: LoginDto) {
    return this.service.login(dto.username, dto.password);
  }
  @UseGuards(AuthGuard) @Get('me') me(@CurrentUser() user: AuthUser) {
    return user;
  }
  @UseGuards(AuthGuard) @Get('session') session(@CurrentUser() user: AuthUser) {
    return this.service.session(user.id);
  }
  @UseGuards(AuthGuard) @Post('logout') async logout(
    @Headers('authorization') authorization: string,
  ) {
    const payload = this.jwt.decode(authorization.replace(/^Bearer\s+/i, '')) as { sid: string };
    await this.service.logout(payload.sid);
    return { message: '已退出登录' };
  }
}
