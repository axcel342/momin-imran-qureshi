export type Tier = 'BASIC' | 'PRO' | 'ENTERPRISE';
export type BillingCycle = 'MONTHLY' | 'YEARLY';
export type SubscriptionStatus = 'ACTIVE' | 'INACTIVE';
export type InactiveReason = 'CANCELLED' | 'PAYMENT_FAILED' | 'EXPIRED';
export const TIERS = ['BASIC', 'PRO', 'ENTERPRISE'] as const;
export const BILLING_CYCLES = ['MONTHLY', 'YEARLY'] as const;
