import { Inject, Injectable } from '@nestjs/common';
import type { BundleQuotaPort, BundleSnapshot } from '../../chat/domain/ports';
import { DomainError } from '../../shared/domain/errors';
import type { Subscription } from '../domain/entities/subscription';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepository,
} from '../repositories/subscription.repository';

const toSnapshot = (s: Subscription): BundleSnapshot => ({
  id: s.id,
  remaining: s.remaining(),
  createdAt: s.createdAt,
  startDate: s.startDate,
  endDate: s.endDate,
});

/** Subscriptions' implementation of the port the chat module defines. */
@Injectable()
export class BundleQuotaAdapter implements BundleQuotaPort {
  constructor(@Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository) {}

  async peekUsableBundles(userId: string, now: Date): Promise<BundleSnapshot[]> {
    return (await this.subs.listActiveForUser(userId)).filter((s) => s.isUsableAt(now)).map(toSnapshot);
  }

  async lockUsableBundles(userId: string, now: Date): Promise<BundleSnapshot[]> {
    return (await this.subs.lockActiveForUser(userId)).filter((s) => s.isUsableAt(now)).map(toSnapshot);
  }

  async consume(subscriptionId: string, now: Date): Promise<void> {
    const sub = await this.subs.findById(subscriptionId);
    if (!sub) throw new DomainError('QUOTA_EXHAUSTED', 'Subscription not available');
    sub.consume(now);
    await this.subs.save(sub);
  }
}
