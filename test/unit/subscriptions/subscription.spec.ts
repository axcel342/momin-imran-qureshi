import { Subscription } from '../../../src/subscriptions/domain/entities/subscription';

const now = new Date('2026-09-24T12:00:00Z');
const make = (over: Partial<Parameters<typeof Subscription.create>[0]> = {}) =>
  Subscription.create({
    id: 's1',
    userId: 'u1',
    tier: 'BASIC',
    billingCycle: 'MONTHLY',
    autoRenew: true,
    paymentSucceeded: true,
    now,
    ...over,
  });

describe('Subscription lifecycle', () => {
  it('creates an active bundle with catalog quota, price and dates', () => {
    const s = make().toSnapshot();
    expect(s).toMatchObject({
      status: 'ACTIVE',
      inactiveReason: null,
      maxMessages: 10,
      usedMessages: 0,
      priceCents: 999,
      startDate: now,
      endDate: new Date('2026-10-24T12:00:00Z'),
      renewalDate: new Date('2026-10-24T12:00:00Z'),
      autoRenew: true,
      createdAt: now,
    });
    expect(make({ tier: 'PRO', billingCycle: 'YEARLY' }).toSnapshot()).toMatchObject({
      maxMessages: 100,
      priceCents: 29990,
    });
    expect(make({ tier: 'ENTERPRISE' }).toSnapshot().maxMessages).toBeNull();
  });

  it('creates an inactive PAYMENT_FAILED bundle when the first charge fails', () => {
    const s = make({ paymentSucceeded: false });
    expect(s.toSnapshot()).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'PAYMENT_FAILED',
      renewalDate: null,
      autoRenew: false,
    });
    expect(s.isUsableAt(now)).toBe(false);
  });

  it('consumes up to maxMessages then refuses', () => {
    const s = make();
    for (let i = 0; i < 10; i++) s.consume(now);
    expect(s.remaining()).toBe(0);
    expect(s.isUsableAt(now)).toBe(false);
    expect(() => {
      s.consume(now);
    }).toThrow(expect.objectContaining({ code: 'QUOTA_EXHAUSTED' }));
  });

  it('never exhausts an unlimited Enterprise bundle', () => {
    const s = make({ tier: 'ENTERPRISE' });
    for (let i = 0; i < 1000; i++) s.consume(now);
    expect(s.remaining()).toBeNull();
    expect(s.isUsableAt(now)).toBe(true);
    expect(s.toSnapshot().usedMessages).toBe(1000);
  });

  it('is not usable before start or at/after end', () => {
    const s = make();
    expect(s.isUsableAt(new Date('2026-09-24T11:59:59Z'))).toBe(false);
    expect(s.isUsableAt(new Date('2026-10-24T12:00:00Z'))).toBe(false);
  });

  it('toggles auto-renew only while active', () => {
    const s = make();
    s.setAutoRenew(false);
    expect(s.autoRenew).toBe(false);
    s.cancel(now);
    expect(() => {
      s.setAutoRenew(true);
    }).toThrow(expect.objectContaining({ code: 'SUBSCRIPTION_NOT_ACTIVE' }));
  });

  it('cancels immediately and keeps usage history', () => {
    const s = make();
    s.consume(now);
    const at = new Date('2026-09-30T00:00:00Z');
    s.cancel(at);
    expect(s.toSnapshot()).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'CANCELLED',
      endDate: at,
      renewalDate: null,
      autoRenew: false,
      cancelledAt: at,
      usedMessages: 1,
    });
    expect(() => {
      s.cancel(at);
    }).toThrow(expect.objectContaining({ code: 'SUBSCRIPTION_NOT_ACTIVE' }));
  });

  it('renews into the next period on successful payment and resets usage', () => {
    const s = make();
    s.consume(now);
    const due = new Date('2026-10-24T12:00:01Z');
    expect(s.isDueForRenewal(due)).toBe(true);
    s.renew(due, true);
    expect(s.toSnapshot()).toMatchObject({
      status: 'ACTIVE',
      startDate: new Date('2026-10-24T12:00:00Z'),
      endDate: new Date('2026-11-24T12:00:00Z'),
      renewalDate: new Date('2026-11-24T12:00:00Z'),
      usedMessages: 0,
    });
  });

  it('deactivates on failed renewal payment', () => {
    const s = make();
    s.renew(new Date('2026-10-25T00:00:00Z'), false);
    expect(s.toSnapshot()).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'PAYMENT_FAILED',
      renewalDate: null,
    });
  });

  it('expires at period end when auto-renew is off', () => {
    const s = make({ autoRenew: false });
    s.renew(new Date('2026-10-25T00:00:00Z'), undefined);
    expect(s.toSnapshot()).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'EXPIRED',
      renewalDate: null,
    });
  });

  it('ignores renew() when not yet due', () => {
    const s = make();
    s.renew(now, true);
    expect(s.toSnapshot().startDate).toEqual(now);
  });
});
