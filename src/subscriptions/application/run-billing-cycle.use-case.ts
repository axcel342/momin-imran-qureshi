import { Inject, Injectable, Logger } from '@nestjs/common';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../shared/application/transaction-runner';
import type { Actor } from '../../shared/domain/actor';
import { assertAdmin } from '../../shared/domain/admin-policy';
import { CLOCK, type Clock } from '../../shared/domain/clock';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../domain/ports';
import { SUBSCRIPTION_REPOSITORY, type SubscriptionRepository } from '../repositories/subscription.repository';

export interface BillingSummary {
  processed: number;
  renewed: number;
  failed: number;
  expired: number;
}

const BATCH_SIZE = 10; // keeps each transaction well under the 5s timeout
const MAX_BATCHES = 100;

@Injectable()
export class RunBillingCycleUseCase {
  private readonly logger = new Logger('RunBillingCycle');

  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY) private readonly subs: SubscriptionRepository,
    @Inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
    @Inject(TRANSACTION_RUNNER) private readonly tx: TransactionRunner,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(trigger: Actor | 'scheduler'): Promise<BillingSummary> {
    if (trigger !== 'scheduler') assertAdmin(trigger);
    const summary: BillingSummary = { processed: 0, renewed: 0, failed: 0, expired: 0 };
    const now = this.clock.now();
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const count = await this.tx.run(async () => {
        const due = await this.subs.lockDueForRenewal(now, BATCH_SIZE);
        for (const sub of due) {
          const payment = sub.autoRenew ? await this.payments.charge({ subscriptionId: sub.id, userId: sub.userId, amountCents: sub.priceCents }) : undefined;
          sub.renew(now, payment?.ok);
          await this.subs.save(sub);
          summary.processed++;
          if (!payment) summary.expired++;
          else if (payment.ok) summary.renewed++;
          else summary.failed++;
          this.logger.log({ msg: 'subscription billed', subscriptionId: sub.id, outcome: payment ? (payment.ok ? 'renewed' : 'payment_failed') : 'expired' });
        }
        return due.length;
      });
      if (count < BATCH_SIZE) break;
    }
    return summary;
  }
}
