import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Billing cycle', () => {
  let ctx: TestContext;
  let user: TestClient;
  let admin: TestClient;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    user = await TestClient.register(ctx);
    admin = await TestClient.register(ctx, { role: 'ADMIN' });
  });
  afterAll(() => closeTestApp(ctx));

  async function dueSubscription(autoRenew: boolean): Promise<string> {
    const res = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew });
    const past = new Date(Date.now() - 1000);
    await ctx.prisma.subscription.update({ where: { id: res.body.id }, data: { endDate: past, renewalDate: past, usedMessages: 4 } });
    return res.body.id as string;
  }

  it('renews due subscriptions into a fresh period when payment succeeds', async () => {
    const id = await dueSubscription(true);
    const before = await ctx.prisma.subscription.findUniqueOrThrow({ where: { id } });
    const res = await admin.post('/v1/admin/billing/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ processed: 1, renewed: 1, failed: 0, expired: 0 });
    const after = await ctx.prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({ status: 'ACTIVE', usedMessages: 0, startDate: before.endDate });
    expect(after.endDate.getTime()).toBeGreaterThan(Date.now());
  });

  it('marks the subscription inactive when the renewal payment fails', async () => {
    const id = await dueSubscription(true);
    ctx.payments.failNext();
    const res = await admin.post('/v1/admin/billing/run');
    expect(res.body).toEqual({ processed: 1, renewed: 0, failed: 1, expired: 0 });
    expect(await ctx.prisma.subscription.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'INACTIVE', inactiveReason: 'PAYMENT_FAILED' });
  });

  it('expires without charging when auto-renew is off', async () => {
    const id = await dueSubscription(false);
    const callsBefore = ctx.payments.calls;
    const res = await admin.post('/v1/admin/billing/run');
    expect(res.body).toEqual({ processed: 1, renewed: 0, failed: 0, expired: 1 });
    expect(ctx.payments.calls).toBe(callsBefore);
    expect(await ctx.prisma.subscription.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'INACTIVE', inactiveReason: 'EXPIRED' });
  });

  it('does not touch subscriptions that are not yet due', async () => {
    await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    expect((await admin.post('/v1/admin/billing/run')).body.processed).toBe(0);
  });

  it('forbids non-admins at the controller level', async () => {
    const res = await user.post('/v1/admin/billing/run');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
