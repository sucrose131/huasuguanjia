import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PermissionGuard } from './permission.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: (config.get('JWT_ACCESS_TTL') ?? '15m') as any },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, PermissionGuard],
  exports: [AuthGuard, PermissionGuard, JwtModule],
})
export class AuthModule {}
