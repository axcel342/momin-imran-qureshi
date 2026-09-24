import type { NextFunction, Request, Response } from 'express';
import { sendError } from './send-error';

/** Express error middleware placed right after the JSON parser. */
export function bodyErrorMiddleware(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const type = (err as { type?: unknown } | null)?.type;
  if (type === 'entity.too.large') {
    sendError(res, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the size limit', req.requestId);
    return;
  }
  if (type === 'entity.parse.failed') {
    sendError(res, 'VALIDATION_FAILED', 'Malformed JSON body', req.requestId);
    return;
  }
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    sendError(res, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported body encoding', req.requestId);
    return;
  }
  next(err);
}
