import { Writable } from 'node:stream';
import request from 'supertest';
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Observability', () => {
  let ctx: TestContext;
  const lines: Record<string, unknown>[] = [];
  const logStream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString().split('\n').filter(Boolean)) lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });

  beforeAll(async () => {
    ctx = await createTestApp({ env: { LOG_LEVEL: 'info' }, logStream });
  });
  beforeEach(() => resetState(ctx));
  afterAll(() => closeTestApp(ctx));

  it('protects /health with the probe token', async () => {
    expect((await request(ctx.http).get('/health')).status).toBe(401);
    expect((await request(ctx.http).get('/health').set('X-Health-Token', 'wrong-token-wrong-token')).status).toBe(401);
    const ok = await request(ctx.http).get('/health').set('X-Health-Token', ctx.config.HEALTH_CHECK_TOKEN);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('serves usage and subscription metrics to admins only', async () => {
    const user = await TestClient.register(ctx);
    await user.post('/v1/chat/messages', { question: 'hello' });
    await user.post('/v1/subscriptions', { tier: 'PRO', billingCycle: 'MONTHLY', autoRenew: true });
    expect((await user.get('/v1/admin/metrics')).status).toBe(403);
    const admin = await TestClient.register(ctx, { role: 'ADMIN' });
    const res = await admin.get('/v1/admin/metrics');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      users: 2,
      chat: { messagesThisMonth: 1, free: 1, bundle: 0 },
      subscriptions: { activeByTier: { BASIC: 0, PRO: 1, ENTERPRISE: 0 }, inactiveByReason: { CANCELLED: 0, PAYMENT_FAILED: 0, EXPIRED: 0 } },
    });
    expect(res.body.chat.tokensThisMonth).toBeGreaterThan(0);
  });

  it('logs request id, user id and response time as structured JSON without secrets', async () => {
    const user = await TestClient.register(ctx);
    lines.length = 0;
    const res = await user.get('/v1/auth/me');
    await new Promise((r) => setImmediate(r));
    const entry = lines.find((l) => l.path === '/v1/auth/me');
    expect(entry).toMatchObject({ requestId: res.headers['x-request-id'], userId: user.userId, statusCode: 200, method: 'GET' });
    expect(typeof entry?.responseTimeMs).toBe('number');
    expect(JSON.stringify(lines)).not.toContain(user.token);
  });
});
