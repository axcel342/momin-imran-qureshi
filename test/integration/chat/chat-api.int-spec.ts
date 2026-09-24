import request from 'supertest';
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Chat API', () => {
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

  const ask = (c: TestClient, question = 'What is DDD?') => c.post('/v1/chat/messages', { question });
  const exhaustFree = async (c: TestClient) => {
    for (let i = 0; i < 3; i++) expect((await ask(c)).status).toBe(201);
  };

  it('answers with a mocked OpenAI response and stores question, answer, tokens and metadata', async () => {
    const res = await ask(user, 'How do transactions work?');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      question: 'How do transactions work?',
      model: 'gpt-4o-mini',
      quota: { source: 'FREE', subscriptionId: null, freeRemaining: 2 },
    });
    expect(res.body.usage.totalTokens).toBe(Number(res.body.usage.promptTokens) + Number(res.body.usage.completionTokens));
    const row = await ctx.prisma.chatMessage.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({ userId: user.userId, question: 'How do transactions work?', answer: res.body.answer, requestId: res.headers['x-request-id'] });
  });

  it('gives 3 free messages then a typed 402 QUOTA_EXHAUSTED', async () => {
    await exhaustFree(user);
    const res = await ask(user);
    expect(res.status).toBe(402);
    expect(res.body.error).toMatchObject({ code: 'QUOTA_EXHAUSTED', details: { freeUsed: 3, freeLimit: 3, usableBundles: 0 } });
  });

  it('charges the newest bundle after free quota', async () => {
    const older = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    const newer = await user.post('/v1/subscriptions', { tier: 'PRO', billingCycle: 'MONTHLY', autoRenew: true });
    await exhaustFree(user);
    const res = await ask(user);
    expect(res.status).toBe(201);
    expect(res.body.quota).toMatchObject({ source: 'BUNDLE', subscriptionId: newer.body.id });
    expect((await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: newer.body.id } })).usedMessages).toBe(1);
    expect((await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: older.body.id } })).usedMessages).toBe(0);
  });

  it('never charges a cancelled or expired bundle (Review Focus #3)', async () => {
    const cancelled = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    await user.post(`/v1/subscriptions/${cancelled.body.id}/cancel`);
    const expired = await user.post('/v1/subscriptions', { tier: 'PRO', billingCycle: 'MONTHLY', autoRenew: true });
    await ctx.prisma.subscription.update({ where: { id: expired.body.id }, data: { endDate: new Date(Date.now() - 1000) } });
    await exhaustFree(user);
    const res = await ask(user);
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('QUOTA_EXHAUSTED');
  });

  it('is atomic under concurrency: 10 parallel requests with 3 free left → exactly 3 succeed', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => ask(user, `parallel ${i}`)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 402)).toHaveLength(7);
    const usage = await ctx.prisma.monthlyUsage.findFirstOrThrow({ where: { userId: user.userId } });
    expect(usage.freeUsed).toBe(3);
    expect(await ctx.prisma.chatMessage.count({ where: { userId: user.userId } })).toBe(3);
  });

  it('never over-draws a bundle under concurrency', async () => {
    const sub = await user.post('/v1/subscriptions', { tier: 'BASIC', billingCycle: 'MONTHLY', autoRenew: true });
    await exhaustFree(user);
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => ask(user, `drain ${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect((await ctx.prisma.subscription.findUniqueOrThrow({ where: { id: sub.body.id } })).usedMessages).toBe(10);
  });

  it('sanitises markup, rejects markup-only questions and keeps emoji (Review Focus #1)', async () => {
    const xss = await ask(user, '<script>alert(1)</script>What is 2+2?');
    expect(xss.status).toBe(201);
    expect(xss.body.question).toBe('What is 2+2?');
    expect(xss.body.answer).not.toMatch(/<script/i);
    expect((await ask(user, '<b></b>')).status).toBe(400);
    const emoji = await ask(user, 'Explain 🚀 rockets');
    expect(emoji.status).toBe(201);
    expect(emoji.body.question).toBe('Explain 🚀 rockets');
  });

  it('rejects a body that differs from the signed body', async () => {
    const signedRaw = JSON.stringify({ question: 'harmless' });
    const res = await request(ctx.http)
      .post('/v1/chat/messages')
      .set(user.headers('POST', '/v1/chat/messages', signedRaw))
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ question: 'tampered' }));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('lists own history; users cannot list others; admins can', async () => {
    await ask(user);
    const own = await user.get('/v1/chat/messages');
    expect(own.body.items).toHaveLength(1);
    const other = await TestClient.register(ctx);
    expect((await other.get(`/v1/chat/messages?userId=${user.userId}`)).status).toBe(403);
    const admin = await TestClient.register(ctx, { role: 'ADMIN' });
    expect((await admin.get(`/v1/chat/messages?userId=${user.userId}`)).body.items).toHaveLength(1);
  });
});
