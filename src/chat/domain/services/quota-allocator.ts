import { DomainError } from '../../../shared/domain/errors';
import type { MonthlyUsage } from '../entities/monthly-usage';
import { selectBundle } from '../policies/bundle-selection.policy';
import type { BundleSnapshot } from '../ports';
import { UsagePeriod } from './usage-period';

export type Allocation = { source: 'FREE' } | { source: 'BUNDLE'; subscriptionId: string };

const isUsable = (b: BundleSnapshot, now: Date) => b.startDate <= now && now < b.endDate && (b.remaining === null || b.remaining > 0);

export class QuotaAllocator {
  allocate(input: { usage: MonthlyUsage; bundles: readonly BundleSnapshot[]; now: Date }): Allocation {
    if (input.usage.hasFreeRemaining()) return { source: 'FREE' };
    const chosen = selectBundle(input.bundles.filter((b) => isUsable(b, input.now)));
    if (!chosen) {
      throw new DomainError('QUOTA_EXHAUSTED', 'Monthly free quota is used up and no active bundle has remaining messages', {
        freeUsed: input.usage.freeUsed,
        freeLimit: input.usage.freeLimit,
        freeResetsAt: UsagePeriod.fromDate(input.now).resetsAt().toISOString(),
        usableBundles: 0,
      });
    }
    return { source: 'BUNDLE', subscriptionId: chosen.id };
  }
}
