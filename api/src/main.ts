import 'reflect-metadata';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';
import { AppModule } from './app.module.js';
import { config } from './config.js';
import { assignCorrelationId } from './observability/correlation.js';
import { measureHttp } from './observability/http-metrics.js';

z.config(z.locales.ptBR());

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.use(measureHttp);
app.use(assignCorrelationId);
app.disable('x-powered-by');
app.useBodyParser('json', { limit: '10kb' });
app.useGlobalPipes(new StandardSchemaValidationPipe());
app.enableShutdownHooks();
await app.listen(config.port);
