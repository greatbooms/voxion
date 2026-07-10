import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from '../config/app-config.module';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [AuthController],
  providers: [
    AdminAuthService,
    {
      provide: APP_GUARD,
      useClass: AdminAuthGuard,
    },
  ],
  exports: [AdminAuthService],
})
export class AuthModule {}
