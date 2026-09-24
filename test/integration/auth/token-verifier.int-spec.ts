import { randomUUID } from 'node:crypto';
import { SupabaseTokenVerifier } from '../../../src/auth/infrastructure/supabase-token-verifier';
import { loadConfig } from '../../../src/config/env';
import { MockIdp } from '../../support/mock-idp';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('SupabaseTokenVerifier (against a real JWKS endpoint)', () => {
  let idp: MockIdp;
  let verifier: SupabaseTokenVerifier;

  beforeAll(async () => {
    idp = await MockIdp.start();
    verifier = new SupabaseTokenVerifier(loadConfig({ ...process.env, SUPABASE_JWKS_URL: idp.jwksUrl }));
  });
  afterAll(() => idp.stop());

  it('returns identity facts for a valid token', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const authAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const v = await verifier.verify(await idp.token({ userId, sessionId, email: 'a@b.co', authenticatedAt: authAt }));
    expect(v).toEqual({ userId, sessionId, email: 'a@b.co', authenticatedAt: authAt });
  });

  it.each([
    ['wrong issuer', { issuer: 'https://evil.supabase.co/auth/v1' }],
    ['wrong audience', { audience: 'service_role' }],
    ['unknown signing key', { foreignKey: true }],
    ['anonymous user', { isAnonymous: true }],
    ['missing session_id', { omitSessionId: true }],
  ])('rejects %s with INVALID_TOKEN', async (_name, opts) => {
    await expect(verifier.verify(await idp.token(opts))).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('rejects expired tokens with TOKEN_EXPIRED', async () => {
    await expect(verifier.verify(await idp.token({ expiresInSeconds: -60 }))).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
  });

  it('rejects alg:none and garbage with INVALID_TOKEN', async () => {
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: randomUUID(), session_id: randomUUID() })}.`;
    await expect(verifier.verify(none)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    await expect(verifier.verify('not.a.jwt')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});
