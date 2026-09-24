import type { Response } from 'express';
import type { ErrorCode } from '../domain/errors';
import { ERROR_STATUS } from './error-status';

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown>; requestId: string | null };
}

export function sendError(
  res: Response,
  code: ErrorCode,
  message: string,
  requestId: string | undefined,
  details?: Record<string, unknown>,
): void {
  const body: ApiErrorBody = {
    error: { code, message, ...(details ? { details } : {}), requestId: requestId ?? null },
  };
  res.status(ERROR_STATUS[code]).json(body);
}
