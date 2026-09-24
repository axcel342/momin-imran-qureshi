import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../shared/domain/actor';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { DomainError } from '../../shared/domain/errors';
import { Subscription, type SubscriptionProps } from '../domain/entities/subscription';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../domain/ports';
import { priceFor } from '../domain/services/pricing-catalog';
import type { BillingCycle, Tier } from '../domain/value-objects';
import { SUBSCRIPTION_REPOSITORY, type SubscriptionRepository } from '../repositories/subscription.repository';

@Injectable()
export class CreateSubscriptionUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Always creates for the actor themselves (policy: no creating on behalf of others). */
  async execute(actor: Actor, input: { tier: Tier; billingCycle: BillingCycle; autoRenew: boolean }): Promise<SubscriptionProps> {
    const id = randomUUID();
    const payment = await this.payments.charge({ subscriptionId: id, userId: actor.userId, amountCents: priceFor(input.tier, input.billingCycle) });
    const sub = Subscription.create({ id, userId: actor.userId, ...input, paymentSucceeded: payment.ok, now: this.clock.now() });
    await this.subs.save(sub);
    if (!payment.ok) throw new DomainError('PAYMENT_FAILED', 'Payment was declined; the subscription is inactive', { subscriptionId: id });
    return sub.toSnapshot();
  }
}
