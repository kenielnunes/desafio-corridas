import 'reflect-metadata';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { z } from 'zod';
import { AppModule } from './app.module.js';
import { config } from './config.js';

z.config(z.locales.ptBR());

const app = await NestFactory.create<NestExpressApplication>(AppModule);
app.disable('x-powered-by');
app.useBodyParser('json', { limit: '10kb' });
app.useGlobalPipes(new StandardSchemaValidationPipe());
app.enableShutdownHooks();
await app.listen(config.port);
