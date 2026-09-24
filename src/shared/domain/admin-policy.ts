import { isAdmin, type Actor } from './actor';
import { DomainError } from './errors';

export function assertAdmin(actor: Actor): void {
  if (!isAdmin(actor)) throw new DomainError('FORBIDDEN', 'Admin role required');
}
