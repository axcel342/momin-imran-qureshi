import { MonthlyUsage } from '../../../src/chat/domain/entities/monthly-usage';
import type { BundleSnapshot } from '../../../src/chat/domain/ports';
import { QuotaAllocator } from '../../../src/chat/domain/services/quota-allocator';

const now = new Date('2026-09-24T12:00:00Z');
const usage = (freeUsed: number) => new MonthlyUsage('u1', '2026-09', freeUsed, 3, freeUsed);
const bundle = (id: string, over: Partial<BundleSnapshot> = {}): BundleSnapshot => ({
  id,
  remaining: 5,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  startDate: new Date('2026-09-01T00:00:00Z'),
  endDate: new Date('2026-10-01T00:00:00Z'),
  ...over,
});

describe('QuotaAllocator', () => {
  const allocator = new QuotaAllocator();

  it('uses free quota first even when bundles exist', () => {
    expect(allocator.allocate({ usage: usage(2), bundles: [bundle('b1')], now })).toEqual({ source: 'FREE' });
  });

  it('uses the most recently created usable bundle once free quota is exhausted', () => {
    const older = bundle('b-old', { createdAt: new Date('2026-09-01T00:00:00Z') });
    const newer = bundle('b-new', { createdAt: new Date('2026-09-10T00:00:00Z') });
    expect(allocator.allocate({ usage: usage(3), bundles: [older, newer], now })).toEqual({
      source: 'BUNDLE',
      subscriptionId: 'b-new',
    });
  });

  it('breaks createdAt ties by id descending', () => {
    const t = new Date('2026-09-10T00:00:00Z');
    expect(
      allocator.allocate({
        usage: usage(3),
        bundles: [bundle('a', { createdAt: t }), bundle('b', { createdAt: t })],
        now,
      }),
    ).toEqual({
      source: 'BUNDLE',
      subscriptionId: 'b',
    });
  });

  it('skips exhausted, expired and not-yet-started bundles', () => {
    const bundles = [
      bundle('exhausted', { remaining: 0, createdAt: new Date('2026-09-20T00:00:00Z') }),
      bundle('expired', { endDate: now, createdAt: new Date('2026-09-19T00:00:00Z') }),
      bundle('future', {
        startDate: new Date('2026-09-25T00:00:00Z'),
        createdAt: new Date('2026-09-18T00:00:00Z'),
      }),
      bundle('ok', { createdAt: new Date('2026-09-02T00:00:00Z') }),
    ];
    expect(allocator.allocate({ usage: usage(3), bundles, now })).toEqual({
      source: 'BUNDLE',
      subscriptionId: 'ok',
    });
  });

  it('treats a null remaining (Enterprise) as unlimited', () => {
    expect(
      allocator.allocate({ usage: usage(3), bundles: [bundle('ent', { remaining: null })], now }),
    ).toEqual({ source: 'BUNDLE', subscriptionId: 'ent' });
  });

  it('throws a typed QUOTA_EXHAUSTED error with reset details when nothing is available', () => {
    expect(() =>
      allocator.allocate({ usage: usage(3), bundles: [bundle('x', { remaining: 0 })], now }),
    ).toThrow(
      expect.objectContaining({
        code: 'QUOTA_EXHAUSTED',
        details: { freeUsed: 3, freeLimit: 3, freeResetsAt: '2026-10-01T00:00:00.000Z', usableBundles: 0 },
      }),
    );
  });
});

describe('MonthlyUsage', () => {
  it('consumes free quota and tracks totals', () => {
    const u = MonthlyUsage.empty('u1', '2026-09', 3);
    u.consumeFree();
    u.recordBundleUse();
    expect({ freeUsed: u.freeUsed, freeRemaining: u.freeRemaining, total: u.totalMessages }).toEqual({
      freeUsed: 1,
      freeRemaining: 2,
      total: 2,
    });
  });
  it('refuses to consume beyond the free limit', () => {
    const u = usage(3);
    expect(() => {
      u.consumeFree();
    }).toThrow(expect.objectContaining({ code: 'QUOTA_EXHAUSTED' }));
  });
});
