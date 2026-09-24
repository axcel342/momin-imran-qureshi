import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { DomainError } from '../domain/errors';
import { RATE_LIMITS, type RateGroup } from '../redis/rate-limit.config';
import { RateLimiter } from '../redis/rate-limiter';
import { RATE_LIMIT_GROUP_KEY } from './decorators';

function groupOf(reflector: Reflector, ctx: ExecutionContext): RateGroup {
  // Routes that forget to declare a group get the strictest limits.
  return reflector.getAllAndOverride<RateGroup | undefined>(RATE_LIMIT_GROUP_KEY, [ctx.getHandler(), ctx.getClass()]) ?? 'auth';
}

async function enforce(limiter: RateLimiter, res: Response, key: string, limit: number): Promise<void> {
  const { allowed, retryAfterSeconds } = await limiter.hit(key, limit);
  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    throw new DomainError('RATE_LIMITED', 'Too many requests', { retryAfterSeconds });
  }
}

@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const group = groupOf(this.reflector, ctx);
    const req = ctx.switchToHttp().getRequest<Request>();
    await enforce(this.limiter, ctx.switchToHttp().getResponse<Response>(), `rl:ip:${group}:${req.ip ?? 'unknown'}`, RATE_LIMITS[group].perIp);
    return true;
  }
}

@Injectable()
export class UserRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const userId = req.actor?.userId ?? (req.verifiedToken as { userId?: string } | undefined)?.userId;
    if (!userId) return true;
    const group = groupOf(this.reflector, ctx);
    await enforce(this.limiter, ctx.switchToHttp().getResponse<Response>(), `rl:user:${group}:${userId}`, RATE_LIMITS[group].perUser);
    return true;
  }
}
