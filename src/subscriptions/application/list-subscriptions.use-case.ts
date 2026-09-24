import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../shared/domain/actor';
import { DomainError } from '../../shared/domain/errors';
import type { SubscriptionProps } from '../domain/entities/subscription';
import { SubscriptionAccessPolicy } from '../domain/policies/subscription-access.policy';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepository,
} from '../repositories/subscription.repository';

@Injectable()
export class ListSubscriptionsUseCase {
  constructor(@Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository) {}

  async execute(
    actor: Actor,
    query: { userId?: string | undefined; limit: number },
  ): Promise<SubscriptionProps[]> {
    const target = query.userId ?? actor.userId;
    if (!SubscriptionAccessPolicy.canListFor(actor, target))
      throw new DomainError('FORBIDDEN', 'Cannot list another user’s subscriptions');
    return (await this.subs.listByUser(target, query.limit)).map((s) => s.toSnapshot());
  }
}
