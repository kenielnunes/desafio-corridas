import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { UserRateLimitGuard } from './auth/rate-limit.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { config } from './config.js';
import { HealthController } from './health.controller.js';
import { PrismaService } from './prisma.service.js';
import { RidesController } from './rides/rides.controller.js';
import { RidesService } from './rides/rides.service.js';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: config.rateLimit.requestsPerMinute }],
    }),
  ],
  controllers: [RidesController, HealthController],
  providers: [
    PrismaService,
    RidesService,
    // A ordem importa: autenticação, depois perfil, depois rate limit (que conta pelo usuário já autenticado).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: UserRateLimitGuard },
  ],
})
export class AppModule {}
