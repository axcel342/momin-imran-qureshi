import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT, type JWK, type KeyLike } from 'jose';
import { TEST_ENV } from './test-env';

export interface TokenOptions {
  userId?: string;
  sessionId?: string;
  email?: string;
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
  authenticatedAt?: Date;
  isAnonymous?: boolean;
  omitSessionId?: boolean;
  foreignKey?: boolean;
}

/** A real HTTP JWKS endpoint + ES256 signer that mints Supabase-shaped access tokens. */
export class MockIdp {
  readonly issuer = `${TEST_ENV.SUPABASE_URL}/auth/v1`;
  private port = 0;

  private constructor(
    private readonly server: Server,
    private readonly privateKey: KeyLike,
    private readonly foreignKey: KeyLike,
  ) {}

  static async start(): Promise<MockIdp> {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const foreign = await generateKeyPair('ES256');
    const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'mock-key-1', alg: 'ES256', use: 'sig' };
    const server = createServer((req, res) => {
      if (req.url === '/jwks.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const idp = new MockIdp(server, privateKey, foreign.privateKey);
    idp.port = (server.address() as AddressInfo).port;
    return idp;
  }

  get jwksUrl(): string {
    return `http://127.0.0.1:${this.port}/jwks.json`;
  }

  async token(opts: TokenOptions = {}): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    const authAt = Math.floor((opts.authenticatedAt ?? new Date()).getTime() / 1000);
    const claims: Record<string, unknown> = {
      email: opts.email ?? 'user@example.com',
      role: 'authenticated',
      aal: 'aal1',
      amr: [{ method: 'password', timestamp: authAt }],
      is_anonymous: opts.isAnonymous ?? false,
    };
    if (!opts.omitSessionId) claims.session_id = opts.sessionId ?? randomUUID();
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: opts.foreignKey ? 'foreign-key' : 'mock-key-1', typ: 'JWT' })
      .setSubject(opts.userId ?? randomUUID())
      .setIssuer(opts.issuer ?? this.issuer)
      .setAudience(opts.audience ?? 'authenticated')
      .setIssuedAt(nowSec - 1)
      .setExpirationTime(nowSec + (opts.expiresInSeconds ?? 3600))
      .sign(opts.foreignKey ? this.foreignKey : this.privateKey);
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server.close(() => {
        resolve();
      }),
    );
  }
}
