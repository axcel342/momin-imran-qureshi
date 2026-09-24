import { randomUUID } from 'node:crypto';
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Subscriptions API', () => {
  let ctx: TestContext;
  let user: TestClient;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetState(ctx);
    user = await TestClient.register(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  it('creates an active bundle with catalog quota and price', async () => {
    const res = await user.post('/v1/subscriptions', {
      tier: 'PRO',
      billingCycle: 'YEARLY',
      autoRenew: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tier: 'PRO',
      billingCycle: 'YEARLY',
      maxMessages: 100,
      priceCents: 29990,
      status: 'ACTIVE',
      autoRenew: true,
      userId: user.userId,
    });
    expect(new Date(res.body.endDate).getUTCFullYear()).toBe(
      new Date(res.body.startDate).getUTCFullYear() + 1,
    );
  });

  it('returns 402 PAYMENT_FAILED and persists the bundle as inactive when payment fails', async () => {
    ctx.payments.failNext();
    const res = await user.post('/v1/subscriptions', {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
    });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('PAYMENT_FAILED');
    const list = await user.get('/v1/subscriptions');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'PAYMENT_FAILED',
      id: res.body.error.details.subscriptionId,
    });
  });

  it('rejects mass-assignment attempts on create and patch', async () => {
    const create = await user.post('/v1/subscriptions', {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
      userId: randomUUID(),
      maxMessages: 1e6,
    });
    expect(create.status).toBe(400);
    const sub = await user.post('/v1/subscriptions', {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
    });
    const patch = await user.patch(`/v1/subscriptions/${sub.body.id}`, {
      autoRenew: false,
      status: 'ACTIVE',
    });
    expect(patch.status).toBe(400);
  });

  it('toggles auto-renew for the owner', async () => {
    const sub = await user.post('/v1/subscriptions', {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
    });
    const res = await user.patch(`/v1/subscriptions/${sub.body.id}`, { autoRenew: false });
    expect(res.status).toBe(200);
    expect(res.body.autoRenew).toBe(false);
  });

  it('cancels immediately, then refuses to cancel again', async () => {
    const sub = await user.post('/v1/subscriptions', {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
    });
    const res = await user.post(`/v1/subscriptions/${sub.body.id}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'INACTIVE',
      inactiveReason: 'CANCELLED',
      autoRenew: false,
      renewalDate: null,
    });
    const again = await user.post(`/v1/subscriptions/${sub.body.id}/cancel`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SUBSCRIPTION_NOT_ACTIVE');
  });

  it('enforces domain policy: other users get 404, admins may cancel but not toggle auto-renew', async () => {
    const sub = await user.post('/v1/subscriptions', {
      tier: 'BASIC',
      billingCycle: 'MONTHLY',
      autoRenew: true,
    });
    const other = await TestClient.register(ctx);
    expect((await other.post(`/v1/subscriptions/${sub.body.id}/cancel`)).status).toBe(404);
    const admin = await TestClient.register(ctx, { role: 'ADMIN' });
    expect((await admin.patch(`/v1/subscriptions/${sub.body.id}`, { autoRenew: false })).status).toBe(403);
    expect((await admin.post(`/v1/subscriptions/${sub.body.id}/cancel`)).status).toBe(200);
  });

  it('lists only own subscriptions unless admin', async () => {
    await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    const other = await TestClient.register(ctx);
    expect((await other.get(`/v1/subscriptions?userId=${user.userId}`)).status).toBe(403);
    const admin = await TestClient.register(ctx, { role: 'ADMIN' });
    const res = await admin.get(`/v1/subscriptions?userId=${user.userId}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it.each(['?limit=abc', '?limit=0', '?limit=500', '?userId=not-a-uuid', '?foo=bar'])(
    'rejects malformed list query %s with 400 (Review Focus #4)',
    async (qs) => {
      const res = await user.get(`/v1/subscriptions${qs}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    },
  );

  it('rejects a non-uuid id with 400', async () => {
    expect((await user.post('/v1/subscriptions/123/cancel')).status).toBe(400);
  });
});
