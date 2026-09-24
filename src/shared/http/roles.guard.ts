import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Role } from '../domain/actor';
import { DomainError } from '../domain/errors';
import { ROLES_KEY } from './decorators';

/** Controller-level RBAC. Signed routes MUST declare @Roles (default deny). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!req.actor) return true; // bearer-only / health-probe routes carry no actor; AuthGuard already vetted them
    if (!roles || !roles.includes(req.actor.role)) throw new DomainError('FORBIDDEN', 'Insufficient role');
    return true;
  }
}
