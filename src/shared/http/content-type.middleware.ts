import type { NextFunction, Request, Response } from 'express';
import { sendError } from './send-error';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export function contentTypeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const hasBody =
    Number(req.headers['content-length'] ?? '0') > 0 || req.headers['transfer-encoding'] !== undefined;
  if (!hasBody) {
    next();
    return;
  }
  if (!BODY_METHODS.has(req.method)) {
    sendError(res, 'VALIDATION_FAILED', `A request body is not allowed for ${req.method}`, req.requestId);
    return;
  }
  if (req.is('application/json') !== 'application/json') {
    sendError(res, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json', req.requestId);
    return;
  }
  next();
}
