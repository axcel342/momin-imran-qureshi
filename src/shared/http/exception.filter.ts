import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, type ErrorCode } from '../domain/errors';
import { sendError } from './send-error';

interface Mapped {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('GlobalExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;
    const mapped = this.map(exception);
    if (mapped.code === 'INTERNAL_ERROR') {
      this.logger.error({ requestId: req.requestId, err: exception instanceof Error ? exception.stack : String(exception) });
    }
    sendError(res, mapped.code, mapped.message, req.requestId, mapped.details);
  }

  private map(exception: unknown): Mapped {
    if (exception instanceof DomainError) {
      return { code: exception.code, message: exception.message, ...(exception.details ? { details: exception.details } : {}) };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 404) return { code: 'NOT_FOUND', message: 'Resource not found' };
      if (status === 413) return { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the size limit' };
      if (status === 400) return { code: 'VALIDATION_FAILED', message: 'Bad request' };
    }
    return { code: 'INTERNAL_ERROR', message: 'Internal server error' };
  }
}
