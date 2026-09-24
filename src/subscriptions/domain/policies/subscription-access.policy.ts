import { isAdmin, type Actor } from '../../../shared/domain/actor';
import { DomainError } from '../../../shared/domain/errors';
import type { Subscription } from '../entities/subscription';

const owns = (actor: Actor, sub: Subscription) => sub.userId === actor.userId;

export const SubscriptionAccessPolicy = {
  canView: (actor: Actor, sub: Subscription): boolean => isAdmin(actor) || owns(actor, sub),
  canCancel: (actor: Actor, sub: Subscription): boolean => isAdmin(actor) || owns(actor, sub),
  canSetAutoRenew: (actor: Actor, sub: Subscription): boolean => owns(actor, sub),
  canListFor: (actor: Actor, targetUserId: string): boolean => isAdmin(actor) || targetUserId === actor.userId,
};

/** Non-admins must not learn that someone else's subscription exists. */
export const accessDenied = (actor: Actor): DomainError =>
  isAdmin(actor) ? new DomainError('FORBIDDEN', 'Not allowed for this subscription') : new DomainError('NOT_FOUND', 'Subscription not found');
