import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { VerifiedToken } from '../../auth/domain/ports';
import type { Actor, Role } from '../domain/actor';
import { DomainError } from '../domain/errors';
import type { RateGroup } from '../redis/rate-limit.config';

export const RATE_LIMIT_GROUP_KEY = 'rateLimitGroup';
export const RateLimitGroup = (group: RateGroup) => SetMetadata(RATE_LIMIT_GROUP_KEY, group);

export type AuthMode = 'signed' | 'bearer-only' | 'health-probe';
export const AUTH_MODE_KEY = 'authMode';
/** Bearer token only; used solely by device-key registration (bootstrap step). */
export const BearerOnly = () => SetMetadata(AUTH_MODE_KEY, 'bearer-only' satisfies AuthMode);
/** X-Health-Token only; used solely by /health. */
export const HealthProbe = () => SetMetadata(AUTH_MODE_KEY, 'health-probe' satisfies AuthMode);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.actor) throw new DomainError('UNAUTHENTICATED', 'Authentication required');
  return req.actor;
});

export const CurrentToken = createParamDecorator((_: unknown, ctx: ExecutionContext): VerifiedToken => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.verifiedToken) throw new DomainError('UNAUTHENTICATED', 'Authentication required');
  return req.verifiedToken;
});
