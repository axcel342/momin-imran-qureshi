export type Role = 'USER' | 'ADMIN';

export interface Actor {
  readonly userId: string;
  readonly role: Role;
  readonly sessionId: string;
}

export const isAdmin = (actor: Actor): boolean => actor.role === 'ADMIN';
