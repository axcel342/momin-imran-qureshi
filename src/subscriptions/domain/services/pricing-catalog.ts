import type { BillingCycle, Tier } from '../value-objects';

export interface Plan {
  maxMessages: number | null; // null = unlimited
  priceCents: Record<BillingCycle, number>;
}

export const PRICING_CATALOG: Readonly<Record<Tier, Plan>> = {
  BASIC: { maxMessages: 10, priceCents: { MONTHLY: 999, YEARLY: 9990 } },
  PRO: { maxMessages: 100, priceCents: { MONTHLY: 2999, YEARLY: 29990 } },
  ENTERPRISE: { maxMessages: null, priceCents: { MONTHLY: 19999, YEARLY: 199990 } },
};

export const priceFor = (tier: Tier, cycle: BillingCycle): number => PRICING_CATALOG[tier].priceCents[cycle];
