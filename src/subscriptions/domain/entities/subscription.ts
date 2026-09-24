import { DomainError } from '../../../shared/domain/errors';
import { addCycle } from '../services/period-calculator';
import { PRICING_CATALOG, priceFor } from '../services/pricing-catalog';
import type { BillingCycle, InactiveReason, SubscriptionStatus, Tier } from '../value-objects';

export interface SubscriptionProps {
  id: string;
  userId: string;
  tier: Tier;
  billingCycle: BillingCycle;
  maxMessages: number | null;
  usedMessages: number;
  priceCents: number;
  autoRenew: boolean;
  status: SubscriptionStatus;
  inactiveReason: InactiveReason | null;
  startDate: Date;
  endDate: Date;
  renewalDate: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export class Subscription {
  private constructor(private props: SubscriptionProps) {}

  static create(input: {
    id: string;
    userId: string;
    tier: Tier;
    billingCycle: BillingCycle;
    autoRenew: boolean;
    paymentSucceeded: boolean;
    now: Date;
  }): Subscription {
    const endDate = addCycle(input.now, input.billingCycle);
    const ok = input.paymentSucceeded;
    return new Subscription({
      id: input.id,
      userId: input.userId,
      tier: input.tier,
      billingCycle: input.billingCycle,
      maxMessages: PRICING_CATALOG[input.tier].maxMessages,
      usedMessages: 0,
      priceCents: priceFor(input.tier, input.billingCycle),
      autoRenew: ok ? input.autoRenew : false,
      status: ok ? 'ACTIVE' : 'INACTIVE',
      inactiveReason: ok ? null : 'PAYMENT_FAILED',
      startDate: input.now,
      endDate,
      renewalDate: ok ? endDate : null,
      cancelledAt: null,
      createdAt: input.now,
    });
  }

  static restore(props: SubscriptionProps): Subscription {
    return new Subscription({ ...props });
  }

  toSnapshot(): SubscriptionProps {
    return { ...this.props };
  }

  get id(): string { return this.props.id; }
  get userId(): string { return this.props.userId; }
  get autoRenew(): boolean { return this.props.autoRenew; }
  get priceCents(): number { return this.props.priceCents; }
  get status(): SubscriptionStatus { return this.props.status; }
  get createdAt(): Date { return this.props.createdAt; }
  get startDate(): Date { return this.props.startDate; }
  get endDate(): Date { return this.props.endDate; }

  remaining(): number | null {
    return this.props.maxMessages === null ? null : Math.max(0, this.props.maxMessages - this.props.usedMessages);
  }

  isUsableAt(now: Date): boolean {
    const p = this.props;
    const remaining = this.remaining();
    return p.status === 'ACTIVE' && p.startDate <= now && now < p.endDate && (remaining === null || remaining > 0);
  }

  consume(now: Date): void {
    if (!this.isUsableAt(now)) throw new DomainError('QUOTA_EXHAUSTED', 'Subscription has no remaining messages');
    this.props.usedMessages += 1;
  }

  setAutoRenew(value: boolean): void {
    this.assertActive();
    this.props.autoRenew = value;
  }

  cancel(now: Date): void {
    this.assertActive();
    Object.assign(this.props, {
      status: 'INACTIVE',
      inactiveReason: 'CANCELLED',
      endDate: now,
      renewalDate: null,
      autoRenew: false,
      cancelledAt: now,
    } satisfies Partial<SubscriptionProps>);
  }

  isDueForRenewal(now: Date): boolean {
    return this.props.status === 'ACTIVE' && this.props.renewalDate !== null && this.props.renewalDate <= now;
  }

  renew(now: Date, paymentSucceeded: boolean | undefined): void {
    if (!this.isDueForRenewal(now)) return;
    if (!this.props.autoRenew) {
      this.deactivate('EXPIRED');
      return;
    }
    if (!paymentSucceeded) {
      this.deactivate('PAYMENT_FAILED');
      return;
    }
    const startDate = this.props.endDate;
    const endDate = addCycle(startDate, this.props.billingCycle);
    Object.assign(this.props, { startDate, endDate, renewalDate: endDate, usedMessages: 0 } satisfies Partial<SubscriptionProps>);
  }

  private deactivate(reason: InactiveReason): void {
    Object.assign(this.props, { status: 'INACTIVE', inactiveReason: reason, renewalDate: null } satisfies Partial<SubscriptionProps>);
  }

  private assertActive(): void {
    if (this.props.status !== 'ACTIVE') throw new DomainError('SUBSCRIPTION_NOT_ACTIVE', 'Subscription is not active');
  }
}
