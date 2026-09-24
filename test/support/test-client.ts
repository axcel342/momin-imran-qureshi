import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import request, { type Test } from 'supertest';
import type { PublicJwk } from '../../src/auth/domain/ports';
import type { Role } from '../../src/shared/domain/actor';
import { signRequest } from '../../scripts/lib/signer';
import type { TestContext } from './test-app';

export function newKeyPair(): { privateKey: KeyObject; publicKeyJwk: PublicJwk } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, publicKeyJwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! } };
}

export class TestClient {
  private constructor(
    private readonly ctx: TestContext,
    readonly userId: string,
    readonly email: string,
    readonly sessionId: string,
    readonly token: string,
    readonly privateKey: KeyObject,
    readonly publicKeyJwk: PublicJwk,
  ) {}

  static async register(ctx: TestContext, opts: { role?: Role; userId?: string } = {}): Promise<TestClient> {
    const userId = opts.userId ?? randomUUID();
    const sessionId = randomUUID();
    const email = `${userId.slice(0, 8)}@example.com`;
    const token = await ctx.idp.token({ userId, sessionId, email });
    const { privateKey, publicKeyJwk } = newKeyPair();
    const res = await request(ctx.http)
      .post('/v1/auth/device-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ publicKey: publicKeyJwk });
    if (res.status !== 201)
      throw new Error(`device-key registration failed: ${res.status} ${JSON.stringify(res.body)}`);
    if (opts.role === 'ADMIN')
      await ctx.prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });
    return new TestClient(ctx, userId, email, sessionId, token, privateKey, publicKeyJwk);
  }

  headers(
    method: string,
    url: string,
    rawBody = '',
    overrides: { timestamp?: number; nonce?: string; token?: string } = {},
  ) {
    const { token = this.token, ...rest } = overrides;
    return signRequest({ method, url, rawBody, token, privateKey: this.privateKey, ...rest });
  }

  get(url: string): Test {
    return request(this.ctx.http).get(url).set(this.headers('GET', url));
  }

  post(url: string, body?: unknown): Test {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const req = request(this.ctx.http)
      .post(url)
      .set(this.headers('POST', url, raw));
    return body === undefined ? req : req.set('Content-Type', 'application/json').send(raw);
  }

  patch(url: string, body: unknown): Test {
    const raw = JSON.stringify(body);
    return request(this.ctx.http)
      .patch(url)
      .set(this.headers('PATCH', url, raw))
      .set('Content-Type', 'application/json')
      .send(raw);
  }
}
