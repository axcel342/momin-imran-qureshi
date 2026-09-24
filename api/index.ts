import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/env';

let appPromise: Promise<NestExpressApplication> | undefined;

async function bootstrapApp(): Promise<NestExpressApplication> {
  const config = loadConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app, config);
  await app.init();
  return app;
}

function getApp(): Promise<NestExpressApplication> {
  appPromise ??= bootstrapApp();
  return appPromise;
}

function restoreOriginalUrl(req: IncomingMessage): void {
  const forwarded = req.headers['x-vercel-original-url'] ?? req.headers['x-forwarded-uri'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    req.url = forwarded;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  restoreOriginalUrl(req);
  const app = await getApp();
  const instance = app.getHttpAdapter().getInstance();
  instance(req, res);
}
