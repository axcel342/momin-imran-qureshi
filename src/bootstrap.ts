import './shared/http/request.types';
import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AppConfig } from './config/env';
import { bodyErrorMiddleware } from './shared/http/body-error.middleware';
import { contentTypeMiddleware } from './shared/http/content-type.middleware';
import { requestIdMiddleware } from './shared/http/request-id.middleware';
import { requestLogger } from './shared/logging/request-logger.middleware';

export const BODY_LIMIT = '16kb';
export const SIGNATURE_HEADERS = ['X-Signature', 'X-Signature-Timestamp', 'X-Signature-Nonce'];

export function configureApp(
  app: NestExpressApplication,
  config: AppConfig,
  opts: { logStream?: pino.DestinationStream } = {},
): void {
  const logger = pino(
    {
      level: config.LOG_LEVEL,
      base: undefined,
      redact: { paths: ['req.headers.authorization', 'req.headers["x-signature"]', 'req.headers["x-health-token"]'], censor: '[REDACTED]' },
    },
    opts.logStream,
  );

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY ? 1 : false);
  app.use(requestIdMiddleware);
  app.use(requestLogger(logger));
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.enableCors({
    origin: (origin, cb) => {
      cb(null, origin !== undefined && config.CORS_ORIGINS.includes(origin));
    },
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', ...SIGNATURE_HEADERS],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    credentials: false,
    maxAge: 600,
  });
  app.use(contentTypeMiddleware);
  app.use(
    express.json({
      limit: BODY_LIMIT,
      strict: true,
      type: 'application/json',
      verify: (req, _res, buf) => {
        (req as unknown as express.Request).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(bodyErrorMiddleware);
}
