import request from 'supertest';
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Rate limiting', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetState(ctx));
  afterAll(() => closeTestApp(ctx));

  it('limits chat per user (20/min) with Retry-After, independently of other groups and users', async () => {
    const a = await TestClient.register(ctx);
    const b = await TestClient.register(ctx);
    for (let i = 0; i < 20; i++) expect((await a.get('/v1/chat/messages')).status).toBe(200);
    const limited = await a.get('/v1/chat/messages');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await a.get('/v1/subscriptions')).status).toBe(200); // other group unaffected
    expect((await b.get('/v1/chat/messages')).status).toBe(200); // other user unaffected
  });

  it('limits the auth group per IP (20/min) before any token verification', async () => {
    for (let i = 0; i < 20; i++) expect((await request(ctx.http).post('/v1/auth/device-keys')).status).toBe(401);
    const limited = await request(ctx.http).post('/v1/auth/device-keys');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('limits the auth group per user (10/min)', async () => {
    const a = await TestClient.register(ctx); // 1 auth-group hit for this user
    let last = 200;
    for (let i = 0; i < 10; i++) last = (await a.get('/v1/auth/me')).status;
    expect(last).toBe(429);
  });
});
