import 'reflect-metadata';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { config } from './config.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
app.disable('x-powered-by');
app.useGlobalPipes(new StandardSchemaValidationPipe());
app.enableShutdownHooks();
await app.listen(config.port);
