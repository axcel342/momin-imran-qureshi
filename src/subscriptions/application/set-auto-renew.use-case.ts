import { Inject, Injectable } from '@nestjs/common';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../shared/application/transaction-runner';
import type { Actor } from '../../shared/domain/actor';
import { DomainError } from '../../shared/domain/errors';
import type { SubscriptionProps } from '../domain/entities/subscription';
import { accessDenied, SubscriptionAccessPolicy } from '../domain/policies/subscription-access.policy';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepository,
} from '../repositories/subscription.repository';

@Injectable()
export class SetAutoRenewUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
  ) {}

  execute(actor: Actor, id: string, autoRenew: boolean): Promise<SubscriptionProps> {
    return this.tx.run(async () => {
      const sub = await this.subs.lockById(id);
      if (!sub) throw new DomainError('NOT_FOUND', 'Subscription not found');
      if (!SubscriptionAccessPolicy.canSetAutoRenew(actor, sub)) throw accessDenied(actor);
      sub.setAutoRenew(autoRenew);
      await this.subs.save(sub);
      return sub.toSnapshot();
    });
  }
}
