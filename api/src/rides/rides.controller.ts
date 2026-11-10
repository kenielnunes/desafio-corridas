import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../auth/decorators.js';
import type { User } from '../auth/user.js';
import { config } from '../config.js';
import { RidesService } from './rides.service.js';
import {
  type CreateRide,
  CreateRideSchema,
  type ListRides,
  ListRidesSchema,
  parseIdempotencyKey,
  RideIdSchema,
  type UpdateStatus,
  UpdateStatusSchema,
} from './schemas.js';

const ONE_MINUTE = 60_000;

@Controller('corridas')
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  @Post()
  @Roles('passageiro')
  @Throttle({ default: { limit: config.rateLimit.createsPerMinute, ttl: ONE_MINUTE } })
  async create(
    @CurrentUser() user: User,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body({ schema: CreateRideSchema }) data: CreateRide,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { ride, replayed } = await this.rides.create(
      user.id,
      parseIdempotencyKey(idempotencyKey),
      data,
    );
    if (replayed) response.setHeader('Idempotent-Replayed', 'true');
    return ride;
  }

  @Get()
  list(@CurrentUser() user: User, @Query({ schema: ListRidesSchema }) query: ListRides) {
    return this.rides.list(user, query.available, query.limit);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: User,
    @Param('id', { schema: RideIdSchema }) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { ride, source } = await this.rides.get(user, id);
    response.setHeader('X-Cache', source);
    return ride;
  }

  @Patch(':id/status')
  @Roles('motorista')
  updateStatus(
    @CurrentUser() user: User,
    @Param('id', { schema: RideIdSchema }) id: string,
    @Body({ schema: UpdateStatusSchema }) data: UpdateStatus,
  ) {
    return this.rides.updateStatus(user.id, id, data.status);
  }
}
