import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { UserRateLimitGuard } from './auth/rate-limit.guard.js';
import { RolesGuard } from './auth/roles.guard.js';
import { config } from './config.js';
import { EventPublisher } from './events/publisher.js';
import { HealthController } from './health.controller.js';
import { INTERNAL_PATHS } from './observability/http-metrics.js';
import { MetricsController } from './observability/metrics.controller.js';
import { PrismaService } from './prisma.service.js';
import { RideCache } from './rides/cache.js';
import { RidesController } from './rides/rides.controller.js';
import { RidesService } from './rides/rides.service.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        base: { service: 'api' },
        timestamp: stdTimeFunctions.isoTime,
        formatters: { level: (label) => ({ level: label }) },
        customProps: (request) => ({ correlation_id: request.id }),
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        autoLogging: { ignore: (request) => INTERNAL_PATHS.test(request.url ?? '') },
        serializers: {
          req: (request) => ({ method: request.method, url: request.url }),
          res: (response) => ({ statusCode: response.statusCode }),
        },
      },
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: config.rateLimit.requestsPerMinute }],
      errorMessage: 'muitas requisições; tente de novo em instantes',
    }),
  ],
  controllers: [RidesController, HealthController, MetricsController],
  providers: [
    PrismaService,
    RidesService,
    EventPublisher,
    RideCache,
    // A ordem importa: autenticação, depois perfil, depois rate limit (que conta pelo usuário já autenticado).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: UserRateLimitGuard },
  ],
})
export class AppModule {}
