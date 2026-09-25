import type { IncomingMessage, ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/env';

export const config = { helpers: false };

let appPromise: Promise<NestExpressApplication> | undefined;

async function bootstrapApp(): Promise<NestExpressApplication> {
  const appConfig = loadConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configureApp(app, appConfig);
  await app.init();
  return app;
}

function getApp(): Promise<NestExpressApplication> {
  appPromise ??= bootstrapApp().catch((error: unknown) => {
    appPromise = undefined;
    throw error;
  });
  return appPromise;
}

function restoreOriginalUrl(req: IncomingMessage): void {
  const forwarded = req.headers['x-vercel-original-url'] ?? req.headers['x-forwarded-uri'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    req.url = forwarded;
  }
}

function sendInternalError(res: ServerResponse): void {
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: null } }),
  );
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  restoreOriginalUrl(req);
  let app: NestExpressApplication;
  try {
    app = await getApp();
  } catch (error) {
    console.error('[api] bootstrap failed', error);
    sendInternalError(res);
    return;
  }
  const instance = app.getHttpAdapter().getInstance();
  instance(req, res);
}
