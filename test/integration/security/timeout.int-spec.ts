import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { TestClient } from '../../support/test-client';

describe('Global timeout on a real route', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp({
      env: { REQUEST_TIMEOUT_MS: '200', AI_MOCK_MIN_LATENCY_MS: '600', AI_MOCK_MAX_LATENCY_MS: '600' },
    });
  });
  beforeEach(() => resetState(ctx));
  afterAll(() => closeTestApp(ctx));

  it('returns 504 and never charges quota for an answer the user did not receive', async () => {
    const user = await TestClient.register(ctx);
    const res = await user.post('/v1/chat/messages', { question: 'slow one' });
    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('REQUEST_TIMEOUT');
    await new Promise((r) => setTimeout(r, 800)); // let the background AI call finish
    expect(await ctx.prisma.chatMessage.count()).toBe(0);
    const usage = await ctx.prisma.monthlyUsage.findFirst({ where: { userId: user.userId } });
    expect(usage?.freeUsed ?? 0).toBe(0);
  });
});
