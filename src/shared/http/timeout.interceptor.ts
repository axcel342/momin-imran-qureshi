import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { DomainError } from '../domain/errors';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      timeout(this.config.REQUEST_TIMEOUT_MS),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          req.timedOut = true;
          return throwError(() => new DomainError('REQUEST_TIMEOUT', 'Request timed out'));
        }
        return throwError(() => err);
      }),
    );
  }
}
