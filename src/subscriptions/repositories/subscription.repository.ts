import type { Subscription } from '../domain/entities/subscription';

export interface SubscriptionRepository {
  findById(id: string): Promise<Subscription | null>;
  /** SELECT … FOR UPDATE; call inside TransactionRunner.run(). */
  lockById(id: string): Promise<Subscription | null>;
  listByUser(userId: string, limit: number): Promise<Subscription[]>;
  listActiveForUser(userId: string): Promise<Subscription[]>;
  /** Locks the user's ACTIVE subscriptions in id order (fixed lock order). */
  lockActiveForUser(userId: string): Promise<Subscription[]>;
  /** Claims due subscriptions with FOR UPDATE SKIP LOCKED. */
  lockDueForRenewal(now: Date, limit: number): Promise<Subscription[]>;
  save(sub: Subscription): Promise<void>;
}
export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
