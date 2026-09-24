import type { NextFunction, Request, Response } from 'express';
import type { Logger } from 'pino';

export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info(
        {
          requestId: req.requestId,
          userId: req.actor?.userId ?? null,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          statusCode: res.statusCode,
          responseTimeMs: Math.round(Number(process.hrtime.bigint() - started) / 1e4) / 100,
        },
        'request completed',
      );
    });
    next();
  };
}
