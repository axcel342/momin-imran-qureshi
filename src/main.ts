import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config/env';

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const config = loadConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.PORT);
  const server = app.getHttpServer();
  server.requestTimeout = config.REQUEST_TIMEOUT_MS + 5000;
  server.headersTimeout = Math.min(10000, server.requestTimeout);
}

void main();
