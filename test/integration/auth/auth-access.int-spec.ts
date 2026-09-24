import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { closeTestApp, createTestApp, resetState, type TestContext } from '../../support/test-app';
import { newKeyPair, TestClient } from '../../support/test-client';
import { signRequest } from '../../../scripts/lib/signer';

describe('Authenticated API access', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(() => resetState(ctx));
  afterAll(() => closeTestApp(ctx));

  const code = (res: request.Response) => (res.body as { error?: { code?: string } }).error?.code;

  it('happy path: registered key + signed request returns the user', async () => {
    const client = await TestClient.register(ctx);
    const res = await client.get('/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: client.userId, email: client.email, role: 'USER' });
  });

  it('rejects missing or non-bearer credentials with UNAUTHENTICATED', async () => {
    expect(code(await request(ctx.http).get('/v1/auth/me'))).toBe('UNAUTHENTICATED');
    expect(code(await request(ctx.http).get('/v1/auth/me').set('Authorization', 'Basic abc'))).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('rejects invalid and expired tokens', async () => {
    const bad = await ctx.idp.token({ audience: 'service_role' });
    expect(code(await request(ctx.http).get('/v1/auth/me').set('Authorization', `Bearer ${bad}`))).toBe(
      'INVALID_TOKEN',
    );
    const expired = await ctx.idp.token({ expiresInSeconds: -60 });
    expect(code(await request(ctx.http).get('/v1/auth/me').set('Authorization', `Bearer ${expired}`))).toBe(
      'TOKEN_EXPIRED',
    );
  });

  it('requires a signature: a valid token alone is not sufficient', async () => {
    const client = await TestClient.register(ctx);
    const res = await request(ctx.http).get('/v1/auth/me').set('Authorization', `Bearer ${client.token}`);
    expect(res.status).toBe(401);
    expect(code(res)).toBe('SIGNATURE_REQUIRED');
  });

  it('rejects a signed request from a session with no bound key', async () => {
    const token = await ctx.idp.token();
    const { privateKey } = newKeyPair();
    const headers = signRequest({ method: 'GET', url: '/v1/auth/me', rawBody: '', token, privateKey });
    expect(code(await request(ctx.http).get('/v1/auth/me').set(headers))).toBe('KEY_NOT_BOUND');
  });

  it('rejects a stolen token used with the attacker’s own key', async () => {
    const victim = await TestClient.register(ctx);
    const attacker = newKeyPair();
    const headers = signRequest({
      method: 'GET',
      url: '/v1/auth/me',
      rawBody: '',
      token: victim.token,
      privateKey: attacker.privateKey,
    });
    expect(code(await request(ctx.http).get('/v1/auth/me').set(headers))).toBe('INVALID_SIGNATURE');
  });

  it('rejects a new token for another session of the same user (key is session-bound)', async () => {
    const client = await TestClient.register(ctx);
    const otherSession = await ctx.idp.token({ userId: client.userId, sessionId: randomUUID() });
    const res = await request(ctx.http)
      .get('/v1/auth/me')
      .set(client.headers('GET', '/v1/auth/me', '', { token: otherSession }));
    expect(code(res)).toBe('KEY_NOT_BOUND');
  });

  it('rejects a session_id reused under a different subject', async () => {
    const client = await TestClient.register(ctx);
    const forged = await ctx.idp.token({ userId: randomUUID(), sessionId: client.sessionId });
    const res = await request(ctx.http)
      .get('/v1/auth/me')
      .set(client.headers('GET', '/v1/auth/me', '', { token: forged }));
    expect(code(res)).toBe('KEY_NOT_BOUND');
  });

  it('rejects tampered URLs, stale or future timestamps, and replays', async () => {
    const client = await TestClient.register(ctx);
    const tampered = await request(ctx.http).get('/v1/auth/me?x=1').set(client.headers('GET', '/v1/auth/me'));
    expect(code(tampered)).toBe('INVALID_SIGNATURE');
    const now = Math.floor(Date.now() / 1000);
    const stale = await request(ctx.http)
      .get('/v1/auth/me')
      .set(client.headers('GET', '/v1/auth/me', '', { timestamp: now - 120 }));
    expect(code(stale)).toBe('REQUEST_EXPIRED');
    const future = await request(ctx.http)
      .get('/v1/auth/me')
      .set(client.headers('GET', '/v1/auth/me', '', { timestamp: now + 120 }));
    expect(code(future)).toBe('REQUEST_EXPIRED');
    const headers = client.headers('GET', '/v1/auth/me');
    expect((await request(ctx.http).get('/v1/auth/me').set(headers)).status).toBe(200);
    expect(code(await request(ctx.http).get('/v1/auth/me').set(headers))).toBe('REPLAY_DETECTED');
  });

  describe('device-key registration', () => {
    it('rejects a second key for the same session', async () => {
      const client = await TestClient.register(ctx);
      const res = await request(ctx.http)
        .post('/v1/auth/device-keys')
        .set('Authorization', `Bearer ${client.token}`)
        .send({ publicKey: newKeyPair().publicKeyJwk });
      expect(res.status).toBe(409);
      expect(code(res)).toBe('KEY_ALREADY_BOUND');
    });

    it('rejects binding more than 300s after authentication', async () => {
      const token = await ctx.idp.token({ authenticatedAt: new Date(Date.now() - 10 * 60 * 1000) });
      const res = await request(ctx.http)
        .post('/v1/auth/device-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ publicKey: newKeyPair().publicKeyJwk });
      expect(res.status).toBe(403);
      expect(code(res)).toBe('KEY_BINDING_WINDOW_CLOSED');
    });

    it('rejects private-key material and off-curve points without creating a binding (Review Focus #5)', async () => {
      const token = await ctx.idp.token();
      const { publicKeyJwk } = newKeyPair();
      const withD = await request(ctx.http)
        .post('/v1/auth/device-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({ publicKey: { ...publicKeyJwk, d: randomBytes(32).toString('base64url') } });
      expect(withD.status).toBe(400);
      const offCurve = await request(ctx.http)
        .post('/v1/auth/device-keys')
        .set('Authorization', `Bearer ${token}`)
        .send({
          publicKey: {
            kty: 'EC',
            crv: 'P-256',
            x: randomBytes(32).toString('base64url'),
            y: randomBytes(32).toString('base64url'),
          },
        });
      expect(offCurve.status).toBe(400);
      expect(await ctx.prisma.deviceBinding.count()).toBe(0);
    });
  });

  it('keeps admins and users distinct in /auth/me', async () => {
    const admin = await TestClient.register(ctx, { role: 'ADMIN' });
    expect((await admin.get('/v1/auth/me')).body.role).toBe('ADMIN');
  });
});
