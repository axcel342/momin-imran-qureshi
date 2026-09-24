import { isAdmin, type Actor } from '../../../shared/domain/actor';

export const ChatAccessPolicy = {
  canListFor: (actor: Actor, targetUserId: string): boolean => isAdmin(actor) || targetUserId === actor.userId,
};
