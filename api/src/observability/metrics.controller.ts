import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators.js';
import { register } from './metrics.js';

@Controller('metrics')
@Public()
@SkipThrottle()
export class MetricsController {
  @Get()
  async metrics(@Res() response: Response) {
    response.setHeader('Content-Type', register.contentType);
    response.send(await register.metrics());
  }
}
